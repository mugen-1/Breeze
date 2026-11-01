'use strict';
// Kiểm tra tài khoản đã "đủ thông tin" cho phương thức thanh toán ở checkout chưa.
// Chỉ ĐỌC, không ghi gì. Không sửa schema: dùng dbo.payment_methods + users.phone sẵn có.
//
// QUY TẮC (client sẽ mirror y nguyên — đổi ở đây thì sửa cả bên client):
//   cod                 -> luôn đủ.
//   visa / mastercard   -> có >= 1 thẻ đã lưu đúng brand và CHƯA hết hạn. Thẻ còn hạn hết
//                          tháng ghi trên thẻ; so theo UTC, giống vExp trong routes/payments.js.
//                          amex / jcb / other không tính cho Visa/Mastercard.
//   momo                -> users.phone sau chuẩn hoá khớp ^0[35789]\d{8}$ — CHỈ số DI ĐỘNG VN
//                          (đầu 03/05/07/08/09). Số bàn 02x và đầu 01x/04x/06x không nhận.
//   phương thức lạ      -> không đủ.
//
// Chuẩn hoá số điện thoại VN (normalizeVnPhone):
//   1. Bỏ mọi khoảng trắng và các ký tự  .  -  (  )
//   2. Bắt đầu bằng "+84" -> thay bằng "0";  bắt đầu bằng "84" -> thay bằng "0".
//   Ví dụ: "+84 901.234-567" -> "0901234567";  "84901234567" -> "0901234567".
//   Số VN nội địa luôn bắt đầu bằng 0 nên đổi "84…" không bao giờ làm hỏng số hợp lệ.
const { sql } = require('../db');

const MOMO_PHONE_RE = /^0[35789]\d{8}$/;
const CARD_BRANDS = ['visa', 'mastercard'];

function normalizeVnPhone(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s.\-()]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('84')) s = '0' + s.slice(2);
  return s;
}

function isMomoPhone(raw) {
  return MOMO_PHONE_RE.test(normalizeVnPhone(raw));
}

// Có ít nhất 1 thẻ còn hạn đúng brand của user này không. `now` chỉ để test.
async function hasUsableCard(pool, userId, brand, now = new Date()) {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  if (CARD_BRANDS.indexOf(brand) < 0) return false;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const result = await pool
    .request()
    .input('uid', sql.Int, userId)
    .input('brand', sql.VarChar(20), brand)
    .input('y', sql.SmallInt, y)
    .input('m', sql.TinyInt, m)
    .query(`
      SELECT TOP 1 1 AS ok
      FROM dbo.payment_methods
      WHERE user_id = @uid AND brand = @brand
        AND (exp_year > @y OR (exp_year = @y AND exp_month >= @m));`);
  return result.recordset.length > 0;
}

// -> { ok: true | false }. `user` là req.user (middleware auth.js đã SELECT sẵn phone).
async function checkPaymentInfo(pool, user, method, now = new Date()) {
  if (method === 'cod') return { ok: true };
  if (!user) return { ok: false };
  if (method === 'momo') return { ok: isMomoPhone(user.phone) };
  if (CARD_BRANDS.indexOf(method) >= 0) return { ok: await hasUsableCard(pool, user.id, method, now) };
  return { ok: false };
}

module.exports = { normalizeVnPhone, isMomoPhone, hasUsableCard, checkPaymentInfo, MOMO_PHONE_RE, CARD_BRANDS };
