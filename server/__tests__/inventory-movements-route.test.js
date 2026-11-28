'use strict';

// GET /api/admin/products/:id/inventory-movements: nhận id >= 0 (products.id bắt đầu từ 0), mỗi dòng kèm receipt_id +
// receipt_code khi DB đã chạy migration 029; DB chưa có cột receipt_id -> câu SELECT cũ (không nhắc tới receipt_id /
// purchase_receipts), receipt_id / receipt_code = null. Router THẬT; chỉ thay xác thực và SQL.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

let hasReceiptColumn, queries;
const rs = recordset => ({ recordset, recordsets: [recordset], rowsAffected: [recordset.length] });
const PRODUCTS = { 0: { id: 0, name_vi: 'Áo id 0', name_en: null, stock: 9, is_active: true }, 5: { id: 5, name_vi: 'Áo 5', name_en: null, stock: 2, is_active: false } };
const MOVES = [{ id: 3, variant_id: 1, size: null, color: null, created_at: new Date('2026-11-27T01:00:00Z'), movement_type: 'PURCHASE_RECEIPT',
  quantity_delta: 6, stock_before: 3, stock_after: 9, order_id: null, order_reference_id: null, order_code: null, reason: null, actor_user_id: 2,
  receipt_id: 7, receipt_code: 'PN-000007' }, { id: 2, variant_id: 1, size: null, color: null, created_at: new Date('2026-11-26T01:00:00Z'),
  movement_type: 'ORDER_CHECKOUT', quantity_delta: -1, stock_before: 4, stock_after: 3, order_id: 11, order_reference_id: 11, order_code: 1004,
  reason: null, actor_user_id: 9, receipt_id: null, receipt_code: null }];
class Request {
  constructor() { this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.p;
    queries.push(q);
    if (q.startsWith('SELECT p.id, p.slug, p.category_id')) return rs(PRODUCTS[p.id] ? [{ ...PRODUCTS[p.id] }] : []);
    if (q.startsWith('SELECT COUNT(*) AS total, CASE WHEN COL_LENGTH(\'dbo.inventory_movements\', \'receipt_id\') IS NULL THEN 0 ELSE 1 END AS has_receipt')) {
      return rs([{ total: MOVES.length, has_receipt: hasReceiptColumn ? 1 : 0 }]);
    }
    if (q.startsWith('SELECT id, variant_id,') && q.includes('FROM dbo.inventory_movements m')) {
      const withReceipt = q.includes('m.receipt_id');
      assert.equal(withReceipt, hasReceiptColumn, 'chỉ nhắc tới receipt_id khi cột đã có');
      assert.equal(q.includes('dbo.purchase_receipts'), hasReceiptColumn);
      return rs(MOVES.map(({ receipt_id, receipt_code, ...m }) => (withReceipt ? { ...m, receipt_id, receipt_code } : m)));
    }
    throw new Error('Unexpected SQL: ' + q);
  }
}
require.cache[require.resolve('../db')] = { exports: { sql: realSql, getPool: async () => ({ request: () => new Request() }) } };
require.cache[require.resolve('../middleware/auth')] = { exports: {
  verifyFirebaseToken: (req, res, next) => { req.user = { id: 2, email: 'staff@example.test', role: 'staff' }; next(); },
} };
const app = express();
app.use(express.json());
app.use('/api/admin', require('../routes/admin'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/api/admin/products/';
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => { hasReceiptColumn = true; queries = []; });
const get = async path => { const r = await fetch(base + path); return { status: r.status, body: await r.json() }; };

test('sản phẩm id 0 xem được lịch sử (trước đây 400); id âm / chữ -> 400; không có -> 404', async () => {
  const r = await get('0/inventory-movements');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.product.id, r.body.total, r.body.movements.length], [0, 2, 2]);
  for (const id of ['-1', 'abc', '1.5']) assert.equal((await get(id + '/inventory-movements')).status, 400, id);
  assert.equal((await get('99/inventory-movements')).status, 404);
});

test('DB đã có 029: mỗi dòng kèm receipt_id + receipt_code (mã phiếu); dòng không thuộc phiếu -> null', async () => {
  const r = await get('5/inventory-movements');
  assert.deepEqual(r.body.movements.map(m => [m.id, m.movement_type, m.receipt_id, m.receipt_code]),
    [[3, 'PURCHASE_RECEIPT', 7, 'PN-000007'], [2, 'ORDER_CHECKOUT', null, null]]);
  assert.match(queries.find(q => q.includes('FROM dbo.inventory_movements m')),
    /, m\.receipt_id, \(SELECT r\.code FROM dbo\.purchase_receipts r WHERE r\.id = m\.receipt_id\) AS receipt_code FROM/);
});

test('DB chưa chạy 029: SELECT cũ (không nhắc receipt_id), vẫn 200, receipt_id / receipt_code = null', async () => {
  hasReceiptColumn = false;
  const r = await get('5/inventory-movements');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.movements.map(m => [m.id, m.receipt_id, m.receipt_code, m.order_code]), [[3, null, null, null], [2, null, null, 1004]]);
});
