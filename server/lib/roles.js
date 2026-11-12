'use strict';
// Tập role hợp lệ của dbo.users.role — khớp CK_users_role (migration 023_staff_role.sql).
//   customer : khách mua hàng (mặc định khi đăng nhập lần đầu)
//   staff    : nhân viên — tài khoản riêng do admin tạo (db/create-staff.js), vào trang quản trị
//   admin    : quản trị toàn quyền
// Quyền chi tiết của từng role khai ở lib/permissions.js, KHÔNG suy ra từ tên role ở nơi khác.
const ROLES = Object.freeze(['customer', 'staff', 'admin']);

// "Phía quản trị": được vào admin.html + /api/admin/* và bị chặn ở các luồng của khách
// (đặt hàng, giỏ, chat phía khách). So khớp chính xác, role lạ -> false (đóng mặc định).
function isBackOffice(role) {
  return role === 'admin' || role === 'staff';
}

module.exports = { ROLES, isBackOffice };
