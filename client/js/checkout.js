/* checkout.js — trang thanh toán (CHỈ frontend UI).
   - NGUỒN GIỎ HÀNG: dùng đúng getCart() của cart.js (cùng nguồn cart-drawer.js đang
     dùng — localStorage khi guest, Cart API khi đã đăng nhập). KHÔNG tạo nguồn mới.
   - User (displayName/email): lấy từ Firebase Auth qua window.AuthHelper.
   - Submit: validate -> POST /api/orders (server đọc dbo.cart_items dựng đơn), thành công thì
     refreshCart() + chuyển sang orders.html; báo lỗi inline theo status (400/409/401/500). */
(function () {
    'use strict';

    // ---------- helpers ----------
    function $(id) { return document.getElementById(id); }

    // i18n: js/i18n.js nạp trước file này. Fallback trả về khoá nếu chưa sẵn sàng.

    function getCartSafe() {
        return (typeof getCart === 'function' && Array.isArray(getCart())) ? getCart() : [];
    }

    // ---------- Định dạng tiền VN (Intl.NumberFormat) ----------
    var VND = new Intl.NumberFormat('vi-VN');
    function num(n) { return VND.format(Number(n) || 0); }   // số thuần: 2.900.000
    function money(n) { return num(n) + '₫'; }               // kèm ký hiệu: 2.900.000₫
    var PLACEHOLDER_IMG = 'img/breeze.png';


    // ---------- PHASE 2: key định danh duy nhất (phòng thủ) ----------
    // Có biến thể -> `${id}__${size}__${color}`; không có -> id; thiếu cả id -> `name:<name>` (fallback).
    // name KHÔNG bao giờ dùng một mình để định danh khi item đã có id.
    function itemKey(it) {
        var base = (it.id != null && it.id !== '') ? String(it.id) : ('name:' + (it.name || ''));
        var size = it.size || '', color = it.color || '';
        return (size || color) ? (base + '__' + size + '__' + color) : base;
    }

    // ---------- PHASE 3: chuẩn hoá dữ liệu (single source of truth cho render) ----------
    // Map field thực tế của giỏ (qty, img) -> field UI (quantity, image); ép kiểu + fallback an toàn.
    function normalizeItems(raw) {
        var list = Array.isArray(raw) ? raw : [];
        var byKey = {}, out = [];
        list.forEach(function (it) {
            var price = Number(it.price);
            if (!isFinite(price)) price = 0;                 // NaN/Infinity -> 0
            var qty = parseInt(it.qty, 10);
            if (!isFinite(qty) || qty < 1) qty = 1;          // lỗi / < 1 -> 1
            var img = (it.img != null && String(it.img).trim()) ? String(it.img) : PLACEHOLDER_IMG;
            var key = itemKey(it);
            if (byKey[key]) {                                // phòng thủ: gộp trùng key (cộng dồn qty)
                byKey[key].quantity += qty;
                byKey[key].lineTotal = byKey[key].price * byKey[key].quantity;
                return;
            }
            var norm = {
                key: key,
                id: (it.id != null ? it.id : null),
                name: (it.name != null ? String(it.name) : ''),
                size: (it.size != null ? String(it.size) : ''),
                color: (it.color != null ? String(it.color) : ''),
                image: img,
                price: price,
                quantity: qty,
                lineTotal: price * qty                       // tính 1 nơi duy nhất
            };
            byKey[key] = norm;
            out.push(norm);
        });
        return out;
    }

    // ---------- PHASE 4: render 1 hàng sản phẩm (layout Adidas) ----------
    function itemRowHTML(it) {
        var meta = [];
        if (it.size) meta.push(t('co.metaSize') + ': ' + esc(it.size));
        if (it.color) meta.push(t('co.metaColor') + ': ' + esc(it.color));
        meta.push(t('co.metaQty') + ': ' + it.quantity);
        return '' +
            '<div class="co-oi-item">' +
                '<img class="co-oi-thumb" src="' + esc(it.image) + '" alt="" ' +
                     'onerror="this.onerror=null;this.src=\'' + PLACEHOLDER_IMG + '\'">' +
                '<div class="co-oi-info">' +
                    '<p class="co-oi-name">' + esc(it.name) + '</p>' +
                    '<p class="co-oi-meta">' + meta.join(' · ') + '</p>' +
                '</div>' +
                '<div class="co-oi-prices">' +
                    '<p class="co-oi-unit">' + money(it.price) + '</p>' +
                    '<p class="co-oi-linetotal">' + money(it.lineTotal) + '</p>' +
                '</div>' +
            '</div>';
    }

    // ---------- 2 + PHASE 5: render tóm tắt giỏ + tổng tiền + badge ----------
    var SHIPPING_FEE = 0; // "Miễn phí" — đổi tại đây nếu sau này data có phí ship
    function renderSummary() {
        var items = normalizeItems(getCartSafe());
        var subtotal = items.reduce(function (s, it) { return s + it.lineTotal; }, 0);
        var count = items.reduce(function (s, it) { return s + it.quantity; }, 0);
        var ship = SHIPPING_FEE;
        var total = subtotal + ship;

        // Danh sách item (hoặc trạng thái rỗng — không crash, không vỡ layout)
        var listEl = $('co-oi-list');
        if (listEl) {
            listEl.innerHTML = items.length
                ? items.map(itemRowHTML).join('')
                : '<p class="co-oi-empty">' + t('co.emptyItems') + '</p>';
        }

        // Khối tổng kết
        var subEl = $('co-oi-subtotal'), shipEl = $('co-oi-ship'),
            oiCountEl = $('co-oi-count'), oiTotalEl = $('co-oi-total');
        if (oiCountEl) oiCountEl.textContent = count;                 // = tổng quantity, không phải số dòng
        if (subEl) subEl.textContent = money(subtotal);
        if (shipEl) shipEl.textContent = ship > 0 ? money(ship) : t('com.free');
        if (oiTotalEl) oiTotalEl.textContent = money(total);

        // Hero (đang ẩn) + nút "Đặt hàng": HTML đã có sẵn ký hiệu ₫ -> chỉ set phần số.
        var countEl = $('co-count'), totalEl = $('co-total'), totalBtnEl = $('co-total-btn');
        if (countEl) countEl.textContent = count;
        if (totalEl) totalEl.textContent = num(total);
        if (totalBtnEl) totalBtnEl.textContent = num(total);

        // Badge header
        var badgeEl = document.querySelector('.co-header .cart-badge');
        if (badgeEl) badgeEl.textContent = count;

        // PHASE 5: đối chiếu tổng hiển thị = tổng lineTotal thật
        console.log('[checkout] ∑lineTotal(subtotal)=', subtotal,
                    '| ship=', ship, '| total=', total, '| SL=', count, '| số dòng=', items.length);

        // Voucher (js/voucher.js) nghe sự kiện này để trừ giảm giá & cập nhật dòng "Tổng".
        // Phát SAU khi đã set DOM -> voucher.js ghi đè tổng hợp lệ, không bị đua thứ tự.
        document.dispatchEvent(new CustomEvent('checkout:summary', { detail: { subtotal: subtotal, ship: ship } }));
        return items;
    }

    // ---------- 1 & 3. User greeting + email ----------
    var _lastUser = null;
    function renderUser(user) {
        _lastUser = user;
        var greetEl = $('co-greeting'), emailEl = $('co-email');
        if (user) {
            var name = user.displayName ||
                (user.email ? user.email.split('@')[0] : '') || t('co.you');
            if (greetEl) greetEl.textContent = t('co.helloName', { name: name });
            if (emailEl) emailEl.textContent = user.email || '—';
        } else {
            if (greetEl) greetEl.textContent = t('co.hello');
            if (emailEl) emailEl.textContent = '—';
        }
    }

    // ---------- Chặn admin (admin không được thanh toán) ----------
    // Nếu user là admin (kể cả khi gõ thẳng URL checkout.html) -> báo lỗi & rời trang.
    var adminGuarded = false;
    function guardAdmin(user) {
        if (!user || adminGuarded) return;
        if (!(window.AuthHelper && typeof window.AuthHelper.apiFetch === 'function')) return;
        window.AuthHelper.apiFetch('/api/me')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (me) {
                if (me && me.role === 'admin') {
                    adminGuarded = true;
                    window.alert(t('co.adminBlocked'));
                    window.location.replace(window.BreezeRoutes.to('index'));
                }
            })
            .catch(function () { /* lỗi mạng -> bỏ qua, không chặn nhầm user thường */ });
    }

    // ---------- Redirect nếu giỏ rỗng ----------
    // Giỏ server nạp bất đồng bộ sau khi Firebase auth xong => hoãn kiểm tra để
    // tránh redirect nhầm khi giỏ chưa kịp về. Mỗi 'cartchange' huỷ hẹn cũ.
    var emptyTimer = null;
    function scheduleEmptyCheck(delay) {
        if (emptyTimer) clearTimeout(emptyTimer);
        emptyTimer = setTimeout(function () {
            if (getCartSafe().length === 0) {
                window.location.replace(window.BreezeRoutes.to('cart'));
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

        fillOptions(citySel, Object.keys(VN_ADDRESS), t('com.select'));
        resetSelect(distSel, t('com.select'));
        resetSelect(wardSel, t('com.select'));
        resetSelect(postalSel, t('com.select'));

        citySel.addEventListener('change', function () {
            var city = citySel.value;
            resetSelect(distSel, t('com.select'));
            resetSelect(wardSel, t('com.select'));
            resetSelect(postalSel, t('com.select'));
            if (city && VN_ADDRESS[city]) {
                fillOptions(distSel, Object.keys(VN_ADDRESS[city]), t('com.select'));
                distSel.disabled = false;
            }
        });

        distSel.addEventListener('change', function () {
            var city = citySel.value, dist = distSel.value;
            resetSelect(wardSel, t('com.select'));
            resetSelect(postalSel, t('com.select'));
            var node = city && dist && VN_ADDRESS[city] && VN_ADDRESS[city][dist];
            if (node) {
                fillOptions(wardSel, node.wards, t('com.select'));
                wardSel.disabled = false;
                fillOptions(postalSel, node.postal, t('com.select'));
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
        ['f-firstname', 'f-firstname-err', function (v) { return v ? null : t('co.errFirstname'); }],
        ['f-lastname', 'f-lastname-err', function (v) { return v ? null : t('co.errLastname'); }],
        ['f-phone', 'f-phone-err', function (v) {
            if (!v) return t('co.errPhoneEmpty');
            return isValidVNPhone(v) ? null : t('co.errPhoneBad');
        }],
        ['f-street', 'f-street-err', function (v) { return v ? null : t('co.errStreet'); }],
        ['f-city', 'f-city-err', function (v) { return v ? null : t('co.errCity'); }],
        ['f-district', 'f-district-err', function (v) { return v ? null : t('co.errDistrict'); }],
        ['f-ward', 'f-ward-err', function (v) { return v ? null : t('co.errWard'); }],
        ['f-postal', 'f-postal-err', function (v) { return v ? null : t('co.errPostal'); }]
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
            if (payErr) { payErr.textContent = t('co.errPay'); payErr.hidden = false; }
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
        // Nút "Đặt hàng" xám / không bấm được cho tới khi chọn 1 phương thức thanh toán.
        var submitBtn = form.querySelector('.co-submit');
        function updatePayGate() {
            var checked = document.querySelector('input[name="payment"]:checked');
            if (submitBtn) {
                submitBtn.disabled = !checked;
                submitBtn.setAttribute('aria-disabled', checked ? 'false' : 'true');
            }
        }
        updatePayGate();

        document.querySelectorAll('input[name="payment"]').forEach(function (r) {
            r.addEventListener('change', function () {
                var payErr = $('f-pay-err');
                if (payErr) { payErr.textContent = ''; payErr.hidden = true; }
                updatePayGate();
            });
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();

            if (getCartSafe().length === 0) {
                showFormMsg(t('acc.cartEmpty'), 'err');
                return;
            }

            var firstInvalid = validateForm();
            if (firstInvalid) {
                showFormMsg(t('co.msgFixFields'), 'err');
                firstInvalid.focus();
                return;
            }

            // Validate OK -> tạo đơn thật qua Orders API (server đọc dbo.cart_items để dựng đơn).
            var btn = form.querySelector('.co-submit');
            function enableBtn() {
                if (btn) { btn.disabled = false; btn.setAttribute('aria-disabled', 'false'); }
            }
            function disableBtn() {
                if (btn) { btn.disabled = true; btn.setAttribute('aria-disabled', 'true'); }
            }

            // Ghép payload từ các field đã có (Họ trước Tên theo tiếng Việt).
            var payChecked = document.querySelector('input[name="payment"]:checked'); // validateForm() đã đảm bảo có chọn
            var payload = {
                shipping_name: ($('f-lastname') ? $('f-lastname').value.trim() : '') + ' ' +
                               ($('f-firstname') ? $('f-firstname').value.trim() : ''),
                shipping_phone: normalizePhone($('f-phone') ? $('f-phone').value : ''),
                shipping_address: [
                    $('f-street') ? $('f-street').value.trim() : '',
                    $('f-ward') ? $('f-ward').value.trim() : '',
                    $('f-district') ? $('f-district').value.trim() : '',
                    $('f-city') ? $('f-city').value.trim() : ''
                ].filter(Boolean).join(', '),
                paymentMethod: payChecked ? payChecked.value : ''
            };

            // Voucher (nếu đã áp) — server tính LẠI discount, giá trị client chỉ để tra mã.
            var _vCode = (window.BreezeVoucher && window.BreezeVoucher.getAppliedCode)
                ? window.BreezeVoucher.getAppliedCode() : null;
            if (_vCode) payload.voucherCode = _vCode;

            if (!(window.AuthHelper && typeof window.AuthHelper.apiFetch === 'function')) {
                showFormMsg(t('co.msgSessionExpired'), 'err');
                window.location.href = window.BreezeRoutes.to('login', { redirect: 'checkout' });
                return;
            }

            disableBtn(); // chống double-submit trước khi gọi API

            window.AuthHelper.apiFetch('/api/orders', {
                method: 'POST',
                body: JSON.stringify(payload)
            }).then(function (res) {
                // Đọc status trước, rồi parse JSON (lỗi có thể không kèm body).
                return res.json().catch(function () { return {}; })
                    .then(function (data) { return { status: res.status, data: data }; });
            }).then(function (r) {
                var data = r.data || {};

                if (r.status === 201) {
                    if (typeof window.refreshCart === 'function') window.refreshCart();
                    if (window.BreezeVoucher && window.BreezeVoucher.clear) window.BreezeVoucher.clear();
                    var order = data.order || {};
                    var okMsg = data.voucherDropped
                        ? t('co.msgOkVoucherDropped', { id: order.id })
                        : t('co.msgOk', { id: order.id });
                    showFormMsg(okMsg, 'ok');
                    setTimeout(function () { window.location.href = window.BreezeRoutes.to('orders'); }, data.voucherDropped ? 2200 : 1200);
                    return; // giữ nút disabled vì đang rời trang
                }

                if (r.status === 400) {
                    showFormMsg(data.message || t('co.msgEmptyCart'), 'err');
                    enableBtn();
                    return;
                }

                if (r.status === 409) {
                    var lines = (data.items || []).map(function (it) {
                        return t('co.msgStockLine', { name: it.name, stock: it.stock, want: it.requested });
                    });
                    showFormMsg((data.message || t('co.msgStock')) +
                        (lines.length ? ': ' + lines.join('; ') : ''), 'err');
                    if (typeof window.refreshCart === 'function') window.refreshCart();
                    enableBtn();
                    return;
                }

                if (r.status === 401) {
                    showFormMsg(t('co.msgSessionExpired'), 'err');
                    window.location.href = window.BreezeRoutes.to('login', { redirect: 'checkout' });
                    return;
                }

                if (r.status === 403 && data.error === 'BLACKLISTED') {
                    showFormMsg(t('acc.blocked'), 'err');
                    enableBtn();
                    return;
                }

                showFormMsg(data.message || t('co.msgFailed'), 'err');
                enableBtn();
            }).catch(function () {
                showFormMsg(t('co.msgNetErr'), 'err');
                enableBtn();
            });
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

        // Đổi VI/EN: dựng lại phần do JS sinh (tóm tắt, lời chào) + nhãn "-- Chọn --"
        // của 4 select địa chỉ (giữ nguyên lựa chọn hiện tại).
        document.addEventListener('langchange', function () {
            renderSummary();
            renderUser(_lastUser);
            ['f-city', 'f-district', 'f-ward', 'f-postal'].forEach(function (id) {
                var sel = $(id);
                if (sel && sel.options.length && sel.options[0].value === '') {
                    sel.options[0].textContent = t('com.select');
                }
            });
        });

        // Trạng thái đăng nhập: cập nhật greeting/email; sau khi auth sẵn sàng thì
        // mới kiểm tra giỏ rỗng (chừa thời gian cho giỏ server nạp).
        if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
            window.AuthHelper.onChange(function (user) {
                renderUser(user);
                renderSummary();
                scheduleEmptyCheck(user ? 1200 : 300); // logged-in: chờ giỏ server
                guardAdmin(user); // admin gõ thẳng URL vẫn bị chặn
            });
        } else {
            renderUser(null);
            scheduleEmptyCheck(300);
        }
    });
})();
