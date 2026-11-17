/* Loại movement ORDER_DELETE: admin xoá hẳn đơn chưa rời kho (pending/confirmed/paid/processing)
   -> cộng lại tồn kho, ghi ledger TRƯỚC khi DELETE (FK_inventory_movements_order ON DELETE SET NULL;
   order_reference_id giữ id đơn). Code: restoreOrderStock trong server/lib/cancel-order.js.
   Giữ nguyên 8 loại của 014. Forward-only, idempotent: CHECK đã đủ 9 loại thì không làm gì;
   thiếu loại nào thì dựng lại. Không sửa dữ liệu; dữ liệu có loại ngoài 9 loại -> ADD CHECK lỗi, rollback. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.inventory_movements', 'U') IS NULL
        THROW 51000, 'Run 011_inventory_movements.sql before 024_inventory_order_delete.sql (dbo.inventory_movements missing)', 1;

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
                   OR definition NOT LIKE '%VARIANT_TRANSFER_IN%'
                   OR definition NOT LIKE '%ORDER_DELETE%'))
        ALTER TABLE dbo.inventory_movements DROP CONSTRAINT CK_inventory_movements_type;

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE parent_object_id = OBJECT_ID('dbo.inventory_movements')
                     AND name = 'CK_inventory_movements_type')
        ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT CK_inventory_movements_type CHECK
          (movement_type IN ('OPENING_BALANCE','VARIANT_OPENING','ORDER_CHECKOUT','ORDER_CANCEL',
                            'ADMIN_ADJUSTMENT','PRODUCT_CREATE','VARIANT_TRANSFER_OUT','VARIANT_TRANSFER_IN',
                            'ORDER_DELETE'));
    ALTER TABLE dbo.inventory_movements WITH CHECK CHECK CONSTRAINT CK_inventory_movements_type;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
