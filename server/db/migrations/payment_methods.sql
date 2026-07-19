/* =====================================================================
   Migration 007 — bảng phương thức thanh toán (payment_methods)
   - FK user_id -> users(id) (giống delivery_addresses; KHÔNG dùng firebase_uid).
   - BẢO MẬT: CHỈ lưu brand + last4 + holder_name + exp_month/exp_year.
     TUYỆT ĐỐI KHÔNG có cột chứa full số thẻ (PAN) hoặc CVV.
   - Idempotent: chỉ tạo khi CHƯA có (chạy lại nhiều lần an toàn).
   - "Chỉ 1 thẻ mặc định / user" bằng filtered unique index UX_payment_methods_default.
   ===================================================================== */
IF OBJECT_ID('dbo.payment_methods', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.payment_methods (
        id           INT IDENTITY(1,1) NOT NULL,
        user_id      INT               NOT NULL,
        brand        VARCHAR(20)       NOT NULL,   -- 'visa' | 'mastercard' | 'jcb' | 'amex' | 'other'
        last4        CHAR(4)           NOT NULL,   -- 4 số cuối (KHÔNG lưu full PAN)
        holder_name  NVARCHAR(150)     NOT NULL,   -- tên chủ thẻ (Unicode)
        exp_month    TINYINT           NOT NULL,   -- 1..12
        exp_year     SMALLINT          NOT NULL,   -- ví dụ 2027
        is_default   BIT               NOT NULL CONSTRAINT DF_payment_methods_is_default DEFAULT 0,
        created_at   DATETIME2         NOT NULL CONSTRAINT DF_payment_methods_created_at DEFAULT SYSUTCDATETIME(),
        updated_at   DATETIME2         NOT NULL CONSTRAINT DF_payment_methods_updated_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_payment_methods           PRIMARY KEY (id),
        CONSTRAINT FK_payment_methods_user      FOREIGN KEY (user_id) REFERENCES dbo.users(id),
        CONSTRAINT CK_payment_methods_exp_month CHECK (exp_month BETWEEN 1 AND 12)
    );
END
GO
/* Index tra cứu theo user. */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_payment_methods_user_id'
      AND object_id = OBJECT_ID('dbo.payment_methods')
)
    CREATE INDEX IX_payment_methods_user_id ON dbo.payment_methods(user_id);
GO
/* Chỉ 1 thẻ is_default=1 cho mỗi user (filtered unique index). */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_payment_methods_default'
      AND object_id = OBJECT_ID('dbo.payment_methods')
)
    CREATE UNIQUE INDEX UX_payment_methods_default
        ON dbo.payment_methods(user_id)
        WHERE is_default = 1;
GO
PRINT 'Migration 007: payment_methods OK';
GO
