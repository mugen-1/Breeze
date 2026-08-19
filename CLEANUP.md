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
| Thứ tự script | mỗi trang một kiểu | 1 thứ tự chuẩn | TASK 5 |
| Trang thiếu `theme.js` | 19 | 0 | 20 |
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
| 5 — Chuẩn hoá thứ tự script | chưa làm | |
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
