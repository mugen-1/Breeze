/* TASK 07: metadata only. Never distribute BASE stock or guess historical sizes. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF COL_LENGTH('dbo.order_items', 'size_snapshot') IS NULL
        ALTER TABLE dbo.order_items ADD size_snapshot NVARCHAR(40) NULL;

    -- TASK 08 can replace this filtered identity with (product,size,color).
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.product_variants')
                   AND name = 'UX_product_variants_size')
        CREATE UNIQUE INDEX UX_product_variants_size ON dbo.product_variants(product_id, size)
          WHERE is_base = 0 AND color IS NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.product_variants')
                   AND name = 'CK_product_variants_size')
        ALTER TABLE dbo.product_variants WITH CHECK ADD CONSTRAINT CK_product_variants_size CHECK
          (color IS NULL AND (is_base = 1 OR (size IS NOT NULL AND size COLLATE Latin1_General_100_BIN2 IN
            ('S','M','L','XL','39','40','40.5','41','42','42.5','43','44','44.5','45','45.5','46'))));
    ALTER TABLE dbo.product_variants WITH CHECK CHECK CONSTRAINT CK_product_variants_size;

    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.inventory_movements')
               AND name = 'CK_inventory_movements_type')
        ALTER TABLE dbo.inventory_movements DROP CONSTRAINT CK_inventory_movements_type;
    ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT CK_inventory_movements_type CHECK
      (movement_type IN ('OPENING_BALANCE','VARIANT_OPENING','ORDER_CHECKOUT','ORDER_CANCEL',
                        'ADMIN_ADJUSTMENT','PRODUCT_CREATE','VARIANT_TRANSFER_OUT','VARIANT_TRANSFER_IN'));
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
