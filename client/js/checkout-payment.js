/* checkout-payment.js — panel nhập thông tin thanh toán ngay dưới các radio ở checkout.html.

   Chọn Visa / Mastercard / MoMo mà tài khoản chưa đủ thông tin -> mở #co-pay-panel để nhập
   tại chỗ; đã đủ (hoặc COD) -> đóng, giao diện y như trước.
     visa / mastercard : đủ khi có >= 1 thẻ đã lưu đúng brand, chưa hết hạn (so theo UTC).
     momo              : đủ khi users.phone là số di động VN (BreezeCard.isMomoPhone).
   Quy tắc mirror server/lib/payment-readiness.js.

   Cung cấp window.BreezeCheckoutPayment = { isReady(), refresh() } và phát
   CustomEvent('checkout:payready', { detail: { ready, method } }) mỗi khi trạng thái sẵn sàng
   đổi. File này KHÔNG khoá nút "Đặt hàng" — việc đó thuộc checkout.js (Task 3).

   Panel nằm TRONG <form id="co-form">: không có <form> lồng, nút là type="button" +
   data-action; Enter trong ô panel bị chặn và kích hoạt "Lưu" của panel thay vì đặt hàng.

   BẢO MẬT: số thẻ chỉ đọc từ ô nhập ngay lúc lưu rồi gửi đi đúng 1 lần — không console,
   không localStorage, không biến dùng lâu. Ô số thẻ bị xoá sau khi lưu, khi đổi phương thức
   và ở pagehide. Nội dung động gán bằng textContent. */
(function () {
  'use strict';

  var CARDS_API = '/api/account/payment-methods';
  var CLOSE_MS = 200;        // khớp transition trong checkout.css
  var SAVED_MS = 3000;       // thời gian hiện "Đã lưu …"
  var BRAND_NAME = { visa: 'Visa', mastercard: 'Mastercard' };
  var TITLE_KEY = { visa: 'co.payTitleVisa', mastercard: 'co.payTitleMastercard', momo: 'co.payTitleMomo' };
  var BRAND_ERR_KEY = { visa: 'co.payErrBrandVisa', mastercard: 'co.payErrBrandMastercard' };

  // cards/phone: dữ liệu tài khoản; loaded: đã nạp xong; error: lần nạp gần nhất lỗi.
  var cache = { cards: [], phone: null, loaded: false, error: false };
  var loadSeq = 0;            // bỏ kết quả của lần nạp cũ nếu đã có lần nạp mới hơn
  var loadPromise = null;
  var lastMethod = null;      // phương thức lần đánh giá trước (để biết khi nào đổi)
  var lastReady = null;       // giá trị ready đã phát gần nhất
  var saving = false;
  var closeTimer = null, savedTimer = null;
  var errs = {};              // id -> { key, params } | { text } — để dịch lại khi đổi ngôn ngữ

  function $(id) { return document.getElementById(id); }
  function tr(key, params) { return (typeof t === 'function') ? t(key, params) : key; }

  // ---------- Trạng thái sẵn sàng ----------
  function currentMethod() {
    var r = document.querySelector('input[name="payment"]:checked');
    return r ? r.value : null;
  }
  function cardUsable(c, method, now) {
    if (!c || c.brand !== method) return false;
    var y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
    var ey = Number(c.exp_year), em = Number(c.exp_month);
    return ey > y || (ey === y && em >= m);
  }
  function readyFor(method) {
    if (method === 'cod') return true;
    if (!cache.loaded) return false;
    if (method === 'visa' || method === 'mastercard') {
      var now = new Date();
      return cache.cards.some(function (c) { return cardUsable(c, method, now); });
    }
    if (method === 'momo') return window.BreezeCard.isMomoPhone(cache.phone);
    return false;
  }
  // Tính tại chỗ từ radio đang chọn + cache: đúng bất kể listener nào chạy trước.
  function isReady() { return readyFor(currentMethod()); }

  function emitIfChanged(method) {
    var ready = readyFor(method);
    if (ready === lastReady) return;
    lastReady = ready;
    document.dispatchEvent(new CustomEvent('checkout:payready', { detail: { ready: ready, method: method } }));
  }

  // ---------- Lỗi / trạng thái (dịch lại được khi đổi ngôn ngữ) ----------
  function renderErr(id) {
    var el = $(id); if (!el) return;
    var e = errs[id];
    el.textContent = e ? (e.text != null ? e.text : tr(e.key, e.params)) : '';
    el.hidden = !e;
  }
  function setErr(id, inputIds, err) {
    if (err) errs[id] = err; else delete errs[id];
    renderErr(id);
    (inputIds || []).forEach(function (iid) {
      var input = $(iid); if (!input) return;
      if (err) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    });
  }
  var FIELD_ERRS = [
    ['co-pay-number-err', ['co-pay-number']],
    ['co-pay-holder-err', ['co-pay-holder']],
    ['co-pay-exp-err', ['co-pay-month', 'co-pay-year']],
    ['co-pay-phone-err', ['co-pay-phone']],
    ['co-pay-err', []]
  ];
  function clearErrors() { FIELD_ERRS.forEach(function (f) { setErr(f[0], f[1], null); }); }

  var statusKey = null;
  function setStatus(key) {
    statusKey = key;
    var el = $('co-pay-status'); if (el) el.textContent = key ? tr(key) : '';
  }

  // ---------- Mở / đóng panel ----------
  function panel() { return $('co-pay-panel'); }
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function openPanel() {
    var p = panel(); if (!p) return;
    clearTimeout(closeTimer); closeTimer = null;
    p.hidden = false;
    p.inert = false;
    p.removeAttribute('inert');
    requestAnimationFrame(function () { p.classList.add('is-open'); });
  }
  function closePanel() {
    var p = panel(); if (!p || p.hidden) return;
    p.classList.remove('is-open');
    // inert ngay lập tức: panel đang mờ dần cũng không nhận focus / Tab.
    p.inert = true;
    p.setAttribute('inert', '');
    clearTimeout(closeTimer);
    var done = function () { closeTimer = null; p.hidden = true; };
    if (reducedMotion()) done(); else closeTimer = setTimeout(done, CLOSE_MS);
  }

  // mode: 'loading' | 'error' | 'card' | 'momo'
  function showMode(mode, method) {
    var title = $('co-pay-panel-title');
    if (title) title.textContent = tr((mode === 'card' || mode === 'momo') ? TITLE_KEY[method] : 'co.payTitle');
    var card = $('co-pay-card'), momo = $('co-pay-momo'), retry = $('co-pay-retry');
    if (card) card.hidden = mode !== 'card';
    if (momo) momo.hidden = mode !== 'momo';
    if (retry) retry.hidden = mode !== 'error';
    setStatus(mode === 'loading' ? 'co.payChecking' : (mode === 'error' ? 'co.payLoadErr' : null));
    if (mode === 'momo') prefillPhone();
    openPanel();
  }

  // users.phone đang có nhưng không dùng được cho MoMo -> điền sẵn để user sửa.
  function prefillPhone() {
    var input = $('co-pay-phone');
    if (input && !input.value && cache.phone && !window.BreezeCard.isMomoPhone(cache.phone)) {
      input.value = String(cache.phone);
    }
  }

  function clearCardNumber() { var n = $('co-pay-number'); if (n) n.value = ''; }

  // Đánh giá lại radio đang chọn: sau khi nạp xong, khi change, khi đổi ngôn ngữ, khi pageshow.
  function evaluate() {
    var method = currentMethod();
    if (method !== lastMethod) {
      clearCardNumber();
      clearErrors();
      lastMethod = method;
    }
    if (!method || method === 'cod' || readyFor(method)) closePanel();
    else if (cache.error) showMode('error', method);
    else if (!cache.loaded) showMode('loading', method);
    else showMode(method === 'momo' ? 'momo' : 'card', method);
    emitIfChanged(method);
  }

  // ---------- Nạp dữ liệu ----------
  function readJson(r) {
    return r.json().catch(function () { return {}; })
      .then(function (data) { return { ok: r.ok, status: r.status, data: data || {} }; });
  }
  function load() {
    if (!(window.AuthHelper && typeof window.AuthHelper.apiFetch === 'function')) return Promise.resolve(false);
    var seq = ++loadSeq;
    cache.error = false;
    if (!cache.loaded) evaluate();      // đang mở non-COD -> "Đang kiểm tra…"
    loadPromise = Promise.all([
      window.AuthHelper.apiFetch(CARDS_API, { method: 'GET' }).then(readJson),
      window.AuthHelper.apiFetch('/api/me', { method: 'GET' }).then(readJson)
    ]).then(function (res) {
      if (seq !== loadSeq) return isReady();
      if (!res[0].ok || !res[1].ok || !Array.isArray(res[0].data.payment_methods)) throw new Error('load');
      cache.cards = res[0].data.payment_methods;
      cache.phone = res[1].data.phone == null ? null : res[1].data.phone;
      cache.loaded = true;
      cache.error = false;
      evaluate();
      return isReady();
    }).catch(function () {
      if (seq !== loadSeq) return isReady();
      cache.error = true;
      evaluate();
      return isReady();
    });
    return loadPromise;
  }

  // ---------- Lưu ----------
  function goLogin() { window.location.href = window.BreezeRoutes.to('login', { redirect: 'checkout' }); }

  function setBusy(btn, busy, labelKey) {
    saving = busy;
    if (!btn) return;
    btn.disabled = busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.textContent = tr(busy ? 'pf.saving' : labelKey);
  }

  function showSaved(label) {
    var el = $('co-pay-saved'); if (!el) return;
    clearTimeout(savedTimer);
    el.textContent = tr('co.paySaved', { label: label });
    savedTimer = setTimeout(function () { el.textContent = ''; savedTimer = null; }, SAVED_MS);
  }

  // Sau khi lưu xong: focus đang ở nút Lưu trong panel sắp ẩn -> trả về radio đang chọn.
  function returnFocus() {
    var p = panel(), active = document.activeElement;
    if (p && active && p.contains && p.contains(active)) {
      var r = document.querySelector('input[name="payment"]:checked');
      if (r && r.focus) r.focus();
    }
  }

  function handleFailure(out) {
    if (out.status === 401) { goLogin(); return; }
    if (out.status === 400 && out.data && typeof out.data.message === 'string' && out.data.message) {
      setErr('co-pay-err', [], { text: out.data.message });
      return;
    }
    setErr('co-pay-err', [], { key: 'co.paySaveErr' });
  }

  function validateCard(method) {
    var bad = false;
    var num = $('co-pay-number'), holder = $('co-pay-holder');
    var raw = num ? String(num.value || '').trim() : '';
    var digits = window.BreezeCard.digitsOnly(raw);
    var numErr = null;
    if (!raw) numErr = { key: 'pf.errCardNumber' };
    else if (digits.length < 13 || digits.length > 19 || !window.BreezeCard.luhn(digits)) numErr = { key: 'pf.errCardNumberBad' };
    else if (window.BreezeCard.brandOf(digits) !== method) numErr = { key: BRAND_ERR_KEY[method] };
    setErr('co-pay-number-err', ['co-pay-number'], numErr);
    bad = bad || !!numErr;

    var holderVal = holder ? String(holder.value || '').trim() : '';
    var holderErr = holderVal ? null : { key: 'pf.errCardHolder' };
    setErr('co-pay-holder-err', ['co-pay-holder'], holderErr);
    bad = bad || !!holderErr;

    var mVal = ($('co-pay-month') || {}).value, yVal = ($('co-pay-year') || {}).value;
    var expKey = window.BreezeCard.validateExpiry(mVal, yVal);
    setErr('co-pay-exp-err', ['co-pay-month', 'co-pay-year'], expKey ? { key: expKey } : null);
    bad = bad || !!expKey;

    if (bad) return null;
    return { digits: digits, holder: holderVal, month: Number(String(mVal).trim()), year: Number(String(yVal).trim()) };
  }

  function saveCard() {
    var method = currentMethod();
    if (saving || !BRAND_NAME[method]) return;
    setErr('co-pay-err', [], null);
    var v = validateCard(method);
    if (!v) return;
    var btn = $('co-pay-save-card');
    setBusy(btn, true, 'co.paySaveCard');
    var oldIds = cache.cards.map(function (c) { return c.id; });
    window.AuthHelper.apiFetch(CARDS_API, {
      method: 'POST',
      body: JSON.stringify({
        card_number: v.digits, holder_name: v.holder, exp_month: v.month, exp_year: v.year,
        is_default: false, expected_brand: method
      })
    }).then(readJson).then(function (out) {
      if (!out.ok || !Array.isArray(out.data.payment_methods)) { handleFailure(out); return; }
      cache.cards = out.data.payment_methods;
      var added = cache.cards.filter(function (c) { return oldIds.indexOf(c.id) < 0; })[0];
      clearCardNumber();
      clearErrors();
      returnFocus();
      evaluate();
      showSaved(tr('co.payCardLabel', {
        brand: BRAND_NAME[(added && added.brand) || method] || BRAND_NAME[method],
        last4: added ? added.last4 : ''
      }));
    }).catch(function () {
      setErr('co-pay-err', [], { key: 'co.paySaveErr' });
    }).then(function () { setBusy(btn, false, 'co.paySaveCard'); });
  }

  function savePhone() {
    if (saving || currentMethod() !== 'momo') return;
    setErr('co-pay-err', [], null);
    var input = $('co-pay-phone');
    var raw = input ? String(input.value || '').trim() : '';
    var err = !raw ? { key: 'co.payErrPhoneEmpty' } : (window.BreezeCard.isMomoPhone(raw) ? null : { key: 'co.payErrPhone' });
    setErr('co-pay-phone-err', ['co-pay-phone'], err);
    if (err) return;
    var btn = $('co-pay-save-phone');
    setBusy(btn, true, 'co.paySavePhone');
    window.AuthHelper.apiFetch('/api/me/phone', {
      method: 'PATCH',
      body: JSON.stringify({ phone: window.BreezeCard.normalizeVnPhone(raw) })
    }).then(readJson).then(function (out) {
      if (!out.ok) { handleFailure(out); return; }
      cache.phone = out.data.phone == null ? null : out.data.phone;
      clearErrors();
      returnFocus();
      evaluate();
      if (window.BreezeCard.isMomoPhone(cache.phone)) {
        showSaved(tr('co.payMomoLabel', { phone: cache.phone }));
      }
    }).catch(function () {
      setErr('co-pay-err', [], { key: 'co.paySaveErr' });
    }).then(function () { setBusy(btn, false, 'co.paySavePhone'); });
  }

  // ---------- Đổi ngôn ngữ ----------
  function retranslate() {
    Object.keys(errs).forEach(renderErr);
    setStatus(statusKey);
    var method = currentMethod();
    var title = $('co-pay-panel-title');
    var card = $('co-pay-card'), momo = $('co-pay-momo');
    var formMode = (card && !card.hidden) || (momo && !momo.hidden);
    if (title) title.textContent = tr(formMode && TITLE_KEY[method] ? TITLE_KEY[method] : 'co.payTitle');
    if (!saving) {
      var sc = $('co-pay-save-card'); if (sc) sc.textContent = tr('co.paySaveCard');
      var sp = $('co-pay-save-phone'); if (sp) sp.textContent = tr('co.paySavePhone');
    }
  }

  // ---------- Gắn sự kiện ----------
  function init() {
    if (!panel()) return;
    var p = panel();
    p.inert = true;
    p.setAttribute('inert', '');

    document.addEventListener('change', function (e) {
      var tg = e.target;
      if (tg && tg.name === 'payment') evaluate();
    });
    document.addEventListener('click', function (e) {
      var tg = e.target;
      var btn = tg && tg.closest ? tg.closest('[data-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      if (action === 'pay-panel-save-card') { e.preventDefault(); saveCard(); }
      else if (action === 'pay-panel-save-momo') { e.preventDefault(); savePhone(); }
      else if (action === 'pay-panel-retry') { e.preventDefault(); load(); }
    });
    // Enter trong ô panel mặc định sẽ submit #co-form (đặt hàng) -> chặn, lưu panel thay vào.
    p.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.keyCode !== 13) return;
      var tg = e.target;
      if (!tg || tg.tagName !== 'INPUT') return;
      e.preventDefault();
      var momo = $('co-pay-momo');
      if (momo && !momo.hidden) savePhone(); else saveCard();
    });
    document.addEventListener('langchange', function () { retranslate(); evaluate(); });
    // Back/Forward: trình duyệt có thể khôi phục radio đã tick mà không bắn 'change'.
    window.addEventListener('pageshow', evaluate);
    window.addEventListener('pagehide', clearCardNumber);

    if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
      window.AuthHelper.onChange(function (user) {
        if (user) { load(); return; }
        loadSeq++;
        cache = { cards: [], phone: null, loaded: false, error: false };
        evaluate();
      });
    }
    evaluate();
  }

  window.BreezeCheckoutPayment = {
    isReady: isReady,
    // Nạp lại dữ liệu tài khoản rồi đánh giá lại; Promise<boolean> = isReady() sau khi nạp.
    refresh: function () { return load(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
