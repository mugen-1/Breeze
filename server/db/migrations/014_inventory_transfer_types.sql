/* TASK 07.1: forward-only guarantee for Size Variant transfer movement types. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE parent_object_id = OBJECT_ID('dbo.inventory_movements')
                 AND name = 'CK_inventory_movements_type'
                 AND (definition NOT LIKE '%OPENING_BALANCE%'
                   OR definition NOT LIKE '%VARIANT_OPENING%'
                   OR definition NOT LIKE '%ORDER_CHECKOUT%'
                   OR definition NOT LIKE '%ORDER_CANCEL%'
                   OR definition NOT LIKE '%ADMIN_ADJUSTMENT%'
                   OR definition NOT LIKE '%PRODUCT_CREATE%'
                   OR definition NOT LIKE '%VARIANT_TRANSFER_OUT%'
                   OR definition NOT LIKE '%VARIANT_TRANSFER_IN%'))
        ALTER TABLE dbo.inventory_movements DROP CONSTRAINT CK_inventory_movements_type;

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE parent_object_id = OBJECT_ID('dbo.inventory_movements')
                     AND name = 'CK_inventory_movements_type')
        ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT CK_inventory_movements_type CHECK
          (movement_type IN ('OPENING_BALANCE','VARIANT_OPENING','ORDER_CHECKOUT','ORDER_CANCEL',
                            'ADMIN_ADJUSTMENT','PRODUCT_CREATE','VARIANT_TRANSFER_OUT','VARIANT_TRANSFER_IN'));
    ALTER TABLE dbo.inventory_movements WITH CHECK CHECK CONSTRAINT CK_inventory_movements_type;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
