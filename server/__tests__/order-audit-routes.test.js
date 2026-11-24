'use strict';

// log đơn hàng phía quản trị qua HTTP: PUT /api/admin/orders/:id/status (kể cả huỷ qua cancelOrder),
// PATCH /shipping-status, DELETE /orders/:id; cộng route khách POST /api/orders/:id/cancel (JSON giữ nguyên, 0 log).
// Router + requireBackOffice/requirePermission + lib/audit.js THẬT; chỉ thay xác thực và SQL (SQL giả có transaction).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

const XSS = '<img src=x onerror=alert(1)>';
let db, actor, events, failAudit, onBegin;
const clone = x => structuredClone(x);
const rs = (recordset = [], affected = recordset.length) => ({ recordset, recordsets: [recordset], rowsAffected: [affected] });
class Transaction {
  async begin() { if (onBegin) { const fn = onBegin; onBegin = null; fn(db); } this.data = clone(db); events.push('begin'); }
  async commit() { db = this.data; events.push('commit'); }
  async rollback() { this.data = null; events.push('rollback'); }
}
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) { return handle(raw.replace(/\s+/g, ' ').trim(), this.p, this.tx ? this.tx.data : db, !!this.tx); }
}
const ord = d => d.orders.find(o => o.id === 7);
function handle(q, p, d, inTx) {
  if (!d) throw new Error('SQL sau rollback');
  const o = d.orders.find(x => x.id === p.id);
  if (q.startsWith('INSERT INTO dbo.audit_logs')) {
    assert.ok(inTx, 'audit phải chạy trong transaction');
    if (failAudit) throw new Error('audit giả lỗi');
    d.audit.push({ actor_user_id: p.actor_user_id, actor_email: p.actor_email, actor_role: p.actor_role, action: p.action,
      entity_type: p.entity_type, entity_id: p.entity_id, before_json: p.before_json, after_json: p.after_json,
      before: p.before_json && JSON.parse(p.before_json), after: p.after_json && JSON.parse(p.after_json) });
    return rs([{ id: String(d.audit.length) }]);
  }
  if (q.startsWith('SELECT status, shipping_version, shipping_status FROM dbo.orders')) { // PUT/PATCH: dòng khoá
    assert.match(q, /WITH \(UPDLOCK, HOLDLOCK\)/); assert.ok(inTx);
    return rs(o ? [{ status: o.status, shipping_version: o.shipping_version, shipping_status: o.shipping_status }] : []);
  }
  if (q.startsWith('SELECT id, user_id, status FROM dbo.orders')) { // cancelOrder: dòng khoá
    return rs(o && (p.uid === undefined || o.user_id === p.uid) ? [{ id: o.id, user_id: o.user_id, status: o.status }] : []);
  }
  if (q.startsWith('SELECT id, status FROM dbo.orders')) return rs(o ? [{ id: o.id, status: o.status }] : []); // DELETE: khoá
  if (q.startsWith('SELECT order_code, user_id')) { // DELETE: snapshot (3 SELECT, trả nguyên dòng — route phải tự lọc cột)
    return { recordsets: [o ? [clone(o)] : [], d.items.filter(i => i.order_id === p.id).map(clone),
      d.payments.filter(x => x.order_id === p.id).map(clone)] };
  }
  if (q.startsWith('SELECT product_id, variant_id, quantity FROM dbo.order_items')) {
    return rs(d.items.filter(i => i.order_id === p.id).map(({ product_id, variant_id, quantity }) => ({ product_id, variant_id, quantity })));
  }
  if (q.startsWith('UPDATE dbo.products SET stock = stock + @qty')) { d.products.find(x => x.id === p.pid).stock += p.qty; return rs([], 1); }
  if (q.startsWith('UPDATE dbo.product_variants SET stock = stock + @qty')) {
    const v = d.variants.find(x => x.id === p.vid), was = v.stock; v.stock += p.qty;
    return rs([{ stock_before: was, stock_after: v.stock }], 1);
  }
  if (q.startsWith('INSERT INTO dbo.inventory_movements')) { d.movements.push({ type: p.type, oid: p.oid, delta: p.delta }); return rs([], 1); }
  if (q.startsWith("UPDATE dbo.orders SET status = 'cancelled'")) { // cancelOrder
    if (!o || o.status !== p.current) return rs([]);
    Object.assign(o, { status: 'cancelled', cancel_reason: p.reason, cancelled_at: 'db-time',
      shipping_status: o.shipping_version === 2 ? 'cancelled' : o.shipping_status });
    return rs([{ id: o.id, status: o.status, total_amount: o.total_amount, created_at: o.created_at,
      cancel_reason: o.cancel_reason, cancelled_at: o.cancelled_at, order_code: o.order_code }]);
  }
  if (q.startsWith('UPDATE dbo.orders SET status = @status, shipping_status = @shippingStatus')) {
    if (q.includes('AND status = @current') && o.status !== p.current) return rs([]);
    Object.assign(o, { status: p.status, shipping_status: p.shippingStatus });
    return rs([q.includes('INSERTED.shipping_version')
      ? { id: o.id, order_code: o.order_code, status: o.status, shipping_version: o.shipping_version, shipping_status: o.shipping_status,
        ...(q.includes('INSERTED.created_at') ? { created_at: o.created_at } : {}) }
      : { id: o.id, status: o.status, total_amount: o.total_amount, created_at: o.created_at, user_id: o.user_id,
        order_code: o.order_code, shipping_status: o.shipping_status }]);
  }
  if (q.startsWith("UPDATE dbo.payment_transactions SET status = 'paid'")) {
    for (const x of d.payments) if (x.order_id === p.oid && x.payment_method === 'cod' && x.status === 'pending') Object.assign(x, { status: 'paid', paid_at: 'now' });
    return rs([], 1);
  }
  if (q.startsWith("UPDATE dbo.payment_transactions SET status = 'cancelled'")) {
    for (const x of d.payments) if (x.order_id === p.oid && x.status === 'pending') x.status = 'cancelled';
    return rs([], 1);
  }
  if (q.startsWith('DELETE FROM dbo.orders')) {
    if (!o) return rs([]);
    d.orders = d.orders.filter(x => x.id !== p.id); d.items = d.items.filter(i => i.order_id !== p.id);
    d.payments = d.payments.filter(x => x.order_id !== p.id); return rs([{ id: p.id }]);
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
app.use('/api/admin', require('../routes/admin'));
app.use('/api/orders', require('../routes/orders'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
const ADMIN = { id: 1, email: 'admin@example.test', role: 'admin' };
const STAFF = { id: 2, email: 'staff@example.test', role: 'staff' };
const CUSTOMER = { id: 3, email: 'khach@example.test', role: 'customer', is_blacklisted: false };
const CREATED = '2026-11-16T01:00:00.000Z';
function reset(status = 'pending', shipping = 'pending_pickup', method = 'cod') {
  db = { audit: [], movements: [],
    orders: [{ id: 7, order_code: 1007, user_id: 3, status, total_amount: 105000, currency: 'VND', PaymentMethod: method,
      VoucherCode: null, DiscountAmount: 0, shipping_name: 'Khách', shipping_phone: '0901234567', shipping_address: '12 Test',
      shipping_ward: 'P1', shipping_district: 'Q1', shipping_city: 'HCM', delivery_note: XSS, shipping_method: 'GHN_STANDARD',
      shipping_fee: 5000, shipping_status: shipping, shipping_tracking_code: 'GHN-1007', cancel_reason: null, cancelled_at: null,
      shipping_version: 2, created_at: CREATED }],
    items: [{ id: 1, order_id: 7, product_id: 5, variant_id: 50, product_name: 'Áo ' + XSS, size_snapshot: 'M', color_snapshot: null,
      quantity: 2, unit_price: 50000, line_total: 100000 }],
    payments: [{ id: 9, order_id: 7, transaction_code: 'PAY-1007-001', payment_method: method, amount: 105000, status: 'pending',
      created_at: CREATED, paid_at: null, card_number: '4111111111111111', gateway_token: 'tok_secret' }],
    products: [{ id: 5, stock: 3 }], variants: [{ id: 50, product_id: 5, stock: 3 }] };
}
beforeEach(() => { reset(); actor = ADMIN; events = []; failAudit = false; onBegin = null; });
async function call(method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
}
const putStatus = status => call('PUT', '/api/admin/orders/7/status', { status });
const patchShip = s => call('PATCH', '/api/admin/orders/7/shipping-status', { shipping_status: s });
const del = () => call('DELETE', '/api/admin/orders/7');
const quiet = t => t.mock.method(console, 'error', () => {});
const oneRow = (action, who = ADMIN) => {
  assert.equal(db.audit.length, 1, 'đúng 1 dòng log');
  const r = db.audit[0];
  assert.deepEqual([r.actor_user_id, r.actor_role, r.actor_email, r.action, r.entity_type, r.entity_id],
    [who.id, who.role, who.email, action, 'order', '7']);
  return r;
};
const stockNow = () => [db.products[0].stock, db.variants[0].stock];

// ---------------- ORDER_STATUS_CHANGE (thường) ----------------
for (const who of [ADMIN, STAFF]) {
  test(`ORDER_STATUS_CHANGE (${who.role}) pending -> confirmed: JSON như cũ, 1 dòng order{order_code,status,shipping_status}`, async () => {
    actor = who;
    const r = await putStatus('confirmed');
    assert.deepEqual(r, { status: 200, body: { status: 'ok', order: { id: 7, status: 'confirmed',
      allowed_next_statuses: ['processing', 'cancelled'], total_amount: 105000, created_at: CREATED } } });
    const log = oneRow('ORDER_STATUS_CHANGE', who);
    assert.deepEqual([log.before, log.after], [{ order: { order_code: 1007, status: 'pending', shipping_status: 'pending_pickup' } },
      { order: { order_code: 1007, status: 'confirmed', shipping_status: 'pending_pickup' } }]);
  });
}
test('ORDER_STATUS_CHANGE: 400 status sai / 404 / 409 không chuyển được / 409 đặt lại đúng trạng thái -> 0 dòng', async () => {
  assert.equal((await putStatus('flying')).status, 400);
  assert.equal((await call('PUT', '/api/admin/orders/8/status', { status: 'confirmed' })).status, 404);
  assert.equal((await putStatus('completed')).status, 409);
  assert.equal((await putStatus('pending')).status, 409, 'đặt lại đúng trạng thái hiện tại (pending -> pending)');
  reset('confirmed'); assert.equal((await putStatus('confirmed')).status, 409);
  reset('cancelled', 'cancelled'); assert.equal((await putStatus('cancelled')).status, 409, 'huỷ lại đơn đã huỷ');
  actor = CUSTOMER; assert.equal((await putStatus('confirmed')).status, 403);
  assert.equal(db.audit.length, 0);
});
test('ORDER_STATUS_CHANGE: audit() lỗi -> rollback, đơn + thanh toán không đổi, 500 như cũ', async (t) => {
  quiet(t); reset('shipping', 'out_for_delivery'); failAudit = true; const original = clone(db);
  assert.deepEqual(await putStatus('completed'), { status: 500, body: { status: 'error', message: 'Không cập nhật được trạng thái đơn' } });
  assert.deepEqual(db, original);
});
test('ORDER_STATUS_CHANGE: before lấy từ dòng KHOÁ trong tx (request khác vừa đổi pending -> confirmed ngay trước)', async () => {
  onBegin = d => { ord(d).status = 'confirmed'; };
  assert.equal((await putStatus('processing')).status, 200);
  assert.equal(db.audit[0].before.order.status, 'confirmed');
});

// ---------------- ORDER_STATUS_CHANGE (huỷ qua cancelOrder) ----------------
test('admin huỷ đơn: JSON như cũ (không lộ order_code), 1 dòng có cancel_reason + restored, kho cộng lại', async () => {
  const r = await putStatus('cancelled');
  assert.deepEqual(r, { status: 200, body: { status: 'ok', order: { id: 7, status: 'cancelled', total_amount: 105000,
    created_at: CREATED, cancel_reason: null, cancelled_at: 'db-time', allowed_next_statuses: [] } } });
  const log = oneRow('ORDER_STATUS_CHANGE');
  assert.deepEqual([log.before, log.after], [{ order: { order_code: 1007, status: 'pending' } },
    { order: { order_code: 1007, status: 'cancelled', cancel_reason: null }, restored: [{ product_id: 5, variant_id: 50, quantity: 2 }] }]);
  assert.deepEqual(stockNow(), [5, 5]);
});
test('admin huỷ đơn: audit() lỗi -> rollback, đơn / TỒN KHO / thanh toán không đổi, 500 như cũ', async (t) => {
  quiet(t); failAudit = true; const original = clone(db);
  assert.deepEqual(await putStatus('cancelled'), { status: 500, body: { status: 'error', message: 'Không cập nhật được trạng thái đơn' } });
  assert.deepEqual(db, original); assert.deepEqual(stockNow(), [3, 3]);
});
test('admin huỷ đơn: before từ dòng khoá trong cancelOrder (request khác vừa xác nhận đơn)', async () => {
  onBegin = d => { ord(d).status = 'confirmed'; };
  assert.equal((await putStatus('cancelled')).status, 200);
  assert.equal(db.audit[0].before.order.status, 'confirmed');
});
test('khách tự huỷ (POST /api/orders/:id/cancel): JSON giữ nguyên đúng các khoá cũ, KHÔNG có order_code, 1 dòng ORDER_CANCEL_BY_CUSTOMER', async () => {
  actor = CUSTOMER;
  const r = await call('POST', '/api/orders/7/cancel', { reason: 'wrong_item' });
  assert.deepEqual(r, { status: 200, body: { status: 'ok', order: { id: 7, status: 'cancelled', total_amount: 105000,
    created_at: CREATED, cancel_reason: 'Đặt nhầm sản phẩm', cancelled_at: 'db-time', can_cancel: false } } });
  assert.deepEqual(db.audit.map(a => a.action), ['ORDER_CANCEL_BY_CUSTOMER']);
  assert.deepEqual(stockNow(), [5, 5]);
});

// ---------------- ORDER_SHIPPING_CHANGE ----------------
for (const who of [ADMIN, STAFF]) {
  test(`ORDER_SHIPPING_CHANGE (${who.role}) delivered: JSON như cũ, 1 dòng gộp status shipping -> completed`, async () => {
    actor = who; reset('shipping', 'out_for_delivery');
    const r = await patchShip('delivered');
    assert.deepEqual(r, { status: 200, body: { status: 'ok', order: { id: 7, order_code: 1007, status: 'completed', shipping_version: 2,
      shipping_status: 'delivered', allowed_next_statuses: [], allowed_shipping_statuses: [] } } });
    const log = oneRow('ORDER_SHIPPING_CHANGE', who);
    assert.deepEqual([log.before, log.after], [{ order: { order_code: 1007, status: 'shipping', shipping_status: 'out_for_delivery' } },
      { order: { order_code: 1007, status: 'completed', shipping_status: 'delivered' } }]);
    assert.equal(db.payments[0].status, 'paid', 'completeCodPayment vẫn chạy, không có dòng log riêng');
  });
}
test('ORDER_SHIPPING_CHANGE: 400 / 404 / 409 (nhảy bước, lặp lại bước hiện tại) -> 0 dòng; audit lỗi -> 500 như cũ, không đổi', async (t) => {
  reset('processing', 'pending_pickup');
  assert.equal((await patchShip('teleport')).status, 400);
  assert.equal((await call('PATCH', '/api/admin/orders/8/shipping-status', { shipping_status: 'picked_up' })).status, 404);
  assert.equal((await patchShip('delivered')).status, 409);
  reset('shipping', 'picked_up'); assert.equal((await patchShip('picked_up')).status, 409);
  assert.equal(db.audit.length, 0);
  quiet(t); failAudit = true; const original = clone(db);
  assert.deepEqual(await patchShip('in_transit'), { status: 500, body: { status: 'error', message: 'Không cập nhật được vận chuyển' } });
  assert.deepEqual(db, original);
});

// ---------------- ORDER_DELETE ----------------
test('ORDER_DELETE pending (cộng kho): JSON như cũ, 1 dòng snapshot đủ order/items/payments/restored, after null, không thẻ/token', async () => {
  assert.deepEqual(await del(), { status: 200, body: { status: 'ok', deletedId: 7, restoredStock: true } });
  const log = oneRow('ORDER_DELETE');
  assert.equal(log.after_json, null);
  assert.deepEqual(log.before.order, { order_code: 1007, user_id: 3, status: 'pending', total_amount: 105000, currency: 'VND',
    PaymentMethod: 'cod', VoucherCode: null, DiscountAmount: 0, shipping_name: 'Khách', shipping_phone: '0901234567',
    shipping_address: '12 Test', shipping_ward: 'P1', shipping_district: 'Q1', shipping_city: 'HCM', delivery_note: XSS,
    shipping_method: 'GHN_STANDARD', shipping_fee: 5000, shipping_status: 'pending_pickup', shipping_tracking_code: 'GHN-1007',
    cancel_reason: null, created_at: CREATED });
  assert.deepEqual(log.before.items, [{ product_id: 5, variant_id: 50, product_name: 'Áo ' + XSS, size_snapshot: 'M',
    color_snapshot: null, quantity: 2, unit_price: 50000 }]);
  assert.deepEqual(log.before.payments, [{ transaction_code: 'PAY-1007-001', payment_method: 'cod', amount: 105000, status: 'pending', paid_at: null }]);
  assert.deepEqual(log.before.restored, [{ product_id: 5, variant_id: 50, quantity: 2 }]);
  assert.doesNotMatch(log.before_json, /4111|tok_secret|card|token/i);
  assert.ok(log.before_json.includes(XSS));
  assert.deepEqual(stockNow(), [5, 5]); assert.equal(db.orders.length, 0);
});
for (const status of ['completed', 'cancelled']) {
  test(`ORDER_DELETE ${status} (KHÔNG cộng kho): restored [], tồn không đổi, JSON như cũ`, async () => {
    reset(status, status === 'completed' ? 'delivered' : 'cancelled');
    assert.deepEqual(await del(), { status: 200, body: { status: 'ok', deletedId: 7, restoredStock: false } });
    const log = oneRow('ORDER_DELETE');
    assert.deepEqual([log.before.order.status, log.before.restored, log.before.items.length], [status, [], 1]);
    assert.deepEqual(stockNow(), [3, 3]);
  });
}
test('ORDER_DELETE: staff -> 403, khách -> 403, 404 -> 0 dòng, đơn còn', async () => {
  actor = STAFF; const r = await del();
  assert.equal(r.status, 403); assert.equal(r.body.code, 'FORBIDDEN');
  actor = CUSTOMER; assert.equal((await del()).status, 403);
  actor = ADMIN; assert.equal((await call('DELETE', '/api/admin/orders/8')).status, 404);
  assert.equal(db.audit.length, 0); assert.equal(db.orders.length, 1);
});
test('ORDER_DELETE: audit() lỗi -> rollback: đơn/items/thanh toán còn, TỒN KHO không đổi, 500 như cũ', async (t) => {
  quiet(t); failAudit = true; const original = clone(db);
  assert.deepEqual(await del(), { status: 500, body: { status: 'error', message: 'Không xoá được đơn hàng' } });
  assert.deepEqual(db, original); assert.deepEqual(stockNow(), [3, 3]);
});
test('ORDER_DELETE: snapshot từ dòng khoá trong tx (request khác vừa xác nhận đơn ngay trước)', async () => {
  onBegin = d => { ord(d).status = 'confirmed'; };
  assert.equal((await del()).status, 200);
  assert.equal(db.audit[0].before.order.status, 'confirmed');
});

// ---------------- Thống kê tính sẵn: job stats.recompute_day trong cùng transaction ----------------
// Đơn tạo lúc 17:30 UTC = 00:30 ngày hôm sau giờ VN: job phải tính lại NGÀY TẠO đơn theo giờ VN.
const statsJob = day => ({ type: 'stats.recompute_day', payload: { day }, dedupe: 'stats:' + day });
const AFTER_MIDNIGHT_VN = '2026-11-16T17:30:00.000Z';
for (const [name, setup, run] of [
  ['đổi trạng thái', () => {}, () => putStatus('confirmed')],
  ['admin huỷ đơn', () => {}, () => putStatus('cancelled')],
  ['trạng thái giao hàng', () => reset('processing', 'pending_pickup'), () => patchShip('picked_up')],
  ['xoá đơn', () => {}, () => del()],
  ['khách tự huỷ', () => { actor = CUSTOMER; }, () => call('POST', '/api/orders/7/cancel', { reason: 'wrong_item' })],
]) {
  test(`thống kê: ${name} đưa đúng 1 job tính lại ngày tạo đơn (giờ VN) cùng transaction`, async () => {
    setup(); db.orders[0].created_at = AFTER_MIDNIGHT_VN;
    assert.equal((await run()).status, 200);
    assert.deepEqual(db.jobs, [statsJob('2026-11-17')]);
  });
  test(`thống kê: ${name} lỗi audit -> rollback, không còn job`, async t => {
    quiet(t); setup(); failAudit = true;
    assert.equal((await run()).status, 500);
    assert.equal(db.jobs, undefined);
  });
}
