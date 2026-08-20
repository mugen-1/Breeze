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

  // Tra từ điển UI (js/i18n.js). Trả về khoá nếu i18n chưa nạp -> không bao giờ throw.
  function _t(key, params) {
    return (window.__i18n && window.__i18n.t) ? window.__i18n.t(key, params) : key;
  }

  var trigger = document.querySelector('a[aria-label="Tài khoản"]');
  // Dấu neo ổn định: aria-label có thể bị i18n đổi sang tiếng Anh, CSS bên dưới
  // phải bám vào class chứ không bám vào aria-label.
  if (trigger) trigger.classList.add('acct-trigger');
  if (!trigger) return; // trang không có icon user => thoát êm, không lỗi
  window.__acctMenuInit = true;

  // ---- style (chèn 1 lần) ----
  injectStyles();

  // ---- popover ----
  var pop = document.createElement('div');
  pop.className = 'acct-pop';
  pop.setAttribute('role', 'menu');
  pop.hidden = true;
  document.body.appendChild(pop);       // nội dung dựng động theo trạng thái đăng nhập (render)

  // Badge số lượng giỏ gắn NGAY TRÊN icon tài khoản (header không còn icon giỏ riêng).
  // cart.js quét mọi '.cart-badge' trong _updateAllBadges() nên số tự đồng bộ realtime.
  if (!trigger.querySelector('.cart-badge')) {
    var badge = document.createElement('span');
    badge.className = 'cart-badge';
    badge.textContent = '0';
    badge.style.display = 'none';
    trigger.appendChild(badge);
  }

  // Ảnh đại diện: thay CHỖ HÌNH của icon người khi đã đăng nhập và có avatar.
  // Chỉ đổi hình — hành vi click giữ nguyên (vẫn mở popover như trước).
  var avatarImg = trigger.querySelector('.user-avatar');
  if (!avatarImg) {
    avatarImg = document.createElement('img');
    avatarImg.className = 'user-avatar';
    avatarImg.alt = _t('acc.avatarAlt');
    avatarImg.hidden = true;
    trigger.insertBefore(avatarImg, trigger.firstChild);
  }

  // Lời chào "Xin chào, <tên>" chèn cạnh icon, chỉ hiện khi đã đăng nhập.
  var greet = document.createElement('span');
  greet.className = 'acct-greet';
  greet.hidden = true;
  if (trigger.parentNode) trigger.parentNode.insertBefore(greet, trigger);

  // Trang KHÔNG hiện lời chào cạnh icon (tên vẫn nằm trong dropdown khi bấm):
  //   - index (hero): giữ header thoáng
  //   - search: nhường chỗ cho thanh tìm kiếm ngay cạnh icon tài khoản
  //   - 3 trang chính sách: chỉ giữ thanh tìm kiếm + icon tài khoản, bỏ lời chào
  // Khoá là KHOÁ TRANG (tên file bỏ đuôi) chứ không phải tên file — xem js/routes.js.
  // Nhờ vậy vẫn đúng khi URL đổi sang dạng không đuôi (/search thay cho /search.html).
  var NO_GREET_PAGES = {
    index: true, search: true,
    chinhsachbaomat: true, chinhsachdoitra: true, chinhsachgiaohang: true,
  };
  var hideGreeting = !!NO_GREET_PAGES[window.BreezeRoutes.currentPageKey()];

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
  // Đích của các mục điều hướng — CHỈ trỏ tới trang có sẵn, không sửa gì trong các trang đó.
  // Giá trị là KHOÁ TRANG; đường dẫn thật do js/routes.js quyết định.
  var NAV_TARGETS = {
    profile: 'profile',   // Thông tin tài khoản
    cart: 'cart',         // Giỏ hàng
    orders: 'orders',     // Đơn hàng ("Đơn Hàng Của Tôi")
  };

  pop.addEventListener('click', function (e) {
    var btn = e.target.closest('.acct-pop-btn');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    close();
    if (act === 'login') {
      window.location.href = window.BreezeRoutes.to('login');
    } else if (act === 'logout') {
      doLogout();
    } else if (NAV_TARGETS[act]) {
      window.location.href = window.BreezeRoutes.to(NAV_TARGETS[act]);
    }
  });

  // ---- dựng nội dung theo trạng thái, cập nhật khi đăng nhập/đăng xuất ----
  function nameOf(user) {
    if (!user) return '';
    var n = user.displayName;
    if (!n && user.email) n = user.email.split('@')[0];   // không có tên -> lấy phần trước @
    return n || _t('acc.you');
  }
  /* ---- Ảnh đại diện trên header ----
     Nguồn: GET /api/me (trường avatar_url) qua AuthHelper.apiFetch.
     Chưa đăng nhập / chưa có ảnh / ảnh lỗi -> giữ nguyên icon người mặc định.
     Tên file avatar do server sinh kèm phiên bản nên URL tự đổi khi user đổi ảnh —
     KHÔNG cần thêm '?t=' phá cache ở đây. */
  var _avatarUrl = null;    // URL đang hiển thị trên header
  var _avatarUid = null;    // đã nạp avatar cho uid nào -> tránh gọi /api/me lặp

  // Có avatar thì header chỉ hiện ẢNH, không kèm tên (theo yêu cầu Phase 4).
  function applyGreet(user) {
    greet.hidden = !user || hideGreeting || !!_avatarUrl;
  }

  function setAvatar(url) {
    _avatarUrl = url || null;
    if (_avatarUrl) {
      avatarImg.src = _avatarUrl;
      avatarImg.hidden = false;
      trigger.classList.add('has-avatar');   // CSS ẩn <i class="fa"> bên trong
    } else {
      avatarImg.hidden = true;
      avatarImg.removeAttribute('src');
      trigger.classList.remove('has-avatar');
    }
    applyGreet(window.AuthHelper && typeof window.AuthHelper.getUser === 'function'
      ? window.AuthHelper.getUser() : null);
  }

  // Ảnh 404/hỏng (vd vừa đổi avatar, file cũ đã được dọn) -> rơi về icon mặc định.
  avatarImg.addEventListener('error', function () {
    if (!avatarImg.hidden) setAvatar(null);
  });

  function loadAvatar(user) {
    var uid = user ? user.uid : null;
    if (uid === _avatarUid) return;        // cùng người -> khỏi gọi lại
    _avatarUid = uid;
    if (!uid) { setAvatar(null); return; } // đăng xuất -> về icon ngay
    if (!(window.AuthHelper && typeof window.AuthHelper.apiFetch === 'function')) return;

    window.AuthHelper.apiFetch('/api/me')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (me) {
        // Đổi tài khoản trong lúc chờ -> BỎ kết quả cũ, không hiện avatar người khác.
        var cur = window.AuthHelper.getUser();
        if (!cur || cur.uid !== uid) return;
        setAvatar(me && me.avatar_url);
      })
      .catch(function () { /* không lấy được -> giữ icon mặc định, không phá header */ });
  }

  // Đổi ảnh ở trang Quyền riêng tư -> header đổi ngay, không cần tải lại trang.
  document.addEventListener('avatarchange', function (e) {
    setAvatar(e && e.detail && e.detail.avatar_url);
  });

  function render(user) {
    loadAvatar(user);
    if (user) {
      var nm = nameOf(user);
      greet.textContent = _t('acc.helloName', { name: nm });
      applyGreet(user);   // ẩn ở index/search/chính sách, hoặc khi đã có avatar
      pop.innerHTML =
        '<div class="acct-pop-name">' + esc(nm) + '</div>' +
        '<button type="button" class="acct-pop-btn" data-act="profile" role="menuitem">' + _t('acc.profile') + '</button>' +
        '<button type="button" class="acct-pop-btn" data-act="cart" role="menuitem">' +
          _t('acc.cart') + '<span class="cart-badge acct-pop-badge">0</span>' +
        '</button>' +
        '<button type="button" class="acct-pop-btn" data-act="orders" role="menuitem">' + _t('acc.orders') + '</button>' +
        '<button type="button" class="acct-pop-btn acct-pop-btn--sep" data-act="logout" role="menuitem">' + _t('com.signout') + '</button>';
    } else {
      greet.hidden = true;
      // Khách vẫn có giỏ riêng (localStorage) -> vẫn vào xem/sửa được ở cart.html.
      // Không dẫn thẳng tới checkout: nút Thanh Toán trong cart.html sẽ đẩy sang login.
      pop.innerHTML =
        '<button type="button" class="acct-pop-btn" data-act="cart" role="menuitem">' +
          _t('acc.cart') + '<span class="cart-badge acct-pop-badge">0</span>' +
        '</button>' +
        '<button type="button" class="acct-pop-btn acct-pop-btn--sep" data-act="login" role="menuitem">' + _t('com.signin') + '</button>';
    }
    // Badge trong menu vừa được dựng lại -> đồng bộ số lượng ngay (cart.js quét .cart-badge).
    if (typeof window._updateAllBadges === 'function') window._updateAllBadges();
    if (!pop.hidden) place();   // đang mở thì canh lại vị trí theo chiều cao mới
  }

  render(window.AuthHelper && typeof window.AuthHelper.getUser === 'function'
    ? window.AuthHelper.getUser() : null);
  if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
    window.AuthHelper.onChange(render);
  }
  // Đổi VI/EN: popover được dựng bằng innerHTML nên phải render lại.
  document.addEventListener('langchange', function () {
    render(window.AuthHelper && typeof window.AuthHelper.getUser === 'function'
      ? window.AuthHelper.getUser() : null);
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
      window.location.href = window.BreezeRoutes.to('login', { notice: 'need-login' });
      return;
    }
    var fb = (window.firebase && firebase.auth) ? firebase.auth() : null;
    var p = fb ? fb.signOut() : Promise.resolve();
    var done = function () {
      try { localStorage.removeItem('userName'); } catch (e) {}
      toast(_t('acc.signedOut'));
      setTimeout(function () { window.location.href = window.BreezeRoutes.to('index'); }, 1000);
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
      // Ảnh đại diện tròn thay chỗ icon người. Kích thước cố định để header không nhảy
      // layout lúc ảnh vừa tải xong.
      '.user-avatar{display:block;width:26px;height:26px;border-radius:50%;object-fit:cover;' +
        'border:1px solid var(--c-line,#e6e3dd);background:var(--c-surface,#f6f4ef);}' +
      '.user-avatar[hidden]{display:none;}' +
      // Có ảnh -> giấu icon người, header chỉ còn ảnh tròn.
      '.acct-trigger.has-avatar .fa{display:none;}' +
      '.acct-greet{font-family:var(--font-ui,\'Jost\',sans-serif);font-size:13px;' +
        'color:var(--c-muted,#6b6b6b);margin-right:12px;white-space:nowrap;}' +
      '.acct-greet[hidden]{display:none;}' +
      '.acct-pop-name{font-family:var(--font-ui,\'Jost\',sans-serif);font-size:13px;' +
        'color:var(--c-muted,#6b6b6b);padding:8px 14px 10px;margin-bottom:4px;' +
        'border-bottom:1px solid var(--c-line,#e6e3dd);max-width:220px;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap;}' +
      '@media (max-width:600px){.acct-greet{display:none;}}' +
      '.acct-pop-btn{appearance:none;-webkit-appearance:none;border:0;background:transparent;' +
        'font:inherit;font-size:14px;letter-spacing:.02em;color:var(--c-ink,#0e0e0e);' +
        'text-align:left;padding:10px 14px;cursor:pointer;border-radius:7px;' +
        'display:flex;align-items:center;justify-content:space-between;gap:12px;' +
        'transition:background-color .18s var(--ease,ease),color .18s var(--ease,ease);}' +
      // Gạch ngăn trước "Đăng xuất" — tách hành động rời phiên khỏi nhóm điều hướng.
      '.acct-pop-btn--sep{margin-top:4px;padding-top:12px;' +
        'border-top:1px solid var(--c-line,#e6e3dd);border-radius:0 0 7px 7px;}' +
      // Badge trong menu: huỷ định vị tuyệt đối của .cart-badge (vốn dành cho icon).
      '.acct-pop-badge{position:static;top:auto;right:auto;flex:0 0 auto;}' +
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
