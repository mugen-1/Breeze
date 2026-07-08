/* =====================================================================
   make-admin.sql — Cấp quyền admin cho MỘT user (Phase 5)
   ---------------------------------------------------------------------
   ⚠️  FILE MẪU — KHÔNG chạy tự động. Bạn tự chọn user và tự chạy trong SSMS
       (hoặc: node db/run-sql.js db/make-admin.sql sau khi sửa email bên dưới).

   BỐI CẢNH:
   - Cột dbo.users.role mặc định 'customer' (tạo từ Phase 1/3). 'admin' = toàn quyền
     quản trị (/api/admin/*). requireAdmin đọc role NÀY từ DB, không phải custom claim.
   - Backend chỉ tạo dòng users khi user ĐÃ ĐĂNG NHẬP ít nhất 1 lần (upsert trong
     verifyFirebaseToken). => Hãy đăng nhập bằng tài khoản định làm admin TRƯỚC,
     rồi mới chạy UPDATE bên dưới, nếu không sẽ không tìm thấy dòng để cập nhật.
   ===================================================================== */

/* --- 1) Xem các user hiện có để lấy đúng email/uid --- */
SELECT id, firebase_uid, email, display_name, role, last_login
FROM dbo.users
ORDER BY last_login DESC;

/* --- 2) Cấp quyền admin theo EMAIL (đổi email cho đúng, rồi bỏ comment để chạy) --- */
-- UPDATE dbo.users SET role = 'admin' WHERE email = 'ban-chon-email@example.com';

/* --- (hoặc) cấp theo firebase_uid nếu có nhiều user trùng email NULL --- */
-- UPDATE dbo.users SET role = 'admin' WHERE firebase_uid = 'DAN_UID_TU_FIREBASE';

/* --- 3) Kiểm tra lại: liệt kê mọi admin --- */
SELECT id, firebase_uid, email, display_name, role
FROM dbo.users
WHERE role = 'admin';

/* --- (Thu hồi quyền admin, nếu cần) --- */
-- UPDATE dbo.users SET role = 'customer' WHERE email = 'ban-chon-email@example.com';
