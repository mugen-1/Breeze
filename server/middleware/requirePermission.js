'use strict';
// Phân quyền phía quản trị — dùng SAU verifyFirebaseToken (req.user là row DB, role đọc từ SQL).
//   requireBackOffice      : cổng chung của /api/admin — chỉ admin/staff (lib/roles.js).
//   requirePermission(perm): gắn lên TỪNG route; quyền tra ở lib/permissions.js.
// 401 = chưa xác thực, 403 = đã xác thực nhưng không đủ quyền.
const { isBackOffice } = require('../lib/roles');
const { PERMISSIONS, can } = require('../lib/permissions');

function missingUser(res, name) {
  // Sai thứ tự middleware (quên verifyFirebaseToken phía trước) — báo lỗi server rõ ràng.
  console.error(`[${name}] req.user rỗng — thiếu verifyFirebaseToken phía trước?`);
  return res.status(401).json({ status: 'error', message: 'Chưa xác thực' });
}

function requireBackOffice(req, res, next) {
  if (!req.user) return missingUser(res, 'requireBackOffice');
  if (!isBackOffice(req.user.role)) {
    return res.status(403).json({ status: 'error', message: 'Chỉ tài khoản quản trị mới được phép thao tác này' });
  }
  next();
}

function requirePermission(perm) {
  // Gõ sai tên quyền -> lỗi ngay lúc nạp route, không phải 403 âm thầm lúc chạy.
  if (!PERMISSIONS.includes(perm)) throw new Error('[requirePermission] permission không tồn tại: ' + perm);
  function permissionGuard(req, res, next) {
    if (!req.user) return missingUser(res, 'requirePermission');
    if (!can(req.user.role, perm)) {
      // securityLogger (res.on('finish')) ghi đúng 1 dòng SecurityEvents với loại này thay cho FORBIDDEN.
      res.locals.securityEventType = 'PERMISSION_DENIED';
      return res.status(403).json({
        status: 'error', code: 'FORBIDDEN', message: 'Tài khoản không có quyền thực hiện thao tác này',
      });
    }
    next();
  }
  // Để test liệt kê route của router admin biết route nào đã gắn quyền gì.
  permissionGuard.permission = perm;
  return permissionGuard;
}

module.exports = { requireBackOffice, requirePermission };
