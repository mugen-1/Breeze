# Gucci Shop — Backend Roadmap

Chuyển từ website tĩnh (HTML/CSS/JS thuần + Firebase Auth + giỏ hàng localStorage)
sang kiến trúc **client / server** với backend Node.js + Express + SQL Server.
Firebase Auth **giữ nguyên ở phía client**; backend chỉ **verify Firebase ID token**
qua Firebase Admin SDK.

```
quanlynhasach/
├─ client/          # Frontend tĩnh hiện tại (HTML/CSS/JS/img) — không đổi cấu trúc nội bộ
├─ server/          # Backend Express + SQL Server (đang xây)
└─ ROADMAP.md
```

## Trạng thái hiện tại (Phase 0 — DONE)

- [x] Tách `client/` (frontend) và `server/` (backend).
- [x] Khởi tạo `server/`: express, mssql, cors, dotenv, firebase-admin.
- [x] `server.js` chạy port 3000, route `GET /api/health` kiểm tra kết nối **thật** tới SQL Server.
- [x] `.env` (bí mật, đã gitignore) + `.env.example` (không chứa password).

---

## Phase 1 — Database & Data Seeding ✅ DONE
- [x] Tạo 5 bảng trong `GucciShopDB` bằng `server/db/schema.sql` (DROP an toàn theo thứ tự khóa ngoại).
- [x] Seed 9 `categories` (slug khớp tên file HTML) + **89 `products`** phong cách GUCCI (VI + EN) bằng `server/db/seed.sql`, idempotent (DELETE + RESEED).
- [x] Ảnh dùng lại từ `client/img` — chỉ những file **thực sự tồn tại** (`gc*`, `anh*`, `gucc1/gucci`); đã cross-check 100% không có ảnh chết.
- [x] Runner `server/db/run-sql.js` (tách batch theo `GO`) + verify `server/db/verify.js` (đếm sản phẩm/category).
- [ ] (Chuyển sang Phase 2) Layer truy vấn dùng parameterized query (chống SQL injection).

> **Ghi chú altitude:** tên cột thực tế dùng `name_vi/name_en`, `description_vi/description_en`,
> `price INT` (VND), `sale_price INT NULL`, `images NVARCHAR(MAX)` (JSON mảng đường dẫn ảnh) —
> xem schema chuẩn bên dưới.

## Phase 2 — Public Product API (read-only)
- `GET /api/categories` — danh sách danh mục.
- `GET /api/products` — hỗ trợ filter (category, giá, tìm kiếm), phân trang, sắp xếp.
- `GET /api/products/:slug` — chi tiết 1 sản phẩm.
- Frontend `client/js/*` gọi API thay cho dữ liệu hard-code (thay dần, giữ i18n VI/EN).

## Phase 3 — Firebase Auth Integration (backend verify)
- Khởi tạo Firebase Admin SDK từ service account (`FIREBASE_SERVICE_ACCOUNT`).
- Middleware `verifyFirebaseToken`: đọc `Authorization: Bearer <idToken>`, verify, gắn `req.user`.
- Đồng bộ user vào bảng `users` (upsert theo `firebase_uid`) khi đăng nhập lần đầu.
- `GET /api/me` — trả thông tin user hiện tại.

## Phase 4 — Cart & Orders (checkout)
- Chuyển giỏ hàng từ localStorage sang server (hoặc đồng bộ hai chiều) cho user đã đăng nhập.
- `POST /api/orders` — tạo đơn từ giỏ (transaction: ghi `orders` + `order_items`, snapshot giá).
- `GET /api/orders` / `GET /api/orders/:id` — lịch sử & chi tiết đơn của user (bảo vệ bằng token).
- Tính tổng tiền phía server (không tin giá từ client).

## Phase 5 — Admin, Hardening & Deploy
- Vai trò admin (custom claim Firebase): CRUD sản phẩm/danh mục, xem đơn hàng.
- Validation (zod/joi), rate limiting, helmet, CORS whitelist, log & error handling tập trung.
- Cấu hình production (HTTPS, biến môi trường trên host), build/serve `client/` qua Express hoặc CDN.
- Test (unit + integration) và tài liệu API.

---

## Schema DB dự kiến (SQL Server)

> Kiểu dữ liệu SQL Server. Giá tiền VND lưu bằng `INT`. Khóa chính dùng `INT IDENTITY`.
> Cột i18n dùng hậu tố `_vi` / `_en`. Mọi cột chữ tiếng Việt dùng `NVARCHAR` (Unicode).
> **Đây là schema thực tế đã tạo ở Phase 1** (`server/db/schema.sql`).

### `categories`
| Cột          | Kiểu                 | Ràng buộc                          |
|--------------|----------------------|------------------------------------|
| id           | INT IDENTITY         | PK                                 |
| slug         | VARCHAR(120)         | UNIQUE, NOT NULL                   |
| name_vi      | NVARCHAR(150)        | NOT NULL (tên VI)                  |
| name_en      | NVARCHAR(150)        | NULL (tên EN)                      |
| parent_id    | INT                  | NULL, FK -> categories(id)         |
| created_at   | DATETIME2            | DEFAULT SYSUTCDATETIME()           |

### `products`
| Cột            | Kiểu               | Ràng buộc                          |
|----------------|--------------------|------------------------------------|
| id             | INT IDENTITY       | PK                                 |
| slug           | VARCHAR(160)       | UNIQUE, NOT NULL                   |
| name_vi        | NVARCHAR(200)      | NOT NULL (tên VI)                  |
| name_en        | NVARCHAR(200)      | NULL (tên EN)                      |
| description_vi | NVARCHAR(MAX)      | NULL (mô tả VI)                    |
| description_en | NVARCHAR(MAX)      | NULL (mô tả EN)                    |
| price          | INT                | NOT NULL, CHECK >= 0 (VND)         |
| sale_price     | INT                | NULL, CHECK >= 0 (giá giảm, VND)   |
| currency       | CHAR(3)            | DEFAULT 'VND'                      |
| images         | NVARCHAR(MAX)      | NULL — JSON mảng, vd `["img/gc5.png"]` |
| category_id    | INT                | NOT NULL, FK -> categories(id)     |
| stock          | INT                | NOT NULL, DEFAULT 0                |
| is_active      | BIT                | NOT NULL, DEFAULT 1                |
| created_at     | DATETIME2          | DEFAULT SYSUTCDATETIME()           |
| updated_at     | DATETIME2          | DEFAULT SYSUTCDATETIME()           |

### `users`
| Cột          | Kiểu                 | Ràng buộc                          |
|--------------|----------------------|------------------------------------|
| id           | INT IDENTITY         | PK                                 |
| firebase_uid | VARCHAR(128)         | UNIQUE, NOT NULL (từ Firebase Auth)|
| email        | VARCHAR(255)         | NULL                               |
| display_name | NVARCHAR(150)        | NULL                               |
| role         | VARCHAR(20)          | DEFAULT 'customer' ('customer'/'admin') |
| created_at   | DATETIME2            | DEFAULT SYSUTCDATETIME()           |
| last_login   | DATETIME2            | NULL                               |

> Mật khẩu **không** lưu ở DB — Firebase Auth quản lý credential; backend chỉ verify token.

### `orders`
| Cột            | Kiểu               | Ràng buộc                          |
|----------------|--------------------|------------------------------------|
| id             | INT IDENTITY       | PK                                 |
| user_id        | INT                | FK -> users(id), NOT NULL          |
| status         | VARCHAR(20)        | DEFAULT 'pending' ('pending'/'paid'/'shipped'/'cancelled') |
| total_amount   | DECIMAL(12,2)      | NOT NULL (tính ở server)           |
| currency       | CHAR(3)            | DEFAULT 'VND'                      |
| shipping_name  | NVARCHAR(150)      | NULL                               |
| shipping_phone | VARCHAR(30)        | NULL                               |
| shipping_address | NVARCHAR(400)    | NULL                               |
| created_at     | DATETIME2          | DEFAULT SYSUTCDATETIME()           |

### `order_items`
| Cột          | Kiểu                 | Ràng buộc                          |
|--------------|----------------------|------------------------------------|
| id           | INT IDENTITY         | PK                                 |
| order_id     | INT                  | FK -> orders(id) ON DELETE CASCADE |
| product_id   | INT                  | FK -> products(id)                 |
| product_name | NVARCHAR(200)        | NOT NULL (snapshot tên lúc mua)    |
| unit_price   | DECIMAL(12,2)        | NOT NULL (snapshot giá lúc mua)    |
| quantity     | INT                  | NOT NULL, CHECK (quantity > 0)     |
| line_total   | DECIMAL(12,2)        | NOT NULL (unit_price * quantity)   |

**Quan hệ tóm tắt:**
`categories 1—n products`, `users 1—n orders`, `orders 1—n order_items`,
`products 1—n order_items`. Đơn hàng **snapshot** tên + giá sản phẩm để lịch sử
không đổi khi giá/tên sản phẩm thay đổi về sau.
