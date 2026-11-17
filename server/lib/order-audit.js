'use strict';
// Dựng before/after cho audit log đơn hàng phía quản trị. Hàm thuần, không chạm DB.
// Thông tin đơn gói trong khóa con `order` (gồm order_code): object này luôn khác nhau giữa 2 phía khi có
// thay đổi thật, nên buildAuditRow (lib/audit.js) giữ NGUYÊN object -> order_code có ở cả before lẫn after
// mà không phải mở rộng DIFF_KEEP_KEY. Khóa có giá trị undefined bị audit.js bỏ.
//   statusChange({ orderCode, before: {status, shipping_status?}, after: {status, shipping_status?, cancel_reason?}, restored? })
//   shippingChange({ orderCode, before: {status, shipping_status}, after: {status, shipping_status} })
//   deleteSnapshot({ order, items, payments, restored })  -> before của ORDER_DELETE (after = null)

// Cột nghiệp vụ được giữ trong snapshot xoá đơn. Admin ghi nên giữ địa chỉ/sđt (chỉ log của khách bị lọc).
const ORDER_FIELDS = Object.freeze(['order_code', 'user_id', 'status', 'total_amount', 'currency', 'PaymentMethod',
  'VoucherCode', 'DiscountAmount', 'shipping_name', 'shipping_phone', 'shipping_address', 'shipping_ward',
  'shipping_district', 'shipping_city', 'delivery_note', 'shipping_method', 'shipping_fee', 'shipping_status',
  'shipping_tracking_code', 'cancel_reason', 'created_at']);
const ITEM_FIELDS = Object.freeze(['product_id', 'variant_id', 'product_name', 'size_snapshot', 'color_snapshot',
  'quantity', 'unit_price']);
const PAYMENT_FIELDS = Object.freeze(['transaction_code', 'payment_method', 'amount', 'status', 'paid_at']);
const RESTORED_FIELDS = Object.freeze(['product_id', 'variant_id', 'quantity']);

const pick = (row, fields) => Object.fromEntries(fields.map(f => [f, row[f] === undefined ? null : row[f]]));
const orderPart = (orderCode, s) => ({ order_code: orderCode === undefined ? null : orderCode, ...s });

function statusChange({ orderCode, before, after, restored }) {
  const out = { before: { order: orderPart(orderCode, before) }, after: { order: orderPart(orderCode, after) } };
  if (restored !== undefined) out.after.restored = (restored || []).map(r => pick(r, RESTORED_FIELDS));
  return out;
}
function shippingChange({ orderCode, before, after }) {
  return { before: { order: orderPart(orderCode, before) }, after: { order: orderPart(orderCode, after) } };
}
function deleteSnapshot({ order, items, payments, restored }) {
  return { order: pick(order, ORDER_FIELDS), items: (items || []).map(i => pick(i, ITEM_FIELDS)),
    payments: (payments || []).map(p => pick(p, PAYMENT_FIELDS)), restored: (restored || []).map(r => pick(r, RESTORED_FIELDS)) };
}

// ORDER_PLACE (khách đặt đơn): before = null; after CHỈ gồm các trường trong danh sách cho phép, dựng từ
// giá trị rời (không chép object đơn) -> không bao giờ có địa chỉ / sđt / tên người nhận / ghi chú / thẻ / số ví.
// items_count = số DÒNG item (khớp item_count trong JSON route). voucher_code / discount_amount chỉ khi có voucher.
function placeOrder({ orderCode, totalAmount, paymentMethod, itemsCount, voucherCode, discountAmount }) {
  const order = { order_code: orderCode == null ? null : orderCode, total_amount: totalAmount,
    payment_method: paymentMethod, items_count: itemsCount };
  if (voucherCode) { order.voucher_code = voucherCode; order.discount_amount = discountAmount; }
  return { before: null, after: { order } };
}
// ORDER_CANCEL_BY_CUSTOMER dùng lại statusChange: { order: { order_code, status } } -> { order: { order_code,
// status: 'cancelled', cancel_reason }, restored }.

module.exports = { ORDER_FIELDS, ITEM_FIELDS, PAYMENT_FIELDS, statusChange, shippingChange, deleteSnapshot, placeOrder };
