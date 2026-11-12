-- Role thứ ba 'staff' (nhân viên): tài khoản riêng do admin tạo, vào trang quản trị.
-- Quyền chi tiết khai trong server/lib/permissions.js; ở đây chỉ chốt tập giá trị hợp lệ
-- của dbo.users.role (khớp ROLES trong server/lib/roles.js).
-- Cột role dùng collation mặc định không phân biệt hoa/thường (CI) -> so bằng
-- Latin1_General_CS_AS để 'Admin', 'STAFF' bị chặn, đúng như JS so khớp chính xác.
-- '=' / IN của SQL Server bỏ qua dấu cách CUỐI (kể cả collation CS) nên 'admin ' vẫn khớp
-- 'admin' -> thêm DATALENGTH(role) = LEN(role) (LEN không đếm dấu cách cuối; role là VARCHAR
-- nên DATALENGTH = số ký tự).
-- Idempotent: CK_users_role đã có thì không làm gì. Có role ngoài 3 giá trị -> dừng, không sửa dữ liệu.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.users', 'U') IS NULL
        THROW 51000, 'Run schema.sql before 023_staff_role.sql (dbo.users missing)', 1;
    IF EXISTS (SELECT 1 FROM dbo.users
               WHERE role COLLATE Latin1_General_CS_AS NOT IN ('customer', 'staff', 'admin')
                  OR DATALENGTH(role) <> LEN(role))
        THROW 51001, 'dbo.users has role values outside (customer, staff, admin) or with trailing spaces; fix them before 023_staff_role.sql', 1;
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_users_role' AND parent_object_id = OBJECT_ID('dbo.users'))
        ALTER TABLE dbo.users WITH CHECK
            ADD CONSTRAINT CK_users_role
            CHECK (role COLLATE Latin1_General_CS_AS IN ('customer', 'staff', 'admin')
                   AND DATALENGTH(role) = LEN(role));
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
