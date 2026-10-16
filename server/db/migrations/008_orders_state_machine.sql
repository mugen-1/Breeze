-- TASK 02: allow the new order workflow without rewriting historical rows.
-- Existing paid/shipped orders remain valid, but the API never writes these
-- legacy statuses again. Idempotent and atomic; no order data is changed.
BEGIN TRY
    BEGIN TRANSACTION;

    IF EXISTS (
        SELECT 1 FROM dbo.orders
        WHERE status COLLATE Latin1_General_100_BIN2 NOT IN (
            'pending', 'confirmed', 'processing', 'shipping', 'completed', 'cancelled',
            'paid', 'shipped'
        )
    )
        THROW 51001, 'Unknown order status exists; inspect data before changing the constraint.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE name = 'CK_orders_status'
          AND parent_object_id = OBJECT_ID('dbo.orders')
          AND is_disabled = 0 AND is_not_trusted = 0
          AND definition LIKE '%confirmed%'
          AND definition LIKE '%processing%'
          AND definition LIKE '%shipping%'
    )
    BEGIN
        IF EXISTS (
            SELECT 1 FROM sys.check_constraints
            WHERE name = 'CK_orders_status' AND parent_object_id = OBJECT_ID('dbo.orders')
        )
            ALTER TABLE dbo.orders DROP CONSTRAINT CK_orders_status;

        ALTER TABLE dbo.orders WITH CHECK ADD CONSTRAINT CK_orders_status
            CHECK (status IN (
                'pending', 'confirmed', 'processing', 'shipping', 'completed', 'cancelled',
                'paid', 'shipped'
            ));
    END

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
