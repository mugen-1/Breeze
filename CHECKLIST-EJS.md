# Checklist test tay sau khi migrate EJS

Phần này máy **không** làm được: cần đăng nhập Firebase thật, cần mắt nhìn giao diện,
cần máy in. Mọi thứ tự động hoá được đã chạy rồi (xem cuối file).

**Trước khi bắt đầu:** `cd server && node server.js`, mở `http://localhost:3000`.

**Cách đối chiếu nhanh khi thấy nghi ngờ:** 18 file `.html` cũ **vẫn còn nguyên** trong
`client/`. Muốn xem bản cũ, mở `server/routes/pages.js`, comment dòng khoá đó trong bảng
`PAGES`, khởi động lại — `express.static` sẽ trả lại đúng file cũ. Không cần rollback git.

---

## A. Giao diện — cần nhìn bằng mắt (máy không kiểm được)

Với **mỗi** trang dưới đây, xem ở **cả chế độ Sáng và Tối** (đổi ở Hồ sơ → Giao diện):

- [ ] `/` và `/index.html` — hero slider chạy, **không trắng trơn lúc mới tải**, 3 ảnh đổi vòng
- [ ] `/sanpham-ao.html` — lưới sản phẩm, **rê chuột vào ảnh đổi ảnh** (chỉ trang này có, xem H-1)
- [ ] `/sanpham-quan.html`, `/sanpham-giay.html`, `/handbags.html`, `/gold-jewellery.html`, `/sale.html`
- [ ] `/product.html?id=1` — ảnh lớn + ảnh nhỏ, chọn size, nút thêm giỏ
- [ ] `/search.html?q=quan` — ra **10 card**, header hiện **ô tìm kiếm thật** (không phải icon kính lúp)
- [ ] `/cart.html`, `/orders.html`, `/profile.html`
- [ ] `/login.html`, `/signup.html`, `/forgot-password.html`
- [ ] 3 trang chính sách
- [ ] Mở drawer menu (nút ☰) ở vài trang khác nhau — trượt ra, bấm nền tối thì đóng
- [ ] Thu nhỏ cửa sổ xuống cỡ điện thoại ở **1 trang danh mục** và **1 trang chính sách**

> ⚠ **Chú ý riêng cỡ điện thoại:** 7 trang (6 danh mục + `product`) vốn **không có**
> `<meta viewport>` và **không có `<!DOCTYPE>`** — đợt này giữ nguyên y hệt, nên chúng
> vẫn hiển thị trên điện thoại **giống hệt trước**. Nếu thấy chúng xấu trên mobile thì
> đó là lỗi có sẵn, không phải do migrate. Xem mục "Phát hiện thêm" trong CLEANUP.md.

## B. Luồng nghiệp vụ — cần tài khoản thật

- [ ] Đăng ký tài khoản mới
- [ ] Đăng nhập / đăng xuất
- [ ] Quên mật khẩu (nhận được email)
- [ ] Hồ sơ: đổi avatar, thêm/sửa/xoá địa chỉ, thẻ đã lưu, 3 toggle riêng tư
- [ ] Hồ sơ: đổi Sáng/Tối bằng nút trong mục Giao diện
- [ ] Thêm hàng vào giỏ → **drawer giỏ mở đúng**
- [ ] Giỏ hàng: đổi số lượng, xoá dòng, tổng tiền đúng
- [ ] Bấm Thanh toán từ giỏ → sang `/checkout.html`
- [ ] Chưa đăng nhập mà bấm Thanh toán → sang `login.html?redirect=checkout` → đăng nhập
      xong **quay lại checkout**
- [ ] Checkout: áp mã giảm giá, đặt hàng thành công
- [ ] Lịch sử đơn hàng hiện đơn vừa đặt
- [ ] Xuất hoá đơn PDF (`window.print()`) — **bố cục bản in không vỡ**, nền giấy trắng
- [ ] Xoá tài khoản: chặn 409 khi còn đơn pending
- [ ] Trang quản trị: KPI, biểu đồ doanh thu, donut trạng thái

## C. Đổi ngôn ngữ

- [ ] Bấm nút **VI/EN ở chân trang** (không gọi hàm trong console) trên 3–4 trang khác nhau
- [ ] Tiêu đề tab đổi theo
- [ ] Không thấy khoá thô kiểu `pf.save`, `title.cart` lọt ra màn hình

---

## Đã tự động kiểm rồi — không cần làm lại tay

| Hạng mục | Kết quả |
|---|---|
| 21/21 trang HTTP 200 | ✅ |
| 18/18 trang migrate khớp DOM contract với bản cũ | ✅ |
| Asset `.js`/`.css` gãy | 0 / 37 |
| `BreezeRoutes` / `BreezeTheme` / `__i18n` / `money` đủ | 21/21 |
| `currentPageKey()` đúng khoá | 21/21 |
| Khoá i18n có đủ bản VI + EN | 311 khoá, 0 thiếu |
| API công khai / cần quyền | 200 / 401 |
| Số card danh mục / khuyến mãi / tìm kiếm | 6 / 14 / 10 |
| 3 trang không migrate vẫn qua static | ✅ |
| Bộ test client | 12 file, 315 assertion, 0 fail |

Chạy lại bất cứ lúc nào:

```bash
node server/tools/regression.js    # bảng trên
node server/tools/verify-all.js    # so DOM 18 trang với file .html cũ
```

---

## Sau khi bạn tick xong

Báo tôi để làm nốt **phase dọn dẹp**: xoá 18 file `.html` đã được thay thế (giữ lại
`invoice.html`, `admin.html`, `checkout.html`) và gỡ route `/ejs-healthcheck`.
**Chưa xoá gì cả** cho tới khi bạn xác nhận.
