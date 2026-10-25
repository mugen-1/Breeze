'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const support = require('../lib/customer-support');
const valid = () => ({ text: 'Xin chào 🌿\n<script>nguyên văn</script>', clientMessageId: randomUUID() });
const bad = fn => assert.throws(fn, e => e instanceof support.SupportError && e.status === 400);
test('message preserves Unicode, line breaks and raw text; canonicalizes UUID', () => {
  const value = valid(); value.clientMessageId = value.clientMessageId.toUpperCase();
  assert.deepEqual(support.messageInput(value), { text: value.text, key: value.clientMessageId.toLowerCase() });
});
for (const text of [undefined, null, 3, [], '', ' \n\t', 'a\0b', 'x'.repeat(100001)]) {
  test('reject invalid message text: ' + typeof text + '/' + String(text).length, () => bad(() => support.messageInput({ ...valid(), text })));
}
for (const key of ['', null, 1, 'not-a-uuid', '00000000-0000-0000-0000-000000000000', 'x'.repeat(1000)]) {
  test('reject invalid retry key ' + String(key).slice(0, 40), () => bad(() => support.messageInput({ ...valid(), clientMessageId: key })));
}
for (const field of ['userId', 'conversationId', 'role', 'adminActorId', 'sender_kind', 'createdAt', 'system_code', 'token']) {
  test('reject forged field ' + field, () => bad(() => support.messageInput({ ...valid(), [field]: 'forged' })));
}
for (const input of [null, [], 'text', 4]) test('reject non-object body ' + JSON.stringify(input), () => bad(() => support.messageInput(input)));
test('guest input trims contact details but preserves message', () => {
  const value = { ...valid(), name: '  Trúc  ', email: '  truc@example.test  ' };
  assert.deepEqual(support.guestInput(value), { name: 'Trúc', email: 'truc@example.test', message: support.messageInput(validWith(value)) });
});
function validWith(value) { return { text: value.text, clientMessageId: value.clientMessageId }; }
for (const change of [{ name: '' }, { name: 'a'.repeat(151) }, { name: 'a\nb' }, { email: '' }, { email: 'bad' },
  { email: 'x@@example.test' }, { email: 'x@example.test\ny@example.test' }, { role: 'admin' }]) {
  test('invalid guest details ' + JSON.stringify(change).slice(0, 70), () => bad(() => support.guestInput({ ...valid(), name: 'Guest', email: 'g@example.test', ...change })));
}
test('BIGINT identifiers remain lossless strings', () => {
  assert.equal(support.id('9223372036854775807'), '9223372036854775807');
  assert.equal(support.id('9007199254740993'), '9007199254740993');
});
for (const value of ['0', '-1', '01', '1.5', '1e2', ' 1', '9223372036854775808', '1 OR 1=1', 1, null, ['1']]) {
  test('invalid identifier ' + JSON.stringify(value), () => bad(() => support.id(value)));
}
test('history defaults and explicit bound', () => {
  assert.deepEqual(support.historyInput({}), { limit: 50, before: null });
  assert.deepEqual(support.historyInput({ limit: '100', before: '9223372036854775807' }), { limit: 100, before: '9223372036854775807' });
});
for (const query of [{ limit: '0' }, { limit: '101' }, { limit: ['1', '2'] }, { before: ['1', '2'] }, { userId: '1' }, { before: '0' }]) {
  test('invalid history query ' + JSON.stringify(query), () => bad(() => support.historyInput(query)));
}
test('inbox pagination is bounded without floating point offsets', () => {
  assert.deepEqual(support.inboxInput({}), { page: 1, limit: 30 });
  assert.deepEqual(support.inboxInput({ page: '2147483647', limit: '100' }), { page: 2147483647, limit: 100 });
});
for (const query of [{ page: '2147483648' }, { page: '0' }, { page: ['1', '2'] }, { limit: '101' }, { role: 'admin' }]) {
  test('invalid inbox query ' + JSON.stringify(query), () => bad(() => support.inboxInput(query)));
}
test('guest secret is hashed as 32 bytes, never used as a display identity', () => {
  assert.equal(support.hashToken('test-secret').length, 32);
  assert.notDeepEqual(support.hashToken('test-secret'), support.hashToken('other-secret'));
  assert.equal(support.GUEST_IDLE_SECONDS, 300);
});
test('read acknowledgement accepts only an exact customer message boundary', () => {
  assert.deepEqual(support.readInput({ messageId: '9223372036854775807' }), { messageId: '9223372036854775807' });
  assert.deepEqual(support.readInput({ messageId: '1', messageCount: '3' }), { messageId: '1', messageCount: '3' });
  for (const body of [null, [], {}, { messageId: 1 }, { messageId: '0' }, { messageId: '9223372036854775808' },
    { messageId: '1', userId: 2 }, { messageId: '1', unread: false }, { messageId: ['1', '2'] }, { messageId: '1', messageCount: 3 },
    { messageId: '1', messageCount: '0' }, { messageId: '1', messageCount: '9223372036854775808' }]) bad(() => support.readInput(body));
});
test('storage refuses customer and guest read acknowledgements before any SQL access', async () => {
  for (const principal of [{ kind: 'customer', userId: 1 }, { kind: 'guest', hash: Buffer.alloc(32) }]) {
    await assert.rejects(support.markRead(null, principal, '1', '1'), e => e.status === 403);
  }
});
test('production guest cookies require Secure and never expose the token to JS', () => {
  const middleware = require('../middleware/support'), previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.deepEqual(middleware.cookieOptions({ secure: false }), { httpOnly: true, sameSite: 'lax', secure: true, path: '/api/support' });
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
test('cookie parsing rejects ambiguous, malformed and oversized credentials', () => {
  const { guestToken } = require('../middleware/support'), token = 'a'.repeat(43);
  assert.equal(guestToken({ headers: {} }), null);
  assert.equal(guestToken({ headers: { cookie: 'other=x; breeze_support_guest=' + token } }), token);
  for (const cookie of ['breeze_support_guest=short', 'breeze_support_guest=' + 'a'.repeat(10000),
    'breeze_support_guest=' + token + '; breeze_support_guest=' + token, 'breeze_support_guest=%invalid']) {
    assert.throws(() => guestToken({ headers: { cookie } }), e => e.status === 401);
  }
});
