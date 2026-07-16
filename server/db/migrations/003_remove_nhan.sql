/* =====================================================================
   Migration 003 — Gỡ danh mục "Nhẫn" (slug='nhan') khỏi cửa hàng.
   - Bỏ FK order_items->products để có thể XOÁ sản phẩm nhẫn mà vẫn GIỮ
     lịch sử đơn hàng (order_items đã lưu snapshot tên + giá lúc mua, nên
     đơn cũ vẫn hiển thị đúng dù sản phẩm gốc không còn).
   - Xoá cart_items, products thuộc nhan, rồi xoá category nhan.
   - Idempotent: chạy lại nhiều lần an toàn.
   Dùng: node db/run-sql.js db/migrations/003_remove_nhan.sql
   ===================================================================== */
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
