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

    // Ảnh sản phẩm lỗi -> ảnh dự phòng, đúng MỘT lần (thay cho onerror="this.onerror=null;
    // this.src=..." inline — CSP chặn handler inline). 'error' của <img> không nổi bọt nên
    // bắt ở pha capture. Đã là ảnh dự phòng mà vẫn lỗi (P-1: img/breeze.png đang thiếu)
    // thì dừng, không lặp.
    document.addEventListener('error', function (e) {
        var img = e.target;
        if (!img || !img.classList || !img.classList.contains('co-oi-thumb')) return;
        if (img.getAttribute('src') === PLACEHOLDER_IMG) return;
        img.src = PLACEHOLDER_IMG;
    }, true);


    // ---------- PHASE 2: key định danh duy nhất (phòng thủ) ----------
    // Có biến thể -> `${id}__${size}__${color}`; không có -> id; thiếu cả id -> `name:<name>` (fallback).
    // name KHÔNG bao giờ dùng một mình để định danh khi item đã có id.
    function itemKey(it) {
        if (it.variant_id) return 'variant:' + it.variant_id;
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
                '<img class="co-oi-thumb" src="' + esc(it.image) + '" alt="">' +
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
    var shippingMethods = [], selectedShipping = null;
    function renderShippingMethods() {
        var box = $('co-shipping-methods');
        if (!box) return;
        box.innerHTML = shippingMethods.map(function (m) {
            return '<label class="co-shipping-option"><input type="radio" name="shipping" value="' + esc(m.key) + '"' +
                (selectedShipping && selectedShipping.key === m.key ? ' checked' : '') + '> <span>' +
                esc(t(m.label_key)) + ' — ' + money(m.fee) + '<small>' + esc(t(m.eta_key)) + '</small></span></label>';
        }).join('') + '<p class="co-shipping-note">' + esc(t('ship.simulation')) + '</p>';
    }
    function loadShippingMethods() {
        if (!(window.AuthHelper && window.AuthHelper.apiFetch)) return;
        window.AuthHelper.apiFetch('/api/orders/shipping-methods').then(function (r) {
            if (!r.ok) throw new Error('shipping methods');
            return r.json();
        }).then(function (methods) {
            if (!Array.isArray(methods) || !methods.length || methods.some(function (m) {
                return typeof m.key !== 'string' || typeof m.label_key !== 'string' || typeof m.eta_key !== 'string' || !Number.isInteger(m.fee) || m.fee < 0;
            })) throw new Error('shipping methods');
            shippingMethods = methods;
            selectedShipping = methods[0];
            renderShippingMethods(); renderSummary();
            document.dispatchEvent(new CustomEvent('checkout:shipping'));
        }).catch(function () { showFormMsg(t('ship.loadError'), 'err'); });
    }
    function renderSummary() {
        var items = normalizeItems(getCartSafe());
        var subtotal = items.reduce(function (s, it) { return s + it.lineTotal; }, 0);
        var count = items.reduce(function (s, it) { return s + it.quantity; }, 0);
        var ship = selectedShipping ? selectedShipping.fee : 0;
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
        if (shipEl) shipEl.textContent = selectedShipping ? money(ship) : '—';
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
                if (me && user === _lastUser) {
                    var parts = (me.display_name || '').trim().split(/\s+/);
                    if (!$('f-firstname').value && !$('f-lastname').value && parts[0]) {
                        $('f-firstname').value = parts.pop();
                        $('f-lastname').value = parts.join(' ');
                    }
                    if (!$('f-phone').value) $('f-phone').value = me.phone || '';
                }
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
    var createdOrder = null, paymentBusy = false;
    function renderPayment() {
        if (!createdOrder) return;
        $('co-payment-heading').textContent = t('paymenttx.checkout', { id: createdOrder.order_code });
        $('co-payment-details').innerHTML = window.BreezeOrderPayment.details(createdOrder, true, paymentBusy);
        $('co-payment-continue').textContent = t('paymenttx.continue');
    }
    async function simulatePayment(action) {
        if (paymentBusy || !window.BreezeOrderPayment.canSimulate(createdOrder)) return;
        paymentBusy = true; $('co-payment-message').textContent = ''; renderPayment();
        try {
            createdOrder.payment_transaction = await window.BreezeOrderPayment.simulate(createdOrder.id, action.getAttribute('data-outcome'));
        } catch (_) { $('co-payment-message').textContent = t('paymenttx.error'); }
        finally { paymentBusy = false; renderPayment(); }
    }
    document.addEventListener('click', function (event) {
        var action = event.target && event.target.closest && event.target.closest('[data-action]');
        if (action && action.getAttribute('data-action') === 'order-payment-simulate') simulatePayment(action);
    });
    var emptyTimer = null;
    function scheduleEmptyCheck(delay) {
        if (emptyTimer) clearTimeout(emptyTimer);
        emptyTimer = setTimeout(function () {
            if (!createdOrder && getCartSafe().length === 0) {
                window.location.replace(window.BreezeRoutes.to('cart'));
            }
        }, delay);
    }

    // ---------- Validation ----------
    // Accept domestic and international numbers; API validates the normalized value again.
    function normalizePhone(v) {
        var s = (v || '').replace(/[\s.\-()]/g, '');
        if (s.indexOf('+84') === 0) s = '0' + s.slice(3);
        else if (s.indexOf('84') === 0 && s.length === 11) s = '0' + s.slice(2);
        return s;
    }
    function isValidVNPhone(v) {
        return /^(?:0\d{9,10}|\+[1-9]\d{7,14})$/.test(normalizePhone(v));
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
        ['f-note', 'f-note-err', function (v) { return v.length <= 500 ? null : t('ship.invalid'); }]
    ];

    function validateForm() {
        var firstInvalid = null;

        REQUIRED_FIELDS.forEach(function (f) {
            var input = $(f[0]), err = $(f[1]);
            var val = input ? input.value.trim() : '';
            var msg = input && input.maxLength > 0 && val.length > input.maxLength ? t('ship.invalid') : f[2](val);
            setError(input, err, msg);
            if (msg && !firstInvalid) firstInvalid = input;
        });

        if (!selectedShipping) {
            setError(null, $('f-shipping-err'), t('ship.loadError'));
            if (!firstInvalid) firstInvalid = $('co-shipping-methods');
        }
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
        var submitting = false;

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
                submitBtn.disabled = submitting || !!createdOrder || !checked || !selectedShipping;
                submitBtn.setAttribute('aria-disabled', submitBtn.disabled ? 'true' : 'false');
            }
        }
        document.addEventListener('checkout:shipping', updatePayGate);
        $('co-shipping-methods').addEventListener('change', function (e) {
            selectedShipping = shippingMethods.find(function (m) { return m.key === e.target.value; }) || null;
            renderSummary(); updatePayGate();
        });
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
            if (submitting || createdOrder) return;

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
                submitting = false;
                updatePayGate();
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
                shipping_address: [$('f-street').value.trim(), $('f-building').value.trim()].filter(Boolean).join(', '),
                shipping_ward: $('f-ward').value.trim(),
                shipping_district: $('f-district').value.trim(),
                shipping_city: $('f-city').value.trim(),
                delivery_note: $('f-note').value.trim(),
                shipping_method: selectedShipping.key,
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

            submitting = true;
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
                    createdOrder = data.order || {};
                    if (emptyTimer) clearTimeout(emptyTimer);
                    if (typeof window.refreshCart === 'function') window.refreshCart();
                    if (window.BreezeVoucher && window.BreezeVoucher.clear) window.BreezeVoucher.clear();
                    var order = data.order || {};
                    var okMsg = data.voucherDropped
                        ? t('co.msgOkVoucherDropped', { id: order.order_code == null ? order.id : order.order_code })
                        : t('co.msgOk', { id: order.order_code == null ? order.id : order.order_code });
                    showFormMsg(okMsg, 'ok');
                    if (window.BreezeOrderPayment && window.BreezeOrderPayment.canSimulate(createdOrder)) {
                        $('co-checkout-grid').hidden = true;
                        $('co-payment-simulation').hidden = false;
                        renderPayment(); $('co-payment-simulation').focus();
                    } else {
                        setTimeout(function () { window.location.href = window.BreezeRoutes.to('orders'); }, data.voucherDropped ? 2200 : 1200);
                    }
                    return; // giữ nút disabled vì đang rời trang
                }

                if (r.status === 400) {
                    showFormMsg(data.error === 'INVALID_SHIPPING' ? t('ship.invalid') : (data.message || t('co.msgEmptyCart')), 'err');
                    enableBtn();
                    return;
                }

                if (data.error === 'ORDER_CODE_LIMIT') {
                    showFormMsg(t('co.orderCodeLimit'), 'err');
                    enableBtn();
                    return;
                }

                if (r.status === 409) {
                    var lines = (data.error === 'PRODUCT_UNAVAILABLE' ? [] : (data.items || [])).map(function (it) {
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
        initForm();
        renderSummary();

        // Giỏ đổi (guest -> server merge, tăng/giảm qty ...) -> cập nhật tóm tắt.
        document.addEventListener('cartchange', function () {
            renderSummary();
            scheduleEmptyCheck(400);
        });

        // Translate dynamic content while retaining the entered address and method.
        document.addEventListener('langchange', function () {
            renderSummary();
            renderUser(_lastUser);
            renderShippingMethods();
            if (createdOrder && window.BreezeOrderPayment) renderPayment();
        });

        // Trạng thái đăng nhập: cập nhật greeting/email; sau khi auth sẵn sàng thì
        // mới kiểm tra giỏ rỗng (chừa thời gian cho giỏ server nạp).
        if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
            window.AuthHelper.onChange(function (user) {
                if (!user) {
                    window.location.replace(window.BreezeRoutes.to('login', { redirect: 'checkout' }));
                    return;
                }
                loadShippingMethods();
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
