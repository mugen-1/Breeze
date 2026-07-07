/* =====================================================================
   Migration 001 — bảng dbo.cart_items (giỏ hàng phía server, Phase 4)
   - Mỗi user 1 dòng / 1 sản phẩm (UNIQUE(user_id, product_id)) => upsert theo qty.
   - Idempotent: chỉ tạo khi CHƯA có (chạy lại nhiều lần an toàn, KHÔNG mất dữ liệu).
   - FK tới users + products; xoá user không cascade (giữ toàn vẹn), nhưng có thể
     xoá thủ công khi cần. quantity luôn > 0 (item hết thì xoá hẳn dòng).
   ===================================================================== */
IF OBJECT_ID('dbo.cart_items', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.cart_items (
        id          INT IDENTITY(1,1) NOT NULL,
        user_id     INT               NOT NULL,
        product_id  INT               NOT NULL,
        quantity    INT               NOT NULL,
        created_at  DATETIME2         NOT NULL CONSTRAINT DF_cart_items_created_at DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2         NOT NULL CONSTRAINT DF_cart_items_updated_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_cart_items              PRIMARY KEY (id),
        CONSTRAINT FK_cart_items_user         FOREIGN KEY (user_id)    REFERENCES dbo.users(id),
        CONSTRAINT FK_cart_items_product      FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT UQ_cart_items_user_product UNIQUE (user_id, product_id),
        CONSTRAINT CK_cart_items_quantity     CHECK (quantity > 0)
    );

    CREATE INDEX IX_cart_items_user ON dbo.cart_items(user_id);

    PRINT 'Created dbo.cart_items';
END
ELSE
    PRINT 'dbo.cart_items already exists — skipped';
GO
