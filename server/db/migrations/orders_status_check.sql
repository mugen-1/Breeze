IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_orders_status' AND parent_object_id = OBJECT_ID('dbo.orders')
)
BEGIN
    ALTER TABLE dbo.orders WITH CHECK
        ADD CONSTRAINT CK_orders_status
        CHECK (status IN ('pending', 'paid', 'shipped', 'completed', 'cancelled'));
    PRINT 'Added CK_orders_status';
END
ELSE
    PRINT 'CK_orders_status already exists — skipped';
GO
