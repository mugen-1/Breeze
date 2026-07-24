// Source of truth DUY NHẤT cho voucher. Frontend KHÔNG BAO GIỜ chứa dữ liệu này
// (không biết % giảm là bao nhiêu cho tới khi server trả về). Tiền VND = số nguyên đồng,
// làm tròn bằng Math.round. Chỉ áp dụng 1 voucher tại một thời điểm.
const { getPool, sql } = require('../db');

const VOUCHERS = {
  GIAMGIA5:      { code: 'GIAMGIA5',      type: 'percent', value: 5,  label: 'Giảm 5% tổng đơn',      minSubtotal: 0, firstOrderOnly: false },
  GIAMGIA10:     { code: 'GIAMGIA10',     type: 'percent', value: 10, label: 'Giảm 10% tổng đơn',     minSubtotal: 0, firstOrderOnly: false },
  GIAMGIALANDAU: { code: 'GIAMGIALANDAU', type: 'percent', value: 15, label: 'Ưu đãi khách hàng mới', minSubtotal: 0, firstOrderOnly: true },
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

module.exports = { VOUCHERS, normalizeCode, getVoucher, calcDiscount, isFirstTimeCustomer };
