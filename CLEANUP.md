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
| Link `.html` hardcode trong JS | 113 | dùng module routes | TASK 7 |
| Key tra cứu phụ thuộc `.html` | 2 chỗ | 0 | TASK 7 |

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
| 6 — Chuẩn hoá CSS | chưa làm | |
| 7 — Bỏ hardcode `.html` | chưa làm | |
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
