/* utils-format.js — hàm định dạng dùng chung toàn site.
   Nạp TRƯỚC mọi script dùng tới nó. Khai báo global có chủ đích (giống cart.js),
   vì các script khác là script cổ điển, không phải module.

   Trước đây mỗi trang tự khai báo một bản riêng: 10 bản của hàm định dạng tiền
   nằm rải ở admin.js, cart.js, cart-drawer.js, products-render.js và 4 file
   page-*.js, dưới 3 cái tên khác nhau (money / formatPrice / _cp). Xem lịch sử
   đối chiếu ở CLEANUP.md. */

/* Định dạng tiền Việt Nam: 250000 -> "250.000₫"

   Vì sao có `|| 0`: các bản cũ dùng thẳng `Number(n)` nên với null/undefined
   sẽ hiện "NaN₫" ra giao diện; riêng bản ở cart.js còn gọi `n.toLocaleString()`
   không bọc Number() nên ném TypeError luôn. Bản gộp lấy theo bản an toàn nhất
   đã từng tồn tại (bản của invoice).

   Ký hiệu ₫ (U+20AB) là ký hiệu tiền tệ chuẩn của đồng Việt Nam. Trước đây site
   dùng lẫn lộn: ₫ ở trang thanh toán/voucher, còn chữ "đ" ở giỏ hàng, đơn hàng,
   hoá đơn và trang quản trị. Nay thống nhất về ₫. */
function money(n) {
    return Number(n || 0).toLocaleString('vi-VN') + '₫';
}

/* Escape ký tự đặc biệt trước khi nhét dữ liệu vào chuỗi HTML.

   Có 9 bản rải khắp client/js dưới 2 tên (esc / escapeHtml). 8 bản chỉ escape
   & < > và dấu nháy KÉP; riêng bản của admin.js escape thêm dấu nháy ĐƠN.
   Lấy theo bản admin vì nó chặn được cả XSS qua thuộc tính HTML viết bằng nháy
   đơn, kiểu title='...' — 8 bản kia để lọt. */
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
