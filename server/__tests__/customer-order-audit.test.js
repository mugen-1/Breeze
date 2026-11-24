'use strict';

// log phía khách: ORDER_PLACE (POST /api/orders) và ORDER_CANCEL_BY_CUSTOMER (POST /api/orders/:id/cancel).
// Router + lib/audit.js THẬT, SQL giả có transaction (begin chụp bản sao, commit ghi đè, rollback bỏ). JSON so với
// hằng số VIẾT CỨNG = JSON thật của routes/orders.js bản 7d547cb (trước khi có log), lấy MỘT LẦN ngày 2026-11-16 trên
// đúng SQL giả này — test không dùng git. SQL thật: scripts/verify-audit-sql.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');
const shipping = require('./helpers/shipping');

const XSS = '<img src=x onerror=alert(1)>';
const PERSONAL = { shipping_name: 'Nguyễn Riêng Tư', shipping_phone: '0987654321', shipping_address: '99 Đường Bí Mật',
  shipping_ward: 'Phường Kín', shipping_district: 'Quận Ẩn', shipping_city: 'Thành Phố Lạ', delivery_note: 'Ghi chú ' + XSS };
const CARD = { last4: '4242', holder_name: 'CHU THE BI MAT', exp_month: 9, exp_year: 2031 };
const MOMO_PHONE = '0912345678';
let db, actor, events, failAudit;
const clone = x => structuredClone(x);
const rs = (recordset = [], affected = recordset.length) => ({ recordset, recordsets: [recordset], rowsAffected: [affected] });
class Transaction {
  async begin() { this.data = clone(db); events.push('begin'); }
  async commit() { db = this.data; events.push('commit'); }
  async rollback() { this.data = null; events.push('rollback'); }
}
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) { return handle(raw.replace(/\s+/g, ' ').trim(), this.p, this.tx ? this.tx.data : db, !!this.tx); }
}
function handle(q, p, d, inTx) {
  if (!d) throw new Error('SQL sau rollback');
  if (q.startsWith('INSERT INTO dbo.audit_logs')) {
    assert.ok(inTx, 'audit phải chạy trong transaction');
    if (failAudit) throw new Error('audit giả lỗi');
    d.audit.push({ actor_user_id: p.actor_user_id, actor_email: p.actor_email, actor_role: p.actor_role, action: p.action,
      entity_type: p.entity_type, entity_id: p.entity_id, before_json: p.before_json, after_json: p.after_json,
      before: p.before_json && JSON.parse(p.before_json), after: JSON.parse(p.after_json) });
    return rs([{ id: String(d.audit.length) }]);
  }
  if (q.includes('FROM dbo.payment_methods')) { // checkPaymentInfo (ngoài tx)
    return rs(d.cards.some(c => c.user_id === p.uid && c.brand === p.brand) ? [{ ok: 1 }] : []);
  }
  if (q.startsWith('SELECT ci.product_id, ci.variant_id, ci.quantity FROM dbo.cart_items')) {
    return rs(d.cart.filter(c => c.user_id === p.uid).map(({ product_id, variant_id, quantity }) => ({ product_id, variant_id, quantity })));
  }
  if (q.startsWith('UPDATE dbo.order_code_counter')) return rs(d.lastCode < p.lastCode ? [{ order_code: ++d.lastCode }] : []);
  if (q.includes('FROM dbo.products p WITH (UPDLOCK, HOLDLOCK)') && q.includes('unit_price')) {
    const x = d.products.find(y => y.id === p.pid);
    return rs(x ? [{ name_vi: x.name_vi, is_active: true, slug: 'tui', category_slug: 'tui-xach', size_configured: 0, color_configured: 0, unit_price: x.price }] : []);
  }
  if (q.includes('FROM dbo.product_variants v WITH (UPDLOCK, HOLDLOCK)')) {
    const v = d.variants.find(y => y.id === p.vid && y.product_id === p.pid);
    return rs(v ? [{ stock: v.stock, is_active: true, is_base: true, size: null, color: null, color_label: null, color_active: null }] : []);
  }
  if (q.startsWith("SELECT COUNT(*) AS c FROM dbo.orders WHERE user_id = @uid AND status <> 'cancelled'")) {
    return rs([{ c: d.orders.filter(o => o.user_id === p.uid && o.status !== 'cancelled').length }]);
  }
  if (q.startsWith('UPDATE dbo.products SET stock = stock - @qty')) {
    const x = d.products.find(y => y.id === p.pid); if (x.stock < p.qty) return rs([], 0); x.stock -= p.qty; return rs([], 1);
  }
  if (q.startsWith('UPDATE dbo.product_variants SET stock = stock - @qty')) {
    const v = d.variants.find(y => y.id === p.vid); if (v.stock < p.qty) return rs([], 0);
    const was = v.stock; v.stock -= p.qty; return rs([{ stock_before: was, stock_after: v.stock }], 1);
  }
  if (q.startsWith('INSERT INTO dbo.orders')) {
    const o = { id: 100 + d.orders.length, user_id: p.uid, status: 'pending', total_amount: p.total, order_code: p.ocode,
      VoucherCode: p.vcode, DiscountAmount: p.discount, PaymentMethod: p.pmethod, created_at: '2026-11-16T00:00:00.000Z',
      shipping_version: 2, shipping_status: 'pending_pickup', cancel_reason: null, cancelled_at: null };
    d.orders.push(o);
    return rs([{ id: o.id, status: o.status, total_amount: o.total_amount, created_at: o.created_at, VoucherCode: o.VoucherCode,
      DiscountAmount: o.DiscountAmount, PaymentMethod: o.PaymentMethod }]);
  }
  if (q.startsWith('INSERT INTO dbo.order_items')) { d.items.push({ order_id: p.oid, product_id: p.pid, variant_id: p.vid, quantity: p.qty }); return rs([], 1); }
  if (q.startsWith('INSERT INTO dbo.inventory_movements')) { d.movements.push({ type: p.type, oid: p.oid, delta: p.delta }); return rs([], 1); }
  if (q.startsWith('INSERT INTO dbo.payment_transactions')) {
    const o = d.orders.find(y => y.id === p.oid);
    const pay = { id: d.payments.length + 1, order_id: o.id, transaction_code: `PAY-${o.order_code}-001`, payment_method: o.PaymentMethod,
      amount: o.total_amount, status: 'pending', created_at: '2026-11-16T00:00:00.000Z', paid_at: null };
    d.payments.push(pay); return rs([pay]);
  }
  if (q.startsWith('DELETE FROM dbo.cart_items WHERE user_id = @uid')) { d.cart = d.cart.filter(c => c.user_id !== p.uid); return rs([], 1); }
  // ---- cancelOrder (khách tự huỷ) ----
  const o = d.orders.find(y => y.id === p.id);
  if (q.startsWith('SELECT id, user_id, status FROM dbo.orders')) {
    return rs(o && (p.uid === undefined || o.user_id === p.uid) ? [{ id: o.id, user_id: o.user_id, status: o.status }] : []);
  }
  if (q.startsWith('SELECT status, shipping_version, shipping_status FROM dbo.orders')) {
    return rs(o ? [{ status: o.status, shipping_version: 2, shipping_status: o.shipping_status }] : []);
  }
  if (q.startsWith('SELECT product_id, variant_id, quantity FROM dbo.order_items')) {
    return rs(d.items.filter(i => i.order_id === p.id).map(({ product_id, variant_id, quantity }) => ({ product_id, variant_id, quantity })));
  }
  if (q.startsWith('UPDATE dbo.products SET stock = stock + @qty')) { d.products.find(y => y.id === p.pid).stock += p.qty; return rs([], 1); }
  if (q.startsWith('UPDATE dbo.product_variants SET stock = stock + @qty')) {
    const v = d.variants.find(y => y.id === p.vid), was = v.stock; v.stock += p.qty; return rs([{ stock_before: was, stock_after: v.stock }], 1);
  }
  if (q.startsWith("UPDATE dbo.orders SET status = 'cancelled'")) {
    if (!o || o.status !== p.current) return rs([]);
    Object.assign(o, { status: 'cancelled', cancel_reason: p.reason, cancelled_at: 'db-time' });
    return rs([{ id: o.id, status: o.status, total_amount: o.total_amount, created_at: o.created_at, cancel_reason: o.cancel_reason,
      cancelled_at: o.cancelled_at, order_code: o.order_code }]);
  }
  if (q.startsWith("UPDATE dbo.payment_transactions SET status = 'cancelled'")) {
    for (const x of d.payments) if (x.order_id === p.oid && x.status === 'pending') x.status = 'cancelled'; return rs([], 1);
  }
  // Job thống kê theo ngày: lưu trong dữ liệu của transaction (rollback thì mất theo), trả id giả.
  if (q.includes('INSERT INTO dbo.jobs')) { (d.jobs || (d.jobs = [])).push({ type: p.type, payload: JSON.parse(p.payload), dedupe: p.dedupe }); return rs([{ id: d.jobs.length }]); }
  throw new Error('Unexpected SQL: ' + q);
}
require.cache[require.resolve('../db')] = { exports: {
  sql: { ...realSql, Transaction, Request }, getPool: async () => ({ request: () => new Request(null) }),
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
const CUSTOMER = { id: 3, email: 'khach@example.test', role: 'customer', is_blacklisted: false, phone: MOMO_PHONE };
function reset() {
  db = { audit: [], movements: [], items: [], payments: [], orders: [], lastCode: 1000,
    products: [{ id: 5, name_vi: 'Túi', price: 100000, stock: 10 }], variants: [{ id: 50, product_id: 5, stock: 10 }],
    cart: [{ user_id: 3, product_id: 5, variant_id: 50, quantity: 2 }],
    cards: [{ user_id: 3, brand: 'visa', ...CARD }] };
}
beforeEach(() => { reset(); actor = CUSTOMER; events = []; failAudit = false; });
async function call(method, p, body) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
}
const checkout = (extra = {}) => call('POST', '/api/orders', { ...shipping, ...PERSONAL, paymentMethod: 'cod', ...extra });
const cancel = (id, body) => call('POST', `/api/orders/${id}/cancel`, body);
const stock = () => [db.products[0].stock, db.variants[0].stock];
const quiet = t => t.mock.method(console, 'error', () => {});
const oneRow = action => {
  assert.equal(db.audit.length, 1, 'đúng 1 dòng log');
  const r = db.audit[0];
  assert.deepEqual([r.actor_role, r.actor_email, r.actor_user_id, r.action, r.entity_type], ['customer', null, 3, action, 'order']);
  return r;
};
// JSON + mã HTTP thật của routes/orders.js bản 7d547cb (chưa có log khách) trên SQL giả này, lấy MỘT LẦN 2026-11-16.
const OLD_CHECKOUT = method => ({ status: 201, body: { status: 'ok', voucherDropped: false, order: { id: 100, status: 'pending',
  total_amount: 220000, subtotal: 200000, shipping_name: 'Nguyễn Riêng Tư', shipping_phone: '0987654321', shipping_address: '99 Đường Bí Mật',
  shipping_ward: 'Phường Kín', shipping_district: 'Quận Ẩn', shipping_city: 'Thành Phố Lạ', delivery_note: 'Ghi chú <img src=x onerror=alert(1)>',
  shipping_method: 'GHN_STANDARD', shipping_fee: 20000, shipping_provider: 'GHN', shipping_service: 'Giao hàng tiêu chuẩn', shipping_eta: '2–4 ngày',
  shipping_tracking_code: 'GHN-BR-1001', shipping_status: 'pending_pickup', shipping_version: 2, order_code: 1001, voucher_code: null,
  discount_amount: 0, payment_method: method, created_at: '2026-11-16T00:00:00.000Z',
  payment_transaction: { id: 1, order_id: 100, transaction_code: 'PAY-1001-001', payment_method: method, amount: 220000, status: 'pending',
    created_at: '2026-11-16T00:00:00.000Z', paid_at: null }, item_count: 1 } } });
const OLD_CANCEL = { status: 200, body: { status: 'ok', order: { id: 100, status: 'cancelled', total_amount: 220000,
  created_at: '2026-11-16T00:00:00.000Z', cancel_reason: 'Khác: <img src=x onerror=alert(1)>', cancelled_at: 'db-time', can_cancel: false } } };
// Chạy bản hiện tại trên dữ liệu vừa reset, so với JSON viết cứng của bản cũ.
async function sameAsOld(run, expected) {
  reset(); const now = await run();
  assert.deepEqual(now, expected, 'JSON + mã HTTP y như bản cũ (7d547cb)');
  return now;
}
const leaks = r => [...Object.values(PERSONAL), CARD.last4, CARD.holder_name, MOMO_PHONE, String(CARD.exp_year)]
  .filter(v => r.after_json.includes(v) || (r.before_json || '').includes(v));

for (const method of ['cod', 'visa', 'momo']) {
  test(`ORDER_PLACE ${method}: JSON y như bản cũ, 1 dòng (customer, email NULL), after đúng 4 trường, không lộ dữ liệu cá nhân / thẻ / ví`, async () => {
    const r = await sameAsOld(() => checkout({ paymentMethod: method }), OLD_CHECKOUT(method));
    assert.equal(r.status, 201);
    const log = oneRow('ORDER_PLACE');
    assert.equal(log.entity_id, String(r.body.order.id)); assert.equal(log.before_json, null);
    assert.deepEqual(log.after, { order: { order_code: 1001, total_amount: r.body.order.total_amount, payment_method: method, items_count: 1 } });
    assert.deepEqual(leaks(log), [], 'không giá trị cá nhân nào trong JSON log');
    assert.doesNotMatch(log.after_json, /address|phone|name|note|card|holder|exp_/i);
  });
}
test('ORDER_PLACE có voucher: thêm voucher_code + discount_amount; items_count = số DÒNG item', async () => {
  db.products.push({ id: 6, name_vi: 'Áo', price: 50000, stock: 9 }); db.variants.push({ id: 60, product_id: 6, stock: 9 });
  db.cart.push({ user_id: 3, product_id: 6, variant_id: 60, quantity: 3 });
  const r = await checkout({ voucherCode: 'GIAMGIALANDAU' });
  assert.equal(r.status, 201); assert.equal(r.body.order.item_count, 2);
  const { order } = oneRow('ORDER_PLACE').after;
  assert.deepEqual(order, { order_code: 1001, total_amount: r.body.order.total_amount, payment_method: 'cod', items_count: 2,
    voucher_code: 'GIAMGIALANDAU', discount_amount: r.body.order.discount_amount });
  assert.ok(order.discount_amount > 0);
});
test('ORDER_PLACE lỗi -> 0 dòng: giỏ trống / hết hàng / thiếu thẻ / paymentMethod sai / thiếu địa chỉ / staff', async () => {
  const cases = [
    [() => { db.cart = []; }, () => checkout(), 400],
    [() => { db.variants[0].stock = 1; }, () => checkout(), 409],
    [() => { db.cards = []; }, () => checkout({ paymentMethod: 'visa' }), 400],
    [() => {}, () => checkout({ paymentMethod: 'bitcoin' }), 400],
    [() => {}, () => checkout({ shipping_address: '' }), 400],
    [() => { actor = { id: 2, email: 's@x', role: 'staff' }; }, () => checkout(), 403],
  ];
  for (const [setup, run, status] of cases) {
    reset(); actor = CUSTOMER; setup();
    assert.equal((await run()).status, status); assert.equal(db.audit.length, 0); assert.equal(db.orders.length, 0);
  }
});
test('ORDER_PLACE audit() lỗi -> rollback: không đơn, tồn KHÔNG trừ, giỏ còn, mã đơn không bị đốt; 500 như cũ', async (t) => {
  quiet(t); failAudit = true; const original = clone(db);
  assert.deepEqual(await checkout(), { status: 500, body: { status: 'error', message: 'Không tạo được đơn hàng' } });
  assert.deepEqual(db, original); assert.equal(db.lastCode, 1000); assert.deepEqual(stock(), [10, 10]);
});

async function placed() { const r = await checkout(); db.audit = []; return r.body.order; }
test('ORDER_CANCEL_BY_CUSTOMER: JSON y như bản cũ, 1 dòng có cancel_reason (XSS nguyên văn) + restored, kho cộng lại', async () => {
  const r = await sameAsOld(async () => { const o = await placed(); return cancel(o.id, { reason: 'other', details: XSS }); }, OLD_CANCEL);
  assert.equal(r.status, 200);
  const log = oneRow('ORDER_CANCEL_BY_CUSTOMER');
  assert.deepEqual([log.before, log.after], [{ order: { order_code: 1001, status: 'pending' } },
    { order: { order_code: 1001, status: 'cancelled', cancel_reason: 'Khác: ' + XSS }, restored: [{ product_id: 5, variant_id: 50, quantity: 2 }] }]);
  assert.deepEqual(stock(), [10, 10]);
});
test('ORDER_CANCEL_BY_CUSTOMER: đơn người khác 404 / đơn không huỷ được 409 / lý do sai 400 -> 0 dòng', async () => {
  const o = await placed();
  actor = { ...CUSTOMER, id: 4 }; assert.equal((await cancel(o.id, { reason: 'wrong_item' })).status, 404);
  actor = CUSTOMER; assert.equal((await cancel(o.id, { reason: 'nope' })).status, 400);
  db.orders[0].status = 'completed'; assert.equal((await cancel(o.id, { reason: 'wrong_item' })).status, 409);
  assert.equal(db.audit.length, 0);
});
test('ORDER_CANCEL_BY_CUSTOMER audit() lỗi -> rollback: đơn vẫn pending, kho KHÔNG cộng, 500 như cũ', async (t) => {
  const o = await placed(); quiet(t); failAudit = true; const original = clone(db);
  assert.deepEqual(await cancel(o.id, { reason: 'wrong_item' }), { status: 500, body: { status: 'error', message: 'Không thể hủy đơn hàng' } });
  assert.deepEqual(db, original); assert.equal(db.orders[0].status, 'pending'); assert.deepEqual(stock(), [8, 8]);
});
test('admin huỷ đơn (route quản trị) vẫn ghi ORDER_STATUS_CHANGE, KHÔNG ghi ORDER_CANCEL_BY_CUSTOMER', async () => {
  const o = await placed();
  actor = { id: 1, email: 'admin@example.test', role: 'admin' };
  assert.equal((await call('PUT', `/api/admin/orders/${o.id}/status`, { status: 'cancelled' })).status, 200);
  assert.deepEqual(db.audit.map(a => [a.action, a.actor_role]), [['ORDER_STATUS_CHANGE', 'admin']]);
});

// ---------------- Thống kê tính sẵn: job stats.recompute_day khi đặt đơn ----------------
test('thống kê: đặt đơn đưa đúng 1 job tính lại ngày tạo đơn (giờ VN) cùng transaction', async () => {
  assert.equal((await checkout()).status, 201);
  assert.deepEqual(db.jobs, [{ type: 'stats.recompute_day', payload: { day: '2026-11-16' }, dedupe: 'stats:2026-11-16' }]);
});
test('thống kê: đặt đơn lỗi audit -> rollback, không còn job', async (t) => {
  quiet(t); failAudit = true;
  assert.equal((await checkout()).status, 500);
  assert.equal(db.jobs, undefined);
});
