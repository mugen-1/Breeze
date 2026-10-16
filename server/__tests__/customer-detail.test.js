'use strict';

// Real router, Firebase middleware and Admin authorization over HTTP.
// Only SQL/Firebase I/O is substituted, as in security.test.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');
let state, server, base;
const result = rows => ({ recordset: rows, rowsAffected: [rows.length] });
const publicFields = ['id', 'email', 'display_name', 'phone', 'dob', 'gender', 'country',
  'role', 'created_at', 'last_login', 'is_blacklisted'];
class Transaction { async begin() {} async commit() {} async rollback() {} }
class Request {
  constructor() { this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.params;
    if (q.startsWith('SELECT id FROM dbo.users WITH')) return result([{ id: 99 }]);
    if (q.startsWith('MERGE dbo.users')) return result([{ id: 99, role: state.role }]);
    state.queries.push({ q, p });
    if (state.fail) throw Object.assign(new Error('PRIVATE_DATABASE_DETAIL'), { code: 'EQUERY' });
    assert.doesNotMatch(q, /firebase_uid|password|token|credential|cvv|card_number|order_items/i);
    if (q.includes('FROM dbo.users WHERE id = @uid')) {
      assert.match(q, /^SELECT id, email, display_name, phone, dob, gender, country, role, created_at, last_login, IsBlacklisted AS is_blacklisted/);
      const u = state.users.find(u => u.id === p.uid);
      return result(u ? [Object.fromEntries(publicFields.map(k => [k, u[k]]))] : []);
    }
    assert.match(q, /FROM dbo.orders WHERE user_id = @uid/);
    assert.equal(typeof p.uid, 'number');
    const orders = state.orders.filter(o => o.user_id === p.uid);
    if (q.startsWith('SELECT COUNT(*)')) {
      assert.match(q, /COUNT\(\*\) AS total_orders/);
      assert.match(q, /COALESCE\(SUM\(CASE WHEN status = 'completed' THEN 1 ELSE 0 END\), 0\) AS completed_orders/);
      assert.match(q, /COALESCE\(SUM\(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END\), 0\) AS cancelled_orders/);
      assert.match(q, /COALESCE\(SUM\(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END\), 0\) AS total_spent/);
      return result([{ total_orders: orders.length,
        completed_orders: orders.filter(o => o.status === 'completed').length,
        cancelled_orders: orders.filter(o => o.status === 'cancelled').length,
        total_spent: orders.filter(o => o.status === 'completed').reduce((n, o) => n + o.total_amount, 0) }]);
    }
    assert.match(q, /^SELECT id, order_code, created_at, total_amount, currency, PaymentMethod AS payment_method, status /);
    assert.match(q, /ORDER BY created_at DESC, id DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/);
    assert.ok(Number.isInteger(p.offset) && p.offset >= 0 && p.offset <= 2147483647);
    assert.ok(p.limit >= 1 && p.limit <= 100);
    return result(orders.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .slice(p.offset, p.offset + p.limit)
      .map(({ id, order_code, created_at, total_amount, currency, payment_method, status }) =>
        ({ id, order_code, created_at, total_amount, currency, payment_method, status })));
  }
}
require.cache[require.resolve('../db')] = { exports: {
  getPool: async () => ({ request: () => new Request() }), sql: { ...realSql, Request, Transaction }
} };
require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({
  async verifyIdToken(token, revoked) {
    assert.equal(revoked, true);
    if (token !== 'active') throw Object.assign(new Error('private token'), { code: 'auth/id-token-expired' });
    return { uid: 'admin-test', email_verified: false };
  }
}) } };
const app = express();
app.use('/api/admin', require('../routes/admin'));
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
  state = { role: 'admin', queries: [], users: [1, 2, 3].map(id => ({
    id, display_name: 'Customer ' + id, email: id + '@example.test', phone: '0901234567',
    dob: null, gender: null, country: 'VN', role: 'customer', created_at: '2026-10-01',
    last_login: null, is_blacklisted: id === 2, firebase_uid: 'PRIVATE_UID', password: 'PRIVATE_PASSWORD'
  })), orders: [
    ['completed', 1000000], ['completed', 500000], ['cancelled', 2000000], ['pending', 900000],
    ['confirmed', 700000], ['processing', 600000], ['shipping', 500000], ['paid', 400000],
    ['shipped', 300000], ['pending', 200000], ['confirmed', 100000], ['shipping', 800000]
  ].map(([status, total_amount], i) => ({ id: i + 1, user_id: 1, status, total_amount,
    currency: 'VND', payment_method: 'cod', created_at: i < 3 ? '2026-10-01' : '2026-10-02' })) };
  state.orders.push({ id: 99, user_id: 2, status: 'completed', total_amount: 9999999,
    currency: 'VND', payment_method: 'visa', created_at: '2026-10-03' });
});
async function call(id = 1, query = '', token = 'active') {
  const r = await fetch(base + '/api/admin/users/' + id + '/detail' + query,
    { headers: token == null ? {} : { Authorization: 'Bearer ' + token } });
  return { status: r.status, body: await r.json() };
}

test('Admin gets real customer fields and a bounded history with no sensitive fields', async () => {
  const r = await call();
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, 1);
  assert.deepEqual(Object.keys(r.body.user).sort(), publicFields.slice().sort());
  assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE_|firebase_uid|password|token|credential|cvv/i);
  assert.equal(r.body.orders.length, 10);
  assert.equal(state.queries.length, 3);
});
test('missing token is rejected before reading customer data', async () => {
  assert.equal((await call(1, '', null)).status, 401);
  assert.equal(state.queries.length, 0);
});
test('expired token is rejected before reading customer data', async t => {
  t.mock.method(console, 'warn', () => {});
  assert.equal((await call(1, '', 'expired')).status, 401);
  assert.equal(state.queries.length, 0);
});
test('customer cannot become Admin through query parameters', async () => {
  state.role = 'customer';
  assert.equal((await call(1, '?role=admin&user_id=1')).status, 403);
  assert.equal(state.queries.length, 0);
});
test('missing customer returns 404 and skips order queries', async () => {
  assert.equal((await call(999)).status, 404);
  assert.equal(state.queries.length, 1);
});
test('KPI totals span all pages; total spent includes completed only, including legacy status exclusion', async () => {
  const r = await call(1, '?page=2');
  assert.deepEqual(r.body.statistics, { total_orders: 12, completed_orders: 2, cancelled_orders: 1, total_spent: 1500000 });
});
test('empty history returns numeric zero statistics and valid pagination', async () => {
  const r = await call(3);
  assert.deepEqual(r.body.statistics, { total_orders: 0, completed_orders: 0, cancelled_orders: 0, total_spent: 0 });
  assert.deepEqual(r.body.orders, []);
  assert.equal(r.body.page, 1);
  assert.equal(r.body.total, 0);
  assert.equal(r.body.total_pages, 0);
});
test('history contains only the target customer, newest first with ID tie break', async () => {
  const r = await call();
  assert.deepEqual(r.body.orders.map(o => o.id), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.equal(r.body.total, 12);
  assert.equal(r.body.total_pages, 2);
  assert.equal(r.body.limit, 10);
});
test('second page contains remaining orders with no overlap', async () => {
  const r = await call(1, '?page=2&limit=10');
  assert.deepEqual(r.body.orders.map(o => o.id), [2, 1]);
  assert.equal(r.body.page, 2);
  assert.equal(state.queries[2].p.offset, 10);
});
test('blacklisted customer stays readable and is not modified', async () => {
  const r = await call(2);
  assert.equal(r.body.user.is_blacklisted, true);
  assert.deepEqual(r.body.orders.map(o => o.id), [99]);
  assert.equal(r.body.statistics.total_spent, 9999999);
  assert.ok(state.queries.every(({ q }) => q.startsWith('SELECT ')));
});
test('custom page size is bounded and out-of-range page is clamped', async () => {
  let r = await call(1, '?page=9999999999999&limit=3');
  assert.equal(r.body.page, 4);
  assert.equal(r.body.total_pages, 4);
  assert.deepEqual(r.body.orders.map(o => o.id), [3, 2, 1]);
  r = await call(1, '?limit=999');
  assert.equal(r.body.limit, 100);
});
for (const query of ['?page=-1&limit=0', '?page=bad&limit=no', '?page=1.5&limit=2.5', '?page=1e100&limit=1e100']) {
  test('invalid pagination falls back safely: ' + query, async () => {
    const r = await call(1, query);
    assert.equal(r.status, 200); assert.equal(r.body.page, 1); assert.equal(r.body.limit, 10);
  });
}
for (const id of ['0', '-1', '1.5', 'NaN', '2147483648', '1%20OR%201=1']) {
  test('invalid user ID is rejected before customer SQL: ' + id, async () => {
    assert.equal((await call(id)).status, 400);
    assert.equal(state.queries.length, 0);
  });
}
test('database error returns a generic message without private details', async t => {
  t.mock.method(console, 'error', () => {});
  state.fail = true;
  const r = await call();
  assert.equal(r.status, 500);
  assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE_|EQUERY/);
});
