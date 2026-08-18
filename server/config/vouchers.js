// Source of truth DUY NHẤT cho voucher. Frontend KHÔNG BAO GIỜ chứa dữ liệu này
// (không biết % giảm là bao nhiêu cho tới khi server trả về). Tiền VND = số nguyên đồng,
// làm tròn bằng Math.round. Chỉ áp dụng 1 voucher tại một thời điểm.
const { getPool, sql } = require('../db');

// Setting mỗi mã:
//   minSubtotal    — tổng tiền hàng tối thiểu (đồng), 0 = không yêu cầu
//   firstOrderOnly — CHỈ khách chưa từng đặt đơn nào
//   returningOnly  — CHỈ khách đã từng đặt ít nhất 1 đơn (ngược với firstOrderOnly)
//   minItems/maxItems — khoảng SỐ LƯỢNG sản phẩm trong giỏ (TỔNG quantity, không phải
//                       số dòng: 2 áo + 3 quần = 5). null = không giới hạn đầu đó.
// Mỗi khoảng số lượng chỉ có ĐÚNG 1 mã hợp lệ (1–5 → GIAMGIA5, ≥6 → GIAMGIA10), và
// vẫn chỉ áp 1 voucher/đơn — KHÔNG cộng dồn 2 mã.
const VOUCHERS = {
  GIAMGIA5:      { code: 'GIAMGIA5',      type: 'percent', value: 5,  label: 'Giảm 5% tổng đơn',      minSubtotal: 0, firstOrderOnly: false, returningOnly: true,  minItems: null, maxItems: 5 },
  GIAMGIA10:     { code: 'GIAMGIA10',     type: 'percent', value: 10, label: 'Giảm 10% tổng đơn',     minSubtotal: 0, firstOrderOnly: false, returningOnly: true,  minItems: 6,    maxItems: null },
  GIAMGIALANDAU: { code: 'GIAMGIALANDAU', type: 'percent', value: 15, label: 'Ưu đãi khách hàng mới', minSubtotal: 0, firstOrderOnly: true,  returningOnly: false, minItems: null, maxItems: null },
};

// Chuẩn hoá mã người dùng gõ: bỏ khoảng trắng thừa (kể cả ở giữa), IN HOA.
// '  giamgia5 ' -> 'GIAMGIA5'. Trả '' nếu đầu vào rỗng/không phải chuỗi.
function normalizeCode(raw) {
  if (raw == null) return '';
  return String(raw).replace(/\s+/g, '').toUpperCase();
}

// Trả object voucher (đã chuẩn hoá mã) hoặc null nếu không tồn tại.
function getVoucher(raw) {
  const code = normalizeCode(raw);
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(VOUCHERS, code) ? VOUCHERS[code] : null;
}

// Tính số tiền giảm. percent: Math.round(subtotal * value / 100), clamp không vượt quá
// subtotal và không âm. subtotal phải là số nguyên đồng (server tự tính từ giá DB).
function calcDiscount(voucher, subtotal) {
  if (!voucher) return 0;
  const base = Math.max(0, Math.round(Number(subtotal) || 0));
  let discount = 0;
  if (voucher.type === 'percent') {
    discount = Math.round((base * voucher.value) / 100);
  }
  return Math.min(discount, base);
}

// Khách mua lần đầu = user KHÔNG có đơn nào ở trạng thái KHÁC 'cancelled'.
// Đơn đã HUỶ không tính là "đã từng mua": khách từng đặt + áp GIAMGIALANDAU rồi huỷ,
// lần đặt lại sau vẫn được coi là lần đầu. (Chốt với chủ dự án: kiểm tra thật, không stub.)
// Đây là SEAM duy nhất cho logic phân loại khách mới — đổi tiêu chí thì chỉ sửa hàm này.
// pool tuỳ chọn: truyền vào để tái dùng connection (vd trong transaction đặt đơn) hoặc
// để inject fake pool khi test; bỏ trống thì tự getPool().
async function isFirstTimeCustomer(userId, pool) {
  if (userId == null) return false;
  const p = pool || (await getPool());
  const r = await p
    .request()
    .input('uid', sql.Int, userId)
    .query("SELECT COUNT(*) AS c FROM dbo.orders WHERE user_id = @uid AND status <> 'cancelled';");
  return (r.recordset[0] && r.recordset[0].c) === 0;
}

// Voucher này có cần biết khách đã từng mua hay chưa? Dùng để routes chỉ chạy query
// isFirstTimeCustomer khi thật sự cần (mã nào không ràng buộc lịch sử thì khỏi tốn query).
function needsCustomerHistory(voucher) {
  return !!voucher && (voucher.firstOrderOnly || voucher.returningOnly);
}

// SEAM DUY NHẤT kiểm tra điều kiện voucher — dùng chung cho routes/vouchers.js (validate)
// và routes/orders.js (lúc đặt đơn) để 2 nơi KHÔNG BAO GIỜ lệch luật. Hàm thuần (không
// chạm DB): mọi dữ liệu cần thiết truyền vào qua ctx.
//   ctx.subtotal    — tổng tiền hàng (số nguyên đồng), tính từ giá DB
//   ctx.itemCount   — TỔNG quantity trong giỏ
//   ctx.isFirstTime — kết quả isFirstTimeCustomer(); chỉ bắt buộc khi needsCustomerHistory()
// Trả { ok: true } hoặc { ok: false, reason, limit } (limit = ngưỡng bị vi phạm, để ghép
// vào message tiếng Việt).
function checkEligibility(voucher, ctx) {
  if (!voucher) return { ok: false, reason: 'NOT_FOUND' };
  const subtotal = Math.max(0, Math.round(Number(ctx && ctx.subtotal) || 0));
  const itemCount = Math.max(0, Math.round(Number(ctx && ctx.itemCount) || 0));
  const isFirstTime = !!(ctx && ctx.isFirstTime);

  if (subtotal <= 0 || itemCount <= 0) return { ok: false, reason: 'EMPTY_CART' };
  if (voucher.firstOrderOnly && !isFirstTime) return { ok: false, reason: 'NOT_FIRST_ORDER' };
  if (voucher.returningOnly && isFirstTime) return { ok: false, reason: 'RETURNING_ONLY' };
  if (voucher.minItems != null && itemCount < voucher.minItems) {
    return { ok: false, reason: 'TOO_FEW_ITEMS', limit: voucher.minItems };
  }
  if (voucher.maxItems != null && itemCount > voucher.maxItems) {
    return { ok: false, reason: 'TOO_MANY_ITEMS', limit: voucher.maxItems };
  }
  if (subtotal < voucher.minSubtotal) return { ok: false, reason: 'MIN_SUBTOTAL', limit: voucher.minSubtotal };
  return { ok: true };
}

module.exports = {
  VOUCHERS,
  normalizeCode,
  getVoucher,
  calcDiscount,
  isFirstTimeCustomer,
  needsCustomerHistory,
  checkEligibility,
};
