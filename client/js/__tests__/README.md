# Test cho script phía client

Bộ test cho các file `client/js/page-*.js` được tách ra ở TASK 3 của đợt dọn dẹp
(xem [../../../CLEANUP.md](../../../CLEANUP.md)).

## Chạy

```bash
node client/js/__tests__/run-all.js     # chạy tất cả
node client/js/__tests__/page-cart.test.js   # chạy riêng một file
```

Không cần cài gì thêm — chỉ dùng Node có sẵn, **không phụ thuộc thư viện ngoài**.
Thoát với mã khác 0 nếu có case fail.

## Cách hoạt động

Các file `page-*.js` là script cổ điển chạy trong trình duyệt (không phải module,
không `export`). Nên test nạp chúng bằng `vm.runInContext` vào một sandbox có
**DOM giả** — đủ để chạy `getElementById`, `querySelector`, `classList`,
`addEventListener`… mà không cần trình duyệt thật hay jsdom.

| File | Vai trò |
|---|---|
| `helpers/dom.js` | DOM giả tối giản (`El`, `makeDoc`) |
| `helpers/sandbox.js` | `load()` nạp một file `page-*.js` kèm global trình duyệt |
| `helpers/assert.js` | `check` / `eq` / `note`, tự tổng kết và đặt exit code |
| `run-all.js` | Chạy hết `*.test.js`, gom kết quả |

Phần tử nào code đọc **ngay lúc parse** thì test phải tạo sẵn **trước khi** gọi
`load()` — xem `page-search.test.js` và `page-product.test.js` làm mẫu.

## Giới hạn cần biết

DOM giả **không phải trình duyệt thật**. Nó không có layout, không CSS, không
cascade sự kiện. Những thứ sau **test này không kiểm được**, phải mở trình duyệt:

- Giao diện, dark/light mode, responsive, FOUC
- Việc in hoá đơn (`window.print()` + `@media print`)
- Thứ tự thực thi thật giữa các thẻ `<script>` trên cùng một trang
- Hành vi `defer` / `async`

Đổi lại nó chạy trong vài giây và bắt được lỗi logic — chính là loại lỗi mà việc
tách file dễ gây ra nhất.

## Khi sửa code phía client

Chạy `run-all.js` trước khi commit. Nếu một case fail mà bạn tin là code đúng, hãy
kiểm tra **stub trước** — trong lúc làm TASK 3 đã có 6 lần báo đỏ hoá ra đều do DOM
giả thiếu thứ gì đó (thiếu `CustomEvent`, sai tên endpoint, API trả
`{addresses:[...]}` chứ không phải mảng trần…), không phải code sai.
