'use strict';

// phần thuần: lib/order-audit.js, chạy qua buildAuditRow THẬT để kiểm order_code còn ở cả 2 phía
// (gói trong khóa con `order`), không có số thẻ / token. Route + SQL giả: order-audit-routes.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../db')] = { exports: { sql: require('mssql') } };
const { buildAuditRow, DIFF_KEEP_KEY } = require('../lib/audit');
const { statusChange, shippingChange, deleteSnapshot, ORDER_FIELDS, ITEM_FIELDS, PAYMENT_FIELDS } = require('../lib/order-audit');

const req = { user: { id: 1, email: 'admin@example.test', role: 'admin' }, ip: '127.0.0.1', socket: {}, headers: {} };
const logged = (action, x) => {
  const r = buildAuditRow(req, { action, entityType: 'order', entityId: 7, ...x });
  return [r.before_json && JSON.parse(r.before_json), r.after_json && JSON.parse(r.after_json), r];
};

test('DIFF_KEEP_KEY không bị mở rộng (vẫn chỉ "action")', () => assert.equal(DIFF_KEEP_KEY, 'action'));

test('statusChange: order_code còn ở CẢ 2 phía nhờ khóa con order; shipping_status đổi kèm được giữ', () => {
  const [b, a] = logged('ORDER_STATUS_CHANGE', statusChange({ orderCode: 1007,
    before: { status: 'confirmed', shipping_status: 'pending_pickup' }, after: { status: 'processing', shipping_status: 'pending_pickup' } }));
  assert.deepEqual([b, a], [{ order: { order_code: 1007, status: 'confirmed', shipping_status: 'pending_pickup' } },
    { order: { order_code: 1007, status: 'processing', shipping_status: 'pending_pickup' } }]);
});

test('statusChange sang cancelled: after có cancel_reason (kể cả null) + restored chỉ product_id/variant_id/quantity', () => {
  const [b, a] = logged('ORDER_STATUS_CHANGE', statusChange({ orderCode: 1007, before: { status: 'pending' },
    after: { status: 'cancelled', cancel_reason: null }, restored: [{ product_id: 5, variant_id: 50, quantity: 2, extra: 'x' }] }));
  assert.deepEqual(b, { order: { order_code: 1007, status: 'pending' } });
  assert.deepEqual(a, { order: { order_code: 1007, status: 'cancelled', cancel_reason: null },
    restored: [{ product_id: 5, variant_id: 50, quantity: 2 }] });
});

test('statusChange: đơn cũ chưa có mã -> order_code null; shippingChange gộp status + shipping_status trong 1 dòng', () => {
  const [b] = logged('ORDER_STATUS_CHANGE', statusChange({ orderCode: null, before: { status: 'paid' }, after: { status: 'processing' } }));
  assert.equal(b.order.order_code, null);
  const [sb, sa] = logged('ORDER_SHIPPING_CHANGE', shippingChange({ orderCode: 1007,
    before: { status: 'shipping', shipping_status: 'out_for_delivery' }, after: { status: 'completed', shipping_status: 'delivered' } }));
  assert.deepEqual([sb, sa], [{ order: { order_code: 1007, status: 'shipping', shipping_status: 'out_for_delivery' } },
    { order: { order_code: 1007, status: 'completed', shipping_status: 'delivered' } }]);
});

test('deleteSnapshot: đủ order/items/payments/restored, chỉ cột cho phép; admin giữ địa chỉ/sđt; không thẻ/token; after null', () => {
  const at = new Date('2026-11-16T01:02:03Z');
  const order = Object.fromEntries(ORDER_FIELDS.map(f => [f, f + '-v']));
  Object.assign(order, { id: 7, created_at: at, shipping_phone: '0901234567', shipping_address: '12 Test', firebase_uid: 'FB' });
  const [b, a, r] = logged('ORDER_DELETE', { after: null, before: deleteSnapshot({ order,
    items: [{ id: 1, order_id: 7, product_id: 5, variant_id: 50, product_name: '<img src=x onerror=alert(1)>', size_snapshot: 'M',
      color_snapshot: null, quantity: 2, unit_price: 50000, line_total: 100000 }],
    payments: [{ id: 3, order_id: 7, transaction_code: 'PAY-1007-001', payment_method: 'visa', amount: 105000, status: 'paid',
      paid_at: at, created_at: at, card_number: '4111111111111111', token: 'tok' }],
    restored: [{ product_id: 5, variant_id: 50, quantity: 2 }] }) });
  assert.equal(a, null); assert.equal(r.after_json, null);
  assert.deepEqual(Object.keys(b), ['order', 'items', 'payments', 'restored']);
  assert.deepEqual(Object.keys(b.order), [...ORDER_FIELDS]);
  assert.deepEqual([b.order.shipping_phone, b.order.shipping_address, b.order.created_at], ['0901234567', '12 Test', at.toISOString()]);
  assert.deepEqual(b.items, [{ product_id: 5, variant_id: 50, product_name: '<img src=x onerror=alert(1)>', size_snapshot: 'M',
    color_snapshot: null, quantity: 2, unit_price: 50000 }]);
  assert.deepEqual(Object.keys(b.items[0]), [...ITEM_FIELDS]);
  assert.deepEqual(b.payments, [{ transaction_code: 'PAY-1007-001', payment_method: 'visa', amount: 105000, status: 'paid', paid_at: at.toISOString() }]);
  assert.deepEqual(Object.keys(b.payments[0]), [...PAYMENT_FIELDS]);
  assert.doesNotMatch(r.before_json, /4111|"token"|firebase_uid|"FB"|line_total|"id":7/);
  assert.deepEqual(b.restored, [{ product_id: 5, variant_id: 50, quantity: 2 }]);
  assert.deepEqual(deleteSnapshot({ order, items: [], payments: [], restored: [] }).restored, []);
});
