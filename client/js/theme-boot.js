/* theme-boot.js — gắn data-theme lên <html> TRƯỚC khi trình duyệt vẽ trang (chống nháy
   sai màu). Thay cho <script> inline ở 3 trang tĩnh admin / checkout / invoice: CSP chặn
   script inline, mà 3 trang này phục vụ bằng express.static nên không có nonce như 18
   trang EJS.

   PHẢI nạp trong <head>, KHÔNG defer/async: chạy trễ là trang kịp vẽ một khung màu sai.

   Chế độ do chính thẻ script khai, qua thuộc tính data-theme-mode:
     "light"  -> luôn sáng (admin, invoice — lý do ghi trong comment của từng trang);
     bỏ trống -> theo lựa chọn đã lưu (breeze-theme), không có thì theo hệ điều hành.

   Nhánh tự động là bản sao logic snippet trong server/views/partials/head.ejs — sửa một
   bên thì sửa cả bên kia. */
(function () {
    var root = document.documentElement;
    var s = document.currentScript;
    if (s && s.getAttribute('data-theme-mode') === 'light') {
        root.setAttribute('data-theme', 'light');
        return;
    }
    try {
        var t = localStorage.getItem('breeze-theme');
        if (t !== 'light' && t !== 'dark') {
            t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        root.setAttribute('data-theme', t);
    } catch (e) {
        root.setAttribute('data-theme', 'light');
    }
})();
