# Kiểm thử BREEZE

## Chạy nhanh sau khi sửa code

Chạy từ thư mục gốc của project:

```bash
node client/js/__tests__/run-all.js
npm --prefix server test
node server/tools/domdiff.js --selftest
```

Test client chỉ dùng Node có sẵn, không cần trình duyệt hay thư viện test ngoài. `run-all.js` tự tìm toàn bộ `*.test.js` trong thư mục này; thêm file mới không cần sửa danh sách. Test backend dùng `node:test` qua script `server/package.json`.

Trên PowerShell có thể dùng `npm.cmd --prefix server test` nếu chính sách thực thi chặn `npm.ps1`.

## Khi sửa luồng size, giỏ hàng hoặc đặt hàng

| Lớp kiểm thử | Lệnh | Điều kiện |
|---|---|---|
| Frontend UI và helper | `node client/js/__tests__/run-all.js` | Node; DOM giả |
| Backend, HTTP giả và giao dịch giả | `npm --prefix server test` | Node, dependencies server |
| SQL tồn kho | `node server/scripts/test-inventory-sql.js` | SQL Server hiện hành; bảng thử tạm |
| SQL hủy đơn | `node server/scripts/test-cancel-sql.js` | SQL Server hiện hành; bảng thử tạm |
| Toàn vẹn sản phẩm/đơn | `node server/scripts/verify-product-integrity-sql.js` | SQL Server hiện hành; dòng thử tự dọn |
| Sổ kho/checkout/cạnh tranh | `node server/scripts/test-inventory-movements-sql.js` | SQL Server hiện hành; dòng thử tự dọn |
| Biến thể size từ API đến SQL | `node server/scripts/test-size-variants-sql.js` | SQL Server hiện hành; dòng thử tự dọn |
| Chuỗi migration 003–013 | `node server/scripts/verify-migration-chain.js` | `sqlcmd`, quyền tạo/xóa database tạm; không chạy `--fresh` trên database cửa hàng |
| Audit dữ liệu hiện hành | `node server/scripts/audit-inventory-movements.js` và `node server/scripts/audit-product-integrity.js` | SQL Server hiện hành; chỉ đọc |
| Route, asset, i18n, CSP | `node server/tools/regression.js` | Server đang chạy ở cổng 3000 |
| So DOM EJS với mốc cũ | `node server/tools/verify-all.js` | Git có các commit baseline; chạy selftest trước khi so |

Các script SQL tích hợp tự tạo dữ liệu thử và dọn trong `finally`; vẫn nên chạy lần lượt để dễ xác định lỗi. `verify-all.js` hiện báo 2/18 trang lệch ở product/orders vì giao diện của các task sau EJS đã đổi; đừng sửa `KNOWN`/baseline chỉ để làm xanh kết quả. Dùng diff để xem nội dung thay đổi có chủ ý hay không.

## Bộ test client hoạt động thế nào

Script client là JS cổ điển trên trình duyệt, không phải module. `helpers/sandbox.js` nạp file thật bằng `vm.runInContext` vào `helpers/dom.js` (DOM giả). `helpers/assert.js` tổng hợp assertion và đặt exit code. Nếu code đọc DOM ngay lúc parse, fixture phải dựng DOM trước `load()`; xem `page-search.test.js` và `page-product.test.js`.

Test DOM giả kiểm tra logic và HTML được sinh ra, nhưng không xác nhận CSS, responsive, focus thực trên trình duyệt, bản in, hay thứ tự thực thi của các thẻ `<script>`. Các phần đó cần checklist duyệt tay trong `CHECKLIST-EJS.md` và `CHECKLIST-CHANGE-PASSWORD.md`.
