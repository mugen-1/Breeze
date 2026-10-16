-- Shipping stays on orders: reuse name/phone/address, no profile references.
-- NULL version = historical snapshot format; API checkout explicitly writes 1.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF COL_LENGTH('dbo.orders', 'shipping_version') IS NULL
    ALTER TABLE dbo.orders ADD shipping_version TINYINT NULL;
  IF COL_LENGTH('dbo.orders', 'shipping_ward') IS NULL
    ALTER TABLE dbo.orders ADD shipping_ward NVARCHAR(120) NULL;
  IF COL_LENGTH('dbo.orders', 'shipping_district') IS NULL
    ALTER TABLE dbo.orders ADD shipping_district NVARCHAR(120) NULL;
  IF COL_LENGTH('dbo.orders', 'shipping_city') IS NULL
    ALTER TABLE dbo.orders ADD shipping_city NVARCHAR(120) NULL;
  IF COL_LENGTH('dbo.orders', 'delivery_note') IS NULL
    ALTER TABLE dbo.orders ADD delivery_note NVARCHAR(500) NULL;
  IF COL_LENGTH('dbo.orders', 'shipping_method') IS NULL
    ALTER TABLE dbo.orders ADD shipping_method VARCHAR(20) NULL;
  IF COL_LENGTH('dbo.orders', 'shipping_fee') IS NULL
    ALTER TABLE dbo.orders ADD shipping_fee DECIMAL(12,2) NULL;
  -- Dynamic batch compiles after the new columns exist. No updates/backfills.
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_orders_shipping')
    EXEC(N'ALTER TABLE dbo.orders WITH CHECK ADD CONSTRAINT CK_orders_shipping CHECK (
      (shipping_version IS NULL AND shipping_method IS NULL AND shipping_fee IS NULL) OR
      (shipping_version IS NOT NULL AND shipping_version = 1 AND
       shipping_method IS NOT NULL AND shipping_method COLLATE Latin1_General_100_BIN2 = ''STANDARD'' AND
       shipping_fee IS NOT NULL AND shipping_fee >= 0 AND shipping_fee = FLOOR(shipping_fee) AND
       shipping_name IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_name))) > 0 AND
       shipping_phone IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_phone))) > 0 AND
       shipping_address IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_address))) > 0 AND
       shipping_ward IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_ward))) > 0 AND
       shipping_district IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_district))) > 0 AND
       shipping_city IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_city))) > 0)
    );');
  ALTER TABLE dbo.orders WITH CHECK CHECK CONSTRAINT CK_orders_shipping;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
