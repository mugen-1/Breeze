const path = require('path');
const fs = require('fs');
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { getAuth, verifyPassword } = require('../firebase');
const { buildUserActionLimiter } = require('../middleware/security');

// ⚠️ TRÙNG LẶP CÓ CHỦ Ý: quy tắc resolve đường dẫn file avatar được viết ở HAI nơi —
// tại đây và removeOldAvatar()/AVATAR_DIR trong routes/me.js. Hai bên phải luôn dùng
// CÙNG thư mục và CÙNG cách ghép tên file. Đổi chỗ lưu ảnh thì SỬA CẢ HAI.
const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');

/* Xoá file avatar của tài khoản vừa bị xoá — best-effort, chống file mồ côi.
   Cùng quy tắc với removeOldAvatar() trong routes/me.js: chỉ chấp nhận đúng dạng
   '/avatars/<tên an toàn>.webp' rồi ghép lại từ AVATAR_DIR — không bao giờ lấy thẳng
   chuỗi trong DB làm đường dẫn.
   Gọi KHÔNG await: xoá file không được làm chậm hay chặn response xoá tài khoản;
   mọi lỗi chỉ log, không đổi status trả về. */
function removeAvatarFile(avatarUrl, userId) {
  if (!avatarUrl || typeof avatarUrl !== 'string') return;   // chưa từng upload -> bỏ qua

  const m = /^\/avatars\/([A-Za-z0-9_-]+\.webp)$/.exec(avatarUrl);
  if (!m) {
    console.warn('[account] avatar_url sai định dạng, KHÔNG xoá file. user_id=' + userId);
    return;
  }

  const target = path.resolve(AVATAR_DIR, m[1]);
  // Chốt chặn cuối (defense in depth): path tuyệt đối phải nằm TRONG uploads/avatars.
  if (!target.startsWith(AVATAR_DIR + path.sep)) {
    console.warn('[account] avatar path nằm ngoài uploads/avatars, KHÔNG xoá: ' + target);
    return;
  }

  fs.promises.unlink(target).catch((err) => {
    if (err.code === 'ENOENT') return;            // file đã mất sẵn -> không phải lỗi
    console.warn('[account] không xoá được file avatar (' + target + '): ' + err.message);
  });
}

// Rate limit theo user cho các thao tác cần mật khẩu (chống brute-force). Dùng CHUNG cho cả
// verify-password lẫn DELETE nên tổng số lần thử mật khẩu bị giới hạn 10/phút/user.
const passwordLimiter = buildUserActionLimiter({
  windowMs: 60 * 1000,
  limit: 10,
  message: 'Bạn đã thử quá nhiều lần, vui lòng đợi một phút',
});

// Đọc mật khẩu từ body (bắt buộc chuỗi không rỗng) + kiểm tra tài khoản có email (dùng mật khẩu).
// Trả { password } nếu hợp lệ; nếu không hợp lệ đã res lỗi và trả null.
function readPassword(req, res) {
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || password.length === 0) {
    res.status(400).json({ status: 'error', message: 'Thiếu mật khẩu' });
    return null;
  }
  if (!req.user.email) {
    res.status(400).json({ status: 'error', message: 'Tài khoản này không dùng mật khẩu để xác thực' });
    return null;
  }
  return password;
}

// ---- POST /api/account/verify-password ---- chỉ verify, KHÔNG xóa gì ----
router.post('/verify-password', verifyFirebaseToken, passwordLimiter, async (req, res) => {
  const password = readPassword(req, res);
  if (password === null) return;
  try {
    const result = await verifyPassword(req.user.email, password);
    if (result.ok) return res.json({ ok: true });
    if (result.reason === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
      return res.status(429).json({ status: 'error', message: 'Bạn đã thử quá nhiều lần, vui lòng đợi ít phút' });
    }
    return res.json({ ok: false });
  } catch (err) {
    console.error('[account] verify-password lỗi:', err.message);
    return res.status(500).json({ status: 'error', message: 'Không kiểm tra được mật khẩu' });
  }
});

// ---- DELETE /api/account ---- xóa tài khoản ----
router.delete('/', verifyFirebaseToken, passwordLimiter, async (req, res) => {
  const password = readPassword(req, res);
  if (password === null) return;

  // (a) Verify LẠI mật khẩu — không tin kết quả verify-password ở bước trước.
  let verify;
  try {
    verify = await verifyPassword(req.user.email, password);
  } catch (err) {
    console.error('[account] delete verify lỗi:', err.message);
    return res.status(500).json({ status: 'error', message: 'Không kiểm tra được mật khẩu' });
  }
  if (!verify.ok) {
    if (verify.reason === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
      return res.status(429).json({ status: 'error', message: 'Bạn đã thử quá nhiều lần, vui lòng đợi ít phút' });
    }
    return res.status(401).json({ status: 'error', message: 'Mật khẩu không đúng' });
  }

  const uid = req.user.firebase_uid;
  const userId = req.user.id;
  // Đọc TRƯỚC khi xoá row users — xoá xong thì không còn chỗ nào đọc lại được.
  // verifyFirebaseToken đã nạp sẵn avatar_url vào req.user nên không tốn query thêm.
  const avatarUrl = req.user.avatar_url;

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('[account] delete pool lỗi:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi kết nối cơ sở dữ liệu' });
  }

  // (b,c) Chặn xóa nếu còn đơn 'pending' (chưa thanh toán).
  try {
    const pend = await pool.request()
      .input('uid', sql.Int, userId)
      .query("SELECT TOP 1 1 AS x FROM dbo.orders WHERE user_id = @uid AND status = 'pending';");
    if (pend.recordset.length > 0) {
      return res.status(409).json({
        status: 'error',
        message: 'Bạn có đơn hàng chưa thanh toán, vui lòng hoàn tất hoặc hủy đơn trước khi xóa tài khoản',
      });
    }
  } catch (err) {
    console.error('[account] delete check pending lỗi:', err.message);
    return res.status(500).json({ status: 'error', message: 'Không kiểm tra được đơn hàng' });
  }

  // (d) Xóa Firebase Auth TRƯỚC: vô hiệu token ngay lập tức -> phiên còn sống ở thiết bị khác
  // không thể tái tạo row user qua upsert của verifyFirebaseToken. Nếu lỗi -> dừng, DB chưa đụng.
  try {
    await getAuth().deleteUser(uid);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {   // đã xóa từ trước -> coi như xong, tiếp tục dọn DB
      console.error('[account] deleteUser (Firebase) lỗi:', err.message);
      return res.status(500).json({ status: 'error', message: 'Không xóa được tài khoản, vui lòng thử lại' });
    }
  }

  // (d) Dọn dữ liệu SQL trong transaction: ẩn danh orders lịch sử (SET NULL) rồi xóa các bảng
  // cá nhân + row users. Thứ tự: gỡ mọi tham chiếu FK tới users TRƯỚC khi xóa row users.
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    await new sql.Request(tx).input('uid', sql.Int, userId)
      .query('UPDATE dbo.orders SET user_id = NULL WHERE user_id = @uid;');
    await new sql.Request(tx).input('uid', sql.Int, userId)
      .query('DELETE FROM dbo.cart_items WHERE user_id = @uid;');
    await new sql.Request(tx).input('uid', sql.Int, userId)
      .query('DELETE FROM dbo.delivery_addresses WHERE user_id = @uid;');
    await new sql.Request(tx).input('uid', sql.Int, userId)
      .query('DELETE FROM dbo.payment_methods WHERE user_id = @uid;');
    await new sql.Request(tx).input('uid', sql.Int, userId)
      .query('DELETE FROM dbo.user_privacy_settings WHERE user_id = @uid;');
    await new sql.Request(tx).input('uid', sql.Int, userId)
      .query('DELETE FROM dbo.users WHERE id = @uid;');
    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch (e) { /* đã rollback hoặc chưa begin */ }
    // Firebase user đã xóa nhưng dọn DB lỗi -> cần cleanup thủ công. Log rõ user_id.
    console.error('[account] CRITICAL: Firebase đã xóa nhưng dọn DB lỗi, user_id=' + userId + ':', err.message);
    return res.status(500).json({ status: 'error', message: 'Xóa tài khoản chưa hoàn tất, vui lòng liên hệ hỗ trợ' });
  }

  // Chỉ dọn file SAU KHI transaction đã commit thành công. Nếu commit lỗi thì đã return
  // ở trên, file vẫn còn — đúng ý: không xoá ảnh của tài khoản thực ra chưa xoá được.
  removeAvatarFile(avatarUrl, userId);

  res.json({ status: 'ok', message: 'Tài khoản đã được xóa' });
});

module.exports = router;
