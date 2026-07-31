IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_order_items_product')
BEGIN
    ALTER TABLE dbo.order_items DROP CONSTRAINT FK_order_items_product;
    PRINT 'Dropped FK_order_items_product';
END
ELSE
    PRINT 'FK_order_items_product not found — skipped';
GO

DECLARE @c_nhan INT = (SELECT id FROM dbo.categories WHERE slug = 'nhan');
IF @c_nhan IS NOT NULL
BEGIN
    DELETE FROM dbo.cart_items WHERE product_id IN (SELECT id FROM dbo.products WHERE category_id = @c_nhan);
    DELETE FROM dbo.products   WHERE category_id = @c_nhan;
    DELETE FROM dbo.categories WHERE id = @c_nhan;
    PRINT 'Removed nhan category + products';
END
ELSE
    PRINT 'nhan category not found — skipped';
GO
