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
Checklist test tay cho role staff (phân quyền): [CHECKLIST-STAFF.md](CHECKLIST-STAFF.md).

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

`theme-boot.js` nằm **trong `<head>`, không defer** ở 3 trang tĩnh (admin, checkout,
invoice) — thay snippet chống FOUC inline mà CSP chặn (xem mục CSP bên dưới).

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
| `js/auth-helper.js` | `window.AuthHelper.{isLoggedIn, onChange, apiFetch}` | Phát sự kiện `authchange`; tài khoản chưa xác minh email -> `reload()` + làm mới token trước lệnh API đầu tiên |
| `js/theme-boot.js` | gắn `data-theme` lên `<html>` | Chỉ 3 trang tĩnh; `data-theme-mode="light"` trên thẻ script để ép sáng |

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

## Content-Security-Policy — BẬT THẬT, áp cho mọi trang

Header sinh ở `server/middleware/security.js` (helmet, nonce mới mỗi request). Code vi
phạm **im lặng không chạy** — chỉ có lỗi Console và một dòng `[csp]` trong log server
(trình duyệt POST về `/api/csp-report`).

| Cấm | Thay bằng |
|---|---|
| `onclick=`, `onsubmit=`, `onerror=`… trong EJS, HTML, hay chuỗi `innerHTML` | `data-action="…"` + `addEventListener` (delegation ở `document`) |
| `href="javascript:…"` | `href="#"` + `e.preventDefault()` |
| `<script>` inline | file `.js`. Bắt buộc inline (chỉ snippet chống FOUC) thì mang `nonce` lấy từ `cspNonce` — xem `partials/head.ejs` |
| `onerror` cho ảnh dự phòng | `document.addEventListener('error', fn, true)` (pha capture — `error` không nổi bọt) |
| `eval`, `new Function`, `setTimeout('chuỗi')` | hàm thật |
| script / CSS / font / ảnh / API từ domain mới | khai domain vào directive tương ứng trong `security.js` TRƯỚC |

3 trang tĩnh không có nonce → **không được có script inline nào**.

`data-action` đang dùng — đặt tên có tiền tố để không trùng: `add-to-cart`,
`submit-search` (cart.js) · `login`, `signup`, `reset-password` trên `<form>` (auth.js) ·
`cart-qty`, `cart-remove`, `cart-checkout` (page-cart.js) · `inv-close`, `inv-print`
(page-invoice.js). `page-profile.js`, `payment-methods.js` có bộ `data-action` riêng.

**Nâng phiên bản Firebase / Chart.js** — sửa cùng lúc: `src` + `integrity` ở
`partials/scripts.ejs` và `admin|checkout|invoice.html`; thư mục phiên bản trong
`script-src` (`security.js`); 2 dòng SRI trong `KNOWN` của `tools/domdiff.js`. Hash:
`curl -s URL | openssl dgst -sha384 -binary | openssl base64 -A`. `regression.js` hạng mục 13
báo đỏ nếu lệch.

### Bật / tắt CSP — biến `CSP_MODE`

| Giá trị | Header gửi đi | Dùng khi |
|---|---|---|
| `enforce` (mặc định, để trống cũng vậy) | `Content-Security-Policy` — chặn thật | Bình thường |
| `report` | `…-Report-Only` — không chặn, vi phạm vẫn ghi `[csp]` trong log | Thử thay đổi lớn; tìm xem CSP có phải thủ phạm |
| `off` | không có CSP (header khác của helmet vẫn còn) | Chỉ để test |

Hai lưới an toàn, đều rơi về `enforce`: **`NODE_ENV=production` luôn ép `enforce`** (bỏ qua
`CSP_MODE`), và giá trị lạ/gõ sai. Logic ở `cspModeInfo()` trong `security.js`.

**Cách 1 — nút trong VS Code** (`.vscode/launch.json`, chỉ trên máy — `.vscode/` bị
gitignore): `Ctrl+Shift+D` → chọn **Server - CSP ON / REPORT / OFF** → ▶ (`F5`); dừng ■
(`Shift+F5`). Biến trong cấu hình thắng `server/.env`.
**Cách 2 — sửa `server/.env`**: `CSP_MODE=enforce|report|off`, rồi khởi động lại
`node server/server.js`.

Cả hai cách: **phải dừng server cũ trước** (cổng 3000). Đọc dòng `[security] …` in ra lúc
khởi động để biết chế độ THẬT SỰ đang áp dụng. Khi không phải `enforce`, `regression.js`
hạng mục 13 báo đỏ — đúng như mong muốn.

---

## Cache CSS/JS qua Cloudflare — server TỰ gắn `?v=`, không gõ tay

Site public chạy qua Cloudflare Tunnel. Server gửi `Cache-Control: max-age=0`, nhưng
Cloudflare **ghi đè thành `max-age=14400` (4 giờ)** cho file `.css`/`.js`. HTML không bị
cache (`cf-cache-status: DYNAMIC`). Để F5 là thấy CSS/JS mới, server gắn
`?v=<10 ký tự sha256 nội dung>` vào mọi link CSS/JS nội bộ **lúc trả HTML**:

| Nơi | File |
|---|---|
| Hàm gắn `?v=` + cache hash theo mtime/size | `server/lib/asset-version.js` |
| 18 trang EJS — gắn sau khi render | `server/routes/pages.js` |
| Trang `.html` tĩnh ở gốc `client/` (admin, checkout, invoice) | `server/routes/static-pages.js`, mount NGAY TRƯỚC `express.static` |

**Quy tắc khi làm chức năng liên quan:**

1. **Không gõ `?v=` bằng tay** trong EJS/HTML — server thay bằng hash thật. Sửa CSS/JS
   xong chỉ cần F5, **không cần khởi động lại server** (hash tự tính lại khi file đổi).
2. Link CSS/JS nội bộ phải viết đúng dạng **`src="js/<tên>.js"`** / **`href="css/<tên>.css"`**
   (tương đối, không `/` hay `./` đầu, nháy kép). Viết khác thì KHÔNG được gắn `?v=` và
   lại bị cache 4 giờ — `regression.js` hạng mục 14 báo đỏ.
3. Trang mới: EJS qua bảng `PAGES` hoặc `.html` tĩnh đặt ở gốc `client/` đều tự có `?v=`.
   Render trang theo đường khác (route riêng, `res.sendFile`, thư mục con) thì phải tự
   gọi `addVersions(html)` trước khi gửi.
4. **Không được phủ:** ảnh/font gọi bằng `url()` trong CSS, file JS tự nạp thêm lúc chạy,
   ảnh trong `img/`. Thay nội dung các file này thì **đổi tên file** (hoặc báo người dùng
   `Ctrl+F5`), không thì F5 vẫn thấy bản cũ tới 4 giờ.
5. Giữ header của trang tĩnh như `express.static`: `Cache-Control: public, max-age=0`,
   `Last-Modified` (= mtime mới nhất giữa HTML và CSS/JS nó gắn), ETag. Hạng mục 10 dựa
   vào `Last-Modified` để biết trang vẫn là file tĩnh.
6. Công cụ test đã bỏ qua `?v=`: `domdiff.js` (`stripAssetVersion`, có selftest), `pagecheck.js`
   và `regression.js` bỏ `?…` trước khi so tên file. Viết công cụ mới so tên script/link thì
   cũng phải bỏ `?v=` trước.
7. Đổi định dạng hash (độ dài, thuật toán) → sửa cùng lúc `asset-version.js` và hạng mục
   14 của `regression.js` (nó tính hash ĐỘC LẬP để đối chiếu).

Kiểm tra bản đang phục vụ: `curl -s https://breeze.ndttruc.dpdns.org/login.html | grep -o 'js/auth.js?v=[0-9a-f]*'`.
Cách bỏ hẳn cache 4 giờ phía Cloudflare (không bắt buộc, không xung đột với `?v=`):
Caching → Configuration → **Browser Cache TTL = Respect Existing Headers**.

Bài học đã gặp: xoá/đổi id phần tử HTML mà JS cũ trong cache vẫn dùng → JS cũ ném lỗi
trên HTML mới (bỏ `#who` khỏi `admin.html` làm trang admin rơi về màn "không có quyền").
`?v=` tự động chặn được chuyện này vì HTML mới luôn trỏ tới JS mới.

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
5. Script riêng trang đặt tên `page-<tên>.js`, khai qua `pageJs` (tự vào nhóm 6, cuối `<body>`).
   Không handler inline trong view — `data-action` + `addEventListener` (mục CSP ở trên)
6. Viết test trong `client/js/__tests__/` nếu trang có JS riêng
7. Chạy `node server/tools/regression.js`

Không phải copy `<head>`, không phải nhớ thứ tự CSS/script, không phải dán lại drawer và
footer — layout lo hết. Snippet chống FOUC nằm trong `partials/head.ejs`.

---

## Phân quyền (RBAC)

Role hợp lệ: `customer | staff | admin` (`server/lib/roles.js`, CHECK `CK_users_role`). "Phía quản trị"
(admin + staff) xét bằng `isBackOffice(role)` — **không** so `=== 'admin'` trực tiếp.

- **Nguồn sự thật của quyền:** `server/lib/permissions.js`. Đổi quyền staff chỉ sửa bảng ở đây + test.
- **Route mới** trong `routes/admin.js`, `admin-reviews.js`, `admin-support.js` PHẢI có
  `requirePermission('<perm>')` — `__tests__/admin-permissions.test.js` fail nếu thiếu. GET dùng
  quyền `:read`; route ghi dùng `:write` / `:delete` / `:update_status`… tương ứng.
- **Frontend** chỉ ẩn/khoá UI theo `me.permissions` (`data-perm`, `can()` trong `admin.js`); kiểm tra
  thật luôn ở backend. Thiếu `permissions` = không có quyền nào.
- **Module support:** staff dùng `principal.kind = 'admin'` (nghĩa "phía quản trị", không phải tên role).
- **Tạo staff:** `node db/create-staff.js <email> "<tên>" [--password]` (trong `server/`, chỉ PowerShell /
  terminal tương tác; Git Bash: `winpty`). Đổi role tài khoản có sẵn: `db/set-role.js`.

---

## Test

```bash
node client/js/__tests__/run-all.js   # 18 file / 529 assertion
node server/tools/regression.js       # 14 hạng mục toàn site, gồm CSP và ?v= (cần server đang chạy)
node server/tools/verify-all.js       # so DOM 18 trang: HTML @21ca387, riêng profile EJS @b723d26
node server/tools/domdiff.js --selftest   # negative control
```

`client/js/__tests__/` không cần cài gì thêm; chi tiết và giới hạn ở
`client/js/__tests__/README.md`.

`server/tools/domdiff.js` so **chuỗi token DOM** (thẻ + attribute đã sắp xếp + text đã
gom khoảng trắng), không so ảnh: máy này không có headless browser, mà token trùng +
CSS/JS không đổi thì pixel bằng nhau theo định nghĩa — và tất định, khác với ảnh chụp
`index.html` (slider chạy animation nên chụp lúc nào cũng lệch).

**Luôn chạy `--selftest` trước khi tin một kết quả "0 khác biệt".** Nó cố tình phá 5
kiểu (đổi class, mất `data-`, đảo thứ tự thẻ, đổi chữ, mất `aria-`) và phải bắt được cả 5;
thêm control cho `nonce` (bị bỏ qua, nhưng chỉ đúng attribute đó) và hash SRI sai 1 ký tự.

Khác biệt DOM **có chủ ý** so với bản gốc ghi vào `KNOWN` của `domdiff.js`, kèm lý do,
so khớp nguyên token. Trang đổi có chủ ý SAU khi migrate thì dùng mốc riêng
`PAGE_BASELINE` trong `verify-all.js` (EJS render lại từ một SHA cố định).

DOM giả **không** kiểm được giao diện, dark mode, việc in, thứ tự tab thật, focus trap
thật, hay thứ tự thực thi thật giữa các thẻ `<script>` — những thứ đó phải mở trình
duyệt: xem [CHECKLIST-EJS.md](CHECKLIST-EJS.md) và
[CHECKLIST-CHANGE-PASSWORD.md](CHECKLIST-CHANGE-PASSWORD.md).

### Bắt buộc kiểm tra lại đăng nhập trước khi báo hoàn tất task

- Sau khi chạy test/regression hoặc khởi động lại server, kiểm tra login thêm một lần
  trước khi báo kết thúc: phiên Firebase thật phải gọi được `GET /api/me` bằng ID token
  và nhận HTTP 200 với role hợp lệ; kiểm tra điều hướng đúng tài khoản. Không yêu cầu
  người dùng đăng xuất phiên đang dùng chỉ để thử lại.
- `/api/health` HTTP 200, `/api/me` không token HTTP 401 và unit test dùng mock **không**
  thay thế được kiểm tra đăng nhập thật. Không có phiên/trình duyệt phù hợp thì ghi rõ
  **CHƯA XÁC MINH LOGIN**, không báo login PASS.
- Server dùng Firebase Admin phải có quyền kết nối Google/Firebase. Không để server
  phục vụ người dùng chạy trong sandbox chặn mạng ra ngoài: đã gặp `EACCES` khi lấy
  public certificate, làm Firebase trên trình duyệt đăng nhập được nhưng backend từ
  chối token. Nếu bị sandbox chặn, yêu cầu quyền chạy server ngoài sandbox; không tắt
  xác minh token, kiểm tra thu hồi, CSP hoặc rate limit để né lỗi.
- Sau kiểm thử, giữ server sử dụng được cho người dùng; kiểm tra health, kết nối Firebase
  và rate limit còn lượt. Không khởi động chồng server trên cổng 3000, không đổi mật khẩu,
  xóa phiên/token hay sửa dữ liệu tài khoản để làm test PASS. Không ghi token/mật khẩu/
  service account vào log hoặc báo cáo.
- Trang login báo "Sai mật khẩu, vui lòng thử lại." (khoá `au.eBadCred`, từ mã Firebase
  `auth/invalid-login-credentials` / `auth/invalid-credential` — map ở `ERROR_KEYS` trong
  `auth.js`; mã nào chưa map thì hiện nguyên văn `Firebase: Error (auth/...)`)
  → lỗi xảy ra ở bước trình duyệt gọi thẳng Firebase, **trước** khi gọi server: sai mật khẩu
  (hay gặp: Brave tự điền mật khẩu cũ, lưu riêng cho `localhost:3000` và tên miền Cloudflare),
  không phải do pm2/server. Lỗi do server thì hiện câu `au.errRoleCheck` hoặc báo 429.
  Không thể xem mật khẩu người dùng; quên thì người dùng tự đặt lại ở Firebase Console.
- Nếu login báo lỗi sau một thời gian sử dụng, kiểm tra HTTP status, `RateLimit` và
  `Retry-After` trước khi kết luận sai tài khoản/token hoặc Firebase mất kết nối. Đã gặp
  HTTP 429 vì quota API dùng chung bị tiêu hết. Quota hiện tách ba nhóm: session
  (`GET/HEAD /api/me`, `POST /api/support/session` có Bearer), lifecycle/SSE CSKH khách,
  và API còn lại;
  mỗi nhóm 300 request / 15 phút / IP. Test cố tình vượt quota phải dùng server/port
  riêng, không làm cạn quota của server người dùng đang sử dụng.

---

## Việc còn nợ

Xem mục "Việc còn nợ" trong [CLEANUP.md](CLEANUP.md): **N-1** (hoá đơn hiện `−0₫`),
**S-1** (`to()` cho qua khoá lạ), **H-1** (hiệu ứng hover chỉ chạy 1/6 trang danh mục),
**Q-1** (7 trang chạy quirks mode, thiếu `<meta viewport>`), **C-1** (trang EJS không
gửi `Cache-Control`, khác `express.static`), **X-1** (4 khối `<style>` inline chưa tách
ra file CSS), **P-1** (`img/breeze.png` — ảnh dự phòng 6 file JS trỏ tới — không tồn tại),
**SEC-1** (`express.static` phục vụ cả `client/` theo blocklist — đề xuất chuyển whitelist),
**SEC-2** (`style-src` còn `'unsafe-inline'`), **SEC-3** (quên mật khẩu chưa có chức năng),
**SEC-4** (admin nhập URL ảnh ngoài bị CSP chặn), **SEC-5** (`connect-src` thừa
`www.googleapis.com`), **SEC-6** (tài khoản chưa xác minh thêm 1 request mỗi trang).
