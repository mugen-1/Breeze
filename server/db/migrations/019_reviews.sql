/* Review foundation only. No reviews, images or purchase history are seeded.
   Account deletion already anonymizes orders then deletes users; SET NULL keeps
   reviews compatible with that flow. Deleting an order detaches its item reference
   without losing review snapshots. Products/variants retain NO ACTION history FKs. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.reviews', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.reviews (
            id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_reviews PRIMARY KEY,
            user_id INT NULL,
            product_id INT NOT NULL,
            order_item_id INT NULL,
            variant_id INT NOT NULL,
            size_snapshot NVARCHAR(40) NULL,
            color_snapshot NVARCHAR(80) NULL,
            rating TINYINT NOT NULL,
            comment NVARCHAR(1000) NULL,
            is_hidden BIT NOT NULL CONSTRAINT DF_reviews_hidden DEFAULT 0,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_reviews_created DEFAULT SYSUTCDATETIME(),
            updated_at DATETIME2 NOT NULL CONSTRAINT DF_reviews_updated DEFAULT SYSUTCDATETIME(),
            CONSTRAINT CK_reviews_rating CHECK (rating BETWEEN 1 AND 5),
            CONSTRAINT FK_reviews_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE SET NULL,
            CONSTRAINT FK_reviews_product FOREIGN KEY (product_id) REFERENCES dbo.products(id) ON DELETE NO ACTION,
            CONSTRAINT FK_reviews_order_item FOREIGN KEY (order_item_id) REFERENCES dbo.order_items(id) ON DELETE SET NULL,
            CONSTRAINT FK_reviews_variant_product FOREIGN KEY (product_id, variant_id)
                REFERENCES dbo.product_variants(product_id, id) ON DELETE NO ACTION
        );
    END;
    -- Deleted accounts have no owner. Every existing user still has at most one
    -- review per product, including hidden reviews; anonymous history is retained.
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.reviews') AND name = 'UX_reviews_user_product')
        CREATE UNIQUE INDEX UX_reviews_user_product ON dbo.reviews(user_id, product_id) WHERE user_id IS NOT NULL;

    IF OBJECT_ID('dbo.review_images', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.review_images (
            id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_review_images PRIMARY KEY,
            review_id INT NOT NULL,
            image_path NVARCHAR(500) NOT NULL,
            sort_order TINYINT NOT NULL CONSTRAINT DF_review_images_sort DEFAULT 0,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_review_images_created DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_review_images_review FOREIGN KEY (review_id) REFERENCES dbo.reviews(id) ON DELETE CASCADE,
            CONSTRAINT CK_review_images_sort CHECK (sort_order BETWEEN 0 AND 4),
            CONSTRAINT CK_review_images_path CHECK (LEN(LTRIM(RTRIM(image_path))) > 0),
            CONSTRAINT UQ_review_images_sort UNIQUE (review_id, sort_order)
        );
    END;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.orders') AND name = 'IX_orders_review_purchase')
        CREATE INDEX IX_orders_review_purchase ON dbo.orders(user_id, status, id) INCLUDE(created_at);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.order_items') AND name = 'IX_order_items_review_purchase')
        CREATE INDEX IX_order_items_review_purchase ON dbo.order_items(product_id, order_id, variant_id, id)
            INCLUDE(size_snapshot, color_snapshot);
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
