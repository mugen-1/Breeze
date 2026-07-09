# Gucci Shop — Backend Roadmap

Chuyển từ website tĩnh (HTML/CSS/JS thuần + Firebase Auth + giỏ hàng localStorage)
sang kiến trúc **client / server** với backend Node.js + Express + SQL Server.
Firebase Auth **giữ nguyên ở phía client**; backend chỉ **verify Firebase ID token**
qua Firebase Admin SDK.

```
HOG/
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

## Phase 2 — Public Product API (read-only) ✅ DONE
- [x] `GET /api/categories` — 9 danh mục (id, slug, name_vi, name_en).
- [x] `GET /api/products` — lọc `?category=`, `?min=&max=` (giá thực = sale_price nếu có), `?sort=newest|price_asc|price_desc`.
- [x] `GET /api/products/:id` — chi tiết 1 sản phẩm (images parse JSON → mảng). Lỗi rõ ràng: 400/404/500 + log.
- [x] Code tách `server/routes/products.js`, `server/routes/categories.js`; parameterized query; server phục vụ tĩnh `client/`.
- [x] 9 trang category bỏ hard-code, render động qua `client/js/products-render.js` (đúng markup cũ, giữ CSS). Slug đọc từ `<body data-category>`.
- [x] `client/js/api-config.js` — biến `API_BASE` 1 chỗ. Filter/sort nối vào API. i18n VI/EN đổi tên sản phẩm khi `langchange`.
- [x] Verified: 15/15 check headless (Playwright) + API curl (render, ảnh, sort, filter, đổi ngôn ngữ, 400/404).
- Ghi chú: sidebar bị `display:none` trong sale.css → bộ lọc thực tế là drawer "Lọc & Sắp Xếp" (đã nối vào API).

## Phase 3 — Firebase Auth Integration (backend verify) ✅ DONE
- [x] `server/firebase.js` — init Firebase Admin SDK (API modular v14: `firebase-admin/app` + `/auth`), lazy + idempotent, đọc `FIREBASE_SERVICE_ACCOUNT` từ `.env`.
- [x] `server/middleware/auth.js` — `verifyFirebaseToken`: đọc `Authorization: Bearer <idToken>`, verify, gắn `req.user` + `req.firebaseToken`.
- [x] Upsert user vào `dbo.users` (MERGE theo `firebase_uid`, cập nhật `last_login`) — lần đầu insert, lần sau update, không nhân đôi.
- [x] `GET /api/me` (`server/routes/me.js`) — trả `id, firebase_uid, email, display_name, role, created_at, last_login`.
- [x] Verified 9/9 (E2E custom token → ID token → /api/me → DB) + 401 khi thiếu/sai token.
- Ghi chú: service account JSON để ngoài Git (`.gitignore`). Client gửi token (`getIdToken()`) sẽ nối ở phase sau.

## Phase 4 — Cart & Orders (checkout) ✅ DONE
- [x] Bảng `dbo.cart_items` (`server/db/migrations/001_cart_items.sql`, idempotent, `UNIQUE(user_id, product_id)`).
- [x] Cart API (bảo vệ token) — `server/routes/cart.js`:
  - `GET /api/cart` join products lấy tên/giá/ảnh MỚI NHẤT (không lưu giá ở giỏ).
  - `POST /api/cart` upsert `{product_id, quantity, mode}` — `set` ghi đè / `add` cộng dồn (MERGE).
  - `DELETE /api/cart/:productId`.
- [x] Orders API (bảo vệ token) — `server/routes/orders.js`:
  - `POST /api/orders` trong **TRANSACTION**: khoá kho (`UPDLOCK`), kiểm tra tồn kho, tạo `orders` +
    `order_items` (SNAPSHOT tên + giá), trừ stock (UPDATE có điều kiện chống race), xoá giỏ. Thiếu
    hàng → **409 + rollback** (không đơn treo, không mất kho). Tổng tiền tính ở server.
  - `GET /api/orders` (kèm items) và `GET /api/orders/:id` (chỉ chủ đơn; đơn người khác → 404).
- [x] Frontend `client/js/auth-helper.js` — `AuthHelper` (getToken/isLoggedIn/onChange/apiFetch gắn Bearer),
  phát sự kiện `authchange`. Nạp Firebase + auth-helper trên 9 trang danh mục + `cart.html` + `orders.html`.
- [x] `client/js/cart.js` viết lại: khách → localStorage như cũ; đăng nhập → thao tác qua API. Khi đăng
  nhập mà còn giỏ localStorage → **merge lên server 1 lần** rồi xoá. Giữ nguyên API đồng bộ (getCart…),
  phát `cartchange` để view render lại.
- [x] `cart.html` — nút Thanh Toán gọi `POST /api/orders`, hiện mã đơn / lỗi stock; chưa login → yêu cầu
  đăng nhập. Trang mới `orders.html` (GET /api/orders) — i18n VI/EN đầy đủ.
- [x] Verified: **26/26** backend (mint Firebase ID token thật) + **17/17** browser E2E (Playwright:
  khách→login→merge→thêm→checkout→stock giảm→giỏ xoá→trang đơn), gồm case thiếu stock rollback. 0 lỗi JS.
- Ghi chú: `product_id` seed từ **0** nên validate cho phép id ≥ 0. `product.html` (dữ liệu tĩnh cũ) chưa
  gắn server-cart — luồng thêm giỏ chuẩn đi qua trang danh mục (card có `data-id`).

## Phase 5 — Admin, Hardening & Deploy ✅ DONE
- [x] Vai trò admin: CRUD sản phẩm/danh mục, xem đơn hàng (`client/admin.html` + `server/routes/admin.js`).
- [x] Phân quyền role-based qua `server/middleware/requireAdmin.js` (guest → 401, customer → 403, admin → 200) + auto-admin theo `ADMIN_EMAILS` khi đăng nhập (`server/middleware/auth.js`).
- [x] Hardening: helmet + CORS whitelist + rate limit + body limit + error handler tập trung (`server/middleware/security.js` + `server/server.js`).
- [x] CHECK constraint cho `orders.status` (`server/db/migrations/002_orders_status_check.sql`).
- [ ] Cấu hình production (HTTPS, biến môi trường trên host), build/serve `client/` qua Express hoặc CDN.
- [ ] Test (unit + integration) và tài liệu API.

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

### `cart_items` (Phase 4 — `server/db/migrations/001_cart_items.sql`)
| Cột          | Kiểu                 | Ràng buộc                              |
|--------------|----------------------|----------------------------------------|
| id           | INT IDENTITY         | PK                                     |
| user_id      | INT                  | NOT NULL, FK -> users(id)              |
| product_id   | INT                  | NOT NULL, FK -> products(id)           |
| quantity     | INT                  | NOT NULL, CHECK (quantity > 0)         |
| created_at   | DATETIME2            | DEFAULT SYSUTCDATETIME()               |
| updated_at   | DATETIME2            | DEFAULT SYSUTCDATETIME()               |
| —            | UNIQUE(user_id, product_id) | mỗi user 1 dòng / 1 sản phẩm (upsert) |

> Giỏ hàng **không** snapshot giá — luôn đọc giá mới từ `products`. Snapshot chỉ xảy ra khi đặt đơn.

**Quan hệ tóm tắt:**
`categories 1—n products`, `users 1—n orders`, `orders 1—n order_items`,
`products 1—n order_items`, `users 1—n cart_items`, `products 1—n cart_items`.
Đơn hàng **snapshot** tên + giá sản phẩm để lịch sử không đổi khi giá/tên sản phẩm thay đổi về sau.
