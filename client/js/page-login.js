// Script riêng của login.html — tách ra từ thẻ <script> inline cuối trang.
// Phải load SAU auth.js (dùng showMessage) và SAU i18n.js (dùng window.__i18n).

// Bị chuyển hướng từ nút "Đăng xuất" (account-menu) lúc CHƯA đăng nhập.
// Chờ 'langchange' (i18n.js phát khi áp ngôn ngữ) để lấy đúng bản dịch,
// và đổi lại text mỗi lần người dùng chuyển VI/EN.
(function () {
    var notice = new URLSearchParams(window.location.search).get('notice');
    if (notice !== 'need-login') return;
    function paint() {
        if (typeof showMessage !== 'function' || !window.__i18n) return;
        showMessage('login-msg', window.__i18n.t('au.notLoggedIn'), true);
    }
    document.addEventListener('langchange', paint);
    document.addEventListener('DOMContentLoaded', paint);
})();
