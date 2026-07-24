// Voucher API — validate mã giảm giá (yêu cầu đăng nhập: Firebase ID token).
//   POST /api/vouchers/validate  — body { code }. KHÔNG nhận subtotal từ client.
//
// Nguyên tắc: TIN server, KHÔNG tin client. Subtotal luôn tính lại từ giỏ (dbo.cart_items)
// + giá sản phẩm trong SQL Server, không dùng bất kỳ số tiền nào client gửi lên.
// Thất bại nghiệp vụ (mã sai, giỏ rỗng, ...) trả HTTP 200 với { valid:false } — KHÔNG phải 4xx.
// Message tiếng Việt, KHÔNG tiết lộ mã nào tồn tại.
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { buildUserActionLimiter } = require('../middleware/security');
const { getVoucher, calcDiscount, isFirstTimeCustomer } = require('../config/vouchers');

const EFFECTIVE_PRICE =
  '(CASE WHEN p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END)';

// Message tiếng Việt tương ứng từng lý do thất bại.
const FAIL_MESSAGE = {
  NOT_FOUND:       'Mã giảm giá không hợp lệ',
  EMPTY_CART:      'Giỏ hàng trống, không thể áp dụng mã',
  NOT_FIRST_ORDER: 'Mã này chỉ dành cho khách hàng mua lần đầu',
  MIN_SUBTOTAL:    'Đơn hàng chưa đạt giá trị tối thiểu để áp dụng mã',
};

function fail(reason) {
  return { valid: false, reason, message: FAIL_MESSAGE[reason] || 'Không thể áp dụng mã giảm giá' };
}

// Tổng tiền hàng (số nguyên đồng) từ giỏ của user — GIÁ LẤY TỪ DB, không tin client.
async function cartSubtotal(pool, userId) {
  const r = await pool
    .request()
    .input('uid', sql.Int, userId)
    .query(`
      SELECT SUM(${EFFECTIVE_PRICE} * ci.quantity) AS subtotal
      FROM dbo.cart_items ci
      JOIN dbo.products p ON p.id = ci.product_id
      WHERE ci.user_id = @uid;`);
  const raw = r.recordset[0] && r.recordset[0].subtotal;
  return raw == null ? 0 : Math.round(Number(raw));
}

// Chống brute-force dò mã: tối đa 20 request / phút, key theo user (fallback IP).
// express-rate-limit dùng store in-memory sẵn có — không thêm dependency mới.
const validateLimiter = buildUserActionLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  message: 'Bạn thử mã giảm giá quá nhiều lần, vui lòng đợi một phút rồi thử lại',
});

router.use(verifyFirebaseToken);

// ---- POST /api/vouchers/validate ----
router.post('/validate', validateLimiter, async (req, res) => {
  const rawCode = req.body && req.body.code;

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('[vouchers] pool error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi kết nối cơ sở dữ liệu' });
  }

  try {
    const voucher = getVoucher(rawCode);

    // Subtotal luôn tính từ DB (dùng cho cả nhánh success lẫn kiểm tra minSubtotal).
    const subtotal = await cartSubtotal(pool, req.user.id);

    // 1) Mã không tồn tại -> NOT_FOUND (message chung, không lộ mã nào có thật).
    if (!voucher) {
      console.warn('[vouchers] validate FAIL NOT_FOUND uid=%s code=%j', req.user.id, rawCode);
      return res.json(fail('NOT_FOUND'));
    }

    // 2) Giỏ rỗng -> không có gì để giảm.
    if (subtotal <= 0) {
      console.warn('[vouchers] validate FAIL EMPTY_CART uid=%s code=%s', req.user.id, voucher.code);
      return res.json(fail('EMPTY_CART'));
    }

    // 3) Mã chỉ cho khách mua lần đầu.
    if (voucher.firstOrderOnly) {
      const firstTime = await isFirstTimeCustomer(req.user.id);
      if (!firstTime) {
        console.warn('[vouchers] validate FAIL NOT_FIRST_ORDER uid=%s code=%s', req.user.id, voucher.code);
        return res.json(fail('NOT_FIRST_ORDER'));
      }
    }

    // 4) Chưa đạt giá trị tối thiểu.
    if (subtotal < voucher.minSubtotal) {
      console.warn('[vouchers] validate FAIL MIN_SUBTOTAL uid=%s code=%s', req.user.id, voucher.code);
      return res.json(fail('MIN_SUBTOTAL'));
    }

    // Thành công.
    const discountAmount = calcDiscount(voucher, subtotal);
    return res.json({
      valid: true,
      code: voucher.code,
      label: voucher.label,
      discountAmount,
      subtotal,
      total: Math.max(0, subtotal - discountAmount),
    });
  } catch (err) {
    console.error('[vouchers] validate error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Không kiểm tra được mã giảm giá' });
  }
});

module.exports = router;
