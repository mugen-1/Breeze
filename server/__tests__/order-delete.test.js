'use strict';
const statsJobs = []; // job stats.recompute_day mà code nghiệp vụ đưa vào hàng (xem SQL giả bên dưới)

// DELETE /api/admin/orders/:id — xoá đơn cộng lại tồn kho theo trạng thái (lib/order-state.js),
// dùng chung restoreOrderStock với huỷ đơn. Router thật qua HTTP; chỉ thay Firebase và SQL bằng
// bản giả có transaction (mẫu cancel-order.test.js). SQL thật: verify-order-shipping-sql.js xoá
// 1 đơn pending trên DB tạm (setup-db --fresh, gồm migration 024).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');
const {
  ALL_STATUSES, DELETE_RESTOCK_STATUSES, DELETE_KEEP_STOCK_STATUSES,
} = require('../lib/order-state');

const ADMIN_ID = 42;
let db, failStage, events, queries, held, waiters;
const clone = x => structuredClone(x);
const result = (recordset = [], affected = recordset.length) => ({ recordset, rowsAffected: [affected] });
function reset(status = 'pending', items = [{ product_id: 5, variant_id: 50, quantity: 2 }]) {
  db = { order: { id: 7, user_id: 1, status, created_at: '2026-10-11T00:00:00Z' }, items: clone(items),
    products: [{ id: 5, stock: 3 }, { id: 6, stock: 10 }],
    variants: [{ id: 50, product_id: 5, stock: 3 }, { id: 60, product_id: 6, stock: 10 }],
    movements: [], payments: [{ order_id: 7, status: 'pending' }] };
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
    queries.push(q);
    assert.ok(this.tx, 'SQL xoá đơn phải nằm trong 1 transaction');
    if (q.startsWith('SELECT id, status FROM dbo.orders')) {
      assert.match(q, /WITH \(UPDLOCK, HOLDLOCK\)/);
      this.tx.release = await lock();
      this.tx.data = clone(db);
      if (failStage === 'select') throw new Error('injected select failure');
      const order = this.tx.data.order;
      return result(order && order.id === p.id ? [order] : []);
    }
    const data = this.tx.data;
    if (q.startsWith('SELECT product_id, variant_id, quantity FROM dbo.order_items')) {
      return result(data.order && data.order.id === p.id ? data.items : []);
    }
    if (q.startsWith('UPDATE dbo.products')) {
      assert.match(q, /stock = stock \+ @qty/);
      if (failStage === 'product-' + p.pid) throw new Error('injected product failure');
      const product = data.products.find(x => x.id === p.pid);
      if (!product) return result([], 0);
      product.stock += p.qty;
      return result([], 1);
    }
    if (q.startsWith('UPDATE dbo.product_variants')) {
      const variant = data.variants.find(x => x.id === p.vid && x.product_id === p.pid);
      if (!variant) return result([], 0);
      const before = variant.stock;
      variant.stock += p.qty;
      return result([{ stock_before: before, stock_after: variant.stock }], 1);
    }
    if (q.startsWith('INSERT INTO dbo.inventory_movements')) {
      if (failStage === 'movement') throw new Error('injected movement failure');
      // FK_inventory_movements_order: order_id phải trỏ tới đơn còn tồn tại.
      if (p.oid != null && !(data.order && data.order.id === p.oid)) throw new Error('FK_inventory_movements_order conflict');
      data.movements.push({ product_id: p.pid, variant_id: p.vid, order_id: p.oid, order_reference_id: p.oref,
        type: p.type, delta: p.delta, before: p.before, after: p.after, actor: p.actor });
      return result([], 1);
    }
    if (q.startsWith('DELETE FROM dbo.orders')) {
      assert.match(q, /OUTPUT DELETED\.id WHERE id = @id/);
      if (failStage === 'delete') throw new Error('injected delete failure');
      if (!data.order || data.order.id !== p.id) return result([]);
      data.order = null; data.items = [];                                  // order_items CASCADE
      data.payments = data.payments.filter(x => x.order_id !== p.id);     // payment_transactions CASCADE
      for (const m of data.movements) if (m.order_id === p.id) m.order_id = null; // ON DELETE SET NULL
      return result([{ id: p.id }]);
    }
    if (q.startsWith('INSERT INTO dbo.audit_logs')) return { recordset: [{ id: '1' }] };
    if (q.startsWith('SELECT order_code, user_id')) return { recordsets: [[clone(data.order)], clone(data.items), clone(data.payments)] };
    // Job thống kê theo ngày (lib/stats-snapshot.js enqueueStatsDay): ghi lại để test kiểm, trả id giả.
    if (q.includes('INSERT INTO dbo.jobs')) { statsJobs.push({ inTx: !!this.tx, type: p.type, payload: JSON.parse(p.payload), dedupe: p.dedupe }); return { recordset: [{ id: statsJobs.length }], recordsets: [[{ id: statsJobs.length }]], rowsAffected: [1] }; }
    throw new Error('Unexpected SQL: ' + q);
  }
}
require.cache[require.resolve('../db')] = { exports: {
  getPool: async () => ({}), sql: { ...realSql, Transaction, Request },
} };
require.cache[require.resolve('../middleware/auth')] = { exports: {
  verifyFirebaseToken: (req, res, next) => { req.user = { id: ADMIN_ID, role: 'admin' }; next(); },
} };
const app = express();
app.use(express.json());
app.use('/api/admin', require('../routes/admin'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => reset());
async function del(id = 7) {
  const response = await fetch(base + '/api/admin/orders/' + id, { method: 'DELETE' });
  return { status: response.status, body: await response.json() };
}
const quiet = t => t.mock.method(console, 'error', () => {});

test('hai nhóm trạng thái xoá phủ đúng ALL_STATUSES, không chồng nhau', () => {
  assert.deepEqual([...DELETE_RESTOCK_STATUSES].sort(), ['confirmed', 'paid', 'pending', 'processing']);
  assert.deepEqual([...DELETE_KEEP_STOCK_STATUSES].sort(), ['cancelled', 'completed', 'shipped', 'shipping']);
  assert.deepEqual([...DELETE_RESTOCK_STATUSES, ...DELETE_KEEP_STOCK_STATUSES].sort(), [...ALL_STATUSES].sort());
});

for (const status of DELETE_RESTOCK_STATUSES) {
  test('xoá đơn ' + status + ': cộng lại stock product + variant, 1 movement ORDER_DELETE, ghi trước DELETE', async () => {
    reset(status);
    const reply = await del();
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { status: 'ok', deletedId: 7, restoredStock: true });
    assert.equal(db.order, null);
    assert.deepEqual(db.payments, []);
    assert.equal(db.products[0].stock, 5);
    assert.equal(db.variants[0].stock, 5);
    assert.deepEqual(db.movements, [{ product_id: 5, variant_id: 50, order_id: null, order_reference_id: 7,
      type: 'ORDER_DELETE', delta: 2, before: 3, after: 5, actor: ADMIN_ID }]);
    const at = prefix => queries.findIndex(q => q.startsWith(prefix));
    assert.equal(at('SELECT id, status FROM dbo.orders'), 0);
    assert.ok(at('INSERT INTO dbo.inventory_movements') < at('DELETE FROM dbo.orders'));
    assert.deepEqual(events, ['begin', 'commit']);
  });
}

test('đơn nhiều item: mỗi item 1 movement ORDER_DELETE, cộng theo thứ tự product id', async () => {
  db.items = [{ product_id: 6, variant_id: 60, quantity: 3 }, { product_id: 5, variant_id: 50, quantity: 2 }];
  assert.equal((await del()).status, 200);
  assert.deepEqual(db.products.map(x => x.stock), [5, 13]);
  assert.deepEqual(db.variants.map(x => x.stock), [5, 13]);
  assert.deepEqual(db.movements.map(m => [m.type, m.product_id, m.variant_id, m.delta, m.before, m.after]),
    [['ORDER_DELETE', 5, 50, 2, 3, 5], ['ORDER_DELETE', 6, 60, 3, 10, 13]]);
});

for (const status of DELETE_KEEP_STOCK_STATUSES) {
  test('xoá đơn ' + status + ': stock không đổi, không có movement, đơn vẫn bị xoá', async () => {
    reset(status);
    const reply = await del();
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { status: 'ok', deletedId: 7, restoredStock: false });
    assert.equal(db.order, null);
    assert.deepEqual(db.products.map(x => x.stock), [3, 10]);
    assert.deepEqual(db.variants.map(x => x.stock), [3, 10]);
    assert.deepEqual(db.movements, []);
    assert.ok(!queries.some(q => /^(UPDATE dbo\.product|INSERT INTO dbo\.inventory_movements|SELECT product_id)/.test(q)));
    assert.deepEqual(events, ['begin', 'commit']);
  });
}

for (const stage of ['product-6', 'movement', 'delete']) {
  test('lỗi ở bước ' + stage + ' -> rollback toàn bộ: đơn còn nguyên, kho không đổi, không movement', async (t) => {
    quiet(t);
    db.items = [{ product_id: 5, variant_id: 50, quantity: 2 }, { product_id: 6, variant_id: 60, quantity: 3 }];
    const before = clone(db); failStage = stage;
    const reply = await del();
    assert.equal(reply.status, 500);
    assert.deepEqual(reply.body, { status: 'error', message: 'Không xoá được đơn hàng' });
    assert.deepEqual(db, before);
    assert.deepEqual(events, ['begin', 'rollback']);
  });
}

test('không có đơn -> 404 như cũ, rollback, không chạy DELETE', async () => {
  const reply = await del(8);
  assert.equal(reply.status, 404);
  assert.deepEqual(reply.body, { status: 'error', message: 'Không tìm thấy đơn hàng' });
  assert.deepEqual(events, ['begin', 'rollback']);
  assert.ok(!queries.some(q => q.startsWith('DELETE')));
  assert.ok(db.order);
});

test('id không hợp lệ -> 400, không chạm DB', async () => {
  assert.equal((await del('abc')).status, 400);
  assert.deepEqual(events, []);
});

test('trạng thái ngoài 2 nhóm (dữ liệu lạ) -> 500, không tự xếp, không đổi gì', async (t) => {
  quiet(t);
  reset('returned');
  const before = clone(db);
  assert.equal((await del()).status, 500);
  assert.deepEqual(db, before);
  assert.ok(!queries.some(q => /^(UPDATE|INSERT|DELETE)/.test(q)));
});

test('đơn chưa rời kho nhưng không có item -> 500 (kiểm toàn vẹn dùng chung với huỷ đơn), đơn còn nguyên', async (t) => {
  quiet(t);
  db.items = [];
  const before = clone(db);
  assert.equal((await del()).status, 500);
  assert.deepEqual(db, before);
});

test('hai lệnh xoá đồng thời: 1 thành công, 1 ra 404, kho chỉ cộng 1 lần', async () => {
  const replies = await Promise.all([del(), del()]);
  assert.deepEqual(replies.map(x => x.status).sort(), [200, 404]);
  assert.equal(db.products[0].stock, 5);
  assert.equal(db.movements.length, 1);
  assert.equal(events.filter(x => x === 'commit').length, 1);
});
