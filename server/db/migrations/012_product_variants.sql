/* TASK 06: switch inventory identity to variants without rewriting product-level history.
   products.stock remains a transactionally maintained SUM of ALL variant stock,
   including inactive variants (physical inventory, not sellable availability). */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.product_variants', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.product_variants (
            id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_product_variants PRIMARY KEY,
            product_id INT NOT NULL,
            sku VARCHAR(80) NOT NULL,
            size NVARCHAR(40) NULL,
            color NVARCHAR(80) NULL,
            stock INT NOT NULL,
            is_active BIT NOT NULL CONSTRAINT DF_product_variants_is_active DEFAULT 1,
            is_base BIT NOT NULL CONSTRAINT DF_product_variants_is_base DEFAULT 0,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_product_variants_created_at DEFAULT SYSUTCDATETIME(),
            updated_at DATETIME2 NOT NULL CONSTRAINT DF_product_variants_updated_at DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_product_variants_product FOREIGN KEY (product_id)
                REFERENCES dbo.products(id) ON DELETE NO ACTION,
            CONSTRAINT CK_product_variants_stock CHECK (stock >= 0),
            CONSTRAINT CK_product_variants_base CHECK (is_base = 0 OR (size IS NULL AND color IS NULL)),
            CONSTRAINT UQ_product_variants_sku UNIQUE (sku),
            CONSTRAINT UQ_product_variants_product_id_id UNIQUE (product_id, id)
        );
        CREATE UNIQUE INDEX UX_product_variants_base
          ON dbo.product_variants(product_id) WHERE is_base = 1;
    END;

    IF EXISTS (SELECT 1 FROM dbo.products WHERE stock < 0)
        THROW 51200, 'Negative product stock before variant cutover.', 1;

    -- One locked snapshot prevents a concurrent stock change during backfill.
    INSERT INTO dbo.product_variants (product_id, sku, stock, is_active, is_base)
    SELECT p.id, 'BR-P' + CONVERT(VARCHAR(11), p.id) + '-BASE', p.stock, p.is_active, 1
    FROM dbo.products p WITH (TABLOCKX, HOLDLOCK)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.product_variants v WHERE v.product_id = p.id AND v.is_base = 1);

    IF COL_LENGTH('dbo.cart_items', 'variant_id') IS NULL
        ALTER TABLE dbo.cart_items ADD variant_id INT NULL;
    EXEC(N'UPDATE ci SET variant_id = v.id
      FROM dbo.cart_items ci JOIN dbo.product_variants v ON v.product_id = ci.product_id AND v.is_base = 1
      WHERE ci.variant_id IS NULL;');
    EXEC(N'IF EXISTS (SELECT 1 FROM dbo.cart_items WHERE variant_id IS NULL)
      THROW 51201, ''Cart row cannot be mapped to a base variant.'', 1;');
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.cart_items')
               AND name = 'variant_id' AND is_nullable = 1)
        ALTER TABLE dbo.cart_items ALTER COLUMN variant_id INT NOT NULL;
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID('dbo.cart_items')
               AND name = 'UQ_cart_items_user_product')
        ALTER TABLE dbo.cart_items DROP CONSTRAINT UQ_cart_items_user_product;
    IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID('dbo.cart_items')
                   AND name = 'UQ_cart_items_user_variant')
        ALTER TABLE dbo.cart_items ADD CONSTRAINT UQ_cart_items_user_variant UNIQUE (user_id, variant_id);
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.cart_items')
                   AND name = 'FK_cart_items_variant_product')
        ALTER TABLE dbo.cart_items WITH CHECK ADD CONSTRAINT FK_cart_items_variant_product
          FOREIGN KEY (product_id, variant_id) REFERENCES dbo.product_variants(product_id, id);
    ALTER TABLE dbo.cart_items WITH CHECK CHECK CONSTRAINT FK_cart_items_variant_product;

    -- Before TASK 06 only one purchasable identity existed per product. Map that
    -- identity to the base variant; preserve every purchase-time snapshot verbatim.
    IF COL_LENGTH('dbo.order_items', 'variant_id') IS NULL
        ALTER TABLE dbo.order_items ADD variant_id INT NULL;
    EXEC(N'UPDATE oi SET variant_id = v.id
      FROM dbo.order_items oi JOIN dbo.product_variants v ON v.product_id = oi.product_id AND v.is_base = 1
      WHERE oi.variant_id IS NULL;');
    EXEC(N'IF EXISTS (SELECT 1 FROM dbo.order_items WHERE variant_id IS NULL)
      THROW 51202, ''Order item cannot be mapped to a base variant.'', 1;');
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.order_items')
               AND name = 'variant_id' AND is_nullable = 1)
        ALTER TABLE dbo.order_items ALTER COLUMN variant_id INT NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.order_items')
                   AND name = 'FK_order_items_variant_product')
        ALTER TABLE dbo.order_items WITH CHECK ADD CONSTRAINT FK_order_items_variant_product
          FOREIGN KEY (product_id, variant_id) REFERENCES dbo.product_variants(product_id, id);
    ALTER TABLE dbo.order_items WITH CHECK CHECK CONSTRAINT FK_order_items_variant_product;

    IF COL_LENGTH('dbo.inventory_movements', 'variant_id') IS NULL
        ALTER TABLE dbo.inventory_movements ADD variant_id INT NULL;
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.inventory_movements')
               AND name = 'CK_inventory_movements_type')
        ALTER TABLE dbo.inventory_movements DROP CONSTRAINT CK_inventory_movements_type;
    ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT CK_inventory_movements_type CHECK
      (movement_type IN ('OPENING_BALANCE', 'VARIANT_OPENING', 'ORDER_CHECKOUT',
                         'ORDER_CANCEL', 'ADMIN_ADJUSTMENT', 'PRODUCT_CREATE'));
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.inventory_movements')
                   AND name = 'FK_inventory_movements_variant_product')
        ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT FK_inventory_movements_variant_product
          FOREIGN KEY (product_id, variant_id) REFERENCES dbo.product_variants(product_id, id);
    ALTER TABLE dbo.inventory_movements WITH CHECK CHECK CONSTRAINT FK_inventory_movements_variant_product;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.inventory_movements')
                   AND name = 'IX_inventory_movements_variant_time')
        CREATE INDEX IX_inventory_movements_variant_time
          ON dbo.inventory_movements(variant_id, created_at DESC, id DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.inventory_movements')
                   AND name = 'UX_inventory_movements_variant_opening')
        CREATE UNIQUE INDEX UX_inventory_movements_variant_opening
          ON dbo.inventory_movements(variant_id) WHERE movement_type = 'VARIANT_OPENING';

    -- A zero-delta transition is the first variant-level ledger row. Old rows
    -- remain product-level with variant_id NULL; no historical meaning changes.
    EXEC(N'IF EXISTS (
      SELECT 1 FROM dbo.product_variants v
      OUTER APPLY (SELECT TOP (1) m.stock_after FROM dbo.inventory_movements m
                   WHERE m.product_id = v.product_id AND m.variant_id IS NULL
                   ORDER BY m.created_at DESC, m.id DESC) old_last
      WHERE v.is_base = 1 AND NOT EXISTS
        (SELECT 1 FROM dbo.inventory_movements m WHERE m.variant_id = v.id)
        AND (old_last.stock_after IS NULL OR old_last.stock_after <> v.stock)
    ) THROW 51203, ''Product ledger does not meet variant opening balance.'', 1;');

    EXEC(N'INSERT INTO dbo.inventory_movements
      (product_id, variant_id, movement_type, quantity_delta, stock_before, stock_after)
    SELECT v.product_id, v.id, ''VARIANT_OPENING'', 0, v.stock, v.stock
    FROM dbo.product_variants v
    WHERE v.is_base = 1 AND NOT EXISTS
      (SELECT 1 FROM dbo.inventory_movements m WHERE m.variant_id = v.id);');

    IF EXISTS (
      SELECT 1 FROM dbo.products p
      OUTER APPLY (SELECT COALESCE(SUM(CONVERT(BIGINT, v.stock)), 0) AS total
                   FROM dbo.product_variants v WHERE v.product_id = p.id) s
      WHERE CONVERT(BIGINT, p.stock) <> s.total
    ) THROW 51204, 'Product stock does not equal sum of variant stock.', 1;
    IF EXISTS (SELECT 1 FROM dbo.products p WHERE NOT EXISTS
               (SELECT 1 FROM dbo.product_variants v WHERE v.product_id = p.id AND v.is_base = 1))
        THROW 51205, 'Product missing base variant.', 1;
    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name IN
        ('FK_cart_items_variant_product','FK_order_items_variant_product','FK_inventory_movements_variant_product')
        AND (is_disabled = 1 OR is_not_trusted = 1))
        THROW 51206, 'Variant foreign key is disabled or untrusted.', 1;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
