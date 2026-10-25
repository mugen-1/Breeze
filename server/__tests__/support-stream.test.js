'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { createHub } = require('../lib/support-events');
const { createStream } = require('../middleware/support-stream');
const { SupportError } = require('../lib/customer-support');
const wait = ms => new Promise(r => setTimeout(r, ms));
const principal = { kind: 'customer', userId: 1, firebaseUid: 'fixture' };
function request(extra = {}) { return { headers: { accept: 'text/event-stream' }, query: {}, ...extra }; }
class Response extends EventEmitter {
  constructor() { super(); this.frames = []; this.headers = {}; this.writableEnded = false; this.destroyed = false; }
  status(code) { this.statusCode = code; return this; }
  set(name, value) { if (typeof name === 'object') Object.assign(this.headers, name); else this.headers[name] = value; return this; }
  flushHeaders() { this.headersSent = true; }
  write(frame) { this.frames.push(frame); return !this.blocked; }
  end() { this.writableEnded = true; this.emit('close'); }
}
function fixture(t, options = {}) {
  const hub = createHub(), state = { checks: 0, fail: null, gate: null, scope: { kind: 'customer', userId: 1, conversationId: '10' } };
  const stream = createStream({ hub, authorize: async () => {
    state.checks++; if (state.gate) await state.gate; if (state.fail) throw state.fail; return { ...state.scope };
  }, ...options });
  t.after(() => stream.closeAll()); return { stream, hub, state, res: new Response() };
}
test('hub carries bounded hints, unsubscribes and isolates broken subscribers', t => {
  const hub = createHub(), seen = [], old = console.error; console.error = () => {};
  t.after(() => { console.error = old; });
  const stop = hub.subscribe(x => seen.push(x)); hub.subscribe(() => { throw Error('fixture'); });
  hub.publish({ conversationId: '10', customerId: 1 }); stop(); hub.publish({ conversationId: '20', customerId: 2 });
  assert.equal(seen.length, 1); assert.equal(hub.size, 1);
});
test('SSE headers, initial resync hint and cleanup on socket close', async t => {
  const { stream, hub, res } = fixture(t); await stream.open(request(), res, principal);
  assert.equal(res.statusCode, 200); assert.match(res.headers['Content-Type'], /^text\/event-stream/);
  assert.equal(res.headers['X-Accel-Buffering'], 'no'); assert.match(res.headers['Cache-Control'], /no-store.*no-transform/);
  assert.deepEqual(res.frames, ['event: ready\ndata: {}\n\n']); assert.equal(stream.size, 1); assert.equal(hub.size, 1);
  res.destroyed = true; res.emit('close'); assert.equal(stream.size, 0); assert.equal(hub.size, 0);
});
test('customer gets only own conversation or own newly created conversation hint', async t => {
  const { stream, hub, state, res } = fixture(t); await stream.open(request(), res, principal);
  hub.publish({ conversationId: '20', customerId: 2 }); await wait(5); assert.equal(state.checks, 1);
  hub.publish({ conversationId: '10', customerId: 1 }); await wait(5);
  assert.equal(res.frames.filter(x => x.startsWith('event: change')).length, 1);
  assert.doesNotMatch(res.frames.join(''), /conversationId|customerId|fixture/);
});
test('account with no chat receives first-create hint from a different device', async t => {
  const { stream, hub, state, res } = fixture(t); state.scope.conversationId = null;
  await stream.open(request(), res, principal); state.scope.conversationId = '30';
  hub.publish({ conversationId: '30', customerId: 1 }); await wait(5);
  assert.ok(res.frames.some(x => x.startsWith('event: change')));
});
test('Admin receives inbox changes without message payload or peer identifiers', async t => {
  const { stream, hub, state, res } = fixture(t); state.scope = { kind: 'admin', userId: 9 };
  await stream.open(request(), res, { kind: 'admin', userId: 9 });
  hub.publish({ conversationId: '99', customerId: 2 }); await wait(5);
  assert.deepEqual(res.frames.slice(-1), ['event: change\ndata: {}\n\n']);
});
test('shared read changes notify Admin only, without waking customer or guest streams', async t => {
  const customer = fixture(t), admin = fixture(t), guest = fixture(t);
  admin.state.scope = { kind: 'admin', userId: 9 };
  guest.state.scope = { kind: 'guest', conversationId: '10', leaseMs: 300000 };
  await customer.stream.open(request(), customer.res, principal);
  await admin.stream.open(request(), admin.res, { kind: 'admin', userId: 9 });
  await guest.stream.open(request(), guest.res, { kind: 'guest', hash: Buffer.alloc(32) });
  for (const f of [customer, admin, guest]) f.hub.publish({ audience: 'admin', conversationId: '10' });
  await wait(5);
  assert.equal(customer.res.frames.length, 1); assert.equal(guest.res.frames.length, 1);
  assert.deepEqual(admin.res.frames.slice(-1), ['event: change\ndata: {}\n\n']);
});
test('merge invalidation scopes reset IDs to Admin and resets only own customer history', async t => {
  const customer = fixture(t), admin = fixture(t); admin.state.scope = { kind: 'admin', userId: 9 };
  await customer.stream.open(request(), customer.res, principal); await admin.stream.open(request(), admin.res, { kind: 'admin', userId: 9 });
  for (const f of [customer, admin]) f.hub.publish({ conversationId: '10', customerId: 1, reset: true });
  await wait(5);
  assert.equal(customer.res.frames.slice(-1)[0], 'event: change\ndata: {"reset":true}\n\n');
  assert.equal(admin.res.frames.slice(-1)[0], 'event: change\ndata: {"resetConversations":["10"]}\n\n');
  assert.doesNotMatch(customer.res.frames.join(''), /conversationId|resetConversations|10/);
});
for (const status of [401, 403]) test('permission loss ' + status + ' closes before any change hint', async t => {
  const { stream, hub, state, res } = fixture(t); await stream.open(request(), res, principal);
  state.fail = new SupportError(status, 'PRIVATE', 'PRIVATE raw detail'); hub.publish({ conversationId: '10' }); await wait(5);
  assert.ok(res.frames.includes('event: auth-lost\ndata: {"status":' + status + '}\n\n'));
  assert.ok(!res.frames.some(x => x.startsWith('event: change'))); assert.doesNotMatch(res.frames.join(''), /PRIVATE/);
  assert.equal(stream.size, 0); assert.equal(hub.size, 0);
});
test('idle stream rechecks authorization without polling messages', async t => {
  const { stream, state, res } = fixture(t, { checkMs: 10 }); await stream.open(request(), res, principal);
  state.fail = new SupportError(401, 'expired', 'expired'); await wait(35);
  assert.equal(stream.size, 0); assert.ok(res.writableEnded);
});
test('guest lease expiry rechecks and closes without treating transport as activity', async t => {
  const { stream, state, res } = fixture(t); state.scope = { kind: 'guest', conversationId: '10', leaseMs: 10 };
  await stream.open(request(), res, { kind: 'guest', hash: Buffer.alloc(32) });
  state.fail = new SupportError(401, 'expired', 'expired'); await wait(30);
  assert.equal(stream.size, 0); assert.ok(res.frames.some(x => x.startsWith('event: auth-lost')));
});
test('transport pings do not invoke an activity endpoint', async t => {
  const { stream, state, res } = fixture(t, { pingMs: 5, checkMs: 60000 }); await stream.open(request(), res, principal); await wait(20);
  assert.ok(res.frames.some(x => x.startsWith(': keep-alive'))); assert.equal(state.checks, 1);
});
test('slow consumer cannot grow an unbounded stream buffer', async t => {
  const { stream, hub, res } = fixture(t); res.blocked = true; await stream.open(request(), res, principal);
  assert.equal(stream.size, 0); assert.equal(hub.size, 0); assert.ok(res.writableEnded);
});
test('notification burst coalesces while authorization is pending', async t => {
  const { stream, hub, state, res } = fixture(t); await stream.open(request(), res, principal);
  let release; state.gate = new Promise(r => { release = r; });
  for (let i = 0; i < 100; i++) hub.publish({ conversationId: '10' });
  assert.equal(state.checks, 2); state.gate = null; release(); await wait(5);
  assert.ok(state.checks <= 3); assert.ok(res.frames.length <= 3);
});
test('capacity is bounded and released after disconnect', async t => {
  const { stream, res } = fixture(t, { maxPerIdentity: 1 }); await stream.open(request(), res, principal);
  const rejected = new Response(); await assert.rejects(() => stream.open(request(), rejected, principal), e => e.status === 429);
  assert.equal(rejected.headers['Retry-After'], '30'); res.emit('close');
  await stream.open(request(), new Response(), principal); assert.equal(stream.size, 1);
});
test('no query tokens, peer IDs, wrong media type or untrusted origin accepted', async t => {
  const { stream, state } = fixture(t);
  for (const query of [{ token: 'secret' }, { conversationId: '20' }, { role: 'admin' }]) {
    await assert.rejects(() => stream.open(request({ query }), new Response(), principal), e => e.status === 400);
  }
  await assert.rejects(() => stream.open(request({ headers: {} }), new Response(), principal), e => e.status === 406);
  await assert.rejects(() => stream.open(request({ headers: { accept: 'text/event-stream', origin: 'https://untrusted.example' } }), new Response(), principal), e => e.status === 403);
  assert.equal(state.checks, 0);
});
test('SQL failure after connection sends generic unavailable and unsubscribes', async t => {
  const { stream, hub, state, res } = fixture(t); await stream.open(request(), res, principal);
  state.fail = Error('PRIVATE SQL error'); hub.publish({ conversationId: '10' }); await wait(5);
  assert.ok(res.frames.includes('event: unavailable\ndata: {}\n\n')); assert.doesNotMatch(res.frames.join(''), /PRIVATE/); assert.equal(hub.size, 0);
});
test('rotating a long-lived stream ends it for fresh token on reconnect', async t => {
  const { stream, res } = fixture(t, { lifetimeMs: 1000 }); await stream.open(request(), res, principal);
  await wait(1050); assert.ok(res.writableEnded); assert.equal(stream.size, 0);
});
