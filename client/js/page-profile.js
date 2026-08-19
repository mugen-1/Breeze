// Script riêng của profile.html — tách ra từ thẻ <script> inline cuối trang.
//
// Toàn bộ nằm trong MỘT IIFE dùng chung closure: 6 mảng chức năng (thông tin tài
// khoản, sổ địa chỉ, phương thức thanh toán, theme, avatar, quyền riêng tư) đều
// gọi chung t()/toast()/byId(). Tách nhỏ hơn nữa là phải refactor, nên giữ 1 file.
//
// RÀNG BUỘC THỨ TỰ LOAD — phải nằm sau:
//   - i18n.js       : cần window.__i18n
//   - auth-helper.js: cần window.AuthHelper (onChange/apiFetch)
// và sau markup của các section, vì code đọc DOM + gắn listener ngay lúc parse.
//
// window.PaymentMethods (payment-methods.js) và window.BreezeTheme (theme.js) được
// dùng BÊN TRONG hàm/handler nên load sau file này vẫn chạy đúng — không đổi thứ tự.

/* Phase 2 — shell + điều hướng section + nạp thông tin tài khoản (read-only).
   Nguồn read-only: GET /api/me (display_name, email, created_at, last_login).
   Field cá nhân mới (SĐT, ngày sinh, giới tính, quốc gia) là khung UI trống,
   CHƯA nối backend — xem các TODO(Truc) trong markup. */
(function () {
    'use strict';

    var SECTIONS = ['account', 'addresses', 'payments', 'theme', 'privacy'];   // section có thể mở
    var _meLoaded = false;                     // tránh gọi /api/me lặp

    // i18n — nhãn tĩnh do js/i18n.js áp qua data-i18n; t() dùng cho chuỗi JS sinh.
    function t(key, params) {
        return (window.__i18n && window.__i18n.t) ? window.__i18n.t(key, params) : key;
    }
    function locale() {
        return (window.__i18n && window.__i18n.current === 'en') ? 'en-GB' : 'vi-VN';
    }

    function show(id, mode) {
        var el = document.getElementById(id);
        if (el) el.style.display = mode || 'none';
    }

    function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = (val == null || val === '') ? '—' : val;
    }

    function setVal(id, val) {
        var el = document.getElementById(id);
        if (el) el.value = (val == null) ? '' : val;
    }

    // Toast: mặc định thành công; ok=false -> biến thể lỗi (đỏ trầm).
    function toast(msg, ok) {
        var t = document.createElement('div');
        t.className = 'settings-toast' + (ok === false ? ' is-err' : '');
        t.setAttribute('role', ok === false ? 'alert' : 'status');
        t.textContent = msg;
        document.body.appendChild(t);
        requestAnimationFrame(function () { t.classList.add('is-on'); });
        setTimeout(function () {
            t.classList.remove('is-on');
            setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
        }, 1900);
    }

    // display_name; nếu trống -> phần trước @ của email (khớp account-menu.js).
    function nameOf(u) {
        if (!u) return '';
        var n = u.display_name || u.displayName;
        if (!n && u.email) n = u.email.split('@')[0];
        return n || t('pf.you');
    }

    function fmtDate(s) {
        if (!s) return '—';
        var d = new Date(s);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString(locale(), {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    // Hiện tên/email tức thì từ Firebase trong lúc chờ /api/me.
    function fillFromFirebase(user) {
        if (!user) return;
        setText('ad-name', nameOf(user));
        setText('ad-email', user.email);
    }

    // Đổ toàn bộ hồ sơ (read-only + field cá nhân) từ dữ liệu server.
    var _lastMe = null;        // hồ sơ vừa nạp — dựng lại khi đổi VI/EN
    function fillProfile(u) {
        _lastMe = u;
        setText('ad-name', nameOf(u));
        setText('ad-email', u.email);
        setText('ad-created', fmtDate(u.created_at));
        setText('ad-last', fmtDate(u.last_login));
        setVal('ad-phone', u.phone);
        setVal('ad-dob', u.dob ? String(u.dob).slice(0, 10) : '');   // ISO -> YYYY-MM-DD
        setVal('ad-gender', u.gender || '');
        setVal('ad-country', u.country || '');
        // Dùng luôn dữ liệu /api/me, không gọi thêm API. Nhớ giữ lại URL hiện tại
        // để khi upload lỗi còn trả preview về đúng ảnh cũ.
        _avatarUrl = u.avatar_url || null;
        showAvatar(_avatarUrl);
    }

    // Nạp hồ sơ từ server.
    function loadMe() {
        if (_meLoaded) return;
        if (!(window.AuthHelper && window.AuthHelper.isLoggedIn())) return;
        _meLoaded = true;
        window.AuthHelper.apiFetch('/api/me')
            .then(function (r) { if (!r.ok) throw new Error('GET /api/me ' + r.status); return r.json(); })
            .then(fillProfile)
            .catch(function (e) {
                _meLoaded = false;   // cho phép thử lại lần đổi trạng thái sau
                console.error('[profile] tải /api/me lỗi:', e);
            });
    }

    // ---- Lưu field cá nhân (PUT /api/me) ----
    var PHONE_RE = /^[0-9+\-\s()]{6,20}$/;

    function formValues() {
        return {
            phone: (document.getElementById('ad-phone').value || '').trim(),
            dob: document.getElementById('ad-dob').value || '',
            gender: document.getElementById('ad-gender').value || '',
            country: document.getElementById('ad-country').value || ''
        };
    }

    // Validate phía client (đồng bộ với server); trả thông báo lỗi hoặc null.
    function validate(v) {
        if (v.phone && !PHONE_RE.test(v.phone)) return t('pf.errPhone');
        if (v.dob) {
            var dobMs = new Date(v.dob + 'T00:00:00Z').getTime();
            if (isNaN(dobMs)) return t('pf.errDob');
            if (dobMs > Date.now()) return t('pf.errDobFuture');
        }
        return null;
    }

    function saveProfile() {
        var btn = document.getElementById('ad-save');
        if (!btn || btn.disabled) return;
        var v = formValues();
        var err = validate(v);
        if (err) { toast(err, false); return; }

        var label = btn.textContent;
        btn.disabled = true;
        btn.textContent = t('pf.saving');
        window.AuthHelper.apiFetch('/api/me', { method: 'PUT', body: JSON.stringify(v) })
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (data) {
                    return { ok: r.ok, status: r.status, data: data };
                });
            })
            .then(function (out) {
                if (out.ok) { fillProfile(out.data); toast(t('pf.savedChanges')); return; }
                if (out.status === 401) return;   // phiên hết hạn -> 'authexpired' lo phần báo + đăng nhập lại
                toast((out.data && out.data.message) || t('pf.errSaveChanges'), false);
            })
            .catch(function (e) {
                console.error('[profile] lưu lỗi:', e);
                toast(t('pf.errSaveChanges'), false);
            })
            .then(function () { btn.disabled = false; btn.textContent = label; });
    }

    /* ============================================================
       Địa chỉ giao hàng (Phase 4) — CRUD qua /api/account/addresses.
       Mỗi mutation server trả { addresses: [...] } (list đầy đủ) nên
       chỉ cần render lại từ response, không cần fetch thêm.
       ============================================================ */
    var _addrLoaded = false;   // đã nạp danh sách chưa (lazy theo tab)
    var _addresses = [];       // cache list hiện tại
    var _editing = null;       // địa chỉ đang sửa (null = thêm mới)
    var _modalTrigger = null;  // element để trả focus khi đóng modal

    var ADDR_PHONE_RE = /^[0-9+\-\s()]{6,20}$/;
    var ADDR_POSTAL_RE = /^[A-Za-z0-9\s-]{2,20}$/;
    function countryName(code) { return code ? t('pf.c' + code) : ''; }
    var MSG_FIELDS = ['af-recipient', 'af-phone', 'af-line1', 'af-city', 'af-postal'];

    function byId(id) { return document.getElementById(id); }
    function elHide(el) { if (el) el.hidden = true; }
    function elShow(el) { if (el) el.hidden = false; }
    function fVal(id) { var el = byId(id); return el ? (el.value || '').trim() : ''; }
    function fSet(id, v) { var el = byId(id); if (el) el.value = (v == null) ? '' : v; }
    function findAddr(id) {
        for (var i = 0; i < _addresses.length; i++) if (_addresses[i].id === id) return _addresses[i];
        return null;
    }
    function setLive(msg) { var el = byId('addr-live'); if (el) el.textContent = msg || ''; }

    // ---- Nạp danh sách ----
    function loadAddresses(force) {
        if (!(window.AuthHelper && window.AuthHelper.isLoggedIn())) return;
        if (_addrLoaded && !force) return;
        _addrLoaded = true;
        showAddrLoading();
        window.AuthHelper.apiFetch('/api/account/addresses')
            .then(function (r) { if (!r.ok) throw new Error('GET addresses ' + r.status); return r.json(); })
            .then(function (d) { renderAddresses(d.addresses || []); })
            .catch(function (e) {
                _addrLoaded = false;   // cho phép thử lại
                console.error('[profile] tải địa chỉ lỗi:', e);
                showAddrError();
            });
    }

    function showAddrLoading() {
        elHide(byId('addr-add')); elHide(byId('addr-list')); elHide(byId('addr-empty')); elHide(byId('addr-error'));
        elShow(byId('addr-loading'));
        setLive(t('pf.addrLoading'));
    }
    function showAddrError() {
        elHide(byId('addr-add')); elHide(byId('addr-loading')); elHide(byId('addr-list')); elHide(byId('addr-empty'));
        elShow(byId('addr-error'));
        setLive('');   // #addr-error role=alert tự đọc; tránh đọc trùng
    }

    // ---- Render danh sách -> card (dựng bằng DOM để tránh XSS từ dữ liệu user) ----
    function renderAddresses(list) {
        _addresses = list || [];
        elHide(byId('addr-loading')); elHide(byId('addr-error'));
        elShow(byId('addr-add'));
        setLive('');   // tải xong: gỡ thông báo "đang tải" (mutation đã có toast riêng)

        var listEl = byId('addr-list');
        listEl.innerHTML = '';
        if (_addresses.length === 0) {
            elHide(listEl); elShow(byId('addr-empty'));
            return;
        }
        elHide(byId('addr-empty'));
        for (var i = 0; i < _addresses.length; i++) listEl.appendChild(buildCard(_addresses[i]));
        elShow(listEl);
    }

    function line(cls, text) { var d = document.createElement('div'); d.className = cls; d.textContent = text; return d; }
    function actionBtn(action, id, text, danger) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'addr-link' + (danger ? ' is-danger' : '');
        b.textContent = text;
        b.setAttribute('data-action', action);
        b.setAttribute('data-id', id);
        return b;
    }

    function buildCard(a) {
        var card = document.createElement('div');
        card.className = 'addr-card' + (a.is_default ? ' is-default' : '');
        card.setAttribute('role', 'listitem');

        if (a.is_default) {
            var badge = document.createElement('span');
            badge.className = 'addr-card-badge';
            badge.textContent = t('pf.default');
            card.appendChild(badge);
        }
        card.appendChild(line('addr-card-name', a.recipient_name));
        card.appendChild(line('addr-card-phone', a.phone));

        var lines = document.createElement('div');
        lines.className = 'addr-card-lines';
        lines.appendChild(line('', a.line1));
        var rest = [a.line2, a.ward, a.district, a.city]
            .filter(function (x) { return x && String(x).trim(); }).join(', ');
        if (rest) lines.appendChild(line('', rest));
        if (a.country && a.country !== 'VN') lines.appendChild(line('', countryName(a.country) || a.country));
        card.appendChild(lines);

        var actions = document.createElement('div');
        actions.className = 'addr-card-actions';
        if (!a.is_default) actions.appendChild(actionBtn('default', a.id, t('pf.setDefault'), false));
        actions.appendChild(actionBtn('edit', a.id, t('com.edit'), false));
        actions.appendChild(actionBtn('delete', a.id, t('com.delete'), true));
        card.appendChild(actions);
        return card;
    }

    // ---- Modal ----
    var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    function openModal(address) {
        _editing = address || null;
        _modalTrigger = document.activeElement;
        byId('addr-modal-title').textContent = _editing ? t('pf.editAddress') : t('pf.addAddress');
        byId('addr-submit').textContent = t('pf.saveAddress');
        byId('addr-submit').disabled = false;
        clearFormErrors();
        fillForm(_editing);

        var overlay = byId('addr-modal-overlay');
        overlay.hidden = false;
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(function () { overlay.classList.add('is-open'); });
        setTimeout(function () { var f = byId('af-recipient'); if (f) f.focus(); }, 40);
    }

    function closeModal() {
        var overlay = byId('addr-modal-overlay');
        overlay.classList.remove('is-open');
        document.body.style.overflow = '';
        setTimeout(function () { overlay.hidden = true; }, 220);
        if (_modalTrigger && _modalTrigger.focus) { try { _modalTrigger.focus(); } catch (e) {} }
        _modalTrigger = null;
    }

    // Điền form. Sửa địa chỉ ĐANG mặc định -> khoá checkbox (không thể bỏ mặc định ở đây;
    // muốn đổi mặc định thì set địa chỉ khác). Server bỏ qua is_default khi PUT nên nếu
    // người dùng tick mặc định lúc SỬA (chưa phải mặc định), ta gọi thêm PATCH sau khi PUT.
    function fillForm(a) {
        fSet('af-recipient', a ? a.recipient_name : '');
        fSet('af-phone', a ? a.phone : '');
        fSet('af-line1', a ? a.line1 : '');
        fSet('af-line2', a ? a.line2 : '');
        fSet('af-ward', a ? a.ward : '');
        fSet('af-district', a ? a.district : '');
        fSet('af-city', a ? a.city : '');
        fSet('af-postal', a ? a.postal_code : '');
        byId('af-country').value = (a && a.country) ? a.country : 'VN';

        var chk = byId('af-default');
        var hint = byId('af-default-hint');
        var isDefault = !!(a && a.is_default);
        chk.checked = isDefault;
        chk.disabled = isDefault;                 // đang mặc định -> không cho bỏ tick
        if (hint) hint.hidden = !isDefault;
    }

    function clearFormErrors() {
        var ids = ['af-recipient', 'af-phone', 'af-line1', 'af-line2', 'af-ward', 'af-district', 'af-city', 'af-postal'];
        for (var i = 0; i < ids.length; i++) {
            var el = byId(ids[i]);
            if (el) { el.classList.remove('addr-input-err'); el.removeAttribute('aria-invalid'); }
        }
        for (var j = 0; j < MSG_FIELDS.length; j++) { var m = byId(MSG_FIELDS[j] + '-msg'); if (m) m.textContent = ''; }
    }
    function markError(id, msg) {
        var el = byId(id);
        if (el) { el.classList.add('addr-input-err'); el.setAttribute('aria-invalid', 'true'); }
        var m = byId(id + '-msg'); if (m) m.textContent = msg;
    }

    // Validate client (đồng bộ với server). Trả true nếu hợp lệ; focus field lỗi đầu tiên.
    function validateForm() {
        clearFormErrors();
        var firstBad = null;
        function fail(id, msg) { markError(id, msg); if (!firstBad) firstBad = byId(id); }

        var recipient = fVal('af-recipient');
        if (!recipient) fail('af-recipient', t('pf.errRecipient'));
        var phone = fVal('af-phone');
        if (!phone) fail('af-phone', t('pf.errPhoneEmpty'));
        else if (!ADDR_PHONE_RE.test(phone)) fail('af-phone', t('pf.errPhone'));
        var line1 = fVal('af-line1');
        if (!line1) fail('af-line1', t('pf.errLine1'));
        var city = fVal('af-city');
        if (!city) fail('af-city', t('pf.errCity'));
        var postal = fVal('af-postal');
        if (postal && !ADDR_POSTAL_RE.test(postal)) fail('af-postal', t('pf.errPostal'));

        if (firstBad) { firstBad.focus(); return false; }
        return true;
    }

    function collectPayload() {
        return {
            recipient_name: fVal('af-recipient'),
            phone: fVal('af-phone'),
            line1: fVal('af-line1'),
            line2: fVal('af-line2'),
            ward: fVal('af-ward'),
            district: fVal('af-district'),
            city: fVal('af-city'),
            postal_code: fVal('af-postal'),
            country: byId('af-country').value || 'VN'
        };
    }

    // Đọc { addresses } từ Response; render nếu có.
    function readResult(r) {
        return r.json().catch(function () { return {}; })
            .then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
    }

    function submitAddress(e) {
        if (e) e.preventDefault();
        if (!validateForm()) return;

        var isEdit = !!_editing;
        var payload = collectPayload();
        var wantDefault = byId('af-default').checked;
        if (!isEdit) payload.is_default = wantDefault;   // POST tôn trọng is_default

        var submit = byId('addr-submit');
        var label = submit.textContent;
        submit.disabled = true; submit.textContent = t('pf.saving');

        var url = isEdit ? '/api/account/addresses/' + encodeURIComponent(_editing.id) : '/api/account/addresses';
        var opts = { method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(payload) };

        window.AuthHelper.apiFetch(url, opts).then(readResult)
            .then(function (out) {
                if (!out.ok) {
                    if (out.status === 401) return null;   // 'authexpired' lo phần đăng nhập lại
                    toast((out.data && out.data.message) || t('pf.errSaveAddr'), false);
                    return null;
                }
                // Sửa + muốn đặt mặc định (trước đó chưa phải) -> PATCH tiếp rồi render kết quả cuối.
                if (isEdit && wantDefault && !(_editing && _editing.is_default)) {
                    return window.AuthHelper.apiFetch(
                        '/api/account/addresses/' + encodeURIComponent(_editing.id) + '/default',
                        { method: 'PATCH' }
                    ).then(readResult).then(function (res2) {
                        var addrs = (res2.ok && res2.data.addresses) ? res2.data.addresses : out.data.addresses;
                        if (addrs) renderAddresses(addrs);
                        finishModalOk(isEdit);
                    });
                }
                if (out.data.addresses) renderAddresses(out.data.addresses);
                finishModalOk(isEdit);
                return null;
            })
            .catch(function (err) { console.error('[profile] lưu địa chỉ lỗi:', err); toast(t('pf.errSaveAddr'), false); })
            .then(function () { submit.disabled = false; submit.textContent = label; });
    }
    function finishModalOk(isEdit) { closeModal(); toast(isEdit ? t('pf.addrUpdated') : t('pf.addrAdded')); }

    function setDefaultAddr(id) {
        window.AuthHelper.apiFetch('/api/account/addresses/' + encodeURIComponent(id) + '/default', { method: 'PATCH' })
            .then(readResult)
            .then(function (out) {
                if (out.ok) { if (out.data.addresses) renderAddresses(out.data.addresses); toast(t('pf.defaultSet')); return; }
                if (out.status === 401) return;
                toast((out.data && out.data.message) || t('pf.errSetDefault'), false);
            })
            .catch(function (e) { console.error('[profile] đặt mặc định lỗi:', e); toast(t('pf.errSetDefault'), false); });
    }

    function deleteAddr(id) {
        var a = findAddr(id);
        var who = (a && a.recipient_name) ? a.recipient_name : t('pf.thisOne');
        if (!window.confirm(t('pf.confirmDelAddr', { who: who }))) return;
        window.AuthHelper.apiFetch('/api/account/addresses/' + encodeURIComponent(id), { method: 'DELETE' })
            .then(readResult)
            .then(function (out) {
                if (out.ok) { if (out.data.addresses) renderAddresses(out.data.addresses); toast(t('pf.addrDeleted')); return; }
                if (out.status === 401) return;
                toast((out.data && out.data.message) || t('pf.errDelAddr'), false);
            })
            .catch(function (e) { console.error('[profile] xóa địa chỉ lỗi:', e); toast(t('pf.errDelAddr'), false); });
    }

    // Focus trap + ESC cho modal.
    function onModalKeydown(e) {
        if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); closeModal(); return; }
        if (e.key !== 'Tab' && e.keyCode !== 9) return;
        var modal = byId('addr-modal');
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

    // Uỷ quyền click trên danh sách card.
    function onListClick(e) {
        var btn = e.target.closest ? e.target.closest('button[data-action]') : null;
        if (!btn) return;
        var id = parseInt(btn.getAttribute('data-id'), 10);
        var action = btn.getAttribute('data-action');
        if (action === 'edit') openModal(findAddr(id));
        else if (action === 'delete') deleteAddr(id);
        else if (action === 'default') setDefaultAddr(id);
    }

    // Gắn sự kiện cho khối địa chỉ (gọi 1 lần lúc init).
    function initAddresses() {
        var addBtn = byId('addr-add'); if (addBtn) addBtn.addEventListener('click', function () { openModal(null); });
        var addEmpty = byId('addr-add-empty'); if (addEmpty) addEmpty.addEventListener('click', function () { openModal(null); });
        var retry = byId('addr-retry'); if (retry) retry.addEventListener('click', function () { loadAddresses(true); });
        var closeBtn = byId('addr-modal-close'); if (closeBtn) closeBtn.addEventListener('click', closeModal);
        var cancel = byId('addr-cancel'); if (cancel) cancel.addEventListener('click', closeModal);
        var form = byId('addr-form'); if (form) form.addEventListener('submit', submitAddress);
        var listEl = byId('addr-list'); if (listEl) listEl.addEventListener('click', onListClick);
        var overlay = byId('addr-modal-overlay');
        if (overlay) {
            overlay.addEventListener('keydown', onModalKeydown);
            overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeModal(); });
        }
    }

    // hash -> section hợp lệ (mặc định "account").
    function currentSection() {
        var h = (location.hash || '').replace('#', '');
        return SECTIONS.indexOf(h) >= 0 ? h : 'account';
    }

    // Đồng bộ active state (sidebar) + show/hide panel.
    // Phase 5: uỷ quyền sang module ngoài js/payment-methods.js (window.PaymentMethods).
    function loadPaymentMethods() {
        if (window.PaymentMethods && window.PaymentMethods.load) window.PaymentMethods.load();
    }

    // Phase 5: đồng bộ UI mục "Giao diện" với theme hiện tại (khung is-current + nút .on).
    function syncThemeUI() {
        var cur = (window.BreezeTheme && window.BreezeTheme.get) ? window.BreezeTheme.get() : 'light';
        var cards = document.querySelectorAll('.theme-card[data-theme-preview]');
        for (var i = 0; i < cards.length; i++) {
            cards[i].classList.toggle('is-current', cards[i].getAttribute('data-theme-preview') === cur);
        }
        var btns = document.querySelectorAll('.theme-seg-btn[data-theme-choice]');
        for (var k = 0; k < btns.length; k++) {
            btns[k].classList.toggle('on', btns[k].getAttribute('data-theme-choice') === cur);
        }
        var live = document.getElementById('theme-live');
        if (live) live.textContent = t('pf.themeNow', { mode: t(cur === 'dark' ? 'pf.dark' : 'pf.light') });
    }

    function applySection(sec) {
        var items = document.querySelectorAll('.settings-nav-item[data-section]');
        for (var i = 0; i < items.length; i++) {
            var on = items[i].getAttribute('data-section') === sec;
            items[i].classList.toggle('is-active', on);
            if (on) items[i].setAttribute('aria-current', 'true');
            else items[i].removeAttribute('aria-current');
        }
        var secs = document.querySelectorAll('.settings-section');
        for (var j = 0; j < secs.length; j++) {
            secs[j].classList.toggle('is-active', secs[j].id === 'section-' + sec);
        }
        if (sec === 'addresses') loadAddresses();   // lazy: chỉ nạp khi mở tab
        if (sec === 'payments') loadPaymentMethods();
        if (sec === 'theme') syncThemeUI();
        if (sec === 'privacy') loadPrivacy();
    }

    /* ===== Ảnh đại diện =====
       Upload: POST /api/me/avatar (multipart, field "avatar").
       Đọc lại: GET /api/me -> trường avatar_url (đã có sẵn trong fillProfile).
       Server sinh tên file kèm phiên bản nên URL đổi theo ảnh — KHÔNG cần
       thêm '?t=' phá cache ở đây. */
    var AVATAR_MAX_BYTES = 2 * 1024 * 1024;
    var AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
    var _avatarUrl = null;      // URL đang hiển thị (để rollback khi upload lỗi)
    var _avatarObjUrl = null;   // object URL của preview tạm, phải revoke kẻo rò bộ nhớ

    function _releaseObjUrl() {
        if (_avatarObjUrl) { URL.revokeObjectURL(_avatarObjUrl); _avatarObjUrl = null; }
    }

    // Không có ảnh -> hiện icon người mặc định.
    function showAvatar(url) {
        var img = document.getElementById('avatar-preview');
        var fb = document.getElementById('avatar-fallback');
        if (!img || !fb) return;
        if (url) {
            img.src = url;
            img.hidden = false;
            fb.hidden = true;
        } else {
            img.hidden = true;
            img.removeAttribute('src');
            fb.hidden = false;
        }
    }

    // Đọc cho screen reader qua #privacy-live — vùng aria-live CÓ SẴN trong DOM.
    // Tin cậy hơn role="alert" của toast (toast là element mới chèn vào, một số
    // screen reader bỏ qua). Bắn cho CẢ thành công lẫn thất bại để không lệch kênh.
    function announce(msg) {
        var live = document.getElementById('privacy-live');
        if (live) live.textContent = msg;
    }

    function setAvatarBusy(busy) {
        var btn = document.getElementById('avatar-pick');
        var block = document.querySelector('.avatar-block');
        if (btn) btn.disabled = !!busy;
        if (block) block.classList.toggle('is-busy', !!busy);
    }

    function onAvatarPicked(e) {
        var input = e.target;
        var file = input.files && input.files[0];
        input.value = '';   // reset để chọn LẠI đúng file đó vẫn kích hoạt change
        if (!file) return;

        // Kiểm tra phía client CHỈ để phản hồi nhanh cho người dùng —
        // KHÔNG thay thế validate của server (server đọc magic bytes + chặn 2MB).
        if (AVATAR_TYPES.indexOf(file.type) < 0) {
            announce(t('pf.avatarBadType'));
            toast(t('pf.avatarBadTypeShort'), false);
            return;
        }
        if (file.size > AVATAR_MAX_BYTES) {
            announce(t('pf.avatarTooBig'));
            toast(t('pf.avatarTooBigShort'), false);
            return;
        }

        var prevUrl = _avatarUrl;
        _releaseObjUrl();
        _avatarObjUrl = URL.createObjectURL(file);
        showAvatar(_avatarObjUrl);          // preview tạm ngay, chưa chờ server
        setAvatarBusy(true);

        // apiFetch tự đính Bearer token; body là FormData nên nó KHÔNG set
        // Content-Type (để trình duyệt tự sinh boundary).
        var fd = new FormData();
        fd.append('avatar', file);

        window.AuthHelper.apiFetch('/api/me/avatar', { method: 'POST', body: fd })
            .then(function (r) {
                return r.json().catch(function () { return {}; })
                    .then(function (j) { return { ok: r.ok, data: j }; });
            })
            .then(function (out) {
                if (!out.ok) {
                    _releaseObjUrl();
                    showAvatar(prevUrl);    // trả về ảnh cũ, không để preview sai sự thật
                    var msg = (out.data && out.data.message) || t('pf.avatarUploadErr');
                    announce(msg);
                    toast(msg, false);
                    return;
                }
                _avatarUrl = out.data.avatar_url || null;
                showAvatar(_avatarUrl);
                _releaseObjUrl();           // revoke SAU khi đã đổi sang URL thật
                announce(t('pf.avatarUpdated'));
                toast(t('pf.avatarUpdated'));
                // Báo cho header đổi avatar ngay, không cần tải lại trang.
                // Phần header dựng ở Phase 4 sẽ lắng nghe sự kiện này.
                document.dispatchEvent(new CustomEvent('avatarchange', {
                    detail: { avatar_url: _avatarUrl },
                }));
            })
            .catch(function (err) {
                _releaseObjUrl();
                showAvatar(prevUrl);
                console.error('[profile] upload avatar lỗi:', err);
                announce(t('pf.avatarUploadErr'));
                toast(t('pf.avatarUploadErr'), false);
            })
            .then(function () { setAvatarBusy(false); });
    }

    function initAvatar() {
        var btn = document.getElementById('avatar-pick');
        var input = document.getElementById('avatar-input');
        var img = document.getElementById('avatar-preview');
        if (btn && input) {
            btn.addEventListener('click', function () { input.click(); });
            input.addEventListener('change', onAvatarPicked);
        }
        // Ảnh hỏng/404 (vd vừa đổi avatar, file cũ đã bị dọn) -> về icon mặc định.
        if (img) {
            img.addEventListener('error', function () {
                if (img.hidden) return;
                var fb = document.getElementById('avatar-fallback');
                img.hidden = true;
                if (fb) fb.hidden = false;
            });
        }
    }

    /* ===== Quyền riêng tư: 2 toggle tự lưu (PATCH từng field) ===== */
    var _privacyLoaded = false;

    function privacyInputs() {
        return document.querySelectorAll('input[data-privacy]');
    }

    // Khoá/mở toàn bộ toggle khi đang gọi API — tránh bấm dồn gây race.
    function setPrivacyBusy(busy) {
        var els = privacyInputs();
        for (var i = 0; i < els.length; i++) els[i].disabled = !!busy;
    }

    function applyPrivacy(data) {
        var els = privacyInputs();
        for (var i = 0; i < els.length; i++) {
            var k = els[i].getAttribute('data-privacy');
            els[i].checked = !!(data && data[k]);
        }
    }

    function loadPrivacy() {
        if (_privacyLoaded) return;
        setPrivacyBusy(true);
        window.AuthHelper.apiFetch('/api/account/privacy-settings')
            .then(function (r) { if (!r.ok) throw new Error('privacy ' + r.status); return r.json(); })
            .then(function (data) { applyPrivacy(data); _privacyLoaded = true; })
            .catch(function (e) {
                console.error('[profile] tải quyền riêng tư lỗi:', e);
                toast(t('pf.privacyLoadErr'), false);
            })
            .then(function () { setPrivacyBusy(false); });
    }

    function onPrivacyToggle(e) {
        var el = e.target;
        var key = el && el.getAttribute && el.getAttribute('data-privacy');
        if (!key) return;
        var want = el.checked;
        var body = {}; body[key] = want;

        setPrivacyBusy(true);
        window.AuthHelper.apiFetch('/api/account/privacy-settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then(function (r) {
                return r.json().then(function (j) { return { ok: r.ok, data: j }; });
            })
            .then(function (out) {
                if (!out.ok) {
                    el.checked = !want;   // lưu hỏng -> trả switch về trạng thái cũ
                    toast((out.data && out.data.message) || t('pf.privacySaveErr'), false);
                    return;
                }
                applyPrivacy(out.data);   // dùng state server trả về làm nguồn sự thật
                var live = document.getElementById('privacy-live');
                if (live) live.textContent = t('pf.privacySavedLive');
                toast(t('pf.saved'));
            })
            .catch(function (err) {
                el.checked = !want;
                console.error('[profile] lưu quyền riêng tư lỗi:', err);
                toast(t('pf.privacySaveErr'), false);
            })
            .then(function () { setPrivacyBusy(false); });
    }

    /* ===== Xoá tài khoản: modal + nhập mật khẩu (server verify lại) ===== */
    function delEls() {
        return {
            overlay: byId('del-modal-overlay'),
            pass: byId('del-password'),
            err: byId('del-error'),
            confirm: byId('del-confirm'),
        };
    }

    function openDelModal() {
        var d = delEls();
        if (!d.overlay) return;
        d.pass.value = '';
        d.err.textContent = '';
        d.confirm.disabled = false;
        d.overlay.hidden = false;
        requestAnimationFrame(function () {
            d.overlay.classList.add('is-open');
            d.pass.focus();
        });
    }

    function closeDelModal() {
        var d = delEls();
        if (!d.overlay) return;
        d.overlay.classList.remove('is-open');
        setTimeout(function () { d.overlay.hidden = true; }, 200);
    }

    function submitDelete(e) {
        e.preventDefault();
        var d = delEls();
        var pw = d.pass.value;
        if (!pw) { d.err.textContent = t('pf.errPwEmpty'); d.pass.focus(); return; }

        d.err.textContent = '';
        d.confirm.disabled = true;
        d.confirm.textContent = t('pf.deleting');

        window.AuthHelper.apiFetch('/api/account', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw }),
        })
            .then(function (r) {
                return r.json().then(function (j) { return { ok: r.ok, data: j }; });
            })
            .then(function (out) {
                if (!out.ok) {
                    d.err.textContent = (out.data && out.data.message) || t('pf.errDeleteAcct');
                    d.confirm.disabled = false;
                    d.confirm.textContent = t('pf.deleteConfirm');
                    return;
                }
                // Xoá xong: tài khoản Firebase đã bị huỷ -> dọn phiên rồi về trang chủ.
                closeDelModal();
                toast(t('pf.acctDeleted'));
                try { localStorage.removeItem('userName'); } catch (er) { /* bỏ qua */ }
                var fb = (window.firebase && firebase.auth) ? firebase.auth() : null;
                var done = function () { window.location.href = 'index.html'; };
                if (fb) fb.signOut().then(done).catch(done); else setTimeout(done, 900);
            })
            .catch(function (err) {
                console.error('[profile] xoá tài khoản lỗi:', err);
                d.err.textContent = t('pf.netRetry');
                d.confirm.disabled = false;
                d.confirm.textContent = t('pf.deleteConfirm');
            });
    }

    function bindPrivacy() {
        var rows = byId('privacy-rows');
        if (rows) rows.addEventListener('change', onPrivacyToggle);

        initAvatar();   // nút "Chọn ảnh" + input file + fallback khi ảnh lỗi

        var btn = byId('btn-delete-account');
        if (btn) btn.addEventListener('click', openDelModal);

        var form = byId('del-form');
        if (form) form.addEventListener('submit', submitDelete);

        var cancel = byId('del-cancel');
        if (cancel) cancel.addEventListener('click', closeDelModal);

        var ov = byId('del-modal-overlay');
        if (ov) {
            ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeDelModal(); });
            ov.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeDelModal(); }
            });
        }
    }

    // Auth gate: khách -> notice; đã đăng nhập -> shell + nạp thông tin.
    function render(user) {
        var loggedIn = user
            || (window.AuthHelper && typeof window.AuthHelper.isLoggedIn === 'function'
                && window.AuthHelper.isLoggedIn());
        if (!loggedIn) {
            _meLoaded = false;      // đăng xuất -> cho phép nạp lại khi đăng nhập lần sau
            _addrLoaded = false;    // reset danh sách địa chỉ
            _privacyLoaded = false; // reset tuỳ chọn riêng tư (user khác -> giá trị khác)
            show('profile-login', 'block');
            show('profile-status', 'none');
            show('settings-body', 'none');
            return;
        }
        show('profile-login', 'none');
        show('settings-body', 'grid');
        applySection(currentSection());
        fillFromFirebase(user);   // tên/email tức thì
        loadMe();                 // chi tiết read-only từ server
    }

    window.addEventListener('hashchange', function () { applySection(currentSection()); });

    // Phase 5: click nút Sáng/Tối -> đặt theme (CSS toàn trang đổi ngay, không reload).
    var themeSeg = document.querySelector('.theme-seg');
    if (themeSeg) {
        themeSeg.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.theme-seg-btn[data-theme-choice]') : null;
            if (b && window.BreezeTheme && window.BreezeTheme.set) {
                window.BreezeTheme.set(b.getAttribute('data-theme-choice'));
            }
        });
    }
    // Đồng bộ UI khi theme đổi từ bất kỳ đâu (vd Phase 6 icon header sau này).
    // theme.js phát event trên document (không bubble) -> phải nghe ở document.
    document.addEventListener('breeze:themechange', syncThemeUI);

    // Khởi tạo form: giới hạn ngày sinh <= hôm nay + gắn nút Lưu.
    var dobEl = document.getElementById('ad-dob');
    if (dobEl) dobEl.max = new Date().toISOString().slice(0, 10);
    var saveBtn = document.getElementById('ad-save');
    if (saveBtn) saveBtn.addEventListener('click', saveProfile);
    initAddresses();   // gắn sự kiện khối "Địa chỉ giao hàng"
    bindPrivacy();     // gắn sự kiện khối "Quyền riêng tư" + modal xoá tài khoản

    // Đổi VI/EN: nhãn tĩnh đã do i18n.js áp lại qua data-i18n; ở đây vẽ lại
    // phần do JS sinh (ngày tháng theo locale, danh sách địa chỉ, nhãn theme).
    document.addEventListener('langchange', function () {
        if (_lastMe) fillProfile(_lastMe);
        if (_addrLoaded) renderAddresses(_addresses);
        syncThemeUI();
        if (window.PaymentMethods && window.PaymentMethods.rerender) {
            window.PaymentMethods.rerender();
        }
    });

    // Phiên hết hạn (đã tự refresh mà vẫn 401): báo lỗi + đưa về đăng nhập lại.
    document.addEventListener('authexpired', function () {
        toast(t('pf.sessionExpired'), false);
        setTimeout(function () {
            window.location.href = 'login.html?redirect=profile.html&notice=session-expired';
        }, 1600);
    });

    if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
        window.AuthHelper.onChange(render);   // gọi ngay nếu đã sẵn + mỗi lần đổi trạng thái
    } else {
        document.addEventListener('DOMContentLoaded', function () { render(); });
    }
})();
