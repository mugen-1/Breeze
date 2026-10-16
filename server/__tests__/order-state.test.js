'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');
const {
  ORDER_TRANSITIONS, CANONICAL_STATUSES, ALL_STATUSES, nextStatuses,
  canTransition, isTargetStatus, canCustomerCancel,
} = require('../lib/order-state');

const transitions = [
  ['pending', 'confirmed'], ['pending', 'cancelled'],
  ['confirmed', 'processing'], ['confirmed', 'cancelled'],
  ['processing', 'shipping'], ['shipping', 'completed'],
  // Existing rows keep their historical values; no new order enters these states.
  ['paid', 'processing'], ['paid', 'cancelled'], ['shipped', 'completed'],
];
const rejected = [
  ['completed', 'pending'], ['completed', 'cancelled'], ['completed', 'shipping'],
  ['cancelled', 'pending'], ['cancelled', 'confirmed'], ['cancelled', 'shipping'],
  ['pending', 'completed'], ['pending', 'shipping'], ['confirmed', 'completed'],
  ['shipping', 'processing'], ['processing', 'cancelled'], ['pending', 'pending'],
  ['paid', 'shipped'], ['pending', 'paid'], ['shipping', 'shipped'],
];

test('canonical states, terminal states, and legacy statuses are explicit', () => {
  assert.deepEqual(CANONICAL_STATUSES, ['pending', 'confirmed', 'processing', 'shipping', 'completed', 'cancelled']);
  assert.deepEqual(nextStatuses('completed'), []);
  assert.deepEqual(nextStatuses('cancelled'), []);
  assert.deepEqual(nextStatuses('paid'), ['processing', 'cancelled']);
  assert.deepEqual(nextStatuses('shipped'), ['completed']);
  assert.deepEqual(ALL_STATUSES, Object.keys(ORDER_TRANSITIONS));
});
for (const [from, to] of transitions) test(from + ' -> ' + to + ' allowed', () => assert.equal(canTransition(from, to), true));
for (const [from, to] of rejected) test(from + ' -> ' + to + ' rejected', () => assert.equal(canTransition(from, to), false));
for (const value of ['abc', 'admin', 'done123', null, {}, [], 'PAID', 'completedd', 'paid', 'shipped', ' confirmed ']) {
  test('invalid target rejected: ' + JSON.stringify(value), () => assert.equal(isTargetStatus(value), false));
}
test('exported next-status list cannot mutate business rules', () => {
  nextStatuses('pending').push('completed');
  assert.equal(canTransition('pending', 'completed'), false);
});
test('customer cancel is limited to pending and confirmed', () => {
  for (const status of ALL_STATUSES) {
    assert.equal(canCustomerCancel(status), ['pending', 'confirmed'].includes(status));
  }
});

let state;
let held = false;
const waiters = [];
async function acquire() {
  if (held) await new Promise((resolve) => waiters.push(resolve));
  held = true;
  return () => { held = false; const next = waiters.shift(); if (next) next(); };
}
class Transaction {
  async begin() { this.active = true; }
  async commit() { this.active = false; if (this.release) this.release(); }
  async rollback() { this.active = false; if (this.stockBefore !== undefined) state.stock = this.stockBefore;
    if (this.variantStockBefore !== undefined) state.variantStock = this.variantStockBefore;
    if (this.release) this.release(); }
}
class Request {
  constructor(tx) { this.tx = tx; this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(query) {
    const q = query.replace(/\s+/g, ' ').trim();
    const p = this.params;
    state.queries.push({ q, p });
    if (q.startsWith('SELECT id FROM dbo.users WITH')) return { recordset: [{ id: 1 }] };
    if (q.startsWith('MERGE dbo.users')) return { recordset: [{ ...state.user }] };
    if (q.startsWith('SELECT status, shipping_version, shipping_status FROM dbo.orders') || q.startsWith('SELECT id, user_id, status FROM dbo.orders')) {
      assert.match(q, /WITH \(UPDLOCK, HOLDLOCK\) WHERE id = @id/);
      assert.ok(this.tx.active);
      this.tx.release = await acquire();
      if (state.failSql) throw Object.assign(new Error('private SQL detail'), { code: 'EQUERY' });
      assert.equal(p.id, 7);
      const status = state.status;
      if (state.changeAfterRead) state.status = state.changeAfterRead;
      return { recordset: state.orderExists ? [{ id: 7, user_id: 1, status }] : [] };
    }
    if (q.startsWith('SELECT product_id, variant_id, quantity FROM dbo.order_items')) {
      return { recordset: [{ product_id: 5, variant_id: 50, quantity: 2 }] };
    }
    if (q.startsWith('UPDATE dbo.products')) {
      assert.match(q, /stock = stock \+ @qty/);
      this.tx.stockBefore = state.stock;
      state.stock += p.qty;
      return { rowsAffected: [1], recordset: [] };
    }
    if (q.startsWith('UPDATE dbo.product_variants')) {
      assert.match(q, /stock = stock \+ @qty/);
      assert.equal(p.vid, 50);
      this.tx.variantStockBefore = state.variantStock;
      state.variantStock += p.qty;
      return { rowsAffected: [1], recordset: [{ stock_before: this.tx.variantStockBefore, stock_after: state.variantStock }] };
    }
    if (q.startsWith('INSERT INTO dbo.inventory_movements')) {
      assert.ok(this.tx.active);
      return { rowsAffected: [1], recordset: [] };
    }
    if (q.startsWith('UPDATE dbo.orders SET status') || q.startsWith('UPDATE dbo.orders SET status =')) {
      assert.match(q, /WHERE id = @id AND status = @current/);
      assert.ok(this.tx.active);
      assert.equal(p.id, 7);
      if (p.current !== state.status) return { recordset: [] };
      const target = p.status || 'cancelled';
      state.status = target;
      state.commits.push({ from: p.current, to: target });
      return { recordset: [{ id: 7, status: target, total_amount: 100000, created_at: new Date(), user_id: 1 }] };
    }
    if (state.list && q.includes('FROM dbo.orders o')) {
      if (q.includes('COUNT(*)')) return { recordset: [{ total: 1 }] };
      return { recordset: [{ id: 7, status: state.status, user_id: 1 }] };
    }
    if (q.includes('dbo.payment_transactions')) return { recordset: [], rowsAffected: [0] };
    if (state.list && q.includes('FROM dbo.order_items')) return { recordset: [] };
    throw new Error('Unexpected SQL: ' + q);
  }
}
const pool = { request: () => new Request() };
require.cache[require.resolve('../db')] = { exports: {
  getPool: async () => pool, sql: { ...realSql, Transaction, Request },
} };
require.cache[require.resolve('../firebase')] = { exports: {
  getAuth: () => ({ verifyIdToken: async (token, checkRevoked) => {
    assert.equal(token, 'test-token');
    assert.equal(checkRevoked, true);
    return { uid: 'test-admin', email: 'admin@example.test', email_verified: true };
  } }),
} };

const app = express();
app.use(express.json());
app.use('/api/admin', require('../routes/admin'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => {
  state = { status: 'pending', stock: 3, variantStock: 3, orderExists: true,
    user: { id: 1, firebase_uid: 'test-admin', role: 'admin' }, queries: [], commits: [] };
});
async function change(to, body = { status: to }, token = 'test-token') {
  const r = await fetch(base + '/api/admin/orders/7/status', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

for (const [from, to] of transitions) {
  test('HTTP accepts ' + from + ' -> ' + to, async () => {
    state.status = from;
    const r = await change(to);
    assert.equal(r.status, 200);
    assert.equal(r.body.order.status, to);
    assert.deepEqual(r.body.order.allowed_next_statuses, nextStatuses(to));
    assert.deepEqual(state.commits, [{ from, to }]);
    assert.equal(!!state.blacklisted, false);
    assert.equal(state.stock, to === 'cancelled' ? 5 : 3);
  });
}
for (const [from, to] of rejected) {
  test('HTTP rejects ' + from + ' -> ' + to, async () => {
    state.status = from;
    const r = await change(to);
    assert.equal(r.status, isTargetStatus(to) ? 409 : 400);
    assert.equal(state.status, from);
    assert.deepEqual(state.commits, []);
    assert.ok(!state.blacklisted);
    assert.doesNotMatch(JSON.stringify(r.body), /SQL|stack|EQUERY/);
  });
}
for (const value of ['abc', 'paid', 'shipped', null, {}, [], 'completedd']) {
  test('HTTP rejects invalid target ' + JSON.stringify(value) + ' with 400', async () => {
    const r = await change(value);
    assert.equal(r.status, 400);
    assert.ok(!state.queries.some((x) => x.q.includes('dbo.orders')));
  });
}
test('missing order -> 404', async () => {
  state.orderExists = false;
  assert.equal((await change('confirmed')).status, 404);
});
test('customer and forged admin body cannot change order', async () => {
  state.user.role = 'customer';
  const r = await change('confirmed', { status: 'confirmed', role: 'admin', isAdmin: true, role_id: 1 });
  assert.equal(r.status, 403);
  assert.ok(!state.queries.some((x) => x.q.includes('dbo.orders')));
});
test('missing token -> 401', async () => assert.equal((await change('confirmed', { status: 'confirmed' }, null)).status, 401));
test('SQL error -> generic 500 and no commit', async (t) => {
  t.mock.method(console, 'error', () => {});
  state.failSql = true;
  const r = await change('confirmed');
  assert.equal(r.status, 500);
  assert.deepEqual(state.commits, []);
  assert.doesNotMatch(JSON.stringify(r.body), /private SQL|stack|EQUERY/);
});
test('two concurrent requests from confirmed commit only one transition', async () => {
  state.status = 'confirmed';
  const replies = await Promise.all([change('processing'), change('cancelled')]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  assert.equal(state.commits.length, 1);
  assert.equal(state.status, state.commits[0].to);
});
test('conditional UPDATE affecting no rows returns 409', async () => {
  state.status = 'confirmed';
  state.changeAfterRead = 'processing';
  const r = await change('cancelled');
  assert.equal(r.status, 409);
  assert.equal(state.status, 'processing');
  assert.deepEqual(state.commits, []);
  assert.ok(!state.blacklisted);
});
test('admin list returns allowed next statuses without UI-owned rules', async () => {
  state.status = 'paid';
  state.list = true;
  const r = await fetch(base + '/api/admin/orders', { headers: { Authorization: 'Bearer test-token' } });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.orders[0].allowed_next_statuses, ['processing', 'cancelled']);
});
