'use strict';

// Real routers and Firebase/Auth middleware; SQL locks are verified separately
// by verify-order-payment-sql.js against a disposable SQL Server database.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');
let db, queries, failPayment, held = false, waiters = [];
const clone = x => structuredClone(x);
const result = (recordset = [], affected = recordset.length) => ({ recordset, rowsAffected: [affected] });
async function lock() {
  if (held) await new Promise(resolve => waiters.push(resolve));
  held = true;
  return () => { const next = waiters.shift(); if (next) next(); else held = false; };
}
class Transaction {
  async begin() { this.active = true; }
  async commit() { if (this.data) db = this.data; this.active = false; if (this.release) this.release(); }
  async rollback() { this.active = false; if (this.release) this.release(); }
}
class Request {
  constructor(tx) { this.tx = tx; this.params = {}; }
  input(k, type, value) { this.params[k] = value; return this; }
  async query(query) {
    const q = query.replace(/\s+/g, ' ').trim(), p = this.params;
    queries.push({ q, p });
    if (q.startsWith('SELECT id FROM dbo.users WITH')) return result([{ id: Number(p.uid) }]);
    if (q.startsWith('MERGE dbo.users')) return result([{ id: Number(p.uid), role: p.uid === '9' ? 'admin' : 'customer' }]);
    if (q.includes('FROM dbo.orders WITH')) {
      assert.ok(this.tx.active); assert.match(q, /UPDLOCK, HOLDLOCK/);
      this.tx.release = await lock(); this.tx.data = clone(db);
      return result(this.tx.data.order.id === p.id && (p.uid == null || this.tx.data.order.user_id === p.uid) ? [this.tx.data.order] : []);
    }
    const d = this.tx && this.tx.data || db;
    if (q.includes('FROM dbo.orders o')) {
      return q.includes('COUNT(*)') ? result([{ total: 1 }]) : result([d.order]);
    }
    if (q.includes('FROM dbo.orders')) {
      assert.match(q, /user_id = @uid/);
      return result(d.order.user_id === p.uid && (p.id == null || p.id === d.order.id) ? [d.order] : []);
    }
    if (q.includes('FROM dbo.order_items')) return result([]);
    if (q.startsWith('SELECT') && q.includes('FROM dbo.payment_transactions')) {
      if (p.oid != null) { assert.ok(this.tx.active); assert.match(q, /UPDLOCK, HOLDLOCK/); }
      const ids = Object.values(p);
      return result(d.payment && ids.includes(d.payment.order_id) ? [d.payment] : []);
    }
    if (q.startsWith('UPDATE dbo.orders')) {
      assert.ok(this.tx.active);
      d.order.status = p.status; d.order.shipping_status = p.shippingStatus;
      return result([clone(d.order)]);
    }
    if (q.startsWith('UPDATE dbo.payment_transactions')) {
      assert.ok(this.tx.active);
      if (failPayment) throw new Error('PRIVATE_DATABASE_DETAIL');
      const payment = d.payment;
      if (!payment || payment.order_id !== p.oid || payment.status !== 'pending' ||
          (p.outcome == null && payment.payment_method !== 'cod')) return result([]);
      payment.status = p.outcome === 'failure' ? 'failed' : 'paid';
      payment.paid_at = payment.status === 'paid' ? '2026-10-11T07:20:00.000Z' : null;
      return result([clone(payment)]);
    }
    throw new Error('Unexpected SQL: ' + q);
  }
}
const pool = { request: () => new Request() };
require.cache[require.resolve('../db')] = { exports: { getPool: async () => pool, sql: { ...realSql, Request, Transaction } } };
require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({
  async verifyIdToken(token, revoked) {
    assert.equal(revoked, true);
    if (!['1', '2', '9'].includes(token)) throw new Error('invalid token');
    return { uid: token, email: 'user' + token + '@example.test', email_verified: true };
  }
}) } };
const app = express(); app.use(express.json());
app.use('/api/orders', require('../routes/orders')); app.use('/api/admin', require('../routes/admin'));
let server, base;
const savedAdmins = process.env.ADMIN_EMAILS;
before(async () => {
  process.env.ADMIN_EMAILS = '';
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (savedAdmins == null) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = savedAdmins;
  await new Promise(r => server.close(r));
});
beforeEach(() => {
  db = { order: { id: 7, order_code: 1001, user_id: 1, status: 'pending', total_amount: 920000, payment_method: 'visa',
    shipping_version: 2, shipping_status: 'pending_pickup' },
  payment: { id: 3, order_id: 7, transaction_code: 'PAY-1001-001', payment_method: 'visa', amount: 920000,
    status: 'pending', created_at: '2026-10-11T00:00:00Z', paid_at: null } };
  queries = []; failPayment = false; held = false; waiters = [];
});
async function call(path = '/api/orders/7/payment-simulation', body = { outcome: 'success' }, token = '1', method = 'POST') {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
for (const method of ['visa', 'mastercard', 'momo']) {
  for (const outcome of ['success', 'failure']) test(method + ' simulation ' + outcome + ' persists backend result', async () => {
    db.order.payment_method = db.payment.payment_method = method;
    const beforeOrder = clone(db.order), r = await call(undefined, { outcome });
    assert.equal(r.status, 200);
    assert.equal(r.body.payment_transaction.status, outcome === 'success' ? 'paid' : 'failed');
    assert.equal(r.body.payment_transaction.paid_at != null, outcome === 'success');
    assert.equal(r.body.payment_transaction.amount, 920000);
    assert.deepEqual(db.order, beforeOrder);
    assert.equal((await call()).status, 409, 'terminal result cannot be rewritten');
  });
}
for (const body of [{ status: 'paid' }, { outcome: 'success', status: 'paid' }, { outcome: 'success', amount: 1 },
  { outcome: 'success', card_number: '4111111111111111', cvv: '123' }, { outcome: 'success', order_id: 8 },
  { outcome: 'paid' }, {}, [], null]) test('reject forged simulation body ' + JSON.stringify(body), async () => {
  const before = clone(db); assert.equal((await call(undefined, body)).status, 400); assert.deepEqual(db, before);
  assert.ok(!queries.some(x => x.q.includes('dbo.orders')));
});
test('simulation requires a valid Firebase token', async () => {
  assert.equal((await call(undefined, undefined, null)).status, 401);
  assert.equal((await call(undefined, undefined, 'invalid')).status, 401);
  assert.equal(queries.length, 0);
});
test('another user cannot read or simulate the payment', async () => {
  assert.equal((await call('/api/orders/7', null, '2', 'GET')).status, 404);
  assert.equal((await call(undefined, undefined, '2')).status, 404);
  assert.ok(!queries.some(x => x.q.includes('payment_transactions')));
  assert.equal(db.payment.status, 'pending');
});
test('own list and detail expose only safe payment metadata', async () => {
  for (const path of ['/api/orders', '/api/orders/7']) {
    const r = await call(path, null, '1', 'GET'); assert.equal(r.status, 200);
    const order = Array.isArray(r.body) ? r.body[0] : r.body;
    assert.deepEqual(order.payment_transaction, db.payment);
    assert.doesNotMatch(JSON.stringify(r.body), /"(?:card_number|cvv|cvc|otp|password|pin)"/);
  }
});
test('Admin can view payments; normal user cannot call Admin API', async () => {
  assert.equal((await call('/api/admin/orders', null, '1', 'GET')).status, 403);
  assert.ok(!queries.some(x => x.q.includes('payment_transactions')));
  const r = await call('/api/admin/orders', null, '9', 'GET'); assert.equal(r.status, 200);
  assert.deepEqual(r.body.orders[0].payment_transaction, db.payment);
  assert.equal((await call(undefined, undefined, '9')).status, 403);
});
for (const status of ['cancelled', 'completed', 'unknown']) test('order ' + status + ' cannot simulate payment', async () => {
  db.order.status = status; const before = clone(db); assert.equal((await call()).status, 409); assert.deepEqual(db, before);
});
for (const change of ['cod', 'amount', 'method', 'missing']) test('reject inconsistent or ineligible payment: ' + change, async () => {
  if (change === 'cod') db.order.payment_method = db.payment.payment_method = 'cod';
  if (change === 'amount') db.payment.amount = 1;
  if (change === 'method') db.payment.payment_method = 'momo';
  if (change === 'missing') db.payment = null;
  const before = clone(db); assert.equal((await call()).status, 409); assert.deepEqual(db, before);
});
test('two concurrent simulation requests commit one result', async () => {
  const r = await Promise.all([call(), call(undefined, { outcome: 'failure' })]);
  assert.deepEqual(r.map(x => x.status).sort(), [200, 409]);
  assert.ok(['paid', 'failed'].includes(db.payment.status));
});
test('simulation DB failure returns a generic error and preserves pending payment', async t => {
  t.mock.method(console, 'error', () => {}); failPayment = true; const before = clone(db);
  const r = await call(); assert.equal(r.status, 500); assert.deepEqual(db, before);
  assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE_DATABASE_DETAIL|stack/);
});
for (const shipping of [false, true]) {
  for (const method of ['cod', 'visa']) test('completion via ' + (shipping ? 'delivery' : 'status') + ': ' + method, async () => {
    db.order.status = 'shipping'; db.order.shipping_status = 'out_for_delivery';
    db.order.payment_method = db.payment.payment_method = method;
    const r = await call('/api/admin/orders/7/' + (shipping ? 'shipping-status' : 'status'),
      shipping ? { shipping_status: 'delivered' } : { status: 'completed' }, '9', shipping ? 'PATCH' : 'PUT');
    assert.equal(r.status, 200); assert.equal(db.order.status, 'completed');
    assert.equal(db.payment.status, method === 'cod' ? 'paid' : 'pending');
    assert.equal(db.payment.paid_at != null, method === 'cod');
  });
  test('COD payment failure rolls back ' + (shipping ? 'delivery' : 'completion'), async t => {
    t.mock.method(console, 'error', () => {});
    db.order.status = 'shipping'; db.order.shipping_status = 'out_for_delivery';
    db.order.payment_method = db.payment.payment_method = 'cod'; failPayment = true; const before = clone(db);
    const r = await call('/api/admin/orders/7/' + (shipping ? 'shipping-status' : 'status'),
      shipping ? { shipping_status: 'delivered' } : { status: 'completed' }, '9', shipping ? 'PATCH' : 'PUT');
    assert.equal(r.status, 500); assert.deepEqual(db, before);
  });
}
