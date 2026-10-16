/* TASK 04: cancellation metadata. Nullable to preserve every historical order.
   Idempotent; no status, stock, or existing cancellation row is rewritten. */
IF COL_LENGTH('dbo.orders', 'cancel_reason') IS NULL
    ALTER TABLE dbo.orders ADD cancel_reason NVARCHAR(250) NULL;
GO
IF COL_LENGTH('dbo.orders', 'cancelled_at') IS NULL
    ALTER TABLE dbo.orders ADD cancelled_at DATETIME2 NULL;
GO
