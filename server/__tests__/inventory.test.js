'use strict';

// HTTP checkout tests with a transactional SQL test double. The separate
// test-inventory-sql.js exercises SQL Server locking with two real connections.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

let db, failAt, events, queries, user;
const clone = (value) => structuredClone(value);
const result = (recordset = [], affected = recordset.length) => ({ recordset, rowsAffected: [affected] });
function seed(products = [{ id: 1, name_vi: 'Áo', stock: 5, is_active: true, price: 500000 }],
  cart = [{ user_id: 1, product_id: 1, quantity: 2 }]) {
  db = { products: clone(products),
    variants: products.map(x => ({ id: x.id * 10, product_id: x.id, stock: x.stock, is_active: x.is_active,
      is_base: true, size: null, color: null })),
    cart: cart.map(x => ({ ...x, variant_id: x.variant_id ?? x.product_id * 10 })),
    orders: [], items: [], movements: [], payments: [], lastCode: 1000 };
  failAt = null; events = []; queries = []; user = { id: 1, role: 'customer', is_blacklisted: false };
}
class Transaction {
  async begin() { this.data = clone(db); events.push('begin'); }
  async commit() { db = this.data; events.push('commit'); }
  async rollback() { events.push('rollback'); }
}
class Request {
  constructor(tx) { this.tx = tx; this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(query) {
    const q = query.replace(/\s+/g, ' ').trim();
    const p = this.params;
    queries.push({ q, p, tx: this.tx });
    const stage = q.startsWith('UPDATE dbo.order_code_counter') ? 'code'
      : q.startsWith('DELETE FROM dbo.cart_items') ? 'clear'
      : q.includes('FROM dbo.cart_items') ? 'cart'
      : q.includes('FROM dbo.products p WITH') ? 'product'
        : q.includes('FROM dbo.product_variants v WITH') ? 'variant_read'
        : q.startsWith('UPDATE dbo.products') ? 'aggregate'
        : q.startsWith('UPDATE dbo.product_variants') ? 'stock'
          : q.startsWith('INSERT INTO dbo.inventory_movements') ? 'movement'
          : q.startsWith('INSERT INTO dbo.orders') ? 'order'
            : q.startsWith('INSERT INTO dbo.order_items') ? 'item'
            : q.startsWith('INSERT INTO dbo.payment_transactions') ? 'payment'
              : 'history';
    if (stage === failAt) throw new Error('injected SQL failure');
    assert.ok(this.tx && this.tx.data, 'checkout query must use the transaction');
    const d = this.tx.data;
    if (stage === 'code') {
      assert.match(q, /UPDLOCK, HOLDLOCK/);
      return result(d.lastCode < p.lastCode ? [{ order_code: ++d.lastCode }] : []);
    }
    if (stage === 'cart') {
      assert.match(q, /UPDLOCK, HOLDLOCK, INDEX\(IX_cart_items_user\)/);
      return result(d.cart.filter(x => x.user_id === p.uid).map(x => ({ product_id: x.product_id,
        variant_id: x.variant_id, quantity: x.quantity })));
    }
    if (stage === 'product') {
      assert.match(q, /UPDLOCK, HOLDLOCK/);
      assert.match(q, /CASE WHEN p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END/);
      const item = d.products.find(x => x.id === p.pid);
      return result(item ? [{ name_vi: item.name_vi,
        slug: item.slug, category_slug: item.category_slug,
        size_configured: d.variants.some(v => v.product_id === item.id && !v.is_base && v.size != null),
        is_active: item.is_active, unit_price: item.sale_price ?? item.price }] : []);
    }
    if (stage === 'variant_read') {
      assert.match(q, /UPDLOCK, HOLDLOCK/);
      const item = d.variants.find(x => x.id === p.vid && x.product_id === p.pid);
      return result(item ? [{ ...item }] : []);
    }
    if (stage === 'history') {
      assert.match(q, /FROM dbo.orders WHERE user_id = @uid/);
      return result([{ c: d.orders.filter(x => x.user_id === p.uid && x.status !== 'cancelled').length }]);
    }
    if (stage === 'aggregate') {
      assert.match(q, /stock = stock - @qty/);
      assert.match(q, /is_active = 1 AND stock >= @qty/);
      const item = d.products.find(x => x.id === p.pid);
      if (!item || !item.is_active || item.stock < p.qty) return result([], 0);
      item.stock -= p.qty;
      return result([], 1);
    }
    if (stage === 'stock') {
      assert.match(q, /stock = stock - @qty/);
      const item = d.variants.find(x => x.id === p.vid && x.product_id === p.pid);
      if (!item || !item.is_active || item.stock < p.qty) return result([], 0);
      const before = item.stock;
      item.stock -= p.qty;
      return result([{ stock_before: before, stock_after: item.stock }], 1);
    }
    if (stage === 'order') {
      assert.match(q, /VALUES \(@uid, 'pending', @total/);
      const order = { id: d.orders.length + 1, user_id: p.uid, status: 'pending',
        order_code: p.ocode, shipping_version: 2, shipping_provider: p.sprovider, shipping_service: p.sservice,
        shipping_eta: p.seta, shipping_tracking_code: p.stracking, shipping_status: 'pending_pickup',
        total_amount: p.total, VoucherCode: p.vcode, DiscountAmount: p.discount,
        PaymentMethod: p.pmethod, shipping_name: p.sname, shipping_phone: p.sphone, shipping_address: p.saddr,
        shipping_ward: p.sward, shipping_district: p.sdistrict, shipping_city: p.scity,
        delivery_note: p.snote, shipping_method: p.smethod, shipping_fee: p.sfee };
      d.orders.push(order);
      return result([order]);
    }
    if (stage === 'item') {
      d.items.push({ order_id: p.oid, product_id: p.pid, variant_id: p.vid, quantity: p.qty,
        unit_price: p.uprice, line_total: p.ltotal, size_snapshot: p.size });
      return result([], 1);
    }
    if (stage === 'movement') {
      d.movements.push({ product_id: p.pid, variant_id: p.vid, order_id: p.oid, type: p.type,
        delta: p.delta, before: p.before, after: p.after, actor: p.actor });
      return result([], 1);
    }
    if (stage === 'payment') {
      assert.ok(q.includes("SELECT id, CONCAT('PAY-', order_code, '-001'), PaymentMethod, total_amount FROM dbo.orders WHERE id = @oid"));
      assert.deepEqual(Object.keys(p), ['oid']);
      const order = d.orders.find(o => o.id === p.oid);
      const payment = { id: d.payments.length + 1, order_id: order.id, transaction_code: 'PAY-' + order.order_code + '-001',
        payment_method: order.PaymentMethod, amount: order.total_amount, status: 'pending', created_at: '2026-10-11T00:00:00Z', paid_at: null };
      d.payments.push(payment); return result([payment]);
    }
    if (stage === 'clear') {
      d.cart = d.cart.filter(x => x.user_id !== p.uid);
      return result([], 1);
    }
    throw new Error('Unexpected SQL: ' + q);
  }
}
require.cache[require.resolve('../db')] = { exports: {
  getPool: async () => ({}), sql: { ...realSql, Transaction, Request },
} };
require.cache[require.resolve('../middleware/auth')] = { exports: {
  verifyFirebaseToken: (req, res, next) => { req.user = user; next(); },
} };
const app = express();
app.use(express.json());
app.use('/api/orders', require('../routes/orders'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => seed());
async function checkout(body = {}) {
  const response = await fetch(base + '/api/orders', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentMethod: 'cod', ...require('./helpers/shipping'), ...body }) });
  return { status: response.status, body: await response.json() };
}

test('stock 5, buy 2: order pending, snapshot price, stock 3 and cart cleared', async () => {
  const r = await checkout();
  assert.equal(r.status, 201);
  assert.equal(r.body.order.status, 'pending');
  assert.equal(db.products[0].stock, 3);
  assert.equal(db.variants[0].stock, 3);
  assert.deepEqual(db.movements, [{ product_id: 1, variant_id: 10, order_id: 1, type: 'ORDER_CHECKOUT',
    delta: -2, before: 5, after: 3, actor: 1 }]);
  assert.equal(db.items[0].unit_price, 500000);
  assert.equal(db.orders[0].total_amount, 1020000);
  assert.equal(db.cart.length, 0);
  assert.deepEqual(events, ['begin', 'commit']);
});
test('stock 1, buy 2: 409, no order and cart retained', async () => {
  db.products[0].stock = 1;
  db.variants[0].stock = 1;
  const r = await checkout();
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'INSUFFICIENT_STOCK');
  assert.equal(r.body.items[0].stock, 1);
  assert.equal(db.products[0].stock, 1);
  assert.equal(db.orders.length, 0);
  assert.equal(db.cart.length, 1);
  assert.deepEqual(events, ['begin', 'rollback']);
});
test('size checkout snapshots SQL size, decrements M only, ignores browser size', async () => {
  db.products[0].category_slug = 'sanpham-ao';
  db.products[0].stock = 7;
  db.variants = [{ id: 10, product_id: 1, size: 'M', color: null, is_base: false, is_active: true, stock: 5 },
    { id: 11, product_id: 1, size: 'L', color: null, is_base: false, is_active: true, stock: 2 }];
  assert.equal((await checkout({ size: 'L' })).status, 201);
  assert.equal(db.items[0].size_snapshot, 'M');
  assert.deepEqual(db.variants.map(v => v.stock), [3,2]);
  assert.equal(db.products[0].stock, 5);
});
test('old BASE cart cannot checkout after sizes configured, including inactive size', async () => {
  db.products[0].category_slug = 'sanpham-ao';
  db.variants.push({ id: 11, product_id: 1, size: 'M', color: null, is_base: false, is_active: false, stock: 0 });
  const r = await checkout();
  assert.equal(r.status,409); assert.equal(r.body.error,'PRODUCT_UNAVAILABLE');
  assert.equal(db.products[0].stock,5); assert.equal(db.orders.length,0);
});
test('multi-item cart: insufficient last item rolls back all and locks in id order', async () => {
  seed([{ id: 1, name_vi: 'A', stock: 5, is_active: true, price: 100 },
    { id: 2, name_vi: 'B', stock: 0, is_active: true, price: 200 }],
  [{ user_id: 1, product_id: 2, quantity: 1 }, { user_id: 1, product_id: 1, quantity: 2 }]);
  assert.equal((await checkout()).status, 409);
  assert.deepEqual(db.products.map(x => x.stock), [5, 0]);
  assert.equal(db.orders.length, 0);
  assert.deepEqual(queries.filter(x => x.q.includes('FROM dbo.products p WITH')).map(x => x.p.pid), [1, 2]);
});
test('a second checkout of the cleared cart cannot create a duplicate order', async () => {
  assert.equal((await checkout()).status, 201);
  assert.equal((await checkout()).status, 400);
  assert.equal(db.orders.length, 1);
  assert.equal(db.products[0].stock, 3);
});
test('stock never becomes negative on rejected checkout', async () => {
  db.products[0].stock = 0;
  db.variants[0].stock = 0;
  assert.equal((await checkout()).status, 409);
  assert.equal(db.products[0].stock, 0);
});
for (const stage of ['order', 'item', 'movement', 'payment', 'clear']) {
  test(stage + ' insert/delete failure rolls back stock, order, items and cart', async (t) => {
    t.mock.method(console, 'error', () => {});
    failAt = stage;
    assert.equal((await checkout()).status, 500);
    assert.equal(db.products[0].stock, 5);
    assert.equal(db.orders.length, 0);
    assert.equal(db.items.length, 0);
    assert.equal(db.movements.length, 0);
    assert.equal(db.cart.length, 1);
    assert.deepEqual(events, ['begin', 'rollback']);
  });
}
test('browser price, total, discount, stock, items and status are ignored', async () => {
  const r = await checkout({ price: 1, total: 1, discount: 999999, stock: 9999,
    items: [{ product_id: 99, quantity: 99 }], status: 'completed' });
  assert.equal(r.status, 201);
  assert.equal(db.orders[0].total_amount, 1020000);
  assert.equal(db.orders[0].status, 'pending');
  assert.deepEqual(db.items.map(x => x.product_id), [1]);
  assert.equal(db.products[0].stock, 3);
});
test('inactive product in cart is rejected without deleting cart', async () => {
  db.products[0].is_active = false;
  const r = await checkout();
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'PRODUCT_UNAVAILABLE');
  assert.equal(db.cart.length, 1);
  assert.equal(db.orders.length, 0);
});
test('empty cart cannot create an order', async () => {
  db.cart = [];
  assert.equal((await checkout()).status, 400);
  assert.equal(db.orders.length, 0);
});
test('admin checkout stays forbidden', async () => {
  user.role = 'admin';
  assert.equal((await checkout()).status, 403);
  assert.equal(events.length, 0);
});
test('blacklisted customer stays forbidden', async () => {
  user.is_blacklisted = true;
  assert.equal((await checkout()).status, 403);
  assert.equal(events.length, 0);
});
test('voucher history and discount are computed within the transaction', async () => {
  const r = await checkout({ voucherCode: 'GIAMGIALANDAU', discountAmount: 999999 });
  assert.equal(r.status, 201);
  assert.equal(db.orders[0].DiscountAmount, 150000);
  assert.equal(db.orders[0].total_amount, 870000);
  assert.ok(queries.find(x => x.q.includes('FROM dbo.orders WHERE user_id')).tx);
});

test('shipping snapshot is normalized and untrusted browser fees/owner are ignored', async () => {
  const r = await checkout({ shipping_name: '  Recipient  ', shipping_phone: '090 123 4567',
    shipping_address: '<img src=x onerror=alert(1)>', delivery_note: '<script>alert(1)</script>',
    user_id: 999, shipping_fee: -1000000, grand_total: 0 });
  assert.equal(r.status, 201);
  assert.equal(db.orders[0].user_id, 1);
  assert.equal(db.orders[0].shipping_name, 'Recipient');
  assert.equal(db.orders[0].shipping_phone, '0901234567');
  assert.equal(db.orders[0].shipping_fee, 20000);
  assert.equal(db.orders[0].shipping_method, 'GHN_STANDARD');
  assert.equal(db.orders[0].shipping_address, '<img src=x onerror=alert(1)>');
  assert.equal(db.orders[0].delivery_note, '<script>alert(1)</script>');
  assert.equal(db.orders[0].total_amount, 1020000);
});
test('shipping API returns the STANDARD business fee', async () => {
  const response = await fetch(base + '/api/orders/shipping-methods');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), require('../config/shipping').METHODS);
});
for (const fee of [0, -999999, 999999]) {
  test('browser fee ' + fee + ' cannot override STANDARD', async () => {
    const r = await checkout({ shipping_fee: fee });
    assert.equal(r.status, 201);
    assert.equal(r.body.order.shipping_fee, 20000);
    assert.equal(db.orders[0].shipping_fee, 20000);
    assert.equal(db.orders[0].total_amount, 1020000);
  });
}
for (const bad of [{ shipping_name: '' }, { shipping_address: '' }, { shipping_phone: 'abc' },
  { shipping_ward: {} }, { shipping_city: [] }, { shipping_district: null },
  { delivery_note: 'x'.repeat(501) }, { shipping_method: 'EXPRESS' }]) {
  test('invalid shipping rejected before transaction: ' + Object.keys(bad)[0], async () => {
    assert.equal((await checkout(bad)).status, 400);
    assert.deepEqual(events, []);
    assert.equal(db.orders.length, 0);
    assert.equal(db.cart.length, 1);
  });
}


test('business codes start at 1001, progress independently of internal IDs and ignore forged snapshots', async () => {
  db.orders.push({ id: 77, user_id: 2, status: 'pending' });
  const r = await checkout({ order_code: 1100, shipping_status: 'delivered', shipping_provider: 'Fake', shipping_tracking_code: 'Fake' });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.order_code, 1001);
  assert.notEqual(r.body.order.id, 1001);
  assert.equal(r.body.order.shipping_tracking_code, 'GHN-BR-1001');
  assert.equal(r.body.order.shipping_status, 'pending_pickup');
  assert.equal(db.orders.at(-1).shipping_provider, 'GHN');
  db.cart.push({ user_id: 1, product_id: 1, variant_id: 10, quantity: 1 });
  const second = await checkout({ shipping_method: 'GHTK_ECONOMY' });
  assert.equal(second.body.order.order_code, 1002);
  assert.equal(second.body.order.shipping_tracking_code, 'GHTK-BR-1002');
  assert.equal(second.body.order.shipping_fee, 15000);
});

test('1100 is last usable code; next checkout retains all data and returns exact limit error', async () => {
  db.lastCode = 1099;
  assert.equal((await checkout()).body.order.order_code, 1100);
  db.cart.push({ user_id: 1, product_id: 1, variant_id: 10, quantity: 1 });
  const before = clone(db);
  const r = await checkout({ voucherCode: 'GIAMGIALANDAU' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'ORDER_CODE_LIMIT');
  assert.equal(r.body.message, 'lỗi lên đơn');
  assert.deepEqual(db, before);
});

test('failed item write rolls back the code and all shipping/inventory data', async () => {
  const before = clone(db);
  failAt = 'item';
  assert.equal((await checkout()).status, 500);
  assert.deepEqual(db, before);
  failAt = null;
  assert.equal((await checkout()).body.order.order_code, 1001);
});

for (const method of require('../config/shipping').METHODS) test('server owns provider, fee, ETA and tracking: ' + method.key, async () => {
  const r = await checkout({ shipping_method: method.key, shipping_fee: 1, shipping_eta: 'Fake', shipping_service: 'Fake' });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.shipping_fee, method.fee);
  assert.equal(r.body.order.total_amount, 1000000 + method.fee);
  assert.equal(r.body.order.shipping_provider, method.provider);
  assert.equal(r.body.order.shipping_service, method.service);
  assert.equal(r.body.order.shipping_eta, method.eta);
  assert.equal(r.body.order.shipping_tracking_code, method.tracking_prefix + '-1001');
});

for (const method of ['cod', 'visa', 'mastercard', 'momo']) {
  test('checkout persists server-owned pending payment: ' + method, async () => {
    const r = await checkout({ paymentMethod: method, amount: 1, payment_status: 'paid', transaction_code: 'FORGED' });
    assert.equal(r.status, 201);
    const payment = r.body.order.payment_transaction;
    assert.deepEqual(payment, db.payments[0]);
    assert.equal(payment.order_id, r.body.order.id);
    assert.equal(payment.transaction_code, 'PAY-1001-001');
    assert.equal(payment.payment_method, method);
    assert.equal(payment.amount, r.body.order.total_amount);
    assert.equal(payment.status, 'pending'); assert.equal(payment.paid_at, null);
  });
}
test('payment insert failure rolls back code, voucher, stock, ledger, order and cart', async () => {
  const before = clone(db); failAt = 'payment';
  assert.equal((await checkout({ voucherCode: 'GIAMGIALANDAU' })).status, 500);
  assert.deepEqual(db, before);
});
test('code limit creates no payment or checkout changes', async () => {
  db.lastCode = 1100; const before = clone(db);
  const reply = await checkout();
  assert.equal(reply.body.error, 'ORDER_CODE_LIMIT'); assert.deepEqual(db, before);
  assert.ok(!queries.some(x => x.q.includes('payment_transactions')));
});
test('two orders have stable distinct payment codes with internal IDs', async () => {
  const a = await checkout();
  db.cart.push({ user_id: 1, product_id: 1, variant_id: 10, quantity: 1 });
  const b = await checkout();
  assert.equal(a.body.order.payment_transaction.transaction_code, 'PAY-1001-001');
  assert.equal(b.body.order.payment_transaction.transaction_code, 'PAY-1002-001');
  assert.deepEqual(db.payments.map(p => p.order_id), [1, 2]);
});
