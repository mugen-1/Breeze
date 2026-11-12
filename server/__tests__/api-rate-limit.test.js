'use strict';

// Real Express + real limiter on an ephemeral port. Downstream responses are
// fixtures: this verifies quota isolation, not Firebase credentials or SQL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { buildApiLimiter } = require('../middleware/security');

async function setup(t) {
  const app = express();
  app.use('/api', buildApiLimiter({ limit: 2, windowMs: 60000 }));
  app.use((req, res) => {
    const needsToken = /^\/api\/me\/?$/i.test(req.path) && ['GET', 'HEAD'].includes(req.method);
    res.status(needsToken ? 401 : 200).json({ reachedHandler: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (path, method = 'GET', headers = {}) => fetch('http://127.0.0.1:' + server.address().port + path, { method, headers });
}

test('exhausted shopping API does not block the two login API steps', async t => {
  const call = await setup(t);
  assert.equal((await call('/api/products')).status, 200);
  assert.equal((await call('/api/cart', 'POST')).status, 200);
  const blocked = await call('/api/products');
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, 'API_RATE_LIMITED');
  assert.match(blocked.headers.get('ratelimit'), /remaining=0/);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  // 401 proves the auth handler was reached, rather than bypassing authentication.
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/support/session', 'POST', { Authorization: 'Bearer quota-test' })).status, 200);
  assert.equal((await call('/api/products')).status, 429);
});

test('guest heartbeats cannot exhaust login or shopping quota', async t => {
  const call = await setup(t);
  assert.equal((await call('/api/support/heartbeat', 'POST')).status, 200);
  assert.equal((await call('/api/support/heartbeat', 'POST')).status, 200);
  assert.equal((await call('/api/support/heartbeat', 'POST')).status, 429);
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/support/session', 'POST', { Authorization: 'Bearer quota-test' })).status, 200);
  assert.equal((await call('/api/cart')).status, 200);
});

test('customer and admin SSE share the bounded background quota', async t => {
  const call = await setup(t);
  assert.equal((await call('/api/support/events')).status, 200);
  assert.equal((await call('/api/admin/support/events')).status, 200);
  assert.equal((await call('/api/support/heartbeat', 'POST')).status, 429);
  assert.equal((await call('/api/me')).status, 401);
});

test('session API is still rate limited, including unauthenticated requests', async t => {
  const call = await setup(t);
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/me')).status, 429);
  assert.equal((await call('/api/support/session', 'POST', { Authorization: 'Bearer quota-test' })).status, 429);
  assert.equal((await call('/api/cart')).status, 200);
  assert.equal((await call('/api/support/heartbeat', 'POST')).status, 200);
});

test('case, trailing slash, HEAD and query strings cannot reset the session counter', async t => {
  const call = await setup(t);
  assert.equal((await call('/api/ME/?next=1', 'HEAD')).status, 401);
  assert.equal((await call('/api/me?next=2')).status, 401);
  assert.equal((await call('/api/me/?next=3')).status, 429);
});

test('other methods and neighboring routes do not escape the general quota', async t => {
  const call = await setup(t);
  assert.equal((await call('/api/me', 'PUT')).status, 200);
  assert.equal((await call('/api/support/heartbeat')).status, 200);
  assert.equal((await call('/api/me/avatar', 'POST')).status, 429);
  assert.equal((await call('/api/me')).status, 401);
});

test('guest session preparation on tab focus cannot block authenticated login', async t => {
  const call = await setup(t);
  assert.equal((await call('/api/support/session', 'POST')).status, 200);
  assert.equal((await call('/api/support/session', 'POST')).status, 200);
  assert.equal((await call('/api/support/session', 'POST')).status, 429);
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/support/session', 'POST', { Authorization: 'Bearer quota-test' })).status, 200);
});

test('default quotas remain 300 per fifteen minutes for all three groups', async t => {
  const app = express();
  app.use('/api', buildApiLimiter());
  app.use((_req, res) => res.sendStatus(204));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const path of ['/api/products', '/api/me', '/api/support/events']) {
    const r = await fetch('http://127.0.0.1:' + server.address().port + path);
    assert.equal(r.status, 204);
    assert.match(r.headers.get('ratelimit-policy'), /^300;w=900$/);
    assert.match(r.headers.get('ratelimit'), /remaining=299/);
  }
});
