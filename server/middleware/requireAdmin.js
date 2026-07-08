// Middleware phân quyền admin — dùng SAU verifyFirebaseToken.
//   verifyFirebaseToken đã gắn req.user (row DB, gồm cột role) => chỉ cần kiểm role.
//   Không phải 'admin' => 403 Forbidden (khác 401: 401 = chưa xác thực, 403 = đã
//   xác thực nhưng không đủ quyền).
function requireAdmin(req, res, next) {
  if (!req.user) {
    // Sai thứ tự middleware (quên verifyFirebaseToken trước đó) — báo lỗi server rõ ràng.
    console.error('[requireAdmin] req.user rỗng — thiếu verifyFirebaseToken phía trước?');
    return res.status(401).json({ status: 'error', message: 'Chưa xác thực' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Chỉ admin mới được phép thao tác này' });
  }
  next();
}

module.exports = { requireAdmin };
