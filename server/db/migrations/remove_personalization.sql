-- Gỡ toggle "Cá nhân hoá": xoá cột allow_data_personalization.
-- LƯU Ý: cột nằm ở dbo.user_privacy_settings (KHÔNG phải dbo.users) — user_privacy_settings
-- là bảng riêng 1-1 với users qua FK user_id.
-- Dữ liệu được BACKUP sang dbo.ups_personalization_backup trước khi xoá.
-- Idempotent: chạy lại nhiều lần không lỗi, không backup đè lên bản đã có.

-- 1) Backup — chỉ khi cột còn tồn tại VÀ chưa từng backup (không ghi đè bản cũ).
IF COL_LENGTH('dbo.user_privacy_settings', 'allow_data_personalization') IS NOT NULL
   AND OBJECT_ID('dbo.ups_personalization_backup', 'U') IS NULL
BEGIN
    EXEC('
        SELECT user_id,
               allow_data_personalization,
               SYSUTCDATETIME() AS backed_up_at
          INTO dbo.ups_personalization_backup
          FROM dbo.user_privacy_settings;
    ');
    PRINT 'Backup: da tao dbo.ups_personalization_backup';
END
ELSE
    PRINT 'Backup: bo qua (cot da xoa hoac backup da ton tai)';
GO

-- 2) Xoá DEFAULT constraint đang gắn vào cột — còn constraint thì DROP COLUMN sẽ lỗi.
--    Tra tên từ sys thay vì hardcode 'DF_ups_allow_data_personalization', phòng khi
--    constraint được tạo với tên khác (vd SQL Server tự sinh).
DECLARE @df SYSNAME;
SELECT @df = dc.name
  FROM sys.default_constraints dc
  JOIN sys.columns c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
 WHERE dc.parent_object_id = OBJECT_ID('dbo.user_privacy_settings')
   AND c.name = 'allow_data_personalization';

IF @df IS NOT NULL
BEGIN
    EXEC('ALTER TABLE dbo.user_privacy_settings DROP CONSTRAINT ' + @df);
    PRINT 'Da xoa DEFAULT constraint: ' + @df;
END
GO

-- 3) Xoá cột.
IF COL_LENGTH('dbo.user_privacy_settings', 'allow_data_personalization') IS NOT NULL
BEGIN
    ALTER TABLE dbo.user_privacy_settings DROP COLUMN allow_data_personalization;
    PRINT 'Da xoa cot allow_data_personalization';
END
ELSE
    PRINT 'Cot allow_data_personalization khong ton tai — skipped';
GO
PRINT 'Migration: remove allow_data_personalization OK';
GO
