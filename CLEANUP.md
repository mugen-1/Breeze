# Dọn dẹp codebase trước khi migrate sang EJS master layout

Theo dõi tiến độ và **chỉ tiêu đã chốt** của đợt dọn dẹp 10 TASK. File này nằm trong
repo để chỉ tiêu không bị hỏi lại hay tranh cãi lúc review TASK 10.

## Chỉ tiêu TASK 10 — bảng đã chốt

| Chỉ số | Trước dọn dẹp | Mục tiêu | Thực tế (2026-08-20) |
|---|---|---|---|
| JS inline trong HTML | ~90.000 chars | **chỉ còn snippet FOUC** | 7.254 (6.048 FOUC + 1.206 chờ TASK 4) |
| Hàm định nghĩa trùng | 8 hàm (số này SAI, xem dưới) | 0, hoặc đã đổi tên rõ ràng | TASK 4 |
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

**TASK 4 mục 4.1 phải đối chiếu lại từng hàm từ đầu, không tin bảng.**

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
| 4 — Gom hàm trùng | chưa làm | |
| 5 — Chuẩn hoá thứ tự script | chưa làm | |
| 6 — Chuẩn hoá CSS | chưa làm | |
| 7 — Bỏ hardcode `.html` | chưa làm | |
| 8 — Đồng bộ partial | chưa làm | |
| 9 — Gộp 6 trang danh mục | chưa làm | |
| 10 — Kiểm tra tổng thể | chưa làm | |

Checkpoint trước cả đợt: `5397db8`.

### File JS mới tạo ở TASK 3

`client/js/page-login.js`, `page-cart.js`, `page-orders.js`, `page-search.js`,
`page-index-slider.js`, `page-product.js`, `page-profile.js`, `page-invoice.js`.

Ba file có **ràng buộc vị trí bắt buộc** (đã ghi comment cảnh báo ở đầu mỗi file) vì
đọc DOM / gắn listener ngay lúc parse, không chờ `DOMContentLoaded`:
`page-search.js`, `page-product.js`, `page-index-slider.js`. TASK 5 không được dời
chúng lên trước phần markup tương ứng.
