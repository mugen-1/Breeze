'use strict';
// Ma trận quyền — NGUỒN SỰ THẬT DUY NHẤT. Backend kiểm bằng middleware/requirePermission.js;
// GET /api/me trả permsFor(role) để frontend chỉ ẩn/hiện (không phải lớp bảo vệ).
// Đổi quyền của staff (Phase C) = sửa bảng MATRIX bên dưới, không sửa route.
const { ROLES } = require('./roles');

const PERMISSIONS = Object.freeze([
  'dashboard:read',
  'product:read', 'product:write', 'product:delete',
  'order:read', 'order:update_status', 'order:delete',
  'user:read',
  'user:view_admin_detail',   // xem chi tiết tài khoản có role admin (GET /users/:id/detail)
  'user:blacklist',           // THÊM vào danh sách đen
  'user:blacklist_release',   // GỠ khỏi danh sách đen
  'user:manage_role',
  'review:moderate',
  'support:reply',
]);

const MATRIX = Object.freeze({
  admin: PERMISSIONS,
  // Phase C: liệt kê RÕ quyền được phép (quyền mới thêm sau này mặc định staff KHÔNG có).
  // Staff KHÔNG có: product:delete, order:delete, user:view_admin_detail,
  // user:blacklist_release, user:manage_role.
  staff: Object.freeze([
    'dashboard:read',
    'product:read', 'product:write',
    'order:read', 'order:update_status',
    'user:read', 'user:blacklist',
    'review:moderate',
    'support:reply',
  ]),
  customer: [],
});

// Map<role, Set<perm>>. Role không có trong bảng -> không quyền nào.
function build(map) {
  const out = new Map();
  for (const [role, perms] of Object.entries(map)) {
    if (!ROLES.includes(role)) throw new Error('[permissions] role không hợp lệ: ' + role);
    for (const p of perms) {
      if (!PERMISSIONS.includes(p)) throw new Error('[permissions] permission không hợp lệ: ' + p);
    }
    out.set(role, new Set(perms));
  }
  return out;
}

let current = build(MATRIX);

// Trả BẢN SAO — người gọi sửa Set trả về không làm đổi ma trận.
function permsFor(role) {
  return new Set(current.get(role) || []);
}

function can(role, perm) {
  const set = current.get(role);
  return !!set && set.has(perm);
}

// Chỉ dùng trong test: thay ma trận ({ role: [perm, ...] }); gọi không tham số để
// trả về ma trận mặc định. Bị chặn khi NODE_ENV=production.
function setPermissionsForTest(map) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[permissions] setPermissionsForTest không dùng được khi NODE_ENV=production');
  }
  current = build(map == null ? MATRIX : map);
}

module.exports = { PERMISSIONS, permsFor, can, setPermissionsForTest };
