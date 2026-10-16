/* TASK 08: color metadata and images; no product/color rows or stock backfill. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.product_colors', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.product_colors (
            id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_product_colors PRIMARY KEY,
            product_id INT NOT NULL,
            color_key NVARCHAR(80) NOT NULL,
            label NVARCHAR(80) NOT NULL,
            swatch_hex CHAR(7) NULL,
            is_active BIT NOT NULL CONSTRAINT DF_product_colors_is_active DEFAULT 1,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_product_colors_created_at DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_product_colors_product FOREIGN KEY (product_id)
                REFERENCES dbo.products(id) ON DELETE NO ACTION,
            CONSTRAINT UQ_product_colors_product_key UNIQUE (product_id, color_key),
            CONSTRAINT CK_product_colors_hex CHECK
                (swatch_hex IS NULL OR (swatch_hex LIKE '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'
                 AND swatch_hex COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^#0-9A-F]%'))
        );
    END;

    IF OBJECT_ID('dbo.product_color_images', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.product_color_images (
            id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_product_color_images PRIMARY KEY,
            color_id INT NOT NULL,
            image_path NVARCHAR(500) NOT NULL,
            sort_order INT NOT NULL CONSTRAINT DF_product_color_images_sort DEFAULT 0,
            is_primary BIT NOT NULL CONSTRAINT DF_product_color_images_primary DEFAULT 0,
            CONSTRAINT FK_product_color_images_color FOREIGN KEY (color_id)
                REFERENCES dbo.product_colors(id) ON DELETE NO ACTION,
            CONSTRAINT CK_product_color_images_sort CHECK (sort_order >= 0),
            CONSTRAINT UQ_product_color_images_path UNIQUE (color_id, image_path)
        );
    END;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.product_color_images')
                   AND name = 'UX_product_color_images_primary')
        CREATE UNIQUE INDEX UX_product_color_images_primary
          ON dbo.product_color_images(color_id) WHERE is_primary = 1;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.product_color_images')
                   AND name = 'IX_product_color_images_order')
        CREATE INDEX IX_product_color_images_order
          ON dbo.product_color_images(color_id, sort_order, id);

    IF COL_LENGTH('dbo.order_items', 'color_snapshot') IS NULL
        ALTER TABLE dbo.order_items ADD color_snapshot NVARCHAR(80) NULL;

    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.product_variants')
               AND name = 'CK_product_variants_size')
        ALTER TABLE dbo.product_variants DROP CONSTRAINT CK_product_variants_size;
    ALTER TABLE dbo.product_variants WITH CHECK ADD CONSTRAINT CK_product_variants_size CHECK
      ((is_base = 1 AND size IS NULL AND color IS NULL) OR
       (is_base = 0 AND (size IS NOT NULL OR color IS NOT NULL) AND
        (size IS NULL OR size COLLATE Latin1_General_100_BIN2 IN
          ('S','M','L','XL','39','40','40.5','41','42','42.5','43','44','44.5','45','45.5','46'))));

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.product_variants')
                   AND name = 'UX_product_variants_color_only')
        CREATE UNIQUE INDEX UX_product_variants_color_only ON dbo.product_variants(product_id, color)
          WHERE is_base = 0 AND size IS NULL AND color IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.product_variants')
                   AND name = 'UX_product_variants_size_color')
        CREATE UNIQUE INDEX UX_product_variants_size_color ON dbo.product_variants(product_id, size, color)
          WHERE is_base = 0 AND size IS NOT NULL AND color IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.product_variants')
                   AND name = 'FK_product_variants_color')
        ALTER TABLE dbo.product_variants WITH CHECK ADD CONSTRAINT FK_product_variants_color
          FOREIGN KEY (product_id, color) REFERENCES dbo.product_colors(product_id, color_key);
    ALTER TABLE dbo.product_variants WITH CHECK CHECK CONSTRAINT FK_product_variants_color;
    ALTER TABLE dbo.product_colors WITH CHECK CHECK CONSTRAINT FK_product_colors_product;
    ALTER TABLE dbo.product_color_images WITH CHECK CHECK CONSTRAINT FK_product_color_images_color;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
