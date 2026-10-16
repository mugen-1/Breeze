'use strict';

// HTTP tests for both cancel routes with a transactional SQL double. Locking is
// also checked independently against real SQL Server by test-cancel-sql.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

let db, actor, failStage, events, queries, held, waiters;
const clone = x => structuredClone(x);
const result = (recordset = [], affected = recordset.length) => ({ recordset, rowsAffected: [affected] });
function reset(status = 'pending', items = [{ product_id: 5, quantity: 2 }]) {
  db = { order: { id: 7, user_id: 1, status, cancel_reason: null, cancelled_at: null },
    items: clone(items).map(x => ({ ...x, variant_id: x.variant_id ?? x.product_id * 10 })),
    products: [{ id: 5, stock: 3, is_active: false }, { id: 6, stock: 10, is_active: true }],
    variants: [{ id: 50, product_id: 5, stock: 3 }, { id: 60, product_id: 6, stock: 10 }],
    blacklisted: false, movements: [], payments: [] };
  actor = { id: 1, role: 'customer' };
  failStage = null; events = []; queries = []; held = false; waiters = [];
}
async function lock() {
  if (held) await new Promise(resolve => waiters.push(resolve));
  held = true;
  return () => { held = false; const next = waiters.shift(); if (next) next(); };
}
class Transaction {
  async begin() { events.push('begin'); }
  async commit() { db = this.data; events.push('commit'); this.release(); }
  async rollback() { events.push('rollback'); if (this.release) this.release(); }
}
class Request {
  constructor(tx) { this.tx = tx; this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(query) {
    const q = query.replace(/\s+/g, ' ').trim();
    const p = this.params;
    queries.push({ q, p, tx: this.tx });
    assert.ok(this.tx, 'cancel SQL must use one transaction');
    if (q.startsWith('SELECT id, user_id, status FROM dbo.orders')) {
      assert.match(q, /WITH \(UPDLOCK, HOLDLOCK\)/);
      this.tx.release = await lock();
      this.tx.data = clone(db);
      if (failStage === 'select') throw new Error('injected select failure');
      const order = this.tx.data.order;
      return result(order && order.id === p.id && (p.uid === undefined || order.user_id === p.uid)
        ? [order] : []);
    }
    const data = this.tx.data;
    if (q.startsWith('SELECT product_id, variant_id, quantity FROM dbo.order_items')) {
      assert.match(q, /ORDER BY product_id, variant_id ASC/);
      if (failStage === 'items') throw new Error('injected items failure');
      return result(data.items);
    }
    if (q.startsWith('UPDATE dbo.products')) {
      assert.match(q, /stock = stock \+ @qty/);
      assert.doesNotMatch(q, /is_active\s*=/);
      if (failStage === 'product-' + p.pid) throw new Error('injected product failure');
      const product = data.products.find(x => x.id === p.pid);
      if (!product) return result([], 0);
      product.stock += p.qty;
      return result([], 1);
    }
    if (q.startsWith('UPDATE dbo.product_variants')) {
      assert.match(q, /stock = stock \+ @qty/);
      const variant = data.variants.find(x => x.id === p.vid && x.product_id === p.pid);
      if (!variant) return result([], 0);
      const before = variant.stock;
      variant.stock += p.qty;
      return result([{ stock_before: before, stock_after: variant.stock }], 1);
    }
    if (q.startsWith('INSERT INTO dbo.inventory_movements')) {
      if (failStage === 'movement') throw new Error('injected movement failure');
      data.movements.push({ product_id: p.pid, variant_id: p.vid, order_id: p.oid, type: p.type,
        delta: p.delta, before: p.before, after: p.after, actor: p.actor });
      return result([], 1);
    }
    if (q.startsWith('UPDATE dbo.payment_transactions')) {
      if (failStage === 'payment') throw new Error('injected payment failure');
      for (const payment of data.payments) if (payment.order_id === p.oid && payment.status === 'pending') payment.status = 'cancelled';
      return result([], 1);
    }
    if (q.startsWith('UPDATE dbo.orders')) {
      assert.match(q, /WHERE id = @id AND status = @current/);
      assert.match(q, /cancelled_at = SYSUTCDATETIME\(\)/);
      if (failStage === 'status') throw new Error('injected status failure');
      if (failStage === 'status_conflict') return result([]);
      if (data.order.status !== p.current) return result([]);
      data.order.status = 'cancelled';
      data.order.cancel_reason = p.reason;
      data.order.cancelled_at = 'database-time';
      return result([clone(data.order)]);
    }
    throw new Error('Unexpected SQL: ' + q);
  }
}
require.cache[require.resolve('../db')] = { exports: {
  getPool: async () => ({}), sql: { ...realSql, Transaction, Request },
} };
require.cache[require.resolve('../middleware/auth')] = { exports: {
  verifyFirebaseToken: (req, res, next) => { req.user = actor; next(); },
} };
const app = express();
app.use(express.json());
app.use('/api/orders', require('../routes/orders'));
app.use('/api/admin', require('../routes/admin'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => reset());
async function call(path = '/api/orders/7/cancel', body = { reason: 'wrong_item' }, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

for (const status of ['pending', 'confirmed']) {
  test('customer cancels ' + status + ': stock restored, reason saved, no blacklist', async () => {
    reset(status);
    const reply = await call();
    assert.equal(reply.status, 200);
    assert.equal(db.order.status, 'cancelled');
    assert.equal(db.products[0].stock, 5);
    assert.equal(db.variants[0].stock, 5);
    assert.deepEqual(db.movements, [{ product_id: 5, variant_id: 50, order_id: 7, type: 'ORDER_CANCEL',
      delta: 2, before: 3, after: 5, actor: 1 }]);
    assert.equal(db.products[0].is_active, false);
    assert.equal(db.order.cancel_reason, 'Đặt nhầm sản phẩm');
    assert.equal(db.order.cancelled_at, 'database-time');
    assert.equal(db.blacklisted, false);
    assert.deepEqual(events, ['begin', 'commit']);
  });
}
for (const status of ['processing', 'shipping', 'completed', 'cancelled', 'paid', 'shipped']) {
  test('customer cannot cancel ' + status, async () => {
    reset(status);
    assert.equal((await call()).status, 409);
    assert.equal(db.products[0].stock, 3);
    assert.equal(db.order.status, status);
    assert.deepEqual(events, ['begin', 'rollback']);
  });
}
test('ownership: another customer gets 404 even with forged owner/role fields', async () => {
  actor.id = 2;
  const reply = await call('/api/orders/7/cancel', { reason: 'wrong_item', user_id: 1, role: 'admin', isAdmin: true });
  assert.equal(reply.status, 404);
  assert.match(queries.find(x => x.q.startsWith('SELECT id, user_id')).q, /AND user_id = @uid/);
  assert.equal(db.order.status, 'pending');
  assert.equal(db.products[0].stock, 3);
});
test('order with multiple items restores stock by product id order', async () => {
  db.items = [{ product_id: 6, variant_id: 60, quantity: 3 }, { product_id: 5, variant_id: 50, quantity: 2 }];
  assert.equal((await call()).status, 200);
  assert.deepEqual(db.products.map(x => x.stock), [5, 13]);
  assert.deepEqual(queries.filter(x => x.q.startsWith('UPDATE dbo.products')).map(x => x.p.pid), [5, 6]);
});
for (const stage of ['product-6', 'movement', 'status']) {
  test(stage + ' failure rolls back every restored item and order', async (t) => {
    t.mock.method(console, 'error', () => {});
    db.items = [{ product_id: 5, variant_id: 50, quantity: 2 }, { product_id: 6, variant_id: 60, quantity: 3 }];
    failStage = stage;
    assert.equal((await call()).status, 500);
    assert.deepEqual(db.products.map(x => x.stock), [3, 10]);
    assert.equal(db.order.status, 'pending');
    assert.equal(db.movements.length, 0);
    assert.deepEqual(events, ['begin', 'rollback']);
  });
}
test('conditional status conflict rolls back restored stock', async () => {
  failStage = 'status_conflict';
  assert.equal((await call()).status, 409);
  assert.equal(db.products[0].stock, 3);
  assert.equal(db.order.status, 'pending');
  assert.deepEqual(events, ['begin', 'rollback']);
});
test('order without items fails integrity check without status change', async (t) => {
  t.mock.method(console, 'error', () => {});
  db.items = [];
  assert.equal((await call()).status, 500);
  assert.equal(db.order.status, 'pending');
  assert.equal(db.products[0].stock, 3);
});
test('two concurrent cancels restore stock only once', async () => {
  const replies = await Promise.all([call(), call()]);
  assert.deepEqual(replies.map(x => x.status).sort(), [200, 409]);
  assert.equal(db.order.status, 'cancelled');
  assert.equal(db.products[0].stock, 5);
  assert.equal(db.movements.length, 1);
  assert.equal(events.filter(x => x === 'commit').length, 1);
});
test('admin cancel uses same restore flow without automatic blacklist', async () => {
  actor.role = 'admin';
  assert.equal((await call('/api/admin/orders/7/status', { status: 'cancelled' }, 'PUT')).status, 200);
  assert.equal(db.products[0].stock, 5);
  assert.equal(db.order.status, 'cancelled');
  assert.equal(db.blacklisted, false);
  assert.equal(db.movements[0].actor, 1);
});
test('admin legacy paid -> cancelled also restores stock', async () => {
  reset('paid'); actor.role = 'admin';
  assert.equal((await call('/api/admin/orders/7/status', { status: 'cancelled' }, 'PUT')).status, 200);
  assert.equal(db.products[0].stock, 5);
});
test('missing product row fails safely, without cancelling', async (t) => {
  t.mock.method(console, 'error', () => {});
  db.products = [];
  assert.equal((await call()).status, 500);
  assert.equal(db.order.status, 'pending');
  assert.deepEqual(events, ['begin', 'rollback']);
});
test('custom reason is stored after validation', async () => {
  assert.equal((await call('/api/orders/7/cancel', { reason: 'other', details: 'Không còn phù hợp' })).status, 200);
  assert.equal(db.order.cancel_reason, 'Khác: Không còn phù hợp');
});
for (const body of [{ reason: 'other', details: '' }, { reason: 'other', details: 'x'.repeat(181) },
  { reason: 5 }, { reason: 'wrong_item', details: 5 }, { reason: 'unknown' }]) {
  test('invalid reason rejected before database access', async () => {
    assert.equal((await call('/api/orders/7/cancel', body)).status, 400);
    assert.deepEqual(events, []);
  });
}

for (const status of ['pending', 'paid', 'failed']) {
  test('cancellation synchronizes only pending payments: ' + status, async () => {
    db.payments.push({ order_id: 7, status, paid_at: status === 'paid' ? 'original-time' : null });
    assert.equal((await call()).status, 200);
    assert.equal(db.payments[0].status, status === 'pending' ? 'cancelled' : status);
    assert.equal(db.payments[0].paid_at, status === 'paid' ? 'original-time' : null);
  });
}
test('payment cancellation SQL failure rolls back restored stock, ledger and order', async () => {
  db.payments.push({ order_id: 7, status: 'pending', paid_at: null });
  const before = clone(db); failStage = 'payment';
  assert.equal((await call()).status, 500); assert.deepEqual(db, before);
});
