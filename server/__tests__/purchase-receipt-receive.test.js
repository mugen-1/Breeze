'use strict';

// lib/purchase-receipt-receive.js (receiveReceipt trên tx của caller) + nhánh receipt_id của lib/inventory-movement.js.
// SQL giả ghi lại thứ tự câu lệnh để kiểm thứ tự khoá. Route: admin-receipts-routes.test.js; SQL thật + đồng thời:
// scripts/verify-audit-sql.js, scripts/test-receipt-receive-sql.js.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const realSql = require('mssql');

let db, log;
const rs = (recordset = [], affected) => ({ recordset, recordsets: [recordset], rowsAffected: [affected === undefined ? recordset.length : affected] });
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.p;
    assert.ok(this.tx, 'mọi câu phải chạy trên tx của caller');
    if (q.startsWith('SELECT i.id, i.product_id, i.variant_id, i.quantity FROM dbo.purchase_receipt_items i WHERE i.receipt_id = @id ORDER BY i.id;')) {
      log.push('items');
      return rs(db.items.filter(i => i.receipt_id === p.id).map(i => ({ ...i })));
    }
    if (q.startsWith('SELECT p.id, p.slug, p.stock,') && q.includes('FROM dbo.products p WITH (UPDLOCK, HOLDLOCK) WHERE p.id = @pid;')) {
      log.push('lock-product:' + p.pid);
      return rs(db.products.filter(x => x.id === p.pid).map(x => ({ ...x })));
    }
    if (q.startsWith('SELECT v.id, v.product_id, v.size, v.color, v.stock, v.is_base, pc.id AS color_id FROM dbo.product_variants v WITH (UPDLOCK, HOLDLOCK)')) {
      log.push('lock-variant:' + p.vid);
      return rs(db.variants.filter(x => x.id === p.vid).map(v => {
        const c = db.colors.find(x => x.product_id === v.product_id && x.color_key === v.color);
        return { ...v, color_id: c ? c.id : null };
      }));
    }
    if (q.startsWith('UPDATE dbo.products SET stock = stock + @qty')) {
      assert.match(q, /WHERE id = @pid AND stock <= 2147483647 - @qty;$/);
      log.push('update-product:' + p.pid + '+' + p.qty);
      const x = db.products.find(y => y.id === p.pid);
      if (!x || x.stock > 2147483647 - p.qty) return rs([], 0);
      x.stock += p.qty; return rs([], 1);
    }
    if (q.startsWith('UPDATE dbo.product_variants SET stock = stock + @qty')) {
      assert.match(q, /WHERE id = @vid AND product_id = @pid AND stock <= 2147483647 - @qty;$/);
      assert.doesNotMatch(q, /is_active/, 'không đụng is_active');
      log.push('update-variant:' + p.vid + '+' + p.qty);
      const v = db.variants.find(y => y.id === p.vid && y.product_id === p.pid);
      if (!v || v.stock > 2147483647 - p.qty) return rs([], 0);
      const before = v.stock; v.stock += p.qty;
      return rs([{ stock_before: before, stock_after: v.stock }]);
    }
    if (q.startsWith('INSERT INTO dbo.inventory_movements')) {
      log.push('movement:' + p.vid);
      db.movements.push({ q, ...p });
      return rs([], 1);
    }
    throw new Error('Unexpected SQL: ' + q);
  }
}
require.cache[require.resolve('../db')] = { exports: { sql: { ...realSql, Request } } };
const { receiveReceipt } = require('../lib/purchase-receipt-receive');
const { recordInventoryMovement } = require('../lib/inventory-movement');
const { ReceiptError } = require('../lib/purchase-receipt');

const TX = { name: 'caller-tx' };
const product = (id, over) => ({ id, slug: 'ao-' + id, stock: 10, category_slug: 'sanpham-ao', size_configured: 0, color_configured: 0, ...over });
const variant = (id, productId, over) => ({ id, product_id: productId, size: null, color: null, stock: 5, is_base: 0, is_active: 1, ...over });
beforeEach(() => {
  log = [];
  db = {
    products: [product(9, { size_configured: 1, stock: 8 }), product(0, { stock: 4, category_slug: 'sanpham-khac' }),
      product(4, { color_configured: 1, stock: 3 })],
    variants: [variant(90, 9, { is_base: 1, stock: 0 }), variant(93, 9, { size: 'L', stock: 5 }), variant(91, 9, { size: 'S', stock: 3, is_active: 0 }),
      variant(1, 0, { is_base: 1, stock: 4 }), variant(41, 4, { color: 'den', stock: 3 }), variant(42, 4, { color: 'xoa', stock: 0 })],
    colors: [{ id: 7, product_id: 4, color_key: 'den' }],
    // Dòng phiếu cố ý không theo thứ tự product_id / variant_id.
    items: [{ id: 1, receipt_id: 5, product_id: 9, variant_id: 93, quantity: 2 }, { id: 2, receipt_id: 5, product_id: 4, variant_id: 41, quantity: 7 },
      { id: 3, receipt_id: 5, product_id: 0, variant_id: 1, quantity: 6 }, { id: 4, receipt_id: 5, product_id: 9, variant_id: 91, quantity: 10 }],
    movements: [],
  };
});

test('khoá TỪNG sản phẩm theo product_id tăng dần, rồi TỪNG biến thể theo variant_id tăng dần, rồi mới UPDATE', async () => {
  await receiveReceipt(TX, { receiptId: 5, actorUserId: 2 });
  assert.deepEqual(log.slice(0, 8), ['items', 'lock-product:0', 'lock-product:4', 'lock-product:9',
    'lock-variant:1', 'lock-variant:41', 'lock-variant:91', 'lock-variant:93']);
  assert.ok(log.slice(8).every(x => /^(update|movement)/.test(x)), 'không khoá thêm sau khi bắt đầu ghi');
});

test('cộng tồn biến thể + tổng sản phẩm, 1 dòng sổ kho PURCHASE_RECEIPT có receipt_id mỗi dòng phiếu; trả theo variant_id', async () => {
  const changes = await receiveReceipt(TX, { receiptId: 5, actorUserId: 2 });
  assert.deepEqual(changes, [
    { product_id: 0, variant_id: 1, quantity: 6, stock_before: 4, stock_after: 10 },
    { product_id: 4, variant_id: 41, quantity: 7, stock_before: 3, stock_after: 10 },
    { product_id: 9, variant_id: 91, quantity: 10, stock_before: 3, stock_after: 13 },
    { product_id: 9, variant_id: 93, quantity: 2, stock_before: 5, stock_after: 7 }]);
  assert.deepEqual(db.products.map(p => [p.id, p.stock]), [[9, 20], [0, 10], [4, 10]], 'sản phẩm 9 cộng 12 trong 1 câu');
  assert.deepEqual(log.filter(x => x.startsWith('update-product')), ['update-product:0+6', 'update-product:4+7', 'update-product:9+12']);
  assert.deepEqual(db.movements.map(m => [m.type, m.pid, m.vid, m.rid, m.delta, m.before, m.after, m.reason, m.actor, m.oid]), [
    ['PURCHASE_RECEIPT', 0, 1, 5, 6, 4, 10, null, 2, null], ['PURCHASE_RECEIPT', 4, 41, 5, 7, 3, 10, null, 2, null],
    ['PURCHASE_RECEIPT', 9, 91, 5, 10, 3, 13, null, 2, null], ['PURCHASE_RECEIPT', 9, 93, 5, 2, 5, 7, null, 2, null]]);
  assert.ok(db.movements.every(m => /\(product_id, variant_id, order_id, order_reference_id, receipt_id, movement_type/.test(m.q)));
  assert.equal(db.variants.find(v => v.id === 91).is_active, 0, 'biến thể đang tắt vẫn nhận, không tự bật lại');
});

test('dòng không còn là biến thể lá -> 409 RECEIPT_ITEMS_INVALID đúng index, KHÔNG có UPDATE / sổ kho nào', async () => {
  db.items.push({ id: 5, receipt_id: 5, product_id: 9, variant_id: 90, quantity: 1 }, { id: 6, receipt_id: 5, product_id: 4, variant_id: 42, quantity: 1 });
  await assert.rejects(receiveReceipt(TX, { receiptId: 5, actorUserId: 2 }), e => {
    assert.ok(e instanceof ReceiptError);
    assert.deepEqual([e.status, e.code, e.extra.items], [409, 'RECEIPT_ITEMS_INVALID', [
      { index: 4, product_id: 9, variant_id: 90, reason: 'NOT_LEAF' }, { index: 5, product_id: 4, variant_id: 42, reason: 'NOT_LEAF' }]]);
    return true;
  });
  assert.deepEqual([log.filter(x => /^(update|movement)/.test(x)), db.movements.length], [[], 0]);
});

test('tràn INT (biến thể hoặc tổng sản phẩm) -> 409 RECEIPT_STOCK_OVERFLOW kèm dòng gây tràn, không ghi gì', async () => {
  db.variants.find(v => v.id === 41).stock = 2147483647 - 6; // 41 + 7 tràn
  db.products.find(p => p.id === 9).stock = 2147483647 - 11;  // 9: biến thể không tràn nhưng tổng 12 thì tràn
  await assert.rejects(receiveReceipt(TX, { receiptId: 5, actorUserId: 2 }), e => {
    assert.deepEqual([e.status, e.code, e.extra.items], [409, 'RECEIPT_STOCK_OVERFLOW', [
      { index: 0, product_id: 9, variant_id: 93 }, { index: 1, product_id: 4, variant_id: 41 }, { index: 3, product_id: 9, variant_id: 91 }]]);
    return true;
  });
  assert.deepEqual([log.filter(x => /^(update|movement)/.test(x)), db.movements.length], [[], 0]);
  db.variants.find(v => v.id === 41).stock = 2147483647 - 7; db.products.find(p => p.id === 9).stock = 2147483647 - 12;
  db.products.find(p => p.id === 4).stock = 2147483647 - 7;
  assert.equal((await receiveReceipt(TX, { receiptId: 5, actorUserId: 2 })).length, 4, 'đúng bằng giới hạn thì được');
});

test('phiếu không có dòng hàng -> lỗi (500 ở route), không ghi gì', async () => {
  await assert.rejects(receiveReceipt(TX, { receiptId: 99, actorUserId: 2 }), /no items/);
  assert.deepEqual(log, ['items']);
});

test('recordInventoryMovement: không có receiptId -> câu INSERT y như trước 029 (không nhắc receipt_id); có -> thêm cột', async () => {
  await recordInventoryMovement(TX, { productId: 1, variantId: 2, orderId: 3, type: 'ORDER_CHECKOUT', delta: -1, before: 5, after: 4, actorUserId: 7 });
  await recordInventoryMovement(TX, { productId: 1, variantId: 2, receiptId: 8, type: 'PURCHASE_RECEIPT', delta: 3, before: 4, after: 7 });
  const [plain, withReceipt] = db.movements;
  assert.equal(plain.q, 'INSERT INTO dbo.inventory_movements (product_id, variant_id, order_id, order_reference_id, movement_type, quantity_delta, '
    + 'stock_before, stock_after, reason, actor_user_id) VALUES (@pid, @vid, @oid, @oref, @type, @delta, @before, @after, @reason, @actor);');
  assert.ok(!('rid' in plain), 'không khai tham số @rid');
  assert.match(withReceipt.q, /order_reference_id, receipt_id, movement_type/);
  assert.match(withReceipt.q, /VALUES \(@pid, @vid, @oid, @oref, @rid, @type/);
  assert.deepEqual([withReceipt.rid, withReceipt.oid, withReceipt.type], [8, null, 'PURCHASE_RECEIPT']);
});
