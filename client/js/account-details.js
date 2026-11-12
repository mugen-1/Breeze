// account-details.js — khối "Chi tiết tài khoản" dùng CHUNG cho 2 nơi:
//   - trang profile (tab #account) — page-profile.js
//   - section Hồ sơ của admin      — admin.js
// Logic chuyển NGUYÊN VĂN từ page-profile.js (không đổi hành vi trang user). Sửa ở
// đây là sửa cả hai trang.
//
// Markup 2 trang dùng CÙNG id:
//   chỉ xem : ad-name, ad-email, ad-created, ad-last
//   sửa được: ad-phone, ad-dob, ad-gender, ad-country + nút ad-save
// API: GET /api/me (đọc, do trang gọi) và PUT /api/me { phone, dob, gender, country }
// (ghi, ở đây). Không gửi định danh nào: server lấy uid từ Firebase token. Server vẫn
// validate lại — kiểm tra ở đây chỉ để phản hồi nhanh.
//
// KHÔNG đọc DOM lúc nạp file: trang gọi init() sau khi markup sẵn sàng.
// Cần nạp trước (chỉ dùng khi hàm chạy): utils-i18n.js (t), auth-helper.js (AuthHelper).
// Dữ liệu hiển thị gán bằng textContent / value — không innerHTML.
(function () {
    'use strict';

    var PHONE_RE = /^[0-9+\-\s()]{6,20}$/;

    function locale() {
        return (window.__i18n && window.__i18n.current === 'en') ? 'en-GB' : 'vi-VN';
    }

    function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = (val == null || val === '') ? '—' : val;
    }

    function setVal(id, val) {
        var el = document.getElementById(id);
        if (el) el.value = (val == null) ? '' : val;
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

    // Đổ hồ sơ (chỉ xem + field cá nhân) từ dữ liệu server. Avatar KHÔNG ở đây —
    // trang profile tự lo (nằm ở tab Quyền riêng tư).
    function fill(u) {
        setText('ad-name', nameOf(u));
        setText('ad-email', u.email);
        setText('ad-created', fmtDate(u.created_at));
        setText('ad-last', fmtDate(u.last_login));
        setVal('ad-phone', u.phone);
        setVal('ad-dob', u.dob ? String(u.dob).slice(0, 10) : '');   // ISO -> YYYY-MM-DD
        setVal('ad-gender', u.gender || '');
        setVal('ad-country', u.country || '');
    }

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

    // Lưu field cá nhân (PUT /api/me).
    //   opts.notify(msg, ok) : báo kết quả; ok === false -> lỗi
    //   opts.onSaved(u)      : nhận hồ sơ server trả về (mặc định: fill)
    function save(opts) {
        opts = opts || {};
        var notify = opts.notify || function () {};
        var onSaved = opts.onSaved || fill;
        var btn = document.getElementById('ad-save');
        if (!btn || btn.disabled) return;
        var v = formValues();
        var err = validate(v);
        if (err) { notify(err, false); return; }

        var label = btn.textContent;
        btn.disabled = true;
        btn.textContent = t('pf.saving');
        return window.AuthHelper.apiFetch('/api/me', { method: 'PUT', body: JSON.stringify(v) })
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (data) {
                    return { ok: r.ok, status: r.status, data: data };
                });
            })
            .then(function (out) {
                if (out.ok) { onSaved(out.data); notify(t('pf.savedChanges')); return; }
                if (out.status === 401) return;   // phiên hết hạn -> 'authexpired' lo phần báo
                notify((out.data && out.data.message) || t('pf.errSaveChanges'), false);
            })
            .catch(function (e) {
                console.error('[profile] lưu lỗi:', e);
                notify(t('pf.errSaveChanges'), false);
            })
            .then(function () { btn.disabled = false; btn.textContent = label; });
    }

    // Gắn form: giới hạn ngày sinh <= hôm nay + nút Lưu. Gọi MỘT lần mỗi trang.
    function init(opts) {
        var dobEl = document.getElementById('ad-dob');
        if (dobEl) dobEl.max = new Date().toISOString().slice(0, 10);
        var saveBtn = document.getElementById('ad-save');
        if (saveBtn) saveBtn.addEventListener('click', function () { save(opts); });
    }

    window.BreezeAccountDetails = {
        nameOf: nameOf, fmtDate: fmtDate,
        fill: fill, fillFromFirebase: fillFromFirebase,
        formValues: formValues, validate: validate,
        save: save, init: init
    };
})();
