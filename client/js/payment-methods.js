/* payment-methods.js — quản lý thẻ đã lưu ở tab "Phương thức thanh toán" (profile.html).
   Mirror logic của phần Địa chỉ (inline trong profile.html). Gọi API qua AuthHelper.apiFetch
   (tự gắn Firebase Bearer token). Tái dùng shell #pm-* + class addr-* dựng ở Phase 3/4.

   BẢO MẬT: KHÔNG bao giờ log/lưu full số thẻ ở client. Số thẻ đầy đủ chỉ được đọc để
   validate (Luhn) rồi gửi lên server ĐÚNG 1 lần khi thêm/sửa — không ghi console, không
   giữ lại biến nào. Server suy brand+last4 và vứt số thẻ; client chỉ nhận lại {brand,last4}. */
(function () {
  'use strict';

  var BASE = '/api/account/payment-methods';
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  var _loaded = false;      // chống nạp trùng (giống _addrLoaded)
  var _cards = [];          // cache list hiện tại
  var _editing = null;      // thẻ đang sửa (null = thêm)
  var _modalTrigger = null; // element trả focus khi đóng modal

  function byId(id) { return document.getElementById(id); }
  // i18n — nhãn tĩnh do js/i18n.js áp qua data-i18n; t() cho chuỗi JS sinh.
  function elHide(el) { if (el) el.hidden = true; }
  function elShow(el) { if (el) el.hidden = false; }
  function fVal(id) { var el = byId(id); return el ? (el.value || '').trim() : ''; }
  function fSet(id, v) { var el = byId(id); if (el) el.value = (v == null) ? '' : v; }
  function setLive(msg) { var el = byId('pm-live'); if (el) el.textContent = msg || ''; }
  function pad2(n) { return ('0' + n).slice(-2); }
  function findCard(id) { for (var i = 0; i < _cards.length; i++) if (_cards[i].id === id) return _cards[i]; return null; }

  // Toast dùng lại CSS .settings-toast của profile.html.
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

  // Luhn — chỉ để validate client. Nhận chuỗi chỉ gồm chữ số.
  function luhn(d) {
    var sum = 0, alt = false;
    for (var i = d.length - 1; i >= 0; i--) {
      var n = d.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function isExpired(c) {
    var now = new Date();
    var cy = now.getFullYear(), cm = now.getMonth() + 1;
    return c.exp_year < cy || (c.exp_year === cy && c.exp_month < cm);
  }

  // Logo brand (markup TĨNH theo brand — không có dữ liệu người dùng).
  function brandSvg(brand) {
    if (brand === 'visa') {
      return '<svg viewBox="0 0 40 26" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="26" fill="#1a1f71"/><text x="20" y="17" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="10" font-style="italic" font-weight="700" letter-spacing="1" fill="#fff">VISA</text></svg>';
    }
    if (brand === 'mastercard') {
      return '<svg viewBox="0 0 40 26" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="26" fill="#f4f2ee"/><circle cx="16.5" cy="13" r="7.5" fill="#eb001b"/><circle cx="23.5" cy="13" r="7.5" fill="#f79e1b" fill-opacity=".85"/></svg>';
    }
    // amex / jcb / other -> ô chữ viết tắt
    var map = { amex: ['#2e77bc', 'AMEX'], jcb: ['#0b4ea2', 'JCB'], other: ['#6b6b6b', 'THẺ'] };
    var m = map[brand] || map.other;
    return '<svg viewBox="0 0 40 26" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="26" fill="' + m[0] + '"/><text x="20" y="17" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="9" font-weight="700" letter-spacing=".5" fill="#fff">' + m[1] + '</text></svg>';
  }

  // ---- Nạp danh sách ----
  function load(force) {
    if (!(window.AuthHelper && window.AuthHelper.isLoggedIn())) return;
    if (_loaded && !force) return;
    _loaded = true;
    showLoading();
    window.AuthHelper.apiFetch(BASE)
      .then(function (r) { if (!r.ok) throw new Error('GET payment-methods ' + r.status); return r.json(); })
      .then(function (d) {
        renderCards(d.payment_methods || []);
        setLive(_cards.length ? t('pf.payLoaded', { n: _cards.length }) : t('pf.noCards'));
      })
      .catch(function (e) { _loaded = false; console.error('[payments] tải thẻ lỗi:', e.message); showError(); });
  }

  function showLoading() {
    elHide(byId('pm-add')); elHide(byId('pm-list')); elHide(byId('pm-empty')); elHide(byId('pm-error'));
    elShow(byId('pm-loading'));
    setLive(t('pf.payLoading'));
  }
  function showError() {
    elHide(byId('pm-add')); elHide(byId('pm-loading')); elHide(byId('pm-list')); elHide(byId('pm-empty'));
    elShow(byId('pm-error'));
  }

  // ---- Render ----
  function renderCards(list) {
    _cards = list || [];
    elHide(byId('pm-loading')); elHide(byId('pm-error'));
    elShow(byId('pm-add'));
    var listEl = byId('pm-list');
    listEl.innerHTML = '';
    if (_cards.length === 0) {
      elHide(listEl); elShow(byId('pm-empty'));
      return;
    }
    elHide(byId('pm-empty'));
    for (var i = 0; i < _cards.length; i++) listEl.appendChild(buildCard(_cards[i]));
    elShow(listEl);
  }

  function actionBtn(action, id, text, danger) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'addr-link' + (danger ? ' is-danger' : '');
    b.textContent = text;
    b.setAttribute('data-action', action);
    b.setAttribute('data-id', id);
    return b;
  }

  function buildCard(c) {
    var expired = isExpired(c);
    var card = document.createElement('div');
    card.className = 'pm-card' + (c.is_default ? ' is-default' : '') + (expired ? ' is-expired' : '');
    card.setAttribute('role', 'listitem');

    var brand = document.createElement('div');
    brand.className = 'pm-brand';
    brand.innerHTML = brandSvg(c.brand);   // markup tĩnh theo brand
    card.appendChild(brand);

    var info = document.createElement('div');
    info.className = 'pm-info';
    var num = document.createElement('div');
    num.className = 'pm-num';
    num.textContent = '•••• ' + c.last4;
    info.appendChild(num);
    var exp = document.createElement('div');
    exp.className = 'pm-exp' + (expired ? ' is-expired' : '');
    var mmyy = pad2(c.exp_month) + '/' + String(c.exp_year).slice(-2);
    exp.textContent = expired ? t('pf.expiredOn', { mmyy: mmyy }) : mmyy;
    info.appendChild(exp);
    card.appendChild(info);

    if (c.is_default) {
      var badge = document.createElement('span');
      badge.className = 'pm-badge';
      badge.textContent = t('pf.default');
      card.appendChild(badge);
    }

    var actions = document.createElement('div');
    actions.className = 'pm-actions';
    if (!c.is_default && !expired) actions.appendChild(actionBtn('default', c.id, t('pf.setDefault'), false));
    actions.appendChild(actionBtn('edit', c.id, t('com.edit'), false));
    actions.appendChild(actionBtn('delete', c.id, t('com.delete'), true));
    card.appendChild(actions);
    return card;
  }

  // ---- Modal ----
  /* Hẹn giờ gỡ modal khỏi layout sau hiệu ứng mờ. PHẢI giữ id để huỷ được: mở lại
     trong lúc nó còn treo thì nó vẫn nổ vô điều kiện, đá hidden về true trong khi
     .is-open đang bật — modal biến mất mà nền vẫn khoá cuộn. Xem closeModal. */
  var _pmCloseTimer = null;

  function openModal(card) {
    clearTimeout(_pmCloseTimer);
    _pmCloseTimer = null;

    _editing = card || null;
    _modalTrigger = document.activeElement;
    byId('pm-modal-title').textContent = _editing ? t('pf.editCard') : t('pf.addCard');
    var save = byId('pm-save'); save.textContent = t('pf.saveCard'); save.disabled = false;
    clearErrors();
    fillForm(_editing);
    var overlay = byId('pm-modal-overlay');
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
    setTimeout(function () { var f = byId('pf-number'); if (f) f.focus(); }, 40);
  }

  function closeModal() {
    var overlay = byId('pm-modal-overlay');
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    _pmCloseTimer = setTimeout(function () {
      _pmCloseTimer = null;
      overlay.hidden = true;
    }, 220);
    if (_modalTrigger && _modalTrigger.focus) { try { _modalTrigger.focus(); } catch (e) {} }
    _modalTrigger = null;
  }

  // Điền form. Sửa: ô số thẻ luôn TRỐNG (placeholder •••• last4, không required = giữ số cũ).
  // Sửa thẻ đang mặc định -> khoá checkbox (không tự bỏ default; giống addresses).
  function fillForm(c) {
    var num = byId('pf-number');
    fSet('pf-number', '');
    fSet('pf-holder', c ? c.holder_name : '');
    fSet('pf-month', c ? pad2(c.exp_month) : '');
    fSet('pf-year', c ? String(c.exp_year) : '');
    var chk = byId('pf-default');
    var isDef = !!(c && c.is_default);
    chk.checked = isDef;
    chk.disabled = isDef;
    if (c) { num.placeholder = '•••• ' + c.last4; num.removeAttribute('required'); }
    else { num.placeholder = '1234 5678 9012 3456'; num.setAttribute('required', 'required'); }
  }

  // ---- Validation client (mirror server) ----
  function clearErrors() {
    var ids = ['pf-number', 'pf-holder', 'pf-month', 'pf-year'];
    for (var i = 0; i < ids.length; i++) {
      var el = byId(ids[i]);
      if (el) { el.classList.remove('addr-input-err'); el.removeAttribute('aria-invalid'); }
    }
    var msgs = ['pf-number-msg', 'pf-holder-msg', 'pf-exp-msg'];
    for (var j = 0; j < msgs.length; j++) { var m = byId(msgs[j]); if (m) m.textContent = ''; }
  }
  function markError(inputIds, msgId, msg) {
    var ids = (typeof inputIds === 'string') ? [inputIds] : inputIds;
    for (var i = 0; i < ids.length; i++) {
      var el = byId(ids[i]);
      if (el) { el.classList.add('addr-input-err'); el.setAttribute('aria-invalid', 'true'); }
    }
    var m = byId(msgId); if (m) m.textContent = msg;
    return byId(ids[0]);
  }

  function validateExp(mRaw, yRaw) {
    var m = Number(mRaw);
    if (!mRaw || !isInt(m) || m < 1 || m > 12) return t('pf.errExpMonth');
    var y = Number(yRaw);
    if (!yRaw || !isInt(y)) return t('pf.errExpYear');
    if (y >= 0 && y < 100) y += 2000;
    if (y < 2000 || y > 2099) return t('pf.errExpYear');
    var now = new Date(); var cy = now.getFullYear(), cm = now.getMonth() + 1;
    if (y < cy || (y === cy && m < cm)) return t('pf.errCardExpired');
    return null;
  }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  function validate() {
    clearErrors();
    var firstBad = null;
    function fail(inputs, msgId, msg) { var el = markError(inputs, msgId, msg); if (!firstBad) firstBad = el; }

    var isEdit = !!_editing;
    var num = fVal('pf-number');
    if (!isEdit && !num) fail('pf-number', 'pf-number-msg', t('pf.errCardNumber'));
    else if (num) {
      var digits = num.replace(/[\s-]/g, '');
      if (!/^\d{13,19}$/.test(digits) || !luhn(digits)) fail('pf-number', 'pf-number-msg', t('pf.errCardNumberBad'));
    }
    if (!fVal('pf-holder')) fail('pf-holder', 'pf-holder-msg', t('pf.errCardHolder'));
    var expMsg = validateExp(fVal('pf-month'), fVal('pf-year'));
    if (expMsg) fail(['pf-month', 'pf-year'], 'pf-exp-msg', expMsg);

    if (firstBad) { firstBad.focus(); return false; }
    return true;
  }

  // ---- Submit (thêm/sửa) ----
  function readResult(r) {
    return r.json().catch(function () { return {}; })
      .then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
  }

  function submit(e) {
    if (e) e.preventDefault();
    if (!validate()) return;

    var isEdit = !!_editing;
    var rawNum = fVal('pf-number');
    var payload = {
      holder_name: fVal('pf-holder'),
      exp_month: Number(fVal('pf-month')),
      exp_year: Number(fVal('pf-year')),
    };
    if (!isEdit) { payload.card_number = rawNum; payload.is_default = byId('pf-default').checked; }
    else if (rawNum) { payload.card_number = rawNum; }   // sửa: chỉ gửi khi gõ số mới
    var wantDefault = byId('pf-default').checked;

    var save = byId('pm-save'); var label = save.textContent;
    save.disabled = true; save.textContent = t('pf.saving');

    var url = isEdit ? (BASE + '/' + encodeURIComponent(_editing.id)) : BASE;
    var opts = { method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(payload) };

    window.AuthHelper.apiFetch(url, opts).then(readResult)
      .then(function (out) {
        if (!out.ok) {
          if (out.status === 401) return null;
          toast((out.data && out.data.message) || t('pf.errSaveCard'), false);
          return null;
        }
        // Sửa + muốn đặt mặc định (trước đó chưa phải) -> PATCH tiếp, render kết quả cuối.
        if (isEdit && wantDefault && !(_editing && _editing.is_default)) {
          return window.AuthHelper.apiFetch(BASE + '/' + encodeURIComponent(_editing.id) + '/default', { method: 'PATCH' })
            .then(readResult).then(function (res2) {
              var cards = (res2.ok && res2.data.payment_methods) ? res2.data.payment_methods : out.data.payment_methods;
              if (cards) renderCards(cards);
              finishOk(isEdit);
            });
        }
        if (out.data.payment_methods) renderCards(out.data.payment_methods);
        finishOk(isEdit);
        return null;
      })
      .catch(function (err) { console.error('[payments] lưu thẻ lỗi:', err.message); toast(t('pf.errSaveCard'), false); })
      .then(function () { save.disabled = false; save.textContent = label; });
  }
  function finishOk(isEdit) { closeModal(); toast(isEdit ? t('pf.cardUpdated') : t('pf.cardAdded')); }

  // ---- Đặt mặc định / Xoá ----
  function setDefault(id) {
    window.AuthHelper.apiFetch(BASE + '/' + encodeURIComponent(id) + '/default', { method: 'PATCH' })
      .then(readResult).then(function (out) {
        if (out.ok) { if (out.data.payment_methods) renderCards(out.data.payment_methods); toast(t('pf.cardDefaultSet')); return; }
        if (out.status === 401) return;
        toast((out.data && out.data.message) || t('pf.errCardDefault'), false);
      })
      .catch(function (e) { console.error('[payments] đặt mặc định lỗi:', e.message); toast(t('pf.errCardDefault'), false); });
  }

  function del(id) {
    var c = findCard(id);
    var label = c ? (c.brand + ' •••• ' + c.last4) : t('pf.thisOne');
    if (!window.confirm(t('pf.confirmDelCard', { label: label }))) return;
    window.AuthHelper.apiFetch(BASE + '/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(readResult).then(function (out) {
        if (out.ok) { if (out.data.payment_methods) renderCards(out.data.payment_methods); toast(t('pf.cardDeleted')); return; }
        if (out.status === 401) return;
        toast((out.data && out.data.message) || t('pf.errDelCard'), false);
      })
      .catch(function (e) { console.error('[payments] xóa thẻ lỗi:', e.message); toast(t('pf.errDelCard'), false); });
  }

  // ---- Uỷ quyền click trên list + focus trap modal ----
  function onListClick(e) {
    var btn = e.target.closest ? e.target.closest('button[data-action]') : null;
    if (!btn) return;
    var id = parseInt(btn.getAttribute('data-id'), 10);
    var action = btn.getAttribute('data-action');
    if (action === 'edit') openModal(findCard(id));
    else if (action === 'delete') del(id);
    else if (action === 'default') setDefault(id);
  }

  function onModalKeydown(e) {
    if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab' && e.keyCode !== 9) return;
    var modal = byId('pm-modal-overlay').querySelector('.pm-modal');
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

  function init() {
    var add = byId('pm-add'); if (add) add.addEventListener('click', function () { openModal(null); });
    var addEmpty = byId('pm-add-empty'); if (addEmpty) addEmpty.addEventListener('click', function () { openModal(null); });
    var retry = byId('pm-retry'); if (retry) retry.addEventListener('click', function () { load(true); });
    var close = byId('pm-modal-close'); if (close) close.addEventListener('click', closeModal);
    var cancel = byId('pm-cancel'); if (cancel) cancel.addEventListener('click', closeModal);
    var form = byId('pm-form'); if (form) form.addEventListener('submit', submit);
    var listEl = byId('pm-list'); if (listEl) listEl.addEventListener('click', onListClick);
    var overlay = byId('pm-modal-overlay');
    if (overlay) {
      overlay.addEventListener('keydown', onModalKeydown);
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeModal(); });
    }
    // Đăng xuất -> cho phép nạp lại khi đăng nhập lần sau (giống _addrLoaded).
    if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
      window.AuthHelper.onChange(function (user) { if (!user) _loaded = false; });
    }
  }

  // Public: profile.html gọi window.PaymentMethods.load() từ applySection (lazy theo tab).
  // rerender: profile.html gọi lại khi đổi VI/EN (dựng lại card từ cache, không gọi API).
  window.PaymentMethods = {
    load: load,
    rerender: function () { if (_loaded) renderCards(_cards); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
