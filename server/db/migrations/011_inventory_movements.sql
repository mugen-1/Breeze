/* TASK 05: the existing stock is a starting balance, not reconstructed history.
   One transaction makes the schema and opening balances visible together. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.inventory_movements', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.inventory_movements (
            id                 BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_inventory_movements PRIMARY KEY,
            product_id         INT NOT NULL,
            order_id           INT NULL,
            order_reference_id INT NULL,
            movement_type      VARCHAR(30) NOT NULL,
            quantity_delta     INT NOT NULL,
            stock_before       INT NOT NULL,
            stock_after        INT NOT NULL,
            reason             NVARCHAR(250) NULL,
            actor_user_id      INT NULL,
            created_at         DATETIME2(7) NOT NULL CONSTRAINT DF_inventory_movements_created_at DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_inventory_movements_product FOREIGN KEY (product_id)
                REFERENCES dbo.products(id) ON DELETE NO ACTION,
            CONSTRAINT FK_inventory_movements_order FOREIGN KEY (order_id)
                REFERENCES dbo.orders(id) ON DELETE SET NULL,
            CONSTRAINT FK_inventory_movements_actor FOREIGN KEY (actor_user_id)
                REFERENCES dbo.users(id) ON DELETE SET NULL,
            CONSTRAINT CK_inventory_movements_type CHECK (movement_type IN
                ('OPENING_BALANCE', 'ORDER_CHECKOUT', 'ORDER_CANCEL', 'ADMIN_ADJUSTMENT', 'PRODUCT_CREATE')),
            CONSTRAINT CK_inventory_movements_stock CHECK (
                stock_before >= 0 AND stock_after >= 0
                AND CONVERT(BIGINT, stock_after) = CONVERT(BIGINT, stock_before) + quantity_delta)
        );
        CREATE INDEX IX_inventory_movements_product_time
            ON dbo.inventory_movements(product_id, created_at DESC, id DESC);
        CREATE UNIQUE INDEX UX_inventory_movements_opening
            ON dbo.inventory_movements(product_id) WHERE movement_type = 'OPENING_BALANCE';
    END;

    IF EXISTS (SELECT 1 FROM dbo.products WHERE stock < 0)
        THROW 51100, 'Negative product stock; inspect before creating opening balances.', 1;

    -- TABLOCKX prevents a concurrent stock mutation between snapshot and insert.
    INSERT INTO dbo.inventory_movements
        (product_id, movement_type, quantity_delta, stock_before, stock_after)
    SELECT p.id, 'OPENING_BALANCE', 0, p.stock, p.stock
    FROM dbo.products p WITH (TABLOCKX, HOLDLOCK)
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.inventory_movements m WHERE m.product_id = p.id
    );

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
