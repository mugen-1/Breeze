/* =====================================================================
   Migration 005 — thêm field hồ sơ cá nhân vào dbo.users
   Cột mới: phone, dob (ngày sinh), gender, country.
   - Idempotent: chỉ thêm cột khi CHƯA có (chạy lại nhiều lần an toàn).
   - gender ràng buộc CHECK ('male' | 'female'); NULL vẫn hợp lệ.
   ===================================================================== */
IF COL_LENGTH('dbo.users', 'phone') IS NULL
    ALTER TABLE dbo.users ADD phone VARCHAR(30) NULL;
GO
IF COL_LENGTH('dbo.users', 'dob') IS NULL
    ALTER TABLE dbo.users ADD dob DATE NULL;
GO
IF COL_LENGTH('dbo.users', 'gender') IS NULL
    ALTER TABLE dbo.users ADD gender VARCHAR(10) NULL;
GO
IF COL_LENGTH('dbo.users', 'country') IS NULL
    ALTER TABLE dbo.users ADD country VARCHAR(8) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_users_gender')
    ALTER TABLE dbo.users ADD CONSTRAINT CK_users_gender
        CHECK (gender IS NULL OR gender IN ('male', 'female'));
GO
PRINT 'Migration 005: users profile fields OK';
GO
