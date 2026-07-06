/* =====================================================================
   GucciShopDB — Schema (Phase 1)
   5 bảng: categories, products, users, orders, order_items
   - Mọi cột chứa tiếng Việt dùng NVARCHAR (Unicode) để không lỗi dấu.
   - Chạy lại an toàn: DROP theo đúng thứ tự khóa ngoại (con trước, cha sau).
   ===================================================================== */

/* ---- DROP (thứ tự: order_items -> orders -> users, products -> categories) ---- */
IF OBJECT_ID('dbo.order_items', 'U') IS NOT NULL DROP TABLE dbo.order_items;
IF OBJECT_ID('dbo.orders',      'U') IS NOT NULL DROP TABLE dbo.orders;
IF OBJECT_ID('dbo.products',    'U') IS NOT NULL DROP TABLE dbo.products;
IF OBJECT_ID('dbo.users',       'U') IS NOT NULL DROP TABLE dbo.users;
IF OBJECT_ID('dbo.categories',  'U') IS NOT NULL DROP TABLE dbo.categories;
GO

/* ---- categories ---- */
CREATE TABLE dbo.categories (
    id          INT IDENTITY(1,1) NOT NULL,
    slug        VARCHAR(120)      NOT NULL,   -- ascii, khớp tên file HTML (ao-nam, handbags, ...)
    name_vi     NVARCHAR(150)     NOT NULL,
    name_en     NVARCHAR(150)     NULL,
    parent_id   INT               NULL,
    created_at  DATETIME2         NOT NULL CONSTRAINT DF_categories_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_categories       PRIMARY KEY (id),
    CONSTRAINT UQ_categories_slug  UNIQUE (slug),
    CONSTRAINT FK_categories_parent FOREIGN KEY (parent_id) REFERENCES dbo.categories(id)
);
GO

/* ---- products ---- */
CREATE TABLE dbo.products (
    id              INT IDENTITY(1,1) NOT NULL,
    slug            VARCHAR(160)      NOT NULL,
    name_vi         NVARCHAR(200)     NOT NULL,
    name_en         NVARCHAR(200)     NULL,
    description_vi  NVARCHAR(MAX)     NULL,
    description_en  NVARCHAR(MAX)     NULL,
    price           INT               NOT NULL,          -- VND
    sale_price      INT               NULL,              -- VND, NULL = không giảm giá
    currency        CHAR(3)           NOT NULL CONSTRAINT DF_products_currency DEFAULT 'VND',
    images          NVARCHAR(MAX)     NULL,              -- JSON mảng đường dẫn ảnh, vd ["img/gc40.png"]
    category_id     INT               NOT NULL,
    stock           INT               NOT NULL CONSTRAINT DF_products_stock DEFAULT 0,
    is_active       BIT               NOT NULL CONSTRAINT DF_products_is_active DEFAULT 1,
    created_at      DATETIME2         NOT NULL CONSTRAINT DF_products_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2         NOT NULL CONSTRAINT DF_products_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_products          PRIMARY KEY (id),
    CONSTRAINT UQ_products_slug     UNIQUE (slug),
    CONSTRAINT FK_products_category FOREIGN KEY (category_id) REFERENCES dbo.categories(id),
    CONSTRAINT CK_products_price      CHECK (price >= 0),
    CONSTRAINT CK_products_sale_price CHECK (sale_price IS NULL OR sale_price >= 0)
);
GO
CREATE INDEX IX_products_category_id ON dbo.products(category_id);
GO

/* ---- users (Firebase quản lý credential; KHÔNG seed) ---- */
CREATE TABLE dbo.users (
    id            INT IDENTITY(1,1) NOT NULL,
    firebase_uid  VARCHAR(128)      NOT NULL,   -- uid từ Firebase Auth
    email         VARCHAR(255)      NULL,
    display_name  NVARCHAR(150)     NULL,
    role          VARCHAR(20)       NOT NULL CONSTRAINT DF_users_role DEFAULT 'customer', -- 'customer' | 'admin'
    created_at    DATETIME2         NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSUTCDATETIME(),
    last_login    DATETIME2         NULL,
    CONSTRAINT PK_users            PRIMARY KEY (id),
    CONSTRAINT UQ_users_firebase_uid UNIQUE (firebase_uid)
);
GO

/* ---- orders ---- */
CREATE TABLE dbo.orders (
    id                INT IDENTITY(1,1) NOT NULL,
    user_id           INT               NOT NULL,
    status            VARCHAR(20)       NOT NULL CONSTRAINT DF_orders_status DEFAULT 'pending', -- pending|paid|shipped|cancelled
    total_amount      DECIMAL(12,2)     NOT NULL,
    currency          CHAR(3)           NOT NULL CONSTRAINT DF_orders_currency DEFAULT 'VND',
    shipping_name     NVARCHAR(150)     NULL,
    shipping_phone    VARCHAR(30)       NULL,
    shipping_address  NVARCHAR(400)     NULL,
    created_at        DATETIME2         NOT NULL CONSTRAINT DF_orders_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_orders       PRIMARY KEY (id),
    CONSTRAINT FK_orders_user  FOREIGN KEY (user_id) REFERENCES dbo.users(id)
);
GO

/* ---- order_items (snapshot tên + giá lúc mua) ---- */
CREATE TABLE dbo.order_items (
    id            INT IDENTITY(1,1) NOT NULL,
    order_id      INT               NOT NULL,
    product_id    INT               NOT NULL,
    product_name  NVARCHAR(200)     NOT NULL,   -- snapshot tên
    unit_price    DECIMAL(12,2)     NOT NULL,   -- snapshot giá
    quantity      INT               NOT NULL,
    line_total    DECIMAL(12,2)     NOT NULL,
    CONSTRAINT PK_order_items          PRIMARY KEY (id),
    CONSTRAINT FK_order_items_order    FOREIGN KEY (order_id)   REFERENCES dbo.orders(id) ON DELETE CASCADE,
    CONSTRAINT FK_order_items_product  FOREIGN KEY (product_id) REFERENCES dbo.products(id),
    CONSTRAINT CK_order_items_quantity CHECK (quantity > 0)
);
GO
