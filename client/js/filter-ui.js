/* filter-ui.js — thao tác giao diện của bộ lọc sản phẩm (6 trang danh mục).

   Vì sao là file riêng chứ không nhét vào filter.js: filter.js bọc kín trong IIFE
   và không lộ gì ra global — đó là điểm tốt, không nên phá. Còn toggleFilter BẮT
   BUỘC phải ở global vì HTML gọi trực tiếp qua onclick="toggleFilter(this)".

   Trước đây 6 trang danh mục mỗi trang tự khai báo một bản y hệt nhau (giống nhau
   từng byte) ngay trong thẻ <script> inline. Xem CLEANUP.md. */

/* Mở/đóng một nhóm bộ lọc ở sidebar. Nhận chính phần tử tiêu đề vừa được bấm.

   `if (list)` lấy lại từ bản từng nằm ở index.html: 6 bản đang chạy trên các trang
   danh mục đều thiếu guard này nên sẽ ném lỗi nếu tiêu đề không có phần tử kế tiếp
   (vd sau này đổi markup, hoặc nhóm lọc rỗng bị JS gỡ đi). */
function toggleFilter(el) {
    el.classList.toggle('collapsed');
    var list = el.nextElementSibling;
    if (list) {
        list.style.display = list.style.display === 'none' ? '' : 'none';
    }
}
