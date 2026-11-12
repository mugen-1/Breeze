/* User card ở đáy sidebar admin: markup/CSS tĩnh + hành vi thật của admin.js trên DOM giả.
   DOM giả KHÔNG kiểm được giao diện, vị trí popup, focus ring hay dark mode — phần đó
   phải mở trình duyệt. */
const fs = require('fs');
const path = require('path');
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'admin.css'), 'utf8');
const i18n = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');

console.log('admin-user-menu.js');

// ---- Markup / CSS / i18n tĩnh ------------------------------------------------
check('old header account icon removed', !/adm-account|btn-logout|adm-logout/.test(html));
check('header keeps language host, search and bell',
  html.includes('id="lang-switcher-host"') && html.includes('id="top-search"') && html.includes('class="adm-bell"'));
const aside = (html.match(/<aside class="adm-sidebar"[\s\S]*?<\/aside>/) || [''])[0];
check('user card lives inside sidebar, after the nav', /<\/nav>\s*(<!--[\s\S]*?-->\s*)?<div class="adm-user" id="adm-user">/.test(aside));
check('card is a button with aria-haspopup + aria-expanded',
  /<button type="button" class="adm-user-btn" id="adm-user-btn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/.test(aside));
check('popup is role=menu, hidden, placed after the card button',
  /id="adm-user-btn"[\s\S]*<\/button>\s*<div class="adm-user-menu" id="adm-user-menu" role="menu"[^>]*hidden><\/div>/.test(aside));
check('no inline handlers in the user card', !/\son[a-z]+=/i.test(aside));
check('profile has no entry in the left menu', !/data-nav="profile"/.test(html));
const profile = (html.match(/<section id="view-profile"[\s\S]*?<\/section>/) || [''])[0];
check('profile section hidden by default', /<section id="view-profile" style="display:none;"/.test(profile));
check('no view has a breadcrumb', !/adm-crumb/.test(html));
check('profile title uses the shared page-title style', /<h1 class="adm-page-title"[^>]*data-i18n="adm.profile">Hồ sơ<\/h1>/.test(profile));
const h1s = html.match(/<h1\b[^>]*>/g) || [];
check('every view h1 can take focus (tabindex="-1")', h1s.length === 9 && h1s.every(h => h.includes('tabindex="-1"')), '(' + h1s.length + ' h1)');

check('old account CSS removed', !/\.adm-account|\.adm-logout/.test(css));
check('sidebar is a flex column', /body\.adm-authed \.adm-sidebar \{ display:flex; \}/.test(css) && /\.adm-sidebar \{[^}]*flex-direction:column/.test(css));
check('menu list scrolls on its own', /\.adm-nav \{[^}]*min-height:0;[^}]*overflow-y:auto/.test(css));
check('user card pinned to the bottom with margin-top:auto', /\.adm-user \{[^}]*margin-top:auto/.test(css));
check('popup opens above the card', /\.adm-user-menu \{[^}]*bottom:calc\(100% - 4px\)/.test(css));
check('name truncates with ellipsis', /\.adm-user-name \{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/.test(css));
const block = css.slice(css.indexOf('/* --- User card'), css.indexOf('.adm-user-sep'));
check('user card CSS uses colour tokens, no hex colours', block.length > 0 && !/#[0-9a-f]{3,8}\b/i.test(block) && !/rgba?\(/.test(block));
check('popup shadow uses the --c-shadow token', /\.adm-user-menu \{[^}]*box-shadow:0 10px 30px var\(--c-shadow\)/.test(css));
const tokens = fs.readFileSync(path.join(ROOT, 'css', 'tokens.css'), 'utf8');
check('--c-shadow light value unchanged (.16)', /html\[data-theme="light"\] \{[^}]*--c-shadow: rgba\(0, 0, 0, \.16\)/.test(tokens));
check('--c-shadow has a dark theme value', /html\[data-theme="dark"\] \{[^}]*--c-shadow:/.test(tokens));
// Drawer ≤1023px: ẩn thật khi đóng, giữ animation trượt; desktop không bị đụng.
// Có nhiều khối ≤1023px (vd section Hồ sơ) — lấy đúng khối chứa rule của sidebar/drawer.
const drawerMq = (css.match(/@media \(max-width: 1023px\) \{[\s\S]*?\n\}/g) || []).find(b => b.includes('.adm-sidebar {')) || '';
check('closed drawer is really hidden (visibility) inside the ≤1023px query',
  /\.adm-sidebar \{[^}]*visibility:hidden;[^}]*transition:transform \.3s var\(--ease\), visibility 0s linear \.3s;/.test(drawerMq));
check('open drawer becomes visible immediately',
  /body\.adm-drawer-open \.adm-sidebar \{[^}]*visibility:visible;[^}]*visibility 0s linear 0s;/.test(drawerMq));
const baseSidebar = (css.match(/\n\.adm-sidebar \{[^}]*\}/) || [''])[0];
check('desktop sidebar rule has no visibility change', baseSidebar.length > 0 && !/visibility/.test(baseSidebar));
check('popup items get 44px touch target by pointer type',
  /@media \(pointer: coarse\) \{\s*\.adm-user-item \{ min-height:44px; \}/.test(css));
check('touch target is not tied to screen width', !/@media \(max-width[^{]*\{[^@]*\.adm-user-item \{[^}]*min-height/.test(css));
['adm.profile', 'adm.crumbProfile', 'adm.userMenu', 'adm.adminFallback'].forEach(k => {
  eq('i18n key ' + k + ' exists in VI and EN', (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length, 2);
});

// ---- Hành vi admin.js -------------------------------------------------------
function setup(me, fbUser) {
  const doc = makeDoc(), g = id => doc.getElementById(id);
  const calls = [], timers = [], signOuts = [];
  const dashNav = El('button'), usersNav = El('button');
  dashNav.setAttribute('data-nav', 'dashboard'); dashNav.classList.add('active'); dashNav.setAttribute('aria-current', 'page');
  usersNav.setAttribute('data-nav', 'users');
  const navs = [dashNav, usersNav];
  doc._qsa['.adm-nav-item'] = navs;
  doc.querySelector = s => s === '.adm-nav-item.active' ? navs.find(n => n.classList.contains('active')) || null
    : s === '.adm-nav-item' ? navs[0] : null;
  // Theo dõi focus thật sự đang ở đâu (DOM giả mặc định không có activeElement).
  const trackFocus = e => { e.focus = () => { doc.activeElement = e; }; return e; };
  const create = doc.createElement;
  doc.createElement = t => trackFocus(create(t));
  [g('adm-user-btn'), g('adm-menu-btn'), dashNav, usersNav].forEach(trackFocus);
  // Cấu trúc <body> như admin.html: topbar (☰ + logo + VI/EN + cụm phải), sidebar, nền mờ,
  // main, modal, toast, script — để kiểm inert gắn/gỡ đúng chỗ.
  const topbar = El('header'), parts = { logo: El('a'), lang: g('lang-switcher-host'), right: g('bar-right') };
  [g('adm-menu-btn'), parts.logo, parts.lang, parts.right].forEach(c => topbar.appendChild(c));
  parts.topbar = topbar; parts.main = El('main'); parts.modal = El('div'); parts.script = El('script');
  [topbar, g('adm-sidebar'), g('adm-backdrop'), parts.main, parts.modal, g('toast'), parts.script].forEach(c => doc.body.appendChild(c));
  // Mỗi view có h1 tabindex=-1 để nhận focus sau khi chọn mục trong drawer.
  const h1 = {};
  ['view-users', 'view-profile'].forEach(id => {
    h1[id] = trackFocus(El('h1'));
    g(id).querySelector = s => s === 'h1' ? h1[id] : null;
  });
  const mq = { matches: true, fn: null, addEventListener(ev, fn) { if (ev === 'change') mq.fn = fn; } };
  g('adm-user-img').tagName = 'IMG';
  g('adm-user-menu').hidden = true;
  let auth;
  const fb = { auth: () => ({ signOut() { signOuts.push(1); } }) };
  const r = load('admin.js', { doc, deps: ['routes.js', 'utils-format.js', 'order-shipping.js', 'utils-i18n.js', 'order-payment.js'],
    globals: { setTimeout: fn => { timers.push(fn); return 0; }, clearTimeout() {}, fetch: async () => ({ json: async () => [] }), firebase: fb },
    window: { firebase: fb, location: { href: 'admin.html', pathname: '/admin.html', search: '' },
      matchMedia: q => (q === '(max-width: 1023px)' ? mq : { matches: false, addEventListener() {} }),
      __i18n: { current: 'vi', t: key => 'VI:' + key }, AuthHelper: {
        onChange(fn) { auth = fn; },
        apiFetch(url, opts) {
          calls.push(url);
          let data = {};
          if (url === '/api/me') data = me;
          else if (url === '/api/categories') data = [];
          else if (url.startsWith('/api/admin/stats/order-status')) data = [];
          else if (url.startsWith('/api/admin/users?')) data = { users: [], total: 0, total_pages: 0 };
          else if (url.startsWith('/api/admin/orders?')) data = { orders: [], total: 0, total_pages: 0 };
          else if (url.startsWith('/api/admin/blacklist?')) data = { orders: [], total: 0, total_pages: 0 };
          return Promise.resolve({ ok: true, status: 200, json: async () => data });
        }
      } }
  });
  return { doc, g, calls, timers, signOuts, navs, dashNav, usersNav, parts, h1, mq, win: r.win,
    login: () => auth(fbUser), logout: () => auth(null) };
}

(async function () {
  const longName = '<b>Nguyễn Văn Quản Trị Có Tên Rất Dài</b>';
  const t = setup({ role: 'admin', email: 'boss@example.test', display_name: longName, avatar_url: '/avatars/u1-2.webp' },
    { uid: 'admin', displayName: 'Firebase Name', email: 'boss@example.test' });
  const { doc, g } = t;
  const btn = g('adm-user-btn'), menu = g('adm-user-menu'), img = g('adm-user-img');
  doc.fire('DOMContentLoaded'); t.login(); await wait(50);

  eq('name comes from /api/me display_name via textContent', g('adm-user-name').textContent, longName);
  eq('name is never written as HTML', g('adm-user-name').innerHTML, '');
  check('email is not shown', !g('adm-user-name').textContent.includes('@'));
  eq('avatar uses uploaded image via img.src', img.src, '/avatars/u1-2.webp');
  check('avatar image visible and icon hidden', img.hidden === false && btn.classList.contains('has-avatar'));
  check('popup starts closed', menu.hidden === true && btn.getAttribute('aria-expanded') === 'false');

  btn.fire('click', { detail: 1 });
  check('mouse click opens popup', menu.hidden === false && btn.getAttribute('aria-expanded') === 'true');
  const kids = menu.children;
  eq('items rendered from config in order', kids.map(k => k.getAttribute('data-user-item') || k.getAttribute('role')), ['profile', 'separator', 'logout']);
  check('items are role=menuitem buttons', [kids[0], kids[2]].every(k => k.tagName === 'BUTTON' && k.type === 'button' && k.getAttribute('role') === 'menuitem'));
  eq('labels come from i18n keys', [kids[0], kids[2]].map(k => k.children[1].textContent), ['VI:adm.profile', 'VI:com.signout']);
  check('logout is styled danger, profile is not', kids[2].className.includes('is-danger') && !kids[0].className.includes('is-danger'));
  check('mouse open keeps focus on the card', doc.activeElement !== kids[0]);

  btn.fire('click', { detail: 1 });
  check('clicking the card again closes popup', menu.hidden === true && btn.getAttribute('aria-expanded') === 'false');

  btn.fire('click', { detail: 0 });
  let items = menu.children.filter(k => k.getAttribute('role') === 'menuitem');
  check('keyboard open focuses first item', menu.hidden === false && doc.activeElement === items[0]);
  menu.fire('keydown', { key: 'ArrowDown' });
  check('ArrowDown moves to next item', doc.activeElement === items[1]);
  menu.fire('keydown', { key: 'ArrowDown' });
  check('ArrowDown wraps to first item', doc.activeElement === items[0]);
  menu.fire('keydown', { key: 'ArrowUp' });
  check('ArrowUp wraps to last item', doc.activeElement === items[1]);
  doc.fire('keydown', { key: 'Escape' });
  check('Escape closes popup and returns focus to card', menu.hidden === true && doc.activeElement === btn);

  btn.fire('keydown', { key: 'ArrowUp' });
  items = menu.children.filter(k => k.getAttribute('role') === 'menuitem');
  check('ArrowUp on card opens popup at last item', menu.hidden === false && doc.activeElement === items[1]);
  doc.fire('click', { target: El('div') });
  check('click outside closes popup', menu.hidden === true);

  btn.fire('click', { detail: 1 });
  g('adm-user').fire('focusout', { relatedTarget: El('a') });
  check('tabbing out of card + popup closes it', menu.hidden === true);

  btn.fire('click', { detail: 1 });
  const before = t.calls.length;
  menu.children[0].fire('click');
  check('choosing an item closes popup', menu.hidden === true);
  eq('Hồ sơ opens the profile section', g('view-profile').style.display, 'block');
  eq('other sections are hidden', ['view-dashboard', 'tab-products', 'view-users'].map(id => g(id).style.display), ['none', 'none', 'none']);
  check('no left-menu item is active on Hồ sơ', t.navs.every(n => !n.classList.contains('active') && n.getAttribute('aria-current') === null));
  check('user card shows the active state', btn.classList.contains('is-current'));
  doc.fire('langchange');
  eq('language change on Hồ sơ does not reload Dashboard data', t.calls.length, before);

  t.usersNav.fire('click');
  check('left-menu navigation still works and clears card active state',
    t.usersNav.classList.contains('active') && g('view-users').style.display === 'block' &&
    g('view-profile').style.display === 'none' && !btn.classList.contains('is-current'));

  // ---- Drawer (tablet/mobile) ----
  const body = doc.body, menuBtn = g('adm-menu-btn'), isOpen = () => body.classList.contains('adm-drawer-open');
  menuBtn.fire('click');
  check('☰ opens drawer and focuses the first menu item',
    isOpen() && menuBtn.getAttribute('aria-expanded') === 'true' && doc.activeElement === t.dashNav);
  doc.fire('keydown', { key: 'Escape' });
  check('Esc closes drawer and returns focus to ☰',
    !isOpen() && menuBtn.getAttribute('aria-expanded') === 'false' && doc.activeElement === menuBtn);

  menuBtn.fire('click');
  btn.fire('click', { detail: 0 });
  doc.fire('keydown', { key: 'Escape' });
  check('first Esc closes only the popup, drawer stays open', menu.hidden === true && isOpen() && doc.activeElement === btn);
  doc.fire('keydown', { key: 'Escape' });
  check('second Esc closes the drawer, focus back on ☰', !isOpen() && doc.activeElement === menuBtn);

  menuBtn.fire('click');
  g('adm-backdrop').fire('click');
  check('tapping the backdrop closes drawer and returns focus to ☰', !isOpen() && doc.activeElement === menuBtn);

  menuBtn.fire('click');
  doc.fire('keydown', { key: 'Escape', defaultPrevented: true });
  check('Esc already handled elsewhere (modal) does not close drawer', isOpen());

  // inert: mọi thứ ngoài drawer, trừ nền mờ, ☰, toast, script.
  const P = t.parts, inert = el => el.inert === true && el.getAttribute('inert') === '';
  const free = el => !el.inert && el.getAttribute('inert') === null;
  check('open drawer makes main + modals inert', inert(P.main) && inert(P.modal));
  check('open drawer makes topbar parts inert except ☰', inert(P.logo) && inert(P.lang) && inert(P.right) && free(menuBtn) && free(P.topbar));
  check('drawer, backdrop, toast and scripts stay interactive', [g('adm-sidebar'), g('adm-backdrop'), g('toast'), P.script].every(free));

  t.usersNav.focus();
  t.usersNav.fire('click');
  check('choosing a menu item in drawer closes it and removes inert',
    !isOpen() && [P.main, P.modal, P.logo, P.lang, P.right].every(free));
  check('focus moves to the new section h1', doc.activeElement === t.h1['view-users']);
  doc.fire('keydown', { key: 'Escape' });
  check('Esc with nothing open does nothing', !isOpen() && doc.activeElement === t.h1['view-users']);

  menuBtn.fire('click');
  btn.fire('click', { detail: 0 });
  menu.children[0].fire('click');
  check('Hồ sơ from popup in drawer: drawer closes, focus on profile h1',
    !isOpen() && g('view-profile').style.display === 'block' && doc.activeElement === t.h1['view-profile'] && free(P.main));

  t.usersNav.focus();
  t.usersNav.fire('click');
  check('desktop (drawer closed): choosing a menu item keeps focus as before', doc.activeElement === t.usersNav);

  menuBtn.fire('click');
  t.mq.fn({ matches: false });
  check('widening to desktop while drawer is open closes it and removes inert', !isOpen() && free(P.main) && free(P.logo));
  doc.fire('keydown', { key: 'Escape' });
  t.mq.fn({ matches: true });
  check('narrowing back does not open the drawer', !isOpen());

  doc.fire('error', { target: img });
  check('broken avatar falls back to user icon', img.hidden === true && !btn.classList.contains('has-avatar'));

  btn.fire('click', { detail: 1 });
  menu.children[2].fire('click');
  eq('Đăng xuất calls Firebase signOut', t.signOuts.length, 1);
  t.timers[t.timers.length - 1]();
  eq('Đăng xuất redirects to login like before', t.win.location.href, 'login.html');

  btn.fire('click', { detail: 1 });
  t.logout();
  check('leaving the admin panel closes popup', menu.hidden === true);

  // Không có display_name / displayName -> nhãn dự phòng, KHÔNG lấy email. Không avatar -> icon.
  const f = setup({ role: 'admin', email: 'nobody@example.test', display_name: null, avatar_url: null },
    { uid: 'admin2', displayName: null, email: 'nobody@example.test' });
  f.doc.fire('DOMContentLoaded'); f.login(); await wait(50);
  eq('missing name falls back to admin label, not email', f.g('adm-user-name').textContent, 'VI:adm.adminFallback');
  check('no avatar keeps the user icon', f.g('adm-user-img').hidden === true && !f.g('adm-user-btn').classList.contains('has-avatar'));

  const fbOnly = setup({ role: 'admin', display_name: '' }, { uid: 'admin3', displayName: 'Tên Firebase' });
  fbOnly.doc.fire('DOMContentLoaded'); fbOnly.login(); await wait(50);
  eq('empty DB name falls back to Firebase displayName', fbOnly.g('adm-user-name').textContent, 'Tên Firebase');
})();
