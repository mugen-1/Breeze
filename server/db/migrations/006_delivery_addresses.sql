/* =====================================================================
   Migration 006 — bảng địa chỉ giao hàng (delivery_addresses)
   - FK user_id -> users(id) (khớp orders/cart_items; KHÔNG dùng firebase_uid).
   - Cột tiếng Việt dùng NVARCHAR (Unicode) để không lỗi dấu.
   - Idempotent: chỉ tạo khi CHƯA có (chạy lại nhiều lần an toàn).
   - Ràng buộc "chỉ 1 địa chỉ mặc định / user" bằng filtered unique index
     (UX_delivery_addresses_default) — chốt chặn ở tầng DB, ngoài logic app.
   ===================================================================== */
IF OBJECT_ID('dbo.delivery_addresses', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.delivery_addresses (
        id             INT IDENTITY(1,1) NOT NULL,
        user_id        INT               NOT NULL,
        recipient_name NVARCHAR(150)     NOT NULL,        -- tên người nhận
        phone          VARCHAR(30)       NOT NULL,        -- SĐT liên hệ
        line1          NVARCHAR(200)     NOT NULL,        -- số nhà, tên đường
        line2          NVARCHAR(200)     NULL,            -- toà nhà, ghi chú (tuỳ chọn)
        ward           NVARCHAR(120)     NULL,            -- phường/xã
        district       NVARCHAR(120)     NULL,            -- quận/huyện
        city           NVARCHAR(120)     NOT NULL,        -- tỉnh/thành phố
        postal_code    VARCHAR(20)       NULL,            -- mã bưu chính (tuỳ chọn)
        country        VARCHAR(8)        NOT NULL CONSTRAINT DF_delivery_addresses_country    DEFAULT 'VN',
        is_default     BIT               NOT NULL CONSTRAINT DF_delivery_addresses_is_default  DEFAULT 0,
        created_at     DATETIME2         NOT NULL CONSTRAINT DF_delivery_addresses_created_at  DEFAULT SYSUTCDATETIME(),
        updated_at     DATETIME2         NOT NULL CONSTRAINT DF_delivery_addresses_updated_at  DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_delivery_addresses      PRIMARY KEY (id),
        CONSTRAINT FK_delivery_addresses_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
    );
END
GO
/* Index tra cứu theo user. */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_delivery_addresses_user_id'
      AND object_id = OBJECT_ID('dbo.delivery_addresses')
)
    CREATE INDEX IX_delivery_addresses_user_id ON dbo.delivery_addresses(user_id);
GO
/* Chỉ 1 địa chỉ is_default=1 cho mỗi user (filtered unique index). */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_delivery_addresses_default'
      AND object_id = OBJECT_ID('dbo.delivery_addresses')
)
    CREATE UNIQUE INDEX UX_delivery_addresses_default
        ON dbo.delivery_addresses(user_id)
        WHERE is_default = 1;
GO
PRINT 'Migration 006: delivery_addresses OK';
GO
