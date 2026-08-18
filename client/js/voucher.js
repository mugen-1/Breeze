/* voucher.js — Mã giảm giá cho trang checkout (Phase 3).
   Trạng thái: collapsed / expanded / applied. Live validate (debounce 400ms + AbortController
   chống race). KHÔNG hardcode danh sách mã / % giảm — mọi số liệu do server trả về.
   Lấy tổng giỏ từ checkout.js qua sự kiện 'checkout:summary'. Chỉ 1 voucher/lần.
   Tiền VND số nguyên: Intl.NumberFormat('vi-VN') + '₫'. Persist DUY NHẤT mã vào sessionStorage. */
(function () {
    'use strict';

    var block = document.getElementById('voucher-block');
    if (!block) return; // không phải trang checkout -> bỏ qua (file dùng chung)

    function id(x) { return document.getElementById(x); }
    function t(key, params) {
        return (window.__i18n && window.__i18n.t) ? window.__i18n.t(key, params) : key;
    }
    var lineBtn = id('voucher-line');   // dòng "Giảm giá" — vừa hiển thị số vừa là nút mở/đóng panel
    var input = id('voucher-code');
    var applyBtn = id('voucher-apply');
    var wrap = block.querySelector('.voucher-input-wrap');
    var msgEl = id('voucher-msg');
    var chipCode = id('voucher-chip-code');
    var removeBtn = id('voucher-remove');
    var discAmount = id('voucher-discount-amount');

    var SS_KEY = 'breeze_voucher';
    var VND = new Intl.NumberFormat('vi-VN');
    function num(n) { return VND.format(Math.round(Number(n) || 0)); }
    function money(n) { return num(n) + '₫'; }
    function normalize(v) { return String(v || '').replace(/\s+/g, '').toUpperCase(); }

    var applied = null;   // { code, label, discountAmount, subtotal, total } — null nếu chưa áp
    var curSubtotal = 0;  // tạm tính hiện tại (từ checkout.js)
    var curShip = 0;
    var debTimer = null;
    var liveCtrl = null;  // AbortController của live validate đang chạy
    var refreshTimer = null;
    var busy = false;     // đang gọi Áp dụng

    // ---------- trạng thái UI ----------
    function setState(s) {
        block.dataset.state = s;
        lineBtn.setAttribute('aria-expanded', s === 'expanded' ? 'true' : 'false');
        lineBtn.disabled = (s === 'applied');   // applied -> khoá click + loại khỏi tab order
    }
    function setWrapClass(cls) {
        wrap.classList.remove('is-loading', 'is-valid', 'is-invalid');
        if (cls) wrap.classList.add(cls);
    }
    function setMsg(text, kind) {
        msgEl.textContent = text || '';
        msgEl.classList.remove('is-err', 'is-ok');
        if (text && kind) msgEl.classList.add(kind === 'ok' ? 'is-ok' : 'is-err');
    }
    function updateApplyDisabled() {
        applyBtn.disabled = busy || normalize(input.value).length === 0;
    }

    // ---------- API ----------
    function callValidate(code, signal) {
        if (!(window.AuthHelper && typeof window.AuthHelper.apiFetch === 'function')) {
            return Promise.reject(new Error('NO_AUTH'));
        }
        return window.AuthHelper.apiFetch('/api/vouchers/validate', {
            method: 'POST',
            body: JSON.stringify({ code: code }),
            signal: signal
        }).then(function (res) {
            if (res.status === 429) {
                return { valid: false, reason: 'RATE', message: t('co.vcRate') };
            }
            return res.json().catch(function () {
                return { valid: false, reason: 'ERR', message: t('co.vcCheckErr') };
            });
        });
    }

    // ---------- render tổng tiền ----------
    function renderTotals() {
        var discount = applied ? Math.min(Math.round(applied.discountAmount || 0), curSubtotal) : 0;
        var total = Math.max(0, curSubtotal - discount + curShip);
        // Dòng "Giảm giá" LUÔN hiển thị: −0₫ (mờ) khi chưa áp, −<số> (accent) khi đã áp.
        // Nhãn giữ nguyên "Giảm giá"; màu mờ/accent do CSS quyết theo data-state.
        discAmount.textContent = '−' + money(discount);
        var t1 = id('co-oi-total'); if (t1) t1.textContent = money(total);
        var t2 = id('co-total'); if (t2) t2.textContent = num(total);
        var t3 = id('co-total-btn'); if (t3) t3.textContent = num(total);
    }

    // ---------- live validate (preview, CHƯA trừ tiền) ----------
    function clearLive() {
        if (debTimer) { clearTimeout(debTimer); debTimer = null; }
        if (liveCtrl) { liveCtrl.abort(); liveCtrl = null; }
    }
    function scheduleLive() {
        if (debTimer) clearTimeout(debTimer);
        var code = normalize(input.value);
        if (code.length < 4) { setWrapClass(''); setMsg(''); return; }  // chỉ chạy khi ≥ 4 ký tự
        debTimer = setTimeout(function () { runLive(code); }, 400);      // debounce 400ms
    }
    function runLive(code) {
        if (liveCtrl) liveCtrl.abort();
        var ctrl = ('AbortController' in window) ? new AbortController() : null;
        liveCtrl = ctrl;
        setWrapClass('is-loading');
        setMsg('');
        callValidate(code, ctrl ? ctrl.signal : undefined).then(function (data) {
            if (liveCtrl !== ctrl) return;                 // đã có request mới -> bỏ kết quả cũ
            liveCtrl = null;
            if (normalize(input.value) !== code) return;   // input đã đổi -> bỏ
            if (data && data.valid) {
                setWrapClass('is-valid');
                setMsg(t('co.vcOk', { amount: money(data.discountAmount) }), 'ok');
            } else {
                setWrapClass('is-invalid');
                setMsg((data && data.message) || t('co.vcInvalid'), 'err');
            }
        }).catch(function (err) {
            if (err && err.name === 'AbortError') return;  // huỷ có chủ đích -> im lặng
            if (liveCtrl !== ctrl) return;
            liveCtrl = null;
            setWrapClass('');
            setMsg(t('co.vcCheckRetry'), 'err');
        });
    }

    // ---------- Áp dụng ----------
    function doApply() {
        var code = normalize(input.value);
        if (!code || busy) return;
        clearLive();
        busy = true;
        updateApplyDisabled();
        setWrapClass('is-loading');
        setMsg('');
        callValidate(code, undefined).then(function (data) {
            busy = false;
            if (data && data.valid) {
                setApplied(data);
                setWrapClass('');
                setMsg('');
                setState('applied');
                renderTotals();
                try { removeBtn.focus(); } catch (e) {}
            } else {
                setWrapClass('is-invalid');
                setMsg((data && data.message) || t('co.vcInvalid'), 'err');
                updateApplyDisabled();
            }
        }).catch(function () {
            busy = false;
            setWrapClass('');
            setMsg(t('co.vcApplyErr'), 'err');
            updateApplyDisabled();
        });
    }
    function setApplied(data) {
        applied = {
            code: data.code, label: data.label,
            discountAmount: data.discountAmount, subtotal: data.subtotal, total: data.total
        };
        if (data.subtotal != null) curSubtotal = Math.round(data.subtotal);
        chipCode.textContent = applied.code;
        removeBtn.setAttribute('aria-label', t('co.voucherRemove') + ' ' + applied.code);
        try { sessionStorage.setItem(SS_KEY, applied.code); } catch (e) {}  // LƯU DUY NHẤT mã
    }

    // ---------- Bỏ voucher ----------
    function removeVoucher(silent) {
        applied = null;
        try { sessionStorage.removeItem(SS_KEY); } catch (e) {}
        clearLive();
        input.value = '';
        setWrapClass('');
        setMsg('');
        setState('collapsed');   // ✕ -> về COLLAPSED: dòng "Giảm giá" clickable trở lại
        updateApplyDisabled();
        renderTotals();
        if (!silent) { try { lineBtn.focus(); } catch (e) {} }
    }

    // ---------- expand / collapse ----------
    function expand() {
        if (block.dataset.state === 'applied') return;
        setState('expanded');
        try { input.focus(); } catch (e) {}   // autofocus khi mở panel
    }
    function collapse() {
        if (block.dataset.state === 'applied') return;
        clearLive();
        setState('collapsed');
    }

    // ---------- khôi phục từ sessionStorage (gọi lại API validate) ----------
    var restored = false;
    function restore() {
        if (restored) return;
        restored = true;
        var code;
        try { code = sessionStorage.getItem(SS_KEY); } catch (e) { code = null; }
        if (!code) return;
        callValidate(normalize(code), undefined).then(function (data) {
            if (data && data.valid) {
                setApplied(data);
                setState('applied');
                renderTotals();
            } else {
                try { sessionStorage.removeItem(SS_KEY); } catch (e) {}   // không hợp lệ -> xoá im lặng
            }
        }).catch(function () { restored = false; /* lỗi mạng -> cho thử lại lần sau */ });
    }

    // Giỏ đổi sau khi đã áp mã -> lấy lại số liệu từ server (im lặng).
    function scheduleRefresh() {
        if (!applied) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(function () {
            if (!applied) return;
            callValidate(applied.code, undefined).then(function (data) {
                if (!applied) return;
                if (data && data.valid) {
                    applied.discountAmount = data.discountAmount;
                    applied.subtotal = data.subtotal;
                    applied.total = data.total;
                    if (data.subtotal != null) curSubtotal = Math.round(data.subtotal);
                    renderTotals();
                } else {
                    removeVoucher(true);   // mã không còn hợp lệ với giỏ mới -> bỏ im lặng
                }
            }).catch(function () {});
        }, 300);
    }

    // ---------- events ----------
    lineBtn.addEventListener('click', function () {
        if (block.dataset.state === 'applied') return;                 // applied -> khoá (nút cũng đang disabled)
        if (block.dataset.state === 'expanded') collapse(); else expand();
    });
    input.addEventListener('input', function () {
        setWrapClass('');
        setMsg('');
        updateApplyDisabled();
        scheduleLive();
    });
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doApply(); }
        else if (e.key === 'Escape') { e.preventDefault(); collapse(); try { lineBtn.focus(); } catch (_) {} }
    });
    applyBtn.addEventListener('click', doApply);
    removeBtn.addEventListener('click', function () { removeVoucher(false); });

    // Tổng giỏ từ checkout.js — chạy sau khi checkout đã set DOM nên ta ghi đè hợp lệ.
    document.addEventListener('checkout:summary', function (e) {
        var d = (e && e.detail) || {};
        curSubtotal = Math.round(Number(d.subtotal) || 0);
        curShip = Math.round(Number(d.ship) || 0);
        if (applied && applied.subtotal != null && curSubtotal !== Math.round(applied.subtotal)) {
            scheduleRefresh();
        }
        renderTotals();
    });

    // ---------- init ----------
    setState('collapsed');
    updateApplyDisabled();
    // Khôi phục sau khi biết user (validate cần token). Guest/không firebase -> thử luôn.
    if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
        window.AuthHelper.onChange(function (user) { if (user) restore(); });
    } else {
        restore();
    }

    // API cho checkout.js: gắn voucherCode khi submit + dọn khi đặt đơn xong.
    window.BreezeVoucher = {
        getAppliedCode: function () { return applied ? applied.code : null; },
        clear: function () { removeVoucher(true); }
    };
})();
