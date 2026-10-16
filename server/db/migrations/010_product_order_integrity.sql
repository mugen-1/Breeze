/* TASK 04.5: restore the verifiable ring catalog rows deleted by migration 003,
   then enforce order_items -> products again. Source: git bedf524:server/db/seed.sql.
   The original stock is deliberately NOT restored: each archive starts at zero.
   Only IDs with orphan order_items are inserted. Unknown historical products fail
   closed for manual review. Rerunnable and atomic. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @source TABLE (
        id INT PRIMARY KEY, slug VARCHAR(160), name_vi NVARCHAR(200), name_en NVARCHAR(200),
        description_vi NVARCHAR(MAX), description_en NVARCHAR(MAX),
        price INT, sale_price INT NULL, images NVARCHAR(MAX)
    );
    INSERT INTO @source VALUES
      (51, 'nhan-vo-so', N'Nhẫn Vỏ Sò', N'Seashell Ring', N'Nhẫn hình vỏ sò dễ thương, gợi nhắc mùa hè.', N'Cute seashell-shaped ring, a summer memento.', 89000, NULL, N'[]'),
      (52, 'nhan-da-mau', N'Nhẫn Đá Màu', N'Colored Stone Ring', N'Nhẫn đính đá màu tươi sáng, nổi bật.', N'Ring with bright colored stone accent.', 109000, 89000, N'[]'),
      (53, 'nhan-day-kim-loai', N'Nhẫn Dây Kim Loại Mảnh', N'Thin Metal Band Ring', N'Nhẫn dây kim loại mảnh, đơn giản tinh tế.', N'Thin metal band ring, simple and refined.', 79000, NULL, N'[]'),
      (54, 'nhan-ngoc-trai', N'Nhẫn Ngọc Trai Nhân Tạo', N'Faux Pearl Ring', N'Nhẫn đính ngọc trai nhân tạo, nữ tính.', N'Faux pearl ring, delicate and feminine.', 99000, NULL, N'[]'),
      (55, 'nhan-da-nhiet-doi', N'Nhẫn Đính Đá Nhiệt Đới', N'Tropical Stone Ring', N'Nhẫn đính đá màu phong cách nhiệt đới rực rỡ.', N'Vibrant tropical-style stone ring.', 119000, 99000, N'[]'),
      (56, 'nhan-bac-tron', N'Nhẫn Bạc Trơn', N'Plain Silver Ring', N'Nhẫn bạc trơn tối giản, dễ phối mọi lúc.', N'Minimal plain silver ring, easy to wear anytime.', 129000, NULL, N'[]'),
      (57, 'nhan-xep-tang', N'Nhẫn Xếp Tầng', N'Stackable Ring Set', N'Bộ nhẫn xếp tầng nhiều kiểu, phối linh hoạt.', N'Stackable ring set, mix and match freely.', 149000, NULL, N'[]'),
      (59, 'nhan-dieu-chinh-size', N'Nhẫn Điều Chỉnh Size', N'Adjustable Ring', N'Nhẫn thiết kế điều chỉnh size linh hoạt, vừa mọi ngón tay.', N'Adjustable-size ring design, fits any finger.', 89000, NULL, N'[]');

    -- Match BOTH ID and historic purchase name; never guess an unknown product.
    IF EXISTS (
      SELECT 1 FROM dbo.order_items oi
      LEFT JOIN dbo.products p ON p.id = oi.product_id
      LEFT JOIN @source s ON s.id = oi.product_id
        AND s.name_vi COLLATE Latin1_General_100_BIN2 = oi.product_name COLLATE Latin1_General_100_BIN2
      WHERE p.id IS NULL AND s.id IS NULL
    ) THROW 51010, 'Unknown orphan product or mismatched order snapshot; manual review required.', 1;

    IF EXISTS (
      SELECT 1 FROM @source s JOIN dbo.products p ON p.slug = s.slug AND p.id <> s.id
      WHERE EXISTS (SELECT 1 FROM dbo.order_items oi WHERE oi.product_id = s.id)
    ) THROW 51011, 'Recovered product slug is owned by another ID.', 1;

    IF EXISTS (
      SELECT 1 FROM dbo.order_items oi LEFT JOIN dbo.products p ON p.id = oi.product_id
      WHERE p.id IS NULL
    )
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM dbo.categories WHERE slug = 'nhan')
        INSERT INTO dbo.categories (slug, name_vi, name_en) VALUES ('nhan', N'Nhẫn', N'Rings');
      DECLARE @ringCategory INT = (SELECT id FROM dbo.categories WHERE slug = 'nhan');

      SET IDENTITY_INSERT dbo.products ON;
      INSERT INTO dbo.products
        (id, slug, name_vi, name_en, description_vi, description_en, price,
         sale_price, currency, images, category_id, stock, is_active)
      SELECT s.id, s.slug, s.name_vi, s.name_en, s.description_vi, s.description_en,
             s.price, s.sale_price, 'VND', s.images, @ringCategory, 0, 0
      FROM @source s
      WHERE NOT EXISTS (SELECT 1 FROM dbo.products p WHERE p.id = s.id)
        AND EXISTS (SELECT 1 FROM dbo.order_items oi WHERE oi.product_id = s.id);
      SET IDENTITY_INSERT dbo.products OFF;
    END;

    -- product_name already is a NOT NULL purchase-time snapshot in this schema.
    -- Do not rewrite historical names or prices from today's catalog.
    IF EXISTS (
      SELECT 1 FROM dbo.order_items oi LEFT JOIN dbo.products p ON p.id = oi.product_id
      WHERE p.id IS NULL
    ) THROW 51012, 'Orphan order_items remain; refusing to add an untrusted FK.', 1;

    IF EXISTS (
      SELECT 1 FROM sys.foreign_keys fk
      WHERE fk.name = 'FK_order_items_product'
        AND (fk.parent_object_id <> OBJECT_ID('dbo.order_items')
          OR fk.referenced_object_id <> OBJECT_ID('dbo.products')
          OR fk.delete_referential_action <> 0
          OR NOT EXISTS (
            SELECT 1 FROM sys.foreign_key_columns fkc
            WHERE fkc.constraint_object_id = fk.object_id
              AND fkc.parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.order_items'), 'product_id', 'ColumnId')
              AND fkc.referenced_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.products'), 'id', 'ColumnId')
          ))
    ) THROW 51013, 'Existing FK_order_items_product has unexpected definition.', 1;

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_order_items_product'
                   AND parent_object_id = OBJECT_ID('dbo.order_items'))
      ALTER TABLE dbo.order_items WITH CHECK ADD CONSTRAINT FK_order_items_product
        FOREIGN KEY (product_id) REFERENCES dbo.products(id) ON DELETE NO ACTION;

    ALTER TABLE dbo.order_items WITH CHECK CHECK CONSTRAINT FK_order_items_product;
    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_order_items_product'
               AND parent_object_id = OBJECT_ID('dbo.order_items')
               AND (is_disabled = 1 OR is_not_trusted = 1))
      THROW 51014, 'Product FK is not enabled and trusted.', 1;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
