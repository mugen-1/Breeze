// Modal đổi mật khẩu trong trang tài khoản (profile.html) — Phase 2B.
// Trước đó đây là một trang riêng; giờ là modal overlay mở từ hàng "Mật khẩu" trong
// mục "Chi tiết tài khoản". Đổi xong thì đóng modal và ở lại trang, không điều hướng.
//
// KIẾN TRÚC: mật khẩu do Firebase Auth quản lý, KHÔNG nằm trong SQL Server và KHÔNG
// bao giờ rời khỏi trình duyệt để đi về backend của mình. File này vì vậy không có một
// lệnh fetch() nào tới server/. (server/routes/account.js có verify-password, nhưng đó
// là luồng XOÁ tài khoản — không liên quan và không dùng lại ở đây.)
//
// RÀNG BUỘC THỨ TỰ LOAD — nạp cùng profile.html, phải nằm sau:
//   - firebase-config.js : cần global `firebase` (EmailAuthProvider)
//   - i18n.js            : cần window.__i18n
//   - utils-i18n.js      : cần t()
//   - auth-helper.js     : cần window.AuthHelper (getUser)
//   - page-profile.js    : cần window.ProfileToast (thông báo ngoài trang)
// và sau markup của modal, vì code đọc DOM + gắn listener ngay lúc parse.
// Trong pages-config.js, entry profile khai pageJs theo đúng thứ tự đó.
//
// KHÔNG có guard đăng nhập ở đây: page-profile.js đã guard cả trang (chưa đăng nhập thì
// #settings-body không hiện, nên nút mở modal cũng không với tới được).
//
// ĐỔI MẬT KHẨU XONG THÌ CÁC PHIÊN KHÁC RA SAO — đã đối chiếu với code thật của dự án:
//   1. Firebase thu hồi refresh token của MỌI phiên khác. Tab hiện tại không bị đá ra:
//      lời gọi updatePassword trả về bộ token mới và SDK compat tự thay vào, nên
//      onAuthStateChanged KHÔNG phát trạng thái null ở tab này.
//   2. ID token đã phát trước đó VẪN CÒN HIỆU LỰC tới khi hết hạn (~1 giờ) — thu hồi
//      refresh token không giết được JWT đã ký. Phiên khác chỉ thực sự mất quyền ở lần
//      làm mới token kế tiếp.
//   3. Backend của mình KHÔNG bịt khe đó: server/middleware/auth.js:75 gọi
//      verifyIdToken(token) mà không truyền checkRevoked:true. Nên trong tối đa ~1 giờ
//      sau khi đổi mật khẩu, một ID token cũ vẫn gọi được /api/* bình thường.
//      Muốn cắt ngay thì phải sửa middleware — việc đó nằm ngoài trang này.

/* Luồng: reauthenticateWithCredential (xác minh mật khẩu hiện tại) -> updatePassword.
   Cú pháp COMPAT (firebase 9.23.0 compat, theo kết quả Phase 0): phương thức nằm trên
   chính đối tượng user, không phải hàm rời như bản modular. */
(function () {
    'use strict';

    var MIN_LEN = 8;              // độ dài tối thiểu của mật khẩu MỚI
    var CLOSE_DELAY = 1500;       // ms — đủ đọc thông báo thành công trước khi modal đóng
    var FADE_MS = 220;            // khớp transition của .addr-modal-overlay trong profile.css

    // Giống hệt hằng trong page-profile.js: modal đổi mật khẩu bám đúng pattern modal
    // "Thêm địa chỉ", nên focus trap cũng phải dùng cùng một danh sách.
    var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    // Mã lỗi Firebase -> khoá i18n. Cùng cách làm với ERROR_KEYS trong auth.js.
    var ERROR_KEYS = {
        // Bốn mã dưới đây đều có nghĩa "mật khẩu hiện tại sai" ở bước reauthenticate.
        // Firebase bản mới trả invalid-credential thay cho wrong-password nên phải nhận
        // cả hai; user-mismatch xảy ra khi credential không thuộc user đang đăng nhập.
        'auth/wrong-password': 'au.cpErrCurrent',
        'auth/invalid-credential': 'au.cpErrCurrent',
        'auth/invalid-login-credentials': 'au.cpErrCurrent',
        'auth/user-mismatch': 'au.cpErrCurrent',
        'auth/weak-password': 'au.cpErrWeak',
        'auth/too-many-requests': 'au.eTooMany',
        'auth/requires-recent-login': 'au.cpErrStale',
        'auth/network-request-failed': 'au.cpErrNetwork',
        'auth/user-not-found': 'au.eNoUser'
    };

    var FIELDS = ['cp-current', 'cp-new', 'cp-confirm'];

    var _busy = false;       // đang gọi Firebase — chặn double-submit
    var _trigger = null;     // phần tử đã mở modal, để trả focus về khi đóng
    var _closeTimer = null;  // hẹn giờ dọn dẹp sau hiệu ứng đóng — PHẢI huỷ khi mở lại
    /* Đã đổi xong, đang đếm ngược để đóng. Tách khỏi _busy vì hai cờ chặn hai thứ khác
       nhau: _busy chặn cả việc ĐÓNG modal, còn _done chỉ chặn GỬI THÊM — chính lượt
       đóng tự động cuối cùng phải đi qua được. */
    var _done = false;

    function byId(id) { return document.getElementById(id); }

    /* ===== Vùng thông báo dùng chung =====
       textContent, KHÔNG BAO GIỜ innerHTML: nội dung có thể là câu dịch, không được để
       chuỗi nào biến thành thẻ HTML.
       Ẩn/hiện do .addr-field-msg:empty lo (giống thông báo lỗi của modal địa chỉ), nên
       không cần class .show hay style inline. .is-ok đổi sắc đỏ sang xanh khi thành công. */
    function showMsg(key, isError) {
        var el = byId('cp-msg');
        if (!el) return;
        if (isError) el.classList.remove('is-ok');
        else el.classList.add('is-ok');
        el.textContent = t(key);
    }

    function clearMsg() {
        var el = byId('cp-msg');
        if (!el) return;
        el.classList.remove('is-ok');
        el.textContent = '';
    }

    function fail(key, focusId) {
        showMsg(key, true);
        var el = byId(focusId);
        if (el) el.focus();
    }

    /* ===== Nút hiện/ẩn mật khẩu ===== */
    function toggles() {
        return document.querySelectorAll('[data-toggle-pw]');
    }

    // Đồng bộ nhãn + icon của MỘT nút theo trạng thái thật của input nó điều khiển.
    function syncToggle(btn) {
        var input = byId(btn.getAttribute('data-toggle-pw'));
        if (!input) return;
        var showing = input.type === 'text';
        btn.setAttribute('aria-pressed', showing ? 'true' : 'false');
        btn.setAttribute('aria-label', t(showing ? 'au.cpHide' : 'au.cpShow'));
        var icon = btn.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-eye', !showing);
            icon.classList.toggle('fa-eye-slash', showing);
        }
    }

    function onToggleClick(btn) {
        var input = byId(btn.getAttribute('data-toggle-pw'));
        if (!input) return;
        input.type = (input.type === 'text') ? 'password' : 'text';
        syncToggle(btn);
        input.focus();
    }

    function bindToggles() {
        toggles().forEach(function (btn) {
            syncToggle(btn);
            btn.addEventListener('click', function () { onToggleClick(btn); });
        });
    }

    /* ===== Ô nhập ===== */
    // Xoá sạch 3 ô + đưa cả 3 về type=password. Gọi lúc MỞ và lúc ĐÓNG modal: mật khẩu
    // không được nằm lại trong DOM sau khi modal đóng, kể cả khi bấm Huỷ giữa chừng.
    function wipeFields() {
        FIELDS.forEach(function (id) {
            var el = byId(id);
            if (el) { el.value = ''; el.type = 'password'; }
        });
        toggles().forEach(syncToggle);
    }

    /* ===== Nút gửi ===== */
    function setBusy(busy) {
        _busy = busy;
        var btn = byId('cp-submit');
        if (!btn) return;
        // _done: đổi xong rồi thì nút phải KHOÁ luôn tới khi modal đóng, dù đã hết bận.
        btn.disabled = busy || _done;
        btn.textContent = t(busy ? 'au.cpSaving' : 'au.cpSubmit');
    }

    /* ===== Tài khoản không có mật khẩu =====
       Đăng nhập bằng Google/Facebook thì providerData không có mục 'password' và
       updatePassword sẽ ném lỗi. Báo ngay lúc mở + khoá nút gửi, thay vì để người dùng
       gõ đủ 3 ô rồi mới ăn lỗi.

       Ở bản trang riêng (Phase 2) chỗ này ẩn hẳn form. Trong modal thì ẩn form nghĩa là
       một hộp thoại rỗng, nên đổi thành khoá nút gửi — cùng ý, hợp ngữ cảnh hơn. */
    function hasPasswordProvider(user) {
        var list = user && user.providerData;
        if (!list || !list.length) return true;   // không đọc được -> cứ cho qua, Firebase sẽ chặn
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].providerId === 'password') return true;
        }
        return false;
    }

    /* ===== Mở / đóng modal — bám đúng pattern openModal/closeModal của modal địa chỉ
       trong page-profile.js: hidden -> is-open, khoá cuộn nền, focus ô đầu sau 40ms,
       trả focus về nút đã mở khi đóng. ===== */
    function openModal() {
        var overlay = byId('cp-modal-overlay');
        if (!overlay) return;
        _trigger = document.activeElement;

        /* Huỷ hẹn giờ dọn dẹp của lần ĐÓNG trước. Không huỷ thì đóng rồi mở lại trong
           vòng FADE_MS (cỡ một nhịp nhấp đúp) sẽ để cái hẹn giờ cũ nổ SAU khi đã mở:
           nó set hidden = true làm modal biến mất, trong khi .is-open và khoá cuộn nền
           vẫn còn — người dùng kẹt ở trang không cuộn được mà chẳng thấy hộp thoại nào. */
        clearTimeout(_closeTimer);
        _closeTimer = null;

        wipeFields();
        clearMsg();
        _done = false;        // phải đặt TRƯỚC setBusy: setBusy đọc _done để quyết định khoá nút
        setBusy(false);

        var user = window.AuthHelper && window.AuthHelper.getUser();
        if (user && !hasPasswordProvider(user)) {
            showMsg('au.cpNoPassword', true);
            var btn = byId('cp-submit');
            if (btn) btn.disabled = true;
        }

        overlay.hidden = false;
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(function () { overlay.classList.add('is-open'); });
        setTimeout(function () { var f = byId('cp-current'); if (f) f.focus(); }, 40);
    }

    function closeModal() {
        var overlay = byId('cp-modal-overlay');
        if (!overlay) return;

        /* Đang gọi Firebase thì KHÔNG cho đóng. Đóng lúc này người dùng đinh ninh là đã
           huỷ, nhưng yêu cầu vẫn chạy tiếp và mật khẩu vẫn đổi — sai lệch nguy hiểm ở
           đúng thao tác bảo mật. Nút đã hiện "Đang đổi…", cửa sổ chờ chỉ là một vòng
           mạng, nên chặn ở đây an toàn hơn là để hiểu nhầm. */
        if (_busy) return;

        overlay.classList.remove('is-open');
        document.body.style.overflow = '';

        // Xoá ô NGAY, không đợi hết hiệu ứng: đây là yêu cầu bảo mật, không phải mỹ thuật.
        wipeFields();

        // Thông báo thì để lại tới khi modal khuất hẳn, nếu không dòng "đã đổi thành công"
        // biến mất ngay giữa lúc đang mờ dần.
        _closeTimer = setTimeout(function () {
            _closeTimer = null;
            overlay.hidden = true;
            clearMsg();
            _done = false;
            setBusy(false);
        }, FADE_MS);

        if (_trigger && _trigger.focus) { try { _trigger.focus(); } catch (e) { /* bỏ qua */ } }
        _trigger = null;
    }

    // Focus trap + ESC — chép đúng onModalKeydown của modal địa chỉ.
    function onModalKeydown(e) {
        if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); closeModal(); return; }
        if (e.key !== 'Tab' && e.keyCode !== 9) return;
        var modal = byId('cp-modal');
        if (!modal) return;
        var nodes = modal.querySelectorAll(FOCUSABLE);
        var list = [];
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].offsetWidth > 0 || nodes[i].offsetHeight > 0 || nodes[i] === document.activeElement) list.push(nodes[i]);
        }
        if (!list.length) return;
        var first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    /* ===== Gửi form =====
       Nghe sự kiện 'submit' của <form> nên phím Enter trong bất kỳ ô nào cũng đi qua
       đây, không riêng cú click vào nút. */
    function submit(e) {
        e.preventDefault();
        // _busy: đang gọi Firebase. _done: đã đổi xong, đang chờ đóng — bấm thêm (hoặc gõ
        // Enter, phím không bị nút disabled chặn) sẽ ra "chưa nhập đủ" đè lên câu thành công.
        if (_busy || _done) return;

        // Đọc NGUYÊN VĂN: không trim, không lowercase, không lọc ký tự đặc biệt hay
        // khoảng trắng. Khoảng trắng đầu/cuối là một phần hợp lệ của mật khẩu.
        var cur = byId('cp-current').value;
        var nw = byId('cp-new').value;
        var cf = byId('cp-confirm').value;

        clearMsg();
        if (!cur || !nw || !cf) {
            fail('au.errFillAll', !cur ? 'cp-current' : (!nw ? 'cp-new' : 'cp-confirm'));
            return;
        }
        if (nw.length < MIN_LEN) { fail('au.cpErrShort', 'cp-new'); return; }
        if (nw !== cf) { fail('au.errConfirm', 'cp-confirm'); return; }
        if (nw === cur) { fail('au.cpErrSame', 'cp-new'); return; }

        var user = window.AuthHelper && window.AuthHelper.getUser();
        if (!user || !user.email) { fail('au.cpErrStale', 'cp-current'); return; }

        setBusy(true);
        var cred = firebase.auth.EmailAuthProvider.credential(user.email, cur);

        user.reauthenticateWithCredential(cred)
            .then(function () { return user.updatePassword(nw); })
            .then(function () {
                // Xoá ô ngay, giữ thông báo trong modal ~1.5s rồi tự đóng, ở lại trang.
                _done = true;
                wipeFields();
                showMsg('au.cpOk', false);
                setTimeout(function () {
                    closeModal();
                    // Dòng xác nhận ngoài trang, dùng lại đúng cơ chế toast của
                    // page-profile.js (không tự chế thông báo mới).
                    if (typeof window.ProfileToast === 'function') window.ProfileToast(t('au.cpOk'));
                }, CLOSE_DELAY);
            })
            .catch(function (err) {
                // Lỗi thì Ở LẠI trong modal, không đóng.
                var code = (err && err.code) || '';
                var key = ERROR_KEYS[code];
                // Mã lạ -> câu chung đã dịch. KHÔNG đổ err.message thô ra UI.
                // Console chỉ nhận MÃ lỗi: không log err nguyên khối, không log giá trị
                // của bất kỳ ô mật khẩu nào, kể cả khi đang gỡ lỗi.
                // Nối thẳng MÃ vào chuỗi thay vì truyền err làm tham số thứ hai: như vậy
                // không có đường nào để một object lạ kéo theo dữ liệu nhạy cảm ra console.
                if (!key) console.error('[change-password] mã lỗi chưa map: ' + code);
                showMsg(key || 'au.cpErrGeneric', true);
                var el = byId(key === 'au.cpErrCurrent' ? 'cp-current' : 'cp-new');
                if (el) el.focus();
            })
            .then(function () { setBusy(false); });
    }

    /* ===== Khởi động ===== */
    function init() {
        var form = byId('cp-form');
        if (!form) return;    // không ở trang có modal này

        bindToggles();
        form.addEventListener('submit', submit);

        // Nút mở: hàng "Mật khẩu · ••••• · Đổi" trong mục chi tiết tài khoản. Cùng cách
        // nút "Thêm địa chỉ" mở modal của nó — button + id, gắn listener ở đây.
        var open = byId('cp-open');
        if (open) open.addEventListener('click', openModal);

        var closeBtn = byId('cp-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);

        var cancel = byId('cp-cancel');
        if (cancel) cancel.addEventListener('click', closeModal);

        var overlay = byId('cp-modal-overlay');
        if (overlay) {
            overlay.addEventListener('keydown', onModalKeydown);
            overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeModal(); });
        }

        // Ngôn ngữ đổi -> i18n.js áp lại data-i18n-aria (luôn là 'Hiện mật khẩu') và
        // data-i18n của nút gửi. Đồng bộ lại theo trạng thái THẬT, nếu không ô đang mở
        // sẽ bị gắn nhãn "Hiện mật khẩu" trong khi mật khẩu đang hiện.
        document.addEventListener('langchange', function () {
            toggles().forEach(syncToggle);
            if (_busy) setBusy(true);
        });
    }

    init();
})();
