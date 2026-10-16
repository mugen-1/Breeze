-- Nullable snapshots preserve legacy orders. No PK, IDENTITY or FK changes.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF COL_LENGTH('dbo.orders', 'order_code') IS NULL
    ALTER TABLE dbo.orders ADD order_code INT NULL;
  IF COL_LENGTH('dbo.orders', 'shipping_provider') IS NULL
    ALTER TABLE dbo.orders ADD shipping_provider NVARCHAR(80) NULL;
  IF COL_LENGTH('dbo.orders', 'shipping_service') IS NULL
    ALTER TABLE dbo.orders ADD shipping_service NVARCHAR(120) NULL;
  IF COL_LENGTH('dbo.orders', 'shipping_eta') IS NULL
    ALTER TABLE dbo.orders ADD shipping_eta NVARCHAR(80) NULL;
  IF COL_LENGTH('dbo.orders', 'shipping_tracking_code') IS NULL
    ALTER TABLE dbo.orders ADD shipping_tracking_code VARCHAR(64) NULL;
  IF COL_LENGTH('dbo.orders', 'shipping_status') IS NULL
    ALTER TABLE dbo.orders ADD shipping_status VARCHAR(30) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.orders') AND name='UX_orders_order_code')
    EXEC(N'CREATE UNIQUE INDEX UX_orders_order_code ON dbo.orders(order_code) WHERE order_code IS NOT NULL;');
  IF OBJECT_ID('dbo.order_code_counter', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.order_code_counter (
      id TINYINT NOT NULL CONSTRAINT PK_order_code_counter PRIMARY KEY,
      last_code INT NOT NULL,
      CONSTRAINT CK_order_code_counter CHECK (id = 1 AND last_code BETWEEN 1000 AND 1100)
    );
    EXEC(N'INSERT INTO dbo.order_code_counter(id,last_code) SELECT 1,COALESCE(MAX(order_code),1000) FROM dbo.orders;');
  END;
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.orders') AND name='CK_orders_shipping')
    ALTER TABLE dbo.orders DROP CONSTRAINT CK_orders_shipping;
    EXEC(N'ALTER TABLE dbo.orders WITH CHECK ADD CONSTRAINT CK_orders_shipping CHECK (
      (shipping_version IS NULL AND shipping_method IS NULL AND shipping_fee IS NULL) OR
      (shipping_version IS NOT NULL AND shipping_version IN (1,2) AND
       shipping_method IS NOT NULL AND ((shipping_version = 1 AND shipping_method COLLATE Latin1_General_100_BIN2 = ''STANDARD'') OR
       (shipping_version = 2 AND shipping_method COLLATE Latin1_General_100_BIN2 IN (''GHN_STANDARD'',''GHTK_ECONOMY'',''BREEZE_EXPRESS''))) AND
       shipping_fee IS NOT NULL AND shipping_fee >= 0 AND shipping_fee = FLOOR(shipping_fee) AND
       shipping_name IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_name))) > 0 AND
       shipping_phone IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_phone))) > 0 AND
       shipping_address IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_address))) > 0 AND
       shipping_ward IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_ward))) > 0 AND
       shipping_district IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_district))) > 0 AND
       shipping_city IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_city))) > 0)
    );');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.orders') AND name='CK_orders_shipping_v2')
    EXEC(N'ALTER TABLE dbo.orders WITH CHECK ADD CONSTRAINT CK_orders_shipping_v2 CHECK (
      (order_code IS NULL OR order_code BETWEEN 1001 AND 1100) AND
      ((shipping_version IS NULL OR shipping_version = 1) AND order_code IS NULL AND
       shipping_provider IS NULL AND shipping_service IS NULL AND shipping_eta IS NULL AND
       shipping_tracking_code IS NULL AND shipping_status IS NULL OR
       shipping_version IS NOT NULL AND shipping_version = 2 AND order_code IS NOT NULL AND
       shipping_provider IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_provider))) > 0 AND
       shipping_service IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_service))) > 0 AND
       shipping_eta IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_eta))) > 0 AND
       shipping_tracking_code IS NOT NULL AND LEN(LTRIM(RTRIM(shipping_tracking_code))) > 0 AND
       shipping_status IS NOT NULL AND shipping_status COLLATE Latin1_General_100_BIN2 IN
         (''pending_pickup'',''picked_up'',''in_transit'',''out_for_delivery'',''delivered'',''cancelled'') AND
       ((status = ''completed'' AND shipping_status = ''delivered'') OR
        (status = ''cancelled'' AND shipping_status = ''cancelled'') OR
        (status NOT IN (''completed'',''cancelled'') AND shipping_status NOT IN (''delivered'',''cancelled''))))
    );');
  ALTER TABLE dbo.orders WITH CHECK CHECK CONSTRAINT CK_orders_shipping;
  ALTER TABLE dbo.orders WITH CHECK CHECK CONSTRAINT CK_orders_shipping_v2;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
