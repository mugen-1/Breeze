# Dọn dẹp codebase trước khi migrate sang EJS master layout

Theo dõi tiến độ và **chỉ tiêu đã chốt** của đợt dọn dẹp 10 TASK. File này nằm trong
repo để chỉ tiêu không bị hỏi lại hay tranh cãi lúc review TASK 10.

## Chỉ tiêu TASK 10 — bảng đã chốt

| Chỉ số | Trước dọn dẹp | Mục tiêu | Thực tế (2026-08-20) |
|---|---|---|---|
| JS inline trong HTML | ~90.000 chars | **chỉ còn snippet FOUC** | **6.048 — đúng bằng FOUC** ✅ |
| Hàm định nghĩa trùng | 8 hàm (số này SAI, xem dưới) | 0, hoặc đã đổi tên rõ ràng | **0** ✅ |
| Biến thể drawer menu | 2 | 1 | TASK 8 |
| Biến thể footer | 1 | 1 | TASK 8 |
| Biến thể policy-header | 2 | 1, hoặc 2 có chủ đích | TASK 8 |
| Thứ tự script | mỗi trang một kiểu | 1 thứ tự chuẩn | **1 thứ tự, 21/21** ✅ |
| Trang thiếu `theme.js` | 20 (khảo sát ghi 19) | 0 | **0** ✅ |
| File JS chết | 4 | 0 | **0** ✅ |
| File có BOM | 13 | 0 | **0** ✅ |
| Link `.html` hardcode trong JS | 113 (thật: 46) | dùng module routes | **0 ngoài routes.js** ✅ |
| Key tra cứu phụ thuộc `.html` | 2 chỗ (thật: **30**) | 0 | **0** ✅ |

### Vì sao chỉ tiêu "JS inline" đổi từ "< 5.000 chars" thành "chỉ còn snippet FOUC"

Mốc "< 5.000 chars" **không thể đạt được về mặt số học**, không liên quan tới chất
lượng dọn dẹp:

- Mỗi trang bắt buộc giữ một snippet chống FOUC inline trong `<head>` (đặt
  `data-theme` trước khi render). Tách ra file ngoài sẽ gây nháy trắng khi load —
  chính TASK 3 đã ghi rõ "PHẢI giữ inline, không đụng vào".
- Snippet bản đầy đủ dài 312 chars × 19 trang, cộng bản rút gọn 60 chars × 2 trang
  (`admin.html`, `invoice.html`) = **6.048 chars sàn cứng**.

Nên chỉ tiêu đúng là **"chỉ còn snippet FOUC"**. Đạt chỉ tiêu = không còn khối inline
nào ngoài snippet đó, bất kể tổng số chars là bao nhiêu.

Phần dư hiện tại 1.206 chars = hàm `toggleFilter` inline ở 6 trang danh mục
(~201 chars/trang). TASK 4 sẽ gom vào module dùng chung, xong thì tổng về đúng 6.048.

## Cảnh báo: bảng "8 hàm trùng" trong kế hoạch gốc KHÔNG chính xác

Bảng đó gần như chắc chắn được sinh bằng regex bắt cả `var X = ...`, nên đếm nhầm
biến thành hàm. Đã tìm được 4 chỗ sai trong lúc làm TASK 3:

| Ghi trong bảng | Thực tế |
|---|---|
| `lang` trùng ở cart | Ở `cart.html` là **biến cục bộ** `var lang` bên trong `_cp()` |
| `lang` trùng ở orders | Ở `orders.html` tên thật là **`_lang()`**, khác tên |
| `imgs` trùng product/search | **Biến cục bộ** trong `cardHTML()` / `renderProduct()`, không phải hàm |
| `render` trùng ở index | Nằm **kín trong IIFE** của slider và làm việc chuyển slide, không đụng ai |

Ngoài ra `esc`/`money`/`t` ở `search.html` và `product.html` nằm trong IIFE nên
**không xung đột** với bản global ở `orders.html` — gom được thì tốt, nhưng đây không
phải xung đột đang tồn tại.

## Kết quả TASK 4.1 — đối chiếu lại từ đầu (bảng CHỐT)

So bằng cách bỏ **hết** khoảng trắng và comment rồi băm nội dung thân hàm. Lần so đầu
bị nhiễu vì các bản chỉ khác chỗ xuống dòng — đừng lặp lại sai lầm đó.

| Hàm | Số nơi định nghĩa | Số bản **thực sự** khác nhau | Quyết định |
|---|---|---|---|
| `esc` / `escapeHtml` | 4 | **1** | Gom. `escapeHtml` (invoice) giống hệt `esc`, chỉ khác tên |
| `t` / `tr` | 4 | **1** | Gom. Bản invoice chỉ khác **tên tham số** (`k,p` vs `key,params`) — thân hàm hoàn toàn tương đương |
| `money` / `formatPrice` | 4 | **2** | Gom về bản an toàn, xem dưới. `formatPrice` (search) giống hệt `money` |
| `toggleFilter` | 6 | **1** | Gom. 6 bản giống hệt nhau từng byte |
| `fmtDate` / `fmtDateVN` | 3 | **3** | KHÔNG gom — khác hẳn nhau |
| `lang` / `_lang` / `locale` | 3 | **3** | KHÔNG gom — khác hẳn nhau |
| `render` | 4 | **4** | KHÔNG gom — đổi tên. Kích thước 252/639/1682/2632 ký tự |
| `imgs` | **0** | — | Không tồn tại hàm nào tên này |

Lưu ý về cách đếm: nếu đọc lướt có thể thấy `t/tr` là "2 bản" vì hash khác nhau. Đó là
do **tên tham số** khác, không phải hành vi khác. Đã chốt: **1 bản**.

Bảng gốc còn **bỏ sót** việc cùng một hàm mang tên khác nhau ở các trang
(`esc`/`escapeHtml`, `money`/`formatPrice`, `t`/`tr`). Tính đúng thì số chỗ trùng
NHIỀU hơn bảng ghi, nhưng số bản khác nhau lại ÍT hơn.

### Khác biệt thật của `money` — đây là bug, không phải style

```js
orders / product / search:  Number(n).toLocaleString('vi-VN') + 'đ'
invoice:                    Number(n || 0).toLocaleString('vi-VN') + 'đ'
```

Với `null`/`undefined`, 3 bản đầu in ra **`NaNđ`** trên giao diện. Bản invoice ra `0đ`.
Đã chốt: gom về bản có `|| 0`, kèm test khoá hành vi cho cả 3 trang.

### Chốt: vì sao dùng `₫` (U+20AB) chứ không phải chữ `đ` — ĐÃ KIỂM CHỨNG

Quyết định đã chốt, **không mở lại**. Lý do:

1. `₫` là ký hiệu tiền tệ chuẩn của đồng Việt Nam trong Unicode. Chữ `đ` là một chữ
   cái, dùng làm ký hiệu tiền là quy ước dân gian.
2. Trước khi gộp, site **đã dùng lẫn cả hai**: `₫` ở trang thanh toán và voucher,
   `đ` ở giỏ hàng, đơn hàng, hoá đơn, trang quản trị. Khách đi hết một luồng mua
   sẽ thấy hai kiểu khác nhau. Buộc phải chọn một.
3. Chọn `₫` thì chỉ cần sửa hàm gộp; chọn `đ` thì phải sửa cả `checkout.js` lẫn
   `voucher.js` (2 file đang dùng `Intl.NumberFormat` riêng) — nhiều rủi ro hơn ở
   đúng luồng nhạy cảm nhất là thanh toán.

**Đã kiểm chứng bằng trình duyệt thật (Chrome headless), không phải suy đoán:**

| Kiểm tra | Kết quả |
|---|---|
| Jost (font UI của site) có glyph `₫`? | CÓ — thuộc subset `latin-ext` (`U+20A0-20AB`) |
| Cormorant Garamond có glyph `₫`? | CÓ — Google Fonts xếp `U+20AB` ngay trong subset `vietnamese` |
| Font hệ thống (khi Google Fonts không tải được, vd in offline) | CÓ — Arial có glyph thật |
| Khi IN ra PDF | `₫` ánh xạ tới glyph `0x047E` trong Arial nhúng vào PDF — **không phải ô vuông**, không bị thay bằng font khác |
| Hiển thị thật trên web | Đã chụp màn hình `search.html`, `product.html`, `sanpham-ao.html`, `cart.html` — đều đúng |

Ví dụ đã xác nhận trên giỏ hàng: `459.000₫` × 2 = `918.000₫`, cộng `199.000₫`,
tổng `1.117.000₫`.

### Phát hiện thêm (KHÔNG do đợt dọn dẹp gây ra) — Jost thiếu chữ Việt có dấu

Các trang gọi Google Fonts với `subset=vietnamese,latin`, nhưng **Jost không hề có
subset `vietnamese`** — Google chỉ phục vụ `cyrillic`, `latin-ext`, `latin`. Dải
`latin-ext` phủ `U+1E00-1E9F` và `U+1EF2-1EFF`, tức là **bỏ trống `U+1EA0-1EF1`** —
đúng vùng chứa phần lớn chữ Việt có dấu thanh (ế, ộ, ứ, ậ...).

Hệ quả: những chữ đó đang rơi về font hệ thống, nằm lẫn giữa chữ Jost. Nhìn kỹ sẽ
thấy nét không đồng đều. Việc này có từ trước, không liên quan TASK 4. Muốn xử lý thì
đổi sang font có hỗ trợ tiếng Việt đầy đủ, hoặc bỏ `subset=vietnamese` cho Jost và
chấp nhận fallback. Cần quyết định riêng vì đụng tới nhận diện thương hiệu.

### `toggleFilter` — lấy lại guard đã mất

Bản từng nằm ở index (đã xoá ở `61d25b9`) có `if (list)` bảo vệ null; 6 bản đang chạy
thì **không có** nên sẽ throw nếu `nextElementSibling` là null. Bản gom lấy lại guard —
đây là mang hàm về đúng phiên bản an toàn nhất từng tồn tại, không phải thêm tính năng.

## Đính chính: `invoice.html` không dùng html2pdf.js

Kế hoạch gốc cảnh báo trang này sinh PDF qua html2pdf.js và có nguy cơ đổi timing khi
tách script. Đã kiểm chứng: **không có `html2pdf` hay `jspdf` ở bất kỳ đâu** trong
`client/` lẫn `server/package.json`.

Cơ chế in thật: nút "In hoá đơn" gọi `window.print()` của trình duyệt, chỉ chạy khi
người dùng bấm (không auto-print), bố cục bản in do khối `@media print` trong `<style>`
của `invoice.html` lo. Việc tách JS không ảnh hưởng gì tới in.

## TASK 5.1 — Bản đồ phụ thuộc script (đo bằng máy, không đọc bằng mắt)

Cách đo: nạp từng file `client/js/*.js` vào sandbox rỗng, gặp `ReferenceError` thì ghi
lại tên còn thiếu rồi chạy lại với sandbox MỚI. Riêng phần DOM thì bọc
`getElementById`/`querySelector` để đếm số lần gọi **trong lúc parse**.

### A. File nào tạo ra global nào

| File | Global tạo ra |
|---|---|
| `api-config.js` | `API_BASE` |
| `firebase-config.js` | `firebaseConfig`, **`auth`** (const top-level) |
| `auth-helper.js` | `window.AuthHelper` |
| `theme.js` | `window.BreezeTheme` |
| `i18n.js` | `window.__i18n`, `window.__policyVI` |
| `utils-format.js` | `money`, `esc` |
| `utils-i18n.js` | `t` |
| `filter-ui.js` | `toggleFilter` |
| `cart.js` | ~30 global, gồm `getCart`, `addToCart`, `updateQty`, `removeFromCart`, `_updateAllBadges`, `_injectAddToCartButtons`, `window.startCheckout`, `window.refreshCart` |
| `cart-drawer.js` | `window.CartDrawer`, và **bọc đè `window.addToCart`** |
| `account-menu.js` | `window.__acctMenuInit` |
| `payment-methods.js` | `window.PaymentMethods` |
| `voucher.js` | `window.BreezeVoucher` |
| `auth.js` | `dangNhap`, `dangKy`, `dangXuat`, `showMessage`, `authError` |
| `page-cart.js` | `window.renderCart`, `changeQty`, `removeItem`, `checkout` |
| `page-index-slider.js` | `window.currentSlide` |
| `page-orders.js` | `render`, `fmtDate`, `loadOrders`, `_lang`, `_op`… |

### B. Ràng buộc CỨNG — phụ thuộc lúc parse

Chỉ có **3** ràng buộc kiểu này. Sai thứ tự ở đây là vỡ ngay, có lỗi console:

| Phải nạp trước | Rồi mới tới | Vì |
|---|---|---|
| Firebase SDK (CDN) | `firebase-config.js` | cần `firebase` |
| `firebase-config.js` | `auth.js` | `auth.js:106` gọi `auth.onAuthStateChanged()` ở top-level |
| `utils-i18n.js` | `page-search.js` | gọi `t('sr.enterKeyword')` ngay lúc parse |

### C. Ràng buộc CỨNG — phải đứng sau markup

7 file đọc DOM **ngay lúc parse**, không chờ `DOMContentLoaded`:

| File | Số lần đọc DOM lúc parse | Phần tử đầu tiên |
|---|---|---|
| `page-profile.js` | 19 | `.theme-seg`, `#ad-dob`, `#ad-save` |
| `page-product.js` | 11 | `#pd-root`, `#pd-name`, `#pd-price` |
| `voucher.js` | 8 | `#voucher-block`, `#voucher-line` |
| `drawer-menu.js` | 4 | `#drawer-menu`, `#drawer-backdrop` |
| `page-index-slider.js` | 4 | `.mySlides`, `.dot`, `.hero` |
| `page-search.js` | 4 | `#search-input`, `#search-title` |
| `account-menu.js` | 1 | `a[aria-label="Tài khoản"]` |

Đáng chú ý: `account-menu.js` và `drawer-menu.js` **dùng chung ở 18–19 trang** và đọc DOM
lúc parse. Khi lên EJS, partial chứa chúng bắt buộc phải nằm CUỐI `<body>`.

### D. Mọi thứ còn lại KHÔNG ràng buộc thứ tự

Các file khác chỉ dùng global của nhau **bên trong hàm hoặc event handler**, nên nạp
trước hay sau đều được. Cụ thể vài chỗ dễ hiểu nhầm là nguy hiểm nhưng thật ra an toàn:

- `cart-drawer.js` bọc đè `window.addToCart` của `cart.js`. Nhìn thì tưởng phải nạp sau
  `cart.js`, nhưng việc bọc nằm trong `init()` chạy ở `DOMContentLoaded` — lúc đó mọi
  script đã xong. **Thứ tự 2 file này tự do.**
- `account-menu.js` gọi `window._updateAllBadges()` của `cart.js` — có bọc `typeof`, và
  gọi trong handler.
- `page-profile.js` dùng `window.BreezeTheme` (theme.js nạp `defer`) và
  `window.PaymentMethods` (nạp sau nó) — đều gọi trong hàm.

### E. Hiện trạng: 13 kiểu thứ tự khác nhau trên 21 trang

| Nhóm | Số trang | Ví dụ lệch |
|---|---|---|
| Kiểu 1 | 5 | `i18n` gần cuối, sau `drawer-menu` |
| Kiểu 2 | 3 | `drawer-menu`, `i18n`, `reveal` nằm **trước cả Firebase SDK** |
| Kiểu 3 | 2 | `i18n` đứng **đầu tiên** |
| Kiểu 4 | 2 | `reveal` đứng đầu, `i18n` đứng cuối |
| 9 kiểu còn lại | mỗi kiểu 1 trang | mỗi trang một kiểu riêng |

`i18n.js` lúc đứng thứ 1, lúc thứ 10. `reveal.js` lúc đầu lúc cuối. May mắn là theo
mục D, không chỗ nào trong số này thật sự vỡ — nhưng khi gom vào MỘT partial dùng chung
thì buộc phải chọn một thứ tự, nên cần bảng này để chọn cho đúng.

### F. Số liệu dùng chung / riêng (cho việc tách partial EJS)

- **Dùng chung 21/21 trang:** Firebase SDK, `firebase-config`, `api-config`, `auth-helper`,
  `utils-format`, `i18n`
- **Gần hết (18–19 trang):** `account-menu`, `cart`, `cart-drawer`, `drawer-menu`, `reveal`
- **Riêng vài trang:** `utils-i18n` (7), `filter` + `filter-ui` + `products-render` (6 trang
  danh mục), `auth` (2)
- **Riêng 1 trang:** `theme`, `admin`, `checkout`, `voucher`, `payment-methods`, và toàn bộ `page-*`

Lưu ý: `theme.js` mới chỉ có ở `profile.html` (1/21) — mục 5.4 phải thêm vào 20 trang còn lại.

## TASK 5.2 — Thứ tự chuẩn đề xuất (CHƯA áp dụng, chờ duyệt)

### Đính chính cách đo ở 5.1

Kết luận "13 kiểu thứ tự, không kiểu nào vỡ" ban đầu **chỉ là phân tích tĩnh** — đo
từng file riêng lẻ rồi suy ra. Nay đã **chạy thật**: dựng harness nạp cả bộ script theo
một thứ tự vào cùng một sandbox, có DOM lấy id từ chính file HTML thật, rồi bắn
`DOMContentLoaded` / `authchange` / `langchange` / `cartchange` để chạy nốt các đường hoãn.

Harness được chứng minh là **đáng tin** bằng negative control: cố tình đặt `auth.js`
trước `firebase-config.js` và `page-search.js` trước `utils-i18n.js` — cả hai đều bị bắt
đúng (`ReferenceError`). Nếu negative control không đỏ thì harness vô dụng.

### Kết quả fuzz 400 hoán vị ngẫu nhiên

Hoán vị ngẫu nhiên 12 script dùng chung, đối chiếu "có vi phạm RB1 không" với "có vỡ không":

| | Vỡ | Không vỡ |
|---|---|---|
| Vi phạm RB1 | **206** | 0 |
| Không vi phạm | 0 | **194** |

Tương quan tuyệt đối, **không một trường hợp bất ngờ nào**. Kết luận thực nghiệm: trong
bộ script dùng chung, **"Firebase SDK trước firebase-config.js" là ràng buộc DUY NHẤT**.

### Thứ tự chuẩn đề xuất

| Nhóm | Script | Phạm vi |
|---|---|---|
| 1. Vendor ngoài | Firebase SDK (app, auth), Chart.js | Firebase: 21/21 · Chart: admin |
| 2. Cấu hình | `firebase-config.js`, `api-config.js` | 21/21 |
| 3. Hạ tầng | `auth-helper.js`, `theme.js`, `i18n.js` | 21/21 (theme sau 5.4) |
| 4. Utils dùng chung | `utils-format.js`, `utils-i18n.js` | dùng chung |
| 5. UI dùng chung | `account-menu.js`, `cart.js`, `cart-drawer.js`, `drawer-menu.js`, `reveal.js` | 18–19/21 |
| 6. Riêng trang | `auth`, `filter-ui`, `filter`, `products-render`, `checkout`, `voucher`, `payment-methods`, `admin`, `page-*` | từng trang |

Nhóm 1–5 sẽ nằm trong partial dùng chung khi lên EJS; nhóm 6 truyền qua biến `pageJs`.

### Bảng đối chiếu ràng buộc — thứ tự chuẩn có phá vỡ gì không

| Ràng buộc (từ 5.1) | Số trang áp dụng | Kết quả |
|---|---|---|
| RB1 Firebase SDK → `firebase-config.js` | 21 | **PASS 21/21** |
| RB2 `firebase-config.js` → `auth.js` | 2 | **PASS 2/2** |
| RB3 `utils-i18n.js` → `page-search.js` | 1 | **PASS 1/1** |
| RB4 7 file đọc DOM lúc parse phải sau markup | 21 | **PASS** — mọi script vẫn ở cuối `<body>`, không đổi vị trí |

Ngoài ra đã **sắp lại script của cả 21 trang theo thứ tự chuẩn rồi chạy thử**:
**21/21 PASS, 0 lỗi.** Cả 21 trang đều phải đổi thứ tự so với hiện tại.

### 3 trang chính sách — không có ràng buộc riêng

`chinhsachbaomat`, `chinhsachdoitra`, `chinhsachgiaohang` đang để `drawer-menu`, `i18n`,
`reveal` **trước cả Firebase SDK**. Đã kiểm riêng bằng chính id lấy từ HTML của chúng:

- Bộ script của 3 trang này là **tập con thật sự** của bộ dùng chung — không có script nào
  mà 18 trang kia không có, và cũng không thiếu script nào gây ràng buộc riêng.
- Chỗ lệch chỉ là thứ tự **giữa các script với nhau**; toàn bộ thẻ `<script>` vẫn nằm ở
  cuối `<body>` (dòng 212+), còn markup drawer ở dòng 32 — nên RB4 vốn đã thoả.
- Thứ tự hiện tại của chúng thoả RB1 (Firebase SDK vẫn trước `firebase-config.js`), nên
  đang không vỡ; thứ tự chuẩn cũng thoả RB1 → **không phá vỡ gì**.

Kết luận: 3 trang này **không cần ngoại lệ**, áp thứ tự chuẩn bình thường.

### Một thay đổi cần biết trước khi áp dụng

`profile.html` đang nạp `theme.js` bằng **`<script defer>` trong `<head>`**. Thứ tự chuẩn
đưa `theme.js` vào nhóm 3 ở cuối `<body>`. Hệ quả: `window.BreezeTheme` sẽ tồn tại **trước**
`page-profile.js` thay vì sau. Đây là thay đổi có lợi (hàm `syncThemeUI()` không còn phải
rơi về giá trị mặc định `'light'`), nhưng vẫn là đổi hành vi — cần kiểm lại nút đổi
sáng/tối ở trang profile khi áp dụng.

## TASK 5.3 / 5.4 — đã áp dụng

### Ngoại lệ được ghi nhận: `page-index-slider.js`

Giữ nguyên vị trí **giữa trang** (index.html dòng 123), KHÔNG gom xuống cuối body.
Lý do: `.hero .mySlides` mặc định `opacity: 0; visibility: hidden`, chỉ JS gắn
`.is-active` mới hiện. Dời xuống cuối thì hero trắng trơn cho tới khi Firebase SDK +
`i18n.js` (95KB) + `cart.js` nạp xong. Khi lên EJS, script này thuộc về thân trang chứ
không thuộc partial script dùng chung.

### `theme.js` — thêm là chuẩn bị, không phải vá lỗi

Trước 5.4 chỉ `profile.html` có. Nhưng **không trang nào đang hỏng**: chỉ profile có nút
đổi theme (`.theme-seg` / `[data-theme-choice]`) và chỉ `page-profile.js` gọi
`BreezeTheme`. Thêm vào 20 trang còn lại là để partial dùng chung của EJS có sẵn nó.

Đã kiểm bằng trình duyệt: nạp cả 21 trang trong iframe, đọc `window.BreezeTheme` →
21/21 đều có. `invoice.html` và `admin.html` trả `'light'` vì dùng snippet FOUC rút gọn
ép sáng — khác biệt có chủ đích, TASK 8 xử lý.

### Bằng chứng không đổi giao diện

- `profile.html` (nơi `theme.js` chuyển từ `<head defer>` xuống body): chụp ở
  300ms/900ms/8000ms cho cả hai chế độ, độ sáng **không đổi giữa các mốc**
  (dark 19.8 / light 245.2) → không nháy sai theme.
- `search.html`: ảnh chụp trước TASK 5 và sau 5.3+5.4 **giống hệt từng pixel**
  (cùng sha256 `1a9407be`).

## TASK 6.1 — Phân tích `sale.css` vs `global.css` (CHƯA sửa, chờ duyệt)

### Kết luận: `sale.css` ĐÚNG là bản copy của `global.css` rồi sửa

| Phép đo | Kết quả |
|---|---|
| Kích thước | `global.css` 39.693 B / 1.851 dòng · `sale.css` 39.724 B / 1.709 dòng |
| Dòng trùng nhau (diff) | **1.388 dòng** — 75,0% của global, 81,2% của sale |
| Độ tương đồng tổng thể | **78,0%** |
| Selector có ở cả hai | **250** (88,3% của global, 85,6% của sale) |
| Trong 250 đó: giống hệt từng ký tự | **200 (80%)** |
| Trong 250 đó: khác nội dung | 50 — trong đó 35 chỉ đổi giá trị, 15 bị bớt thuộc tính |
| Chỉ có ở `global.css` | 33 selector |
| Chỉ có ở `sale.css` | 42 selector |

### Hai file phân kỳ ở đâu

**Chỉ `sale.css` có (42):** gần như trọn bộ **`.fd-*`** — 26 rule của drawer bộ lọc
(`.fd-drawer`, `.fd-chip`, `.fd-group`, `.fd-overlay`…), cộng biến thể thẻ sản phẩm
(`.product-item`, `.price-sale`, `.price-default`, `.soldout-badge`, `.btn-soldout`).

**Chỉ `global.css` có (33):** slideshow trang chủ (`.mySlides`, `.slideshow-container`),
nhóm `body.home`, và **19 rule scoped `body.category-page`**.

### Điểm mấu chốt: hai đường tạo kiểu song song cho cùng một loại trang

Cả 7 trang dùng `sale.css` đều có `<body class="category-page sitehdr">`, nhưng **không
nạp `global.css`** — nên 19 rule `body.category-page` trong `global.css` không chạm tới
chúng. Ngược lại `search.html` **có** nạp `global.css` và **cũng có** `body.category-page`.

Nghĩa là: `search.html` và 6 trang danh mục trông giống nhau nhưng được tạo kiểu bằng
**hai đường hoàn toàn khác nhau** — search dùng nhánh `body.category-page` trong
`global.css`, còn 6 trang kia dùng selector không scope trong `sale.css`. Đây là rủi ro
chính khi gộp: đổi 6 trang sang `global.css` là chúng nhảy sang nhánh vốn chỉ được chỉnh
cho search.

### Hiện trạng nạp CSS — 9 kiểu khác nhau trên 21 trang

| CSS | Số trang |
|---|---|
| `tokens.css`, Font Awesome | 21/21 |
| `global.css` | 13 |
| `sale.css` | 7 |
| `chinhsach-doitra.css`, `auth.css` | 3 mỗi file |
| `admin`, `checkout`, `index-slide`, `profile` | 1 mỗi file |

Lệch thứ tự: 14 trang để `tokens` trước Font Awesome, 7 trang danh mục thì ngược lại.
`profile.html` để `profile.css` **sau** Font Awesome, các trang khác để CSS riêng trước.

**Ngoại lệ có chủ đích:** `invoice.html` chỉ nạp `tokens` + Font Awesome, **cố ý không
nạp `global.css`** — trong file có ghi rõ lý do (rule `section{padding-block}` của
global làm hỏng bản in). Không được "sửa" chỗ này.

## TASK 6.2 — Thứ tự CSS chuẩn đề xuất (CHƯA áp dụng, chờ duyệt)

### Ràng buộc thứ tự CSS THẬT — đo, không giả định

Quét mọi cặp file CSS cùng nạp trên ít nhất 1 trang, tìm cặp (selector, thuộc tính)
trùng nhau với **cùng specificity** → thứ tự nạp quyết định. Tìm được **12 va chạm**
tĩnh, nhưng phải kiểm từng cái bằng trình duyệt vì specificity của rule KHÁC trong
cùng file có thể che mất.

| Cặp file | Va chạm tĩnh | Đảo thứ tự có đổi hiển thị? |
|---|---|---|
| `global` + `admin` | `body{color}` | **CÓ — đổi hoàn toàn** |
| `global` + `auth` | `body{color,background-color}` | Không |
| `global` + `profile` | `body{color}` | Không |
| `global` + `checkout` | `header{display}`, `.cart-badge` | Không |
| `global` + `chinhsach-doitra` | 5 selector `.policy-header*` | Không |
| `global` + `index-slide` | `.mySlides img{width}`, `.slideshow-container{margin}` | chưa đo (xem ghi chú) |
| `tokens` + mọi file | **0 va chạm** | — |
| Font Awesome + mọi file | `.sr-only` (profile) | Không |

**Ràng buộc thật duy nhất đo được: `global.css` phải nạp TRƯỚC `admin.css`.**

Bằng chứng đo bằng `getComputedStyle`, trang không có class trên `<body>`:

| Thứ tự | `body` color | `body` background |
|---|---|---|
| `tokens → global → admin` (hiện tại) | `rgb(14,14,14)` | `rgb(255,255,255)` |
| `tokens → admin → global` (đảo) | **`rgb(255,255,255)`** | **`rgb(14,14,14)`** |

Đảo là trang quản trị lộn ngược sang nền tối dù đang ở chế độ sáng.

### Vì sao 11 va chạm còn lại KHÔNG đổi gì

`global.css` có `body.sitehdr { color: var(--c-ink) }` ở rule 212 — specificity (0,1,1),
cao hơn `body` trần (0,0,1) nên **thắng bất kể thứ tự**. Mọi trang có
`class="sitehdr"` hoặc `category-page` đều được rule này che. Chỉ `admin.html` (không có
class nào trên `<body>`) là phơi ra.

Đây đúng là lý do không được suy luận: danh sách va chạm tĩnh có **11/12 dương tính giả**,
chỉ lộ ra khi đo thật.

### Về `tokens.css`

Không va chạm với file nào. `tokens.css` định nghĩa biến màu (`--c-*`), còn
`global.css`/`sale.css` định nghĩa biến chữ và layout (`--font-*`, `--ease`,
`--pad-section`) — **hai tập rời nhau**. Biến CSS lại được phân giải lúc tính giá trị
chứ không phải lúc parse, nên vị trí `tokens.css` so với Font Awesome không ảnh hưởng gì.
Vẫn đặt đầu tiên cho đúng ý nghĩa, không phải vì bắt buộc.

### Thứ tự chuẩn đề xuất

| # | Nhóm | File |
|---|---|---|
| 1 | Design token | `tokens.css` |
| 2 | Vendor | Font Awesome, Google Fonts |
| 3 | Base | `global.css` **hoặc** `sale.css` (7 trang danh mục giữ `sale.css`) |
| 4 | Riêng trang | `admin`, `auth`, `checkout`, `chinhsach-doitra`, `index-slide`, `profile` |

**Ngoại lệ giữ nguyên:** `invoice.html` chỉ nạp `tokens` + Font Awesome, cố ý bỏ
`global.css` (rule `section{padding-block}` làm hỏng bản in — lý do ghi ngay trong file).

### Bảng đối chiếu ràng buộc

| Ràng buộc | Số trang | Thứ tự chuẩn |
|---|---|---|
| `global.css` trước `admin.css` (đã đo, có thật) | 1 | **PASS** — nhóm 3 trước nhóm 4 |
| `global.css` trước mọi CSS riêng trang (giữ đúng ý đồ hiện tại) | 13 | **PASS** |
| `tokens.css` đứng đầu | 21 | **PASS** |
| `invoice.html` không nạp `global.css` | 1 | **PASS** — không đụng |
| Không đổi nội dung file `.css` nào | — | **PASS** — chỉ đổi thứ tự thẻ `<link>` |

Việc gộp `sale.css` vào `global.css` **để task riêng sau TASK 10**, không làm ở đây.

## TASK 6.3 — đã áp dụng

20/21 trang đổi thứ tự CSS về chuẩn; `invoice.html` vốn đã đúng nên không đổi, và ngoại
lệ "không nạp `global.css`" của nó giữ nguyên.

**Kiểm chứng bằng ảnh:** chụp 21 trang × 2 chế độ sáng/tối, trước và sau →
**40/42 ảnh giống hệt từng pixel**. 2 ảnh khác đều của `index.html`, đã xác minh là
**bất định do animation slider**: chụp 3 lần liên tiếp mà không sửa gì cũng ra 3 hash
khác nhau. Đã xem mắt ảnh sau — hero, nút, dots đều bình thường.

**Lưu ý cho ai đo lại sau này:** đừng dùng `index.html` làm mốc so pixel, nó không tất
định. Dùng trang tĩnh bất kỳ khác.

## TASK 7.1 — Kiểm kê đường dẫn `.html` (CHƯA sửa, chờ duyệt)

Đếm lại từ đầu, không dùng số trong kế hoạch (số cũ tính cả `search-data.js` — file đã
xoá ở TASK 1).

| Nhóm | Số lượng |
|---|---|
| **A** · link điều hướng trong HTML (`href`/`src`/`action`) | **336** |
| **A** · `location.href/replace/assign` trong JS | **19** |
| **A** · chuỗi `href="..."` do JS sinh ra | **27** |
| **B** · khoá tra cứu bằng tên file | **3 file** — xem dưới |
| **C** · trong comment (49 JS + 1 HTML) | 50 |
| **D** · đường dẫn tới file thật không phải trang | **0** |
| **TỔNG nhóm A** (phải đổi khi đổi route) | **382** |

Kế hoạch ghi 339 + 113 + 17. Số thật: 336 + 46 (JS) + 17→19 redirect. Chênh vì
`search-data.js` (38 chuỗi) đã bị xoá, và vì cách đếm cũ tính cả comment.

**Có đúng 22 đường dẫn `.html` khác nhau trong toàn bộ `client/`, trong đó 21 ứng với
file thật** (đủ 21 trang). Cái thứ 22 là `client/checkout.html` nằm trong một comment —
không phải link. Nghĩa là không có link chết nào.

### Nhóm B — chi tiết 3 chỗ hỏng ngầm

**1. `i18n.js`** — nặng nhất, 4 cơ chế:

```js
var EXCLUDED = ['index.html', ''];
function currentPage() {
    var parts = location.pathname.split('/');
    return parts[parts.length - 1] || 'index.html';
}
```
- `t.page[pg]` — tiêu đề 6 trang danh mục, khoá là `'sanpham-ao.html'`…
- `t.policy[currentPage()]` — nội dung dịch của 3 trang chính sách
- `currentPage() === 'cart.html'` — quyết định có gọi `window.renderCart()` không
- `EXCLUDED.indexOf(currentPage())` — quyết định dịch toàn trang hay chỉ nav

**2. `account-menu.js`** — `NO_GREET_PAGES` gồm 6 khoá (`''`, `index.html`,
`search.html`, 3 trang chính sách), tra bằng
`(location.pathname.split('/').pop() || '').toLowerCase()`.

**3. `auth.js`** — `if (redirect === 'checkout.html')`, so tham số `?redirect=` với tên
file. Tham số này do chính code sinh ra (`login.html?redirect=checkout.html`) nên hiện
tự nhất quán, nhưng vẫn là ghép cứng theo tên file.

### Cảnh báo: 2 chỗ tôi phát hiện bị phân loại NHẦM

Regex ban đầu xếp `auth.js` vào nhóm B vì bắt được `'admin.html' :`. Thực ra đó là
**ternary** `isAdmin ? 'admin.html' : 'index.html'` — thuộc nhóm A. Tương tự
`'checkout.html'` ở `auth.js:89` là redirect, không phải khoá.

Bài học lặp lại lần thứ ba trong đợt này: phân loại bằng regex luôn phải kiểm lại bằng
mắt trên từng chỗ trước khi sửa.

## TASK 7.3 — Thiết kế `client/js/routes.js` (CHƯA viết code, chờ duyệt)

### Phạm vi đã chốt

TASK 7 **KHÔNG đổi route thật**. Site vẫn chạy nguyên với URL `.html` hiện tại. Việc duy
nhất TASK 7 làm là **gỡ bỏ giả định "URL phải có đuôi .html"** khỏi code, để lần migrate
EJS sau này bật được route không-đuôi mà không vỡ ngầm.

### Ý tưởng cốt lõi: khoá trang = tên file BỎ ĐUÔI

Không phát minh hệ tên mới. Khoá của một trang chính là basename bỏ `.html`:

| URL | `currentPageKey()` |
|---|---|
| `/cart.html` | `cart` |
| `/cart` | `cart` |
| `/cart/` | `cart` |
| `/CART.HTML` | `cart` |
| `/` | `index` |
| `/index.html` | `index` |
| `/product.html?id=5` | `product` |

Chọn cách này vì mọi khoá nhóm B hiện có chỉ cần **bỏ 5 ký tự `.html`** — diff nhỏ nhất
có thể, và tự động đúng cho cả hai dạng URL. 21 tên file hiện tại đều là slug hợp lệ,
không trùng nhau, không cần bảng ánh xạ phụ.

### API đề xuất

```js
window.BreezeRoutes = {
  PATHS: { index:'index.html', cart:'cart.html', /* … 21 trang … */ },
  to(key, query),        // 'cart' -> 'cart.html' ; ('login',{redirect:'checkout'}) -> 'login.html?redirect=checkout'
  product(id),           // -> 'product.html?id=5'
  currentPageKey(),      // khoá của trang đang mở, không phụ thuộc đuôi
  keyOf(hrefOrPath),     // 'checkout.html' | 'checkout' | '/checkout/' -> 'checkout'
  is(key),               // currentPageKey() === key
};
```

`to()` là chỗ DUY NHẤT biết đuôi `.html`. Khi migrate EJS chỉ cần sửa `PATHS` (hoặc bỏ
đuôi trong đó) là toàn site đổi theo — đó chính là mục tiêu "trung tâm hoá".

### Cả 6 cơ chế nhóm B được thay thế thế nào

Đây là phần chính của TASK 7, không phải 382 link nhóm A.

| # | File | Hiện tại | Sau khi dùng routes.js |
|---|---|---|---|
| B1 | `i18n.js` | `EXCLUDED = ['index.html','']` + `EXCLUDED.indexOf(currentPage())` | `EXCLUDED = ['index']` + `EXCLUDED.indexOf(BreezeRoutes.currentPageKey())`. Bỏ luôn phần tử `''` vì `currentPageKey()` đã quy `/` về `index` |
| B2 | `i18n.js` | `t.page['sanpham-ao.html']` … (6 khoá × 2 ngôn ngữ) | Bỏ `.html` khỏi 12 khoá, tra bằng `currentPageKey()` |
| B3 | `i18n.js` | `t.policy[currentPage()]` (3 khoá) | Bỏ `.html` khỏi 3 khoá, tra bằng `currentPageKey()` |
| B4 | `i18n.js` | `currentPage() === 'cart.html'` → gọi `renderCart()` | `BreezeRoutes.is('cart')` |
| B5 | `account-menu.js` | `NO_GREET_PAGES` 6 khoá + `location.pathname.split('/').pop().toLowerCase()` | Khoá bỏ `.html`, bỏ luôn phần tử `''`; tra bằng `currentPageKey()` |
| B6 | `auth.js` | `redirect === 'checkout.html'` | `BreezeRoutes.keyOf(redirect) === 'checkout'` — chấp nhận cả `?redirect=checkout` lẫn `?redirect=checkout.html` |

Sau bước này, **hàm `currentPage()` trong `i18n.js` bị xoá hẳn** — không còn nơi nào tự
cắt `location.pathname` nữa.

### Nhóm A xử lý tới đâu

| Nhóm A ở đâu | Số | Xử lý ở TASK 7 |
|---|---|---|
| `location.href/replace/assign` trong JS | 19 | **CÓ** — thay bằng `BreezeRoutes.to(...)` |
| Chuỗi `href="..."` do JS sinh | 27 | **CÓ** — thay bằng `BreezeRoutes.to(...)` / `.product(id)` |
| `href` tĩnh trong HTML | 336 | **KHÔNG** — xem dưới |

**Đề xuất để 336 link HTML lại cho lần migrate EJS.** Không có template engine thì chỉ có
hai cách: (a) viết JS sửa `href` lúc chạy — gây nháy link, hỏng khi tắt JS, hại SEO;
(b) sửa tay 336 chỗ rồi vài tuần nữa sửa lại lần hai khi lên EJS. Cả hai đều tệ hơn là
để partial EJS render bằng `ROUTES` ngay từ đầu. Phần lớn 336 link nằm trong drawer menu
và footer — vốn sẽ thành partial.

### Vị trí nạp

`routes.js` không phụ thuộc gì, nhưng `account-menu.js` gọi `currentPageKey()` **ngay lúc
parse** (tính `hideGreeting` trong IIFE). Nên đặt vào **nhóm 2 (cấu hình)** của thứ tự
chuẩn TASK 5: `firebase-config.js` → `api-config.js` → **`routes.js`**. Như vậy chắc chắn
đứng trước mọi file dùng nó.

### Rủi ro và cách chặn

| Rủi ro | Cách chặn |
|---|---|
| Sót một khoá `.html` → hỏng ngầm, không lỗi console | Sau khi sửa, grep chặn: không được còn `'*.html'` nào làm **khoá object** hay vế **so sánh** trong `client/js/` |
| `currentPageKey()` sai ở dạng URL lạ | Viết test bảng trước, phủ 10 dạng URL gồm `/`, đuôi hoa, dấu `/` cuối, query, hash |
| Đổi khoá i18n làm mất bản dịch | Test khoá `t.page`/`t.policy` khớp đúng cho cả 6 trang danh mục + 3 trang chính sách, ở cả VI và EN |

## QUYẾT ĐỊNH: 336 link `.html` tĩnh trong HTML — CỐ Ý để lại cho migrate EJS

**Đây không phải việc bỏ sót.** Đã cân nhắc và chốt ở TASK 7.

Mục 7.5 của kế hoạch gốc yêu cầu xử lý 336 link `.html` tĩnh trong HTML. Đã bỏ khỏi
phạm vi TASK 7, vì không có template engine thì chỉ còn hai cách, cả hai đều tệ hơn:

| Cách | Nhược điểm |
|---|---|
| Viết JS sửa `href` lúc chạy | Nháy link khi tải, hỏng hoàn toàn khi tắt JS, hại SEO |
| Sửa tay 336 chỗ ngay bây giờ | Phải sửa **lần thứ hai** khi lên EJS — lãng phí, và tăng rủi ro sai sót gấp đôi |

Phần lớn 336 link nằm trong **drawer menu và footer** — hai khối vốn sẽ thành partial EJS.
Khi migrate, partial render bằng `BreezeRoutes.PATHS` là xong một lần, đúng chỗ.

**Người làm migrate EJS cần biết:** `client/js/routes.js` đã có sẵn bảng `PATHS` cho cả 21
trang. Dùng nó khi render partial thay vì gõ lại đường dẫn.

Phần nhóm A trong JS (19 redirect + 27 chuỗi `href` do JS sinh) thì ĐÃ xử lý ở TASK 7.

## TASK 7.4 — đã áp dụng

`client/js/routes.js` là **file duy nhất trong client biết đuôi `.html`**. Nạp ở nhóm cấu
hình (sau `api-config.js`) vì `account-menu.js` gọi `currentPageKey()` ngay lúc parse.

### Kiểm kê 7.1 bỏ sót 24 chỗ nhóm B

Ngoài 6 cơ chế đã liệt kê, `i18n.js` còn **24 chỗ so `href` đọc từ DOM với tên file**
để chọn nhãn dịch cho nav / mega menu / footer / sidebar / drawer:

```js
var href = a.getAttribute('href') || '';
if (href === 'sanpham-ao.html') a.textContent = t.megaItems.shirt;
```

Cùng loại hỏng ngầm: link đổi sang dạng không đuôi thì nhãn ngừng dịch, không báo lỗi.
Nay dùng `BreezeRoutes.keyOf(href)`. Tổng nhóm B thật: **30 chỗ**, không phải 2 như kế
hoạch ghi.

### Chốt chặn hồi quy

`group-b-route-keys.test.js` có một assertion quét toàn bộ `client/js/`: **không file nào
ngoài `routes.js` được dùng tên file `.html` làm khoá object hay vế so sánh**. Ai vô tình
thêm lại sẽ bị test chặn ngay.

## Việc còn nợ (phát hiện trong lúc dọn, CỐ Ý chưa sửa)

Ghi ở đây để không trôi mất qua các task sau.

### N-1 — Hoá đơn hiện "Giảm giá: −0đ" với voucher giảm 0đ

- **Ở đâu:** `client/js/page-invoice.js`, điều kiện `if (discount > 0 || o.voucher_code)`
- **Hiện tượng:** đơn áp voucher không giảm tiền hàng (vd mã freeship) có
  `discount_amount = 0` nhưng vẫn có `voucher_code`, nên dòng giảm giá **vẫn hiện**
  và in ra "−0đ" trên hoá đơn.
- **Đúng hay sai:** nhánh `|| o.voucher_code` là **có chủ đích** — đã áp mã thì hoá
  đơn nên ghi nhận. Vấn đề chỉ nằm ở chỗ hiển thị "−0đ" trông kỳ trên bản in.
- **Đã có test phủ:** `client/js/__tests__/page-invoice.test.js`, case
  "giam 0 NHUNG co voucher_code -> HIEN". Test đang khoá hành vi **hiện tại**; nếu
  sau này đổi cách hiển thị thì phải sửa case đó theo.
- **Gợi ý khi xử lý:** giữ dòng nhưng đổi text thành tên mã + "miễn phí vận chuyển"
  thay vì "−0đ". Cần chốt với người dùng vì đây là thay đổi nội dung hoá đơn.
- **Mức độ:** thấp, không sai số tiền. Tổng vẫn lấy `total_amount` thật từ DB.

## Test tự động cho client

`client/js/__tests__/` — chạy `node client/js/__tests__/run-all.js`, không cần cài
thư viện ngoài. Hiện có **168 assertion / 8 file**, phủ toàn bộ `page-*.js` tách ra
ở TASK 3. Đã kiểm chứng bộ test thật sự bắt lỗi: cố ý phá điều kiện hết hàng trong
`page-cart.js` thì 4 case đỏ và runner thoát mã 1.

Chạy lại bộ này sau mỗi bước của TASK 4-9 để biết việc gom hàm có làm vỡ trang nào
không. Chi tiết và giới hạn: xem `client/js/__tests__/README.md`.

## Tiến độ

| TASK | Trạng thái | Commit |
|---|---|---|
| 1 — Dọn file chết, file rác | ✅ xong | `f804104` |
| 2 — Line ending + BOM | ✅ xong | `c43a7e8`, `c665c63` |
| 3 — Tách JS inline (8 trang) | ✅ xong | `f1821e6` → `c362f01` |
| 4 — Gom hàm trùng | ✅ xong | `1c8f359` → `b8ddc62` |
| 5 — Chuẩn hoá thứ tự script | ✅ xong | `6908e92` (5.3), `2231944` (5.4) |
| 6 — Chuẩn hoá CSS | ✅ xong (6.2–6.3) | `1da43f3`, `e524cc3` |
| 7 — Bỏ hardcode `.html` | ✅ xong | `6a5eb87` |
| 8 — Đồng bộ partial | chưa làm | |
| 9 — Gộp 6 trang danh mục | chưa làm | |
| 10 — Kiểm tra tổng thể | chưa làm | |

Checkpoint trước cả đợt: `5397db8`.

### File dùng chung mới tạo ở TASK 4

| File | Chứa | Gộp từ |
|---|---|---|
| `client/js/utils-format.js` | `money`, `esc` | 8 bản money (3 tên) + 9 bản esc (2 tên) |
| `client/js/utils-i18n.js` | `t` | 8 bản y hệt nhau |
| `client/js/filter-ui.js` | `toggleFilter` | 6 bản giống nhau từng byte |

**KHÔNG gộp, cố ý:** `fmtDate`/`fmtDateVN` (3 bản khác hẳn), `lang`/`_lang`/`locale`
(3 bản khác hẳn), `render` (4 bản khác hẳn — cần đổi tên, chưa làm),
`admin.js:tr` (có tham số `fallback`), `checkout.js`/`voucher.js` `money`
(dùng `Intl.NumberFormat`, voucher có `Math.round`).

### File JS mới tạo ở TASK 3

`client/js/page-login.js`, `page-cart.js`, `page-orders.js`, `page-search.js`,
`page-index-slider.js`, `page-product.js`, `page-profile.js`, `page-invoice.js`.

Ba file có **ràng buộc vị trí bắt buộc** (đã ghi comment cảnh báo ở đầu mỗi file) vì
đọc DOM / gắn listener ngay lúc parse, không chờ `DOMContentLoaded`:
`page-search.js`, `page-product.js`, `page-index-slider.js`. TASK 5 không được dời
chúng lên trước phần markup tương ứng.
