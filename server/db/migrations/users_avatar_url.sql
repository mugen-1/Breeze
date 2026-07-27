-- Ảnh đại diện user: lưu ĐƯỜNG DẪN tương đối (vd '/avatars/<uid>.webp'), không lưu file trong DB.
-- NVARCHAR(255) NULL — user chưa upload thì NULL, header tự fallback về icon mặc định.
-- Idempotent: chạy lại nhiều lần không lỗi.
IF COL_LENGTH('dbo.users', 'avatar_url') IS NULL
    ALTER TABLE dbo.users ADD avatar_url NVARCHAR(255) NULL;
GO
PRINT 'Migration: users.avatar_url OK';
GO
