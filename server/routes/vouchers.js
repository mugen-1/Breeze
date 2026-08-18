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
const {
  getVoucher, calcDiscount, isFirstTimeCustomer, needsCustomerHistory, checkEligibility,
} = require('../config/vouchers');

const EFFECTIVE_PRICE =
  '(CASE WHEN p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END)';

// Message tiếng Việt tương ứng từng lý do thất bại. Giá trị có thể là hàm (nhận ngưỡng
// bị vi phạm) để ghép số vào câu — vd "chỉ áp dụng cho đơn tối đa 5 sản phẩm".
const FAIL_MESSAGE = {
  NOT_FOUND:       'Mã giảm giá không hợp lệ',
  EMPTY_CART:      'Giỏ hàng trống, không thể áp dụng mã',
  NOT_FIRST_ORDER: 'Mã này chỉ dành cho khách hàng mua lần đầu',
  RETURNING_ONLY:  'Mã này chỉ dành cho khách đã từng đặt hàng',
  TOO_FEW_ITEMS:   (n) => `Mã này chỉ áp dụng cho đơn từ ${n} sản phẩm trở lên`,
  TOO_MANY_ITEMS:  (n) => `Mã này chỉ áp dụng cho đơn tối đa ${n} sản phẩm`,
  MIN_SUBTOTAL:    'Đơn hàng chưa đạt giá trị tối thiểu để áp dụng mã',
};

function fail(reason, limit) {
  const m = FAIL_MESSAGE[reason];
  const message = (typeof m === 'function' ? m(limit) : m) || 'Không thể áp dụng mã giảm giá';
  return { valid: false, reason, message };
}

// Tổng tiền hàng (số nguyên đồng) + TỔNG số lượng sản phẩm trong giỏ của user.
// GIÁ VÀ SỐ LƯỢNG LẤY TỪ DB, không tin client.
async function cartTotals(pool, userId) {
  const r = await pool
    .request()
    .input('uid', sql.Int, userId)
    .query(`
      SELECT SUM(${EFFECTIVE_PRICE} * ci.quantity) AS subtotal,
             SUM(ci.quantity) AS item_count
      FROM dbo.cart_items ci
      JOIN dbo.products p ON p.id = ci.product_id
      WHERE ci.user_id = @uid;`);
  const row = r.recordset[0] || {};
  return {
    subtotal: row.subtotal == null ? 0 : Math.round(Number(row.subtotal)),
    itemCount: row.item_count == null ? 0 : Math.round(Number(row.item_count)),
  };
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

    // 1) Mã không tồn tại -> NOT_FOUND (message chung, không lộ mã nào có thật).
    //    Trả sớm: khỏi tốn query giỏ hàng cho mã rác.
    if (!voucher) {
      console.warn('[vouchers] validate FAIL NOT_FOUND uid=%s code=%j', req.user.id, rawCode);
      return res.json(fail('NOT_FOUND'));
    }

    // Subtotal + số lượng luôn tính từ DB (dùng cho cả nhánh success lẫn các điều kiện).
    const { subtotal, itemCount } = await cartTotals(pool, req.user.id);

    // Chỉ query lịch sử mua khi mã thật sự ràng buộc theo nó.
    const isFirstTime = needsCustomerHistory(voucher)
      ? await isFirstTimeCustomer(req.user.id)
      : false;

    // 2) Toàn bộ điều kiện đi qua SEAM chung với lúc đặt đơn (config/vouchers.js).
    const check = checkEligibility(voucher, { subtotal, itemCount, isFirstTime });
    if (!check.ok) {
      console.warn('[vouchers] validate FAIL %s uid=%s code=%s items=%s',
        check.reason, req.user.id, voucher.code, itemCount);
      return res.json(fail(check.reason, check.limit));
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
