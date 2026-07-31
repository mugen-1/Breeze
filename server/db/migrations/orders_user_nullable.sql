IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'orders'
      AND COLUMN_NAME = 'user_id' AND IS_NULLABLE = 'NO'
)
BEGIN
    ALTER TABLE dbo.orders ALTER COLUMN user_id INT NULL;
    PRINT 'Migration: orders.user_id -> NULLable OK';
END
ELSE
    PRINT 'Migration: orders.user_id already nullable — skipped';
GO
