/* utils-i18n.js — helper i18n dùng chung. Nạp SAU i18n.js, TRƯỚC mọi script dùng t().

   Trước đây có 8 bản y hệt nhau nằm rải ở auth.js, checkout.js, payment-methods.js,
   voucher.js và 4 file page-*.js (một bản đặt tên tham số là k/p, còn lại key/params
   — thân hàm hoàn toàn tương đương). Xem CLEANUP.md. */

/* Dịch một khoá, an toàn cả khi i18n.js chưa nạp xong.

   Vì sao vẫn cần lớp bọc này dù đã có window.__i18n.t: các script gọi t() có thể
   chạy trước khi i18n.js kịp gán window.__i18n (thứ tự thẻ <script> hiện chưa
   thống nhất giữa các trang — TASK 5 mới xử lý). Khi đó trả về chính khoá thay vì
   ném lỗi, trang vẫn hiện chữ chứ không vỡ.

   KHÔNG gộp admin.js:tr() vào đây — hàm đó có tham số thứ ba `fallback` và trả về
   fallback khi khoá chưa có bản dịch, tức là làm việc khác. */
function t(key, params) {
    return (window.__i18n && window.__i18n.t) ? window.__i18n.t(key, params) : key;
}
