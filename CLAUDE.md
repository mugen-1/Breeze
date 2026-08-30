# BREEZE — Quy ước codebase

Web bán hàng thời trang. Node.js/Express + SQL Server + Firebase Auth; frontend
HTML/CSS/JS thuần, không build step.

18/21 trang render bằng **EJS master layout**; 3 trang còn lại vẫn là `.html` tĩnh.
18 file `.html` cũ **đã xoá** — sửa 18 trang đó nghĩa là sửa `server/views/`.

`client/js/`, `client/css/` — frontend, không đổi gì trong đợt migrate
`client/*.html` — CHỈ còn `invoice`, `admin`, `checkout` (cố ý không migrate)
`server/views/` — layout + partial + view từng trang
`server/lib/pages-config.js` — bảng `PAGES`: mỗi trang là một mục tham số
`server/routes/pages.js` — đăng ký route từ bảng đó, TRƯỚC `express.static`

Tài liệu đợt dọn dẹp trước khi migrate EJS: xem [CLEANUP.md](CLEANUP.md).
Checklist test tay sau migrate: [CHECKLIST-EJS.md](CHECKLIST-EJS.md).
Checklist test tay cho modal đổi mật khẩu: [CHECKLIST-CHANGE-PASSWORD.md](CHECKLIST-CHANGE-PASSWORD.md).

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

## EJS master layout

**URL giữ nguyên đuôi `.html`.** Route EJS đăng ký **trước** `express.static` nên nó
thắng; 336 link tĩnh trong markup không phải sửa, `PATHS` không phải đổi.

```
server/views/
  layouts/main.ejs          <- include 6 khối theo đúng thứ tự, KHÔNG được đảo
  partials/head.ejs         <- <head> + thẻ <body> mở
  partials/header.ejs       <- 3 biến thể: policy | home | none
  partials/drawer-menu.ejs  <- giống hệt trên 18 trang, không tham số
  partials/footer.ejs       <- giống hệt trên 18 trang, không tham số
  partials/scripts.ejs      <- nhóm 1–5 + pageJs cho nhóm 6, LUÔN cuối <body>
  partials/*-style.ejs      <- 4 khối <style> inline giữ nguyên (product/search/orders/cart)
  pages/                    <- 13 view; riêng category.ejs dùng chung cho 6 trang danh mục
server/lib/pages-config.js  <- bảng PAGES (dữ liệu thuần, test require được)
server/lib/client-routes.js <- nạp ngược PATHS từ client/js/routes.js bằng vm
server/tools/               <- domdiff · pagecheck · regression · verify-all
```

`client-routes.js` đọc `client/js/routes.js` trong sandbox `vm` thay vì chép lại bảng.
Giữ đúng lời chốt "`routes.js` là nơi DUY NHẤT biết đuôi `.html`" — đổi route chỉ sửa
một chỗ. Sửa `routes.js` thì phải khởi động lại server.

### Tham số của layout

| Tham số | Mặc định | Dùng để |
|---|---|---|
| `view` | — | tên file trong `pages/` |
| `title` | `'BREEZE'` | `<title>` |
| `i18nTitle` | `''` | `data-i18n-doctitle` trên `<body>` |
| `bodyClass` | `''` | class của `<body>` |
| `bodyData` | `{}` | `{category:'x'}` → `data-category="x"` |
| `baseCss` | `'global.css'` | `'sale.css'` cho 6 trang danh mục + product |
| `pageCss` | `[]` | CSS riêng trang, nạp sau base |
| `headExtra` | `null` | partial nạp thêm cuối `<head>` (khối `<style>` inline) |
| `headVariant` | `'standard'` | `'fragment'` cho 7 trang không có doctype |
| `headerVariant` | `'policy'` | `'home'` cho index, `'none'` nếu trang tự dựng |
| `showSearchBox` | `false` | **chỉ `search` truyền `true`** |
| `useUtilsI18n` | `false` | bật `utils-i18n.js` (7 trang cần) |
| `pageJs` | `[]` | script nhóm 6 |
| `closeHtml` | `true` | `false` cho biến thể fragment |

### Ba chỗ dễ vấp khi sửa view

1. **Đừng viết cú pháp thẻ EJS nguyên văn trong khối chú thích** — bộ quét EJS không
   phân biệt chú thích, gặp dấu đóng là cắt khối ngay tại đó.
2. **Trong chú thích JS, đừng viết `data-` rồi dấu sao rồi `/`** — nó đóng chú thích sớm.
3. **Đừng escape sẵn HTML entity trong tham số**: `<%= %>` tự escape, truyền
   `'Giày &amp; Dép'` sẽ ra `&amp;amp;`. Truyền `'Giày & Dép'`.

---

## Khi thêm một trang mới

1. Thêm đường dẫn vào `PATHS` trong `client/js/routes.js` — **bước này trước tiên**,
   `routes/pages.js` ném lỗi lúc boot nếu khoá không có ở đó
2. Tạo `server/views/pages/<tên>.ejs` — **chỉ phần thân riêng**, không header/footer/script
3. Thêm một mục vào bảng `PAGES` trong `server/lib/pages-config.js` (xem bảng tham số ở trên)
4. Thêm khoá dịch vào `client/js/i18n.js` — **cả VI lẫn EN**, `regression.js` báo đỏ nếu
   thiếu một bên
5. Script riêng trang đặt tên `page-<tên>.js`, khai qua `pageJs` (tự vào nhóm 6, cuối `<body>`)
6. Viết test trong `client/js/__tests__/` nếu trang có JS riêng
7. Chạy `node server/tools/regression.js`

Không phải copy `<head>`, không phải nhớ thứ tự CSS/script, không phải dán lại drawer và
footer — layout lo hết. Snippet chống FOUC nằm trong `partials/head.ejs`.

---

## Test

```bash
node client/js/__tests__/run-all.js   # 14 file / 437 assertion
node server/tools/regression.js       # 12 hạng mục toàn site (cần server đang chạy)
node server/tools/verify-all.js       # so DOM 18 trang, bản gốc lấy từ git 21ca387
node server/tools/domdiff.js --selftest   # negative control
```

`client/js/__tests__/` không cần cài gì thêm; chi tiết và giới hạn ở
`client/js/__tests__/README.md`.

`server/tools/domdiff.js` so **chuỗi token DOM** (thẻ + attribute đã sắp xếp + text đã
gom khoảng trắng), không so ảnh: máy này không có headless browser, mà token trùng +
CSS/JS không đổi thì pixel bằng nhau theo định nghĩa — và tất định, khác với ảnh chụp
`index.html` (slider chạy animation nên chụp lúc nào cũng lệch).

**Luôn chạy `--selftest` trước khi tin một kết quả "0 khác biệt".** Nó cố tình phá 5
kiểu (đổi class, mất `data-`, đảo thứ tự thẻ, đổi chữ, mất `aria-`) và phải bắt được cả 5.

DOM giả **không** kiểm được giao diện, dark mode, việc in, thứ tự tab thật, focus trap
thật, hay thứ tự thực thi thật giữa các thẻ `<script>` — những thứ đó phải mở trình
duyệt: xem [CHECKLIST-EJS.md](CHECKLIST-EJS.md) và
[CHECKLIST-CHANGE-PASSWORD.md](CHECKLIST-CHANGE-PASSWORD.md).

---

## Việc còn nợ

Xem mục "Việc còn nợ" trong [CLEANUP.md](CLEANUP.md): **N-1** (hoá đơn hiện `−0₫`),
**S-1** (`to()` cho qua khoá lạ), **H-1** (hiệu ứng hover chỉ chạy 1/6 trang danh mục),
**Q-1** (7 trang chạy quirks mode, thiếu `<meta viewport>`), **C-1** (trang EJS không
gửi `Cache-Control`, khác `express.static`), **X-1** (4 khối `<style>` inline chưa tách
ra file CSS), **P-1** (`img/breeze.png` — ảnh dự phòng 6 file JS trỏ tới — không tồn tại).
