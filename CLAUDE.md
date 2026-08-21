# BREEZE — Quy ước codebase

Web bán hàng thời trang. Node.js/Express + SQL Server + Firebase Auth; frontend
HTML/CSS/JS thuần, không build step.

`client/` — 21 trang `.html` tĩnh + `client/js/` + `client/css/`
`server/` — Express API

Tài liệu đợt dọn dẹp trước khi migrate EJS: xem [CLEANUP.md](CLEANUP.md).

---

## Thứ tự nạp `<script>` — CHUẨN, áp cho mọi trang

Đặt tất cả ở **cuối `<body>`**, theo đúng thứ tự này:

| # | Nhóm | File |
|---|---|---|
| 1 | Vendor ngoài | Firebase SDK (app, auth), Chart.js (chỉ admin) |
| 2 | Cấu hình | `firebase-config.js`, `api-config.js`, `routes.js` |
| 3 | Hạ tầng | `auth-helper.js`, `theme.js`, `i18n.js` |
| 4 | Utils dùng chung | `utils-format.js`, `utils-i18n.js` |
| 5 | UI dùng chung | `account-menu.js`, `cart.js`, `cart-drawer.js`, `drawer-menu.js`, `reveal.js` |
| 6 | Riêng trang | `auth`, `filter`, `products-render`, `checkout`, `voucher`, `payment-methods`, `admin`, `page-*` |

### 3 ràng buộc CỨNG (sai là vỡ, có lỗi console)

1. Firebase SDK **trước** `firebase-config.js`
2. `firebase-config.js` **trước** `auth.js` — `auth.js` dùng biến `auth` ngay lúc parse
3. `utils-i18n.js` **trước** `page-search.js` — gọi `t()` ngay lúc parse

### 7 file đọc DOM ngay lúc parse → phải đứng SAU markup

`page-profile`, `page-product`, `voucher`, `drawer-menu`, `page-index-slider`,
`page-search`, `account-menu`. Vì `account-menu` và `drawer-menu` dùng chung ở 18–19
trang, **partial chứa chúng bắt buộc nằm cuối `<body>`**.

### Ngoại lệ đã ghi nhận

`page-index-slider.js` giữ nguyên **giữa trang**, ngay sau markup hero. Lý do:
`.hero .mySlides` mặc định `opacity:0; visibility:hidden`, chỉ JS gắn `.is-active` mới
hiện — dời xuống cuối thì hero trắng trơn tới khi Firebase SDK + `i18n.js` (95KB) nạp xong.

---

## Thứ tự nạp CSS — CHUẨN

| # | Nhóm | File |
|---|---|---|
| 1 | Design token | `tokens.css` |
| 2 | Vendor | Font Awesome, Google Fonts |
| 3 | Base | `global.css` **hoặc** `sale.css` |
| 4 | Riêng trang | `admin`, `auth`, `checkout`, `chinhsach-doitra`, `index-slide`, `profile` |

**Ràng buộc thật duy nhất (đã đo):** `global.css` phải trước `admin.css`. Đảo thứ tự thì
trang quản trị lộn sang nền tối dù đang chế độ sáng.

**Ngoại lệ:** `invoice.html` cố ý **không** nạp `global.css` — rule `section{padding-block}`
của nó làm hỏng bản in. Lý do ghi ngay trong file.

---

## Module dùng chung

| File | Cung cấp | Ghi chú |
|---|---|---|
| `js/routes.js` | `BreezeRoutes.{PATHS, to, product, keyOf, currentPageKey, is}` | **Nơi DUY NHẤT biết đuôi `.html`** |
| `js/utils-format.js` | `money(n)`, `esc(s)` | `money` ra ký hiệu `₫` (U+20AB) |
| `js/utils-i18n.js` | `t(key, params)` | An toàn khi `i18n.js` chưa nạp |
| `js/theme.js` | `window.BreezeTheme.{get, set}` | Không tự set theme lúc load |
| `js/auth-helper.js` | `window.AuthHelper.{isLoggedIn, onChange, apiFetch}` | Phát sự kiện `authchange` |

### Quy tắc đường dẫn

**Không bao giờ gõ `'cart.html'` trong JS.** Dùng:

```js
BreezeRoutes.to('cart')                              // -> 'cart.html'
BreezeRoutes.to('login', { redirect: 'checkout' })   // -> 'login.html?redirect=checkout'
BreezeRoutes.product(5)                              // -> 'product.html?id=5'
BreezeRoutes.currentPageKey()                        // '/cart.html' VÀ '/cart' -> 'cart'
```

Khoá trang = tên file bỏ đuôi. Có test chặn hồi quy: không file nào ngoài `routes.js`
được dùng tên file `.html` làm khoá object hay vế so sánh.

---

## Khi thêm một trang mới

1. Copy `<head>` từ một trang cùng loại — **giữ nguyên snippet chống FOUC inline**
2. Đặt `<body class="…" data-i18n-doctitle="title.xxx">`; trang danh mục thêm `data-category="<slug>"`
3. Nạp CSS theo thứ tự chuẩn ở trên
4. Nạp script theo thứ tự chuẩn; script riêng của trang đặt tên `page-<tên>.js`
5. Thêm đường dẫn vào `PATHS` trong `js/routes.js`
6. Thêm khoá dịch vào `js/i18n.js` (từ điển phẳng, tiền tố theo trang)
7. Viết test trong `client/js/__tests__/` nếu trang có JS riêng

---

## Test

```bash
node client/js/__tests__/run-all.js
```

Không cần cài gì thêm. **12 file / 315 assertion.** Chi tiết và giới hạn:
`client/js/__tests__/README.md`.

DOM giả **không** kiểm được giao diện, dark mode, việc in, hay thứ tự thực thi thật giữa
các thẻ `<script>` — những thứ đó phải mở trình duyệt.

---

## Việc còn nợ

Xem mục "Việc còn nợ" trong [CLEANUP.md](CLEANUP.md): **N-1** (hoá đơn hiện `−0₫`),
**S-1** (`to()` cho qua khoá lạ), **H-1** (hiệu ứng hover chỉ chạy 1/6 trang danh mục).
