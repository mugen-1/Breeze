/* account-menu.js — popover cho icon user ở header storefront.
   - Gắn HÀNH VI vào icon có sẵn: a[aria-label="Tài khoản"] (KHÔNG thêm markup icon).
   - Click icon (mọi trạng thái) => mở popover 2 nút: [Tài khoản] + [Đăng xuất].
       • Tài khoản  -> login.html
       • Đăng xuất  -> nếu đang đăng nhập: signOut + toast "Đã đăng xuất" -> index.html
                        nếu chưa đăng nhập: login.html?notice=need-login
   - Đóng khi click ra ngoài / Esc. aria-expanded phản ánh đúng trạng thái.
   - Guard: thiếu AuthHelper/firebase => coi như CHƯA đăng nhập, không throw.
   - Chỉ dùng biến palette trong css/global.css (off-black/off-white), font Jost.
   Tải SAU js/auth-helper.js. */
(function () {
  'use strict';

  // Chống khởi tạo trùng nếu file lỡ được nạp 2 lần.
  if (window.__acctMenuInit) return;

  var trigger = document.querySelector('a[aria-label="Tài khoản"]');
  if (!trigger) return; // trang không có icon user => thoát êm, không lỗi
  window.__acctMenuInit = true;

  // ---- style (chèn 1 lần) ----
  injectStyles();

  // ---- popover ----
  var pop = document.createElement('div');
  pop.className = 'acct-pop';
  pop.setAttribute('role', 'menu');
  pop.hidden = true;
  pop.innerHTML =
    '<button type="button" class="acct-pop-btn" data-act="account" role="menuitem">Tài khoản</button>' +
    '<button type="button" class="acct-pop-btn" data-act="logout" role="menuitem">Đăng xuất</button>';
  document.body.appendChild(pop);

  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  // ---- mở/đóng ----
  function place() {
    var r = trigger.getBoundingClientRect();
    pop.style.top = (window.scrollY + r.bottom + 8) + 'px';
    // canh phải: mép phải popover trùng mép phải icon
    pop.style.left = (window.scrollX + r.right - pop.offsetWidth) + 'px';
  }

  function open() {
    pop.hidden = false;
    place();
    trigger.setAttribute('aria-expanded', 'true');
    // listener thêm ở đây KHÔNG bị kích hoạt bởi chính cú click đang mở (theo spec DOM).
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
  }

  function close() {
    if (pop.hidden) return;
    pop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  }

  function onDocClick(e) {
    if (pop.contains(e.target) || trigger.contains(e.target)) return;
    close();
  }
  function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Esc') { close(); trigger.focus(); }
  }

  trigger.addEventListener('click', function (e) {
    e.preventDefault();
    if (pop.hidden) open(); else close();
  });

  // ---- hành động 2 nút ----
  pop.addEventListener('click', function (e) {
    var btn = e.target.closest('.acct-pop-btn');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    close();
    if (act === 'account') {
      window.location.href = 'login.html';
    } else if (act === 'logout') {
      doLogout();
    }
  });

  function isLoggedIn() {
    try {
      return !!(window.AuthHelper &&
        typeof window.AuthHelper.isLoggedIn === 'function' &&
        window.AuthHelper.isLoggedIn());
    } catch (e) { return false; }
  }

  function doLogout() {
    if (!isLoggedIn()) {
      window.location.href = 'login.html?notice=need-login';
      return;
    }
    var fb = (window.firebase && firebase.auth) ? firebase.auth() : null;
    var p = fb ? fb.signOut() : Promise.resolve();
    var done = function () {
      try { localStorage.removeItem('userName'); } catch (e) {}
      toast('Đã đăng xuất');
      setTimeout(function () { window.location.href = 'index.html'; }, 1000);
    };
    p.then(done).catch(done); // dù signOut lỗi vẫn dọn + điều hướng
  }

  // ---- toast tự ẩn ~1.5s ----
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'acct-toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-on'); });
    setTimeout(function () {
      t.classList.remove('is-on');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 1500);
  }

  // ---- CSS (biến global.css, palette off-black/off-white, không #000/#fff thuần) ----
  function injectStyles() {
    if (document.getElementById('acct-menu-style')) return;
    var css =
      '.acct-pop{position:absolute;z-index:1000;min-width:170px;display:flex;flex-direction:column;' +
        'background:var(--c-cream,#f6f4ef);border:1px solid var(--c-line,#e6e3dd);border-radius:10px;' +
        'box-shadow:0 10px 30px rgba(14,14,14,.15);padding:6px;' +
        'font-family:var(--font-ui,\'Jost\',sans-serif);}' +
      '.acct-pop[hidden]{display:none;}' +
      '.acct-pop-btn{appearance:none;-webkit-appearance:none;border:0;background:transparent;' +
        'font:inherit;font-size:14px;letter-spacing:.02em;color:var(--c-ink,#0e0e0e);' +
        'text-align:left;padding:10px 14px;cursor:pointer;border-radius:7px;' +
        'transition:background-color .18s var(--ease,ease),color .18s var(--ease,ease);}' +
      '.acct-pop-btn:hover,.acct-pop-btn:focus-visible{background:var(--c-ink,#0e0e0e);' +
        'color:var(--c-cream,#f6f4ef);outline:none;}' +
      '.acct-toast{position:fixed;left:50%;bottom:32px;transform:translate(-50%,12px);z-index:1100;' +
        'background:var(--c-ink,#0e0e0e);color:var(--c-cream,#f6f4ef);' +
        'font-family:var(--font-ui,\'Jost\',sans-serif);font-size:14px;letter-spacing:.02em;' +
        'padding:11px 20px;border-radius:999px;box-shadow:0 10px 30px rgba(14,14,14,.22);' +
        'opacity:0;pointer-events:none;transition:opacity .3s var(--ease,ease),transform .3s var(--ease,ease);}' +
      '.acct-toast.is-on{opacity:1;transform:translate(-50%,0);}';
    var st = document.createElement('style');
    st.id = 'acct-menu-style';
    st.textContent = css;
    document.head.appendChild(st);
  }
})();
