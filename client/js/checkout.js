/* checkout.js — trang thanh toán (CHỈ frontend UI).
   - NGUỒN GIỎ HÀNG: dùng đúng getCart() của cart.js (cùng nguồn cart-drawer.js đang
     dùng — localStorage khi guest, Cart API khi đã đăng nhập). KHÔNG tạo nguồn mới.
   - User (displayName/email): lấy từ Firebase Auth qua window.AuthHelper.
   - Không gọi backend đặt đơn (ngoài scope): submit chỉ validate + báo inline. */
(function () {
    'use strict';

    // ---------- helpers ----------
    function $(id) { return document.getElementById(id); }

    function getCartSafe() {
        return (typeof getCart === 'function' && Array.isArray(getCart())) ? getCart() : [];
    }

    // Định dạng số kiểu VN (dấu chấm ngăn nghìn). Ký hiệu ₫ đặt ở HTML.
    function money(n) { return Number(n || 0).toLocaleString('vi-VN'); }

    function cartCount(items) {
        return items.reduce(function (s, i) { return s + (Number(i.qty) || 0); }, 0);
    }
    function cartTotal(items) {
        return items.reduce(function (s, i) { return s + (Number(i.price) || 0) * (Number(i.qty) || 0); }, 0);
    }

    // ---------- 2. Tóm tắt giỏ + update badge ở header ----------
    function renderSummary() {
        var items = getCartSafe();
        var total = cartTotal(items);
        var count = cartCount(items);
        var countEl = $('co-count'), totalEl = $('co-total'), totalBtnEl = $('co-total-btn');
        if (countEl) countEl.textContent = count;
        if (totalEl) totalEl.textContent = money(total);
        if (totalBtnEl) totalBtnEl.textContent = money(total);
        // Cập nhật badge ở header .co-header
        var badgeEl = document.querySelector('.co-header .cart-badge');
        if (badgeEl) badgeEl.textContent = count;
        return items;
    }

    // ---------- 1 & 3. User greeting + email ----------
    function renderUser(user) {
        var greetEl = $('co-greeting'), emailEl = $('co-email');
        if (user) {
            var name = user.displayName ||
                (user.email ? user.email.split('@')[0] : '') || 'bạn';
            if (greetEl) greetEl.textContent = 'Xin chào, ' + name + '!';
            if (emailEl) emailEl.textContent = user.email || '—';
        } else {
            if (greetEl) greetEl.textContent = 'Xin chào!';
            if (emailEl) emailEl.textContent = '—';
        }
    }

    // ---------- Redirect nếu giỏ rỗng ----------
    // Giỏ server nạp bất đồng bộ sau khi Firebase auth xong => hoãn kiểm tra để
    // tránh redirect nhầm khi giỏ chưa kịp về. Mỗi 'cartchange' huỷ hẹn cũ.
    var emptyTimer = null;
    function scheduleEmptyCheck(delay) {
        if (emptyTimer) clearTimeout(emptyTimer);
        emptyTimer = setTimeout(function () {
            if (getCartSafe().length === 0) {
                window.location.replace('cart.html');
            }
        }, delay);
    }

    // ---------- 4. Cascading dữ liệu địa chỉ (static tối thiểu) ----------
    // Cấu trúc: Tỉnh -> Quận -> { wards:[], postal:[] }. Dữ liệu đầy đủ để prompt sau.
    var VN_ADDRESS = {
        'TP. Hồ Chí Minh': {
            'Quận 1': { wards: ['Phường Bến Nghé', 'Phường Bến Thành', 'Phường Đa Kao'], postal: ['700000', '710000'] },
            'Quận 3': { wards: ['Phường 1', 'Phường 6', 'Phường Võ Thị Sáu'], postal: ['720000'] },
            'TP. Thủ Đức': { wards: ['Phường Linh Trung', 'Phường Hiệp Bình Chánh'], postal: ['713300', '713400'] }
        },
        'Hà Nội': {
            'Quận Hoàn Kiếm': { wards: ['Phường Hàng Bạc', 'Phường Hàng Bồ', 'Phường Cửa Đông'], postal: ['100000'] },
            'Quận Ba Đình': { wards: ['Phường Điện Biên', 'Phường Kim Mã', 'Phường Ngọc Hà'], postal: ['110000', '118000'] }
        },
        'Đà Nẵng': {
            'Quận Hải Châu': { wards: ['Phường Thạch Thang', 'Phường Hải Châu 1'], postal: ['550000'] },
            'Quận Thanh Khê': { wards: ['Phường An Khê', 'Phường Xuân Hà'], postal: ['551000'] }
        }
    };

    function fillOptions(sel, values, placeholder) {
        sel.innerHTML = '';
        var opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = placeholder;
        sel.appendChild(opt0);
        values.forEach(function (v) {
            var o = document.createElement('option');
            o.value = v; o.textContent = v;
            sel.appendChild(o);
        });
    }

    function resetSelect(sel, placeholder) {
        fillOptions(sel, [], placeholder);
        sel.disabled = true;
    }

    function initAddressCascade() {
        var citySel = $('f-city'), distSel = $('f-district'),
            wardSel = $('f-ward'), postalSel = $('f-postal');
        if (!citySel) return;

        fillOptions(citySel, Object.keys(VN_ADDRESS), '-- Chọn --');
        resetSelect(distSel, '-- Chọn --');
        resetSelect(wardSel, '-- Chọn --');
        resetSelect(postalSel, '-- Chọn --');

        citySel.addEventListener('change', function () {
            var city = citySel.value;
            resetSelect(distSel, '-- Chọn --');
            resetSelect(wardSel, '-- Chọn --');
            resetSelect(postalSel, '-- Chọn --');
            if (city && VN_ADDRESS[city]) {
                fillOptions(distSel, Object.keys(VN_ADDRESS[city]), '-- Chọn --');
                distSel.disabled = false;
            }
        });

        distSel.addEventListener('change', function () {
            var city = citySel.value, dist = distSel.value;
            resetSelect(wardSel, '-- Chọn --');
            resetSelect(postalSel, '-- Chọn --');
            var node = city && dist && VN_ADDRESS[city] && VN_ADDRESS[city][dist];
            if (node) {
                fillOptions(wardSel, node.wards, '-- Chọn --');
                wardSel.disabled = false;
                fillOptions(postalSel, node.postal, '-- Chọn --');
                postalSel.disabled = false;
            }
        });
    }

    // ---------- Validation ----------
    // SĐT Việt Nam: 10 số, bắt đầu 0 và số thứ 2 ∈ {3,5,7,8,9}. Chấp nhận +84 (đổi về 0).
    function normalizePhone(v) {
        var s = (v || '').replace(/[\s.\-()]/g, '');
        if (s.indexOf('+84') === 0) s = '0' + s.slice(3);
        else if (s.indexOf('84') === 0 && s.length === 11) s = '0' + s.slice(2);
        return s;
    }
    function isValidVNPhone(v) {
        return /^0[35789]\d{8}$/.test(normalizePhone(v));
    }

    function setError(inputEl, errEl, msg) {
        if (msg) {
            if (inputEl) inputEl.setAttribute('aria-invalid', 'true');
            if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
        } else {
            if (inputEl) inputEl.removeAttribute('aria-invalid');
            if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
        }
    }

    // [inputId, errId, validatorFn(value) -> errorMessage|null]
    var REQUIRED_FIELDS = [
        ['f-firstname', 'f-firstname-err', function (v) { return v ? null : 'Vui lòng nhập Tên'; }],
        ['f-lastname', 'f-lastname-err', function (v) { return v ? null : 'Vui lòng nhập Họ'; }],
        ['f-phone', 'f-phone-err', function (v) {
            if (!v) return 'Vui lòng nhập số điện thoại';
            return isValidVNPhone(v) ? null : 'Số điện thoại không hợp lệ (VD: 0901234567)';
        }],
        ['f-street', 'f-street-err', function (v) { return v ? null : 'Vui lòng nhập số nhà / tên đường'; }],
        ['f-city', 'f-city-err', function (v) { return v ? null : 'Vui lòng chọn Thành phố / Tỉnh'; }],
        ['f-district', 'f-district-err', function (v) { return v ? null : 'Vui lòng chọn Quận / Huyện'; }],
        ['f-ward', 'f-ward-err', function (v) { return v ? null : 'Vui lòng chọn Phường / Xã'; }],
        ['f-postal', 'f-postal-err', function (v) { return v ? null : 'Vui lòng chọn Mã bưu chính'; }]
    ];

    function validateForm() {
        var firstInvalid = null;

        REQUIRED_FIELDS.forEach(function (f) {
            var input = $(f[0]), err = $(f[1]);
            var val = input ? input.value.trim() : '';
            var msg = f[2](val);
            setError(input, err, msg);
            if (msg && !firstInvalid) firstInvalid = input;
        });

        // Payment (radio)
        var payErr = $('f-pay-err');
        var payChecked = document.querySelector('input[name="payment"]:checked');
        if (!payChecked) {
            if (payErr) { payErr.textContent = 'Vui lòng chọn phương thức thanh toán'; payErr.hidden = false; }
            if (!firstInvalid) firstInvalid = document.querySelector('input[name="payment"]');
        } else if (payErr) {
            payErr.textContent = ''; payErr.hidden = true;
        }

        return firstInvalid;
    }

    function showFormMsg(text, kind) {
        var el = $('co-form-msg');
        if (!el) return;
        el.textContent = text;
        el.className = 'co-form-msg ' + (kind === 'ok' ? 'is-ok' : 'is-err');
        el.hidden = false;
    }

    function initForm() {
        var form = $('co-form');
        if (!form) return;

        // Xoá lỗi khi người dùng sửa lại field.
        REQUIRED_FIELDS.forEach(function (f) {
            var input = $(f[0]), err = $(f[1]);
            if (!input) return;
            var evt = (input.tagName === 'SELECT') ? 'change' : 'input';
            input.addEventListener(evt, function () {
                if (input.getAttribute('aria-invalid') === 'true') setError(input, err, null);
            });
        });
        document.querySelectorAll('input[name="payment"]').forEach(function (r) {
            r.addEventListener('change', function () {
                var payErr = $('f-pay-err');
                if (payErr) { payErr.textContent = ''; payErr.hidden = true; }
            });
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();

            if (getCartSafe().length === 0) {
                showFormMsg('Giỏ hàng của bạn đang trống.', 'err');
                return;
            }

            var firstInvalid = validateForm();
            if (firstInvalid) {
                showFormMsg('Vui lòng kiểm tra lại các trường được đánh dấu.', 'err');
                firstInvalid.focus();
                return;
            }

            // Ngoài scope: KHÔNG gọi Orders API. Chỉ xác nhận UI hợp lệ.
            showFormMsg('Thông tin hợp lệ. (Bản demo giao diện — chưa gửi đơn tới máy chủ.)', 'ok');
            var btn = form.querySelector('.co-submit');
            if (btn) btn.setAttribute('disabled', 'true');
        });
    }

    // ---------- init ----------
    document.addEventListener('DOMContentLoaded', function () {
        initAddressCascade();
        initForm();
        renderSummary();

        // Giỏ đổi (guest -> server merge, tăng/giảm qty ...) -> cập nhật tóm tắt.
        document.addEventListener('cartchange', function () {
            renderSummary();
            scheduleEmptyCheck(400);
        });

        // Trạng thái đăng nhập: cập nhật greeting/email; sau khi auth sẵn sàng thì
        // mới kiểm tra giỏ rỗng (chừa thời gian cho giỏ server nạp).
        if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
            window.AuthHelper.onChange(function (user) {
                renderUser(user);
                renderSummary();
                scheduleEmptyCheck(user ? 1200 : 300); // logged-in: chờ giỏ server
            });
        } else {
            renderUser(null);
            scheduleEmptyCheck(300);
        }
    });
})();
