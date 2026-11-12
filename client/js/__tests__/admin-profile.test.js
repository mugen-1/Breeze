/* Section Hồ sơ của admin = tab "Chi tiết tài khoản" của trang profile.
   Markup/CSS/script tĩnh + hành vi thật của admin.js + account-details.js trên DOM giả.
   DOM giả KHÔNG kiểm được giao diện, modal thật, hay đổi mật khẩu với Firebase thật. */
const fs = require('fs');
const path = require('path');
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const { adminMe } = require('./helpers/me');

const ROOT = path.join(__dirname, '..', '..');
const REPO = path.join(ROOT, '..');
const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'admin.css'), 'utf8');
const i18n = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');
const profileEjs = fs.readFileSync(path.join(REPO, 'server', 'views', 'pages', 'profile.ejs'), 'utf8');
const PAGES = require(path.join(REPO, 'server', 'lib', 'pages-config.js'));

console.log('admin-profile.js');

// ---- Markup tĩnh -------------------------------------------------------------
const section = (html.match(/<section id="view-profile"[\s\S]*?<\/section>\s*<\/div>\s*<\/main>/) || [''])[0];
check('no breadcrumb; h1 kept in DOM (hidden by CSS)',
  !section.includes('adm-crumb') && /<h1 class="adm-page-title" tabindex="-1" id="admin-profile-title" data-i18n="adm.profile">Hồ sơ<\/h1>/.test(section));
['ad-name', 'ad-email', 'ad-created', 'ad-last'].forEach(id => {
  check(id + ' is read-only text (dd), like the user page', new RegExp('<dd id="' + id + '">').test(section));
});
check('password row has the "Đổi" button that opens the modal', /<button type="button"[^>]*id="cp-open" data-i18n="pf.change">Đổi<\/button>/.test(section));
check('editable fields are inputs/selects', /<input id="ad-phone" type="tel"/.test(section) && /<input id="ad-dob" type="date"/.test(section) &&
  /<select id="ad-gender">/.test(section) && /<select id="ad-country">/.test(section));
check('save button', /<button type="button" class="adm-btn" id="ad-save" data-i18n="pf.saveChanges">/.test(section));
check('no name/avatar editing added', !/<input[^>]*id="ad-name"/.test(section) && !/avatar/i.test(section));
check('3 shopping shortcuts not brought over', !/cart\.html|orders\.html|pf\.myCart|pf\.myOrders|pf\.continueShopping/.test(section));
check('no left tab column', !/settings-nav|data-section=/.test(section));
check('no inline handlers', !/\son[a-z]+=/i.test(section));
// Cùng lựa chọn với trang user (giá trị + khoá dịch).
const opts = src => (src.match(/<option value="[^"]*" data-i18n="[^"]+">/g) || []).join('|');
const userAcct = (profileEjs.match(/<section class="settings-section" id="section-account"[\s\S]*?<\/section>/) || [''])[0];
eq('gender/country options identical to the user page', opts(section), opts(userAcct));

const modal = (html.match(/<div class="modal-backdrop adm-cp-overlay" id="cp-modal-overlay" hidden>[\s\S]*?<\/form>\s*<\/div>\s*<\/div>/) || [''])[0];
check('change-password modal present and hidden', modal.length > 0);
const cpIds = src => (src.match(/id="cp-[a-z-]+"/g) || []).sort().join(',');
const userModal = (profileEjs.match(/<div class="addr-modal-overlay" id="cp-modal-overlay" hidden>[\s\S]*?<\/form>\s*<\/div>\s*<\/div>/) || [''])[0];
eq('modal has the same cp-* ids as the user page', cpIds(modal), cpIds(userModal));
eq('modal has the same data-toggle-pw buttons', (modal.match(/data-toggle-pw="[^"]+"/g) || []).join(), (userModal.match(/data-toggle-pw="[^"]+"/g) || []).join());
check('comment points to the source block in profile.ejs',
  /LẶP MARKUP từ server\/views\/pages\/profile\.ejs, khối #cp-modal-overlay[\s\S]*PHẢI sửa cả ở đây/.test(html));

// i18n: mọi khoá dùng trong Hồ sơ + modal có cả VI và EN.
const keys = [...new Set(((section + modal).match(/data-i18n(?:-aria|-ph)?="([^"]+)"/g) || []).map(m => m.split('"')[1]))];
const missing = keys.filter(k => (i18n.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length < 2);
eq('every label key has VI + EN (' + keys.length + ' keys)', missing, []);

// Script: account-details trước admin.js; change-password sau markup modal (cuối body).
const scripts = (html.match(/<script src="js\/[^"]+"/g) || []).map(s => s.slice(16, -1));
const at = f => scripts.indexOf(f);
check('admin loads account-details.js before admin.js', at('account-details.js') > -1 && at('account-details.js') < at('admin.js'));
check('admin loads change-password.js after admin.js', at('change-password.js') > at('admin.js'));
check('utils-i18n.js (t) loads before both shared files', at('utils-i18n.js') < at('account-details.js'));
const pj = PAGES.profile.pageJs;
check('profile page loads account-details.js right before page-profile.js', pj.indexOf('account-details.js') === pj.indexOf('page-profile.js') - 1);
check('profile page keeps change-password.js after page-profile.js', pj.indexOf('change-password.js') > pj.indexOf('page-profile.js'));

// CSS: một cột giữa, không khung, mọi selector dưới #view-profile, chỉ token.
const block = css.slice(css.indexOf('/* ===== Section Hồ sơ'), css.indexOf('.adm-cp-msg.is-ok'));
check('profile + modal CSS: no hex colours', block.length > 0 && !/#[0-9a-f]{3,8}\b/i.test(block));
const pf = css.slice(css.indexOf('/* ===== Section Hồ sơ'), css.indexOf('/* Modal đổi mật khẩu'));
const pfSelectors = (pf.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) || [])
  .map(s => s.trim()).filter(s => s && !s.startsWith('@media'))
  .flatMap(s => s.split(',').map(x => x.trim()));
check('every Hồ sơ selector is scoped under #view-profile (' + pfSelectors.length + ')',
  pfSelectors.length > 10 && pfSelectors.every(s => s.startsWith('#view-profile ')), pfSelectors.filter(s => !s.startsWith('#view-profile ')).join(' | '));
check('no unscoped .adm-pf-* / .adm-profile rule anywhere', !/(^|\})\s*\.adm-(pf-|profile)/m.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
check('column 640px centred, flush with top of view', /#view-profile \.adm-profile \{ max-width:640px; margin:0 auto; \}/.test(css));
check('blocks have no frame', /#view-profile \.adm-pf-card \{ background:none; border:0; border-radius:0; box-shadow:none; padding:0; \}/.test(css));
check('2nd block: no rule, 56px gap', /#view-profile \.adm-pf-card \+ \.adm-pf-card \{ margin-top:56px; \}/.test(css));
check('no horizontal rules in Hồ sơ (only input borders)',
  !/border-(top|bottom)\s*:/.test(pf) && (pf.match(/border:1px solid/g) || []).length === 1);
check('block title: display serif 26px / 1.3, margin 0 0 24px',
  /#view-profile \.adm-pf-title \{[^}]*font-family:var\(--font-display\); font-size:26px;[^}]*line-height:1\.3;[^}]*margin:0 0 24px;/.test(css));
check('labels: 13.5px uppercase .08em muted (rows + form)',
  /#view-profile \.adm-pf-row dt,\s*#view-profile \.fld label \{[^}]*font-size:13\.5px;[^}]*text-transform:uppercase; letter-spacing:\.08em; color:var\(--c-muted\);/.test(css));
check('read-only rows stacked (label 8px above value), no rule',
  /#view-profile \.adm-pf-row \{ display:flex; flex-direction:column; gap:8px; padding:0; border:0; \}/.test(css));
check('items evenly spaced: 28px between rows and between fields',
  /#view-profile \.adm-pf-rows \{ display:flex; flex-direction:column; gap:28px; margin:0; \}/.test(css) &&
  /#view-profile \.adm-pf-grid \{ display:flex; flex-direction:column; gap:28px; margin:0; \}/.test(css));
check('values 17px / 1.5, long text wraps', /#view-profile \.adm-pf-row dd \{[^}]*font-size:17px; line-height:1\.5;[^}]*overflow-wrap:anywhere;/.test(css));
check('"Đổi" link: 16px underline, 44×44 hit area', /#view-profile \.adm-pf-link \{[^}]*min-width:44px; min-height:44px;[^}]*font-size:16px;[^}]*text-decoration:underline;/.test(css));
check('inputs 52px, padding 0 16px, 17px, token border + radius',
  /#view-profile \.fld input,\s*#view-profile \.fld select \{[^}]*height:52px;[^}]*padding:0 16px;[^}]*border:1px solid var\(--c-line\); border-radius:var\(--admin-radius\);[^}]*font-size:17px;/.test(css));
check('save button: 32px above, 52px tall, padding 0 36px, right aligned',
  /#view-profile \.adm-pf-actions \{ display:flex; justify-content:flex-end; margin-top:32px; \}/.test(css) &&
  /#view-profile \.adm-pf-actions \.adm-btn \{ height:52px; padding:0 36px; font-size:14px; \}/.test(css));
check('≤1023px: full-width column + full-width save button',
  /@media \(max-width: 1023px\) \{\s*#view-profile \.adm-profile \{ max-width:100%; margin-left:0; margin-right:0; \}\s*#view-profile \.adm-pf-actions \.adm-btn \{ width:100%; \}/.test(css));
check('no breadcrumb CSS; h1 visually hidden by the shared rule', !/\.adm-crumb/.test(css) &&
  /\.adm-page-title, \.dash-title \{[^}]*position:absolute; width:1px; height:1px;[^}]*clip-path:inset\(50%\);/.test(css));
check('modal shows when not hidden, fades with .is-open', /\.adm-cp-overlay:not\(\[hidden\]\) \{ display:flex; \}/.test(css) && /\.adm-cp-overlay\.is-open \{ opacity:1; \}/.test(css));
check('modal message hides when empty', /\.adm-cp-msg:empty \{ display:none; \}/.test(css));

// ---- Hành vi -----------------------------------------------------------------
function setup(meSeq, putReply) {
  const doc = makeDoc(), g = id => doc.getElementById(id);
  const calls = [];
  const dashNav = El('button'); dashNav.setAttribute('data-nav', 'dashboard'); dashNav.classList.add('active');
  doc._qsa['.adm-nav-item'] = [dashNav];
  doc.querySelector = s => s === '.adm-nav-item.active' ? (dashNav.classList.contains('active') ? dashNav : null) : null;
  g('adm-user-menu').hidden = true;
  g('adm-user-img').tagName = 'IMG';
  let auth, meIdx = 0;
  const r = load('admin.js', { doc, deps: ['routes.js', 'utils-format.js', 'order-shipping.js', 'utils-i18n.js', 'order-payment.js', 'account-details.js'],
    globals: { setTimeout: () => 0, clearTimeout() {}, fetch: async () => ({ json: async () => [] }) },
    window: { location: { href: 'admin.html', pathname: '/admin.html', search: '' },
      __i18n: { current: 'vi', t: key => 'VI:' + key }, AuthHelper: {
        onChange(fn) { auth = fn; },
        apiFetch(url, o) {
          const method = (o && o.method) || 'GET';
          calls.push({ url, method, body: o && o.body });
          let data = {}, ok = true, status = 200;
          if (url === '/api/me' && method === 'GET') data = meSeq[Math.min(meIdx++, meSeq.length - 1)];
          else if (url === '/api/me' && method === 'PUT') ({ data, ok, status } = putReply());
          else if (url === '/api/categories') data = [];
          else if (url.startsWith('/api/admin/stats/order-status')) data = [];
          else if (/^\/api\/admin\/(users|orders|blacklist)\?/.test(url)) data = { users: [], orders: [], total: 0, total_pages: 0 };
          return Promise.resolve({ ok, status, json: async () => data });
        }
      } }
  });
  return { doc, g, calls, win: r.win, login: u => auth(u) };
}
const ME1 = { ...adminMe(), email: 'boss@example.test', display_name: 'Chủ Shop', avatar_url: null,
  created_at: '2026-01-02T03:04:05Z', last_login: '2026-11-01T08:00:00Z', phone: '0901111222', dob: '1990-05-06T00:00:00.000Z', gender: 'male', country: 'VN' };
const ME2 = Object.assign({}, ME1, { phone: '0903333444', country: 'SG' });   // đã sửa ở trang user (tab khác)

(async function () {
  let put = () => ({ ok: true, status: 200, data: Object.assign({}, ME2, { display_name: 'Tên Mới', avatar_url: '/avatars/u1-9.webp', phone: '0905555666' }) });
  const t = setup([ME1, ME2], () => put());
  const { doc, g } = t;
  doc.fire('DOMContentLoaded'); t.login({ uid: 'admin', displayName: 'FB', email: 'boss@example.test' }); await wait(50);
  const meGets = () => t.calls.filter(c => c.url === '/api/me' && c.method === 'GET').length;

  eq('login fills Hồ sơ from the same /api/me (no extra request)', meGets(), 1);
  eq('read-only rows via textContent', [g('ad-name').textContent, g('ad-email').textContent], ['Chủ Shop', 'boss@example.test']);
  check('dates formatted', g('ad-created').textContent.includes('2026') && g('ad-last').textContent.includes('2026'));
  eq('editable fields via value', [g('ad-phone').value, g('ad-dob').value, g('ad-gender').value, g('ad-country').value], ['0901111222', '1990-05-06', 'male', 'VN']);
  eq('dob max set to today', g('ad-dob').max, new Date().toISOString().slice(0, 10));
  eq('user card name', g('adm-user-name').textContent, 'Chủ Shop');

  // Mở Hồ sơ từ popup user card -> tải lại /api/me (thấy thay đổi từ trang user).
  g('adm-user-btn').fire('click', { detail: 1 });
  g('adm-user-menu').children[0].fire('click'); await wait();
  eq('opening Hồ sơ reloads /api/me', meGets(), 2);
  eq('changes made on the user page show up', [g('ad-phone').value, g('ad-country').value], ['0903333444', 'SG']);
  eq('Hồ sơ visible', g('view-profile').style.display, 'block');

  // Lưu: PUT /api/me, chỉ 4 field, rồi user card làm mới từ dữ liệu server trả về.
  g('ad-phone').value = '0905555666';
  g('ad-save').textContent = 'Lưu thay đổi';
  g('ad-save').fire('click'); await wait();
  const puts = t.calls.filter(c => c.method === 'PUT');
  eq('save sends one PUT /api/me', puts.map(c => c.url), ['/api/me']);
  eq('body = the 4 editable fields only', Object.keys(JSON.parse(puts[0].body)), ['phone', 'dob', 'gender', 'country']);
  eq('success toast (admin toast, not error)', [g('toast').textContent, g('toast').className], ['VI:pf.savedChanges', 'show']);
  eq('form refilled from server reply', g('ad-phone').value, '0905555666');
  eq('user card name refreshed after save', g('adm-user-name').textContent, 'Tên Mới');
  check('user card avatar refreshed after save', g('adm-user-img').src === '/avatars/u1-9.webp' && g('adm-user-btn').classList.contains('has-avatar'));

  g('ad-phone').value = 'abc!!!';
  g('ad-save').fire('click'); await wait();
  eq('invalid phone: no PUT, error toast', [t.calls.filter(c => c.method === 'PUT').length, g('toast').textContent, g('toast').className], [1, 'VI:pf.errPhone', 'show err']);

  put = () => ({ ok: false, status: 400, data: { message: '<b>Ngày sinh không hợp lệ</b>' } });
  g('ad-phone').value = '0905555666';
  g('ad-save').fire('click'); await wait();
  eq('server validation message shown as text', [g('toast').textContent, g('toast').className], ['<b>Ngày sinh không hợp lệ</b>', 'show err']);
  eq('toast never uses innerHTML', g('toast').innerHTML, '');

  put = () => ({ ok: false, status: 401, data: {} });
  g('toast').textContent = '';
  g('ad-save').fire('click'); await wait();
  eq('401 on save: silent until authexpired', g('toast').textContent, '');
  doc.fire('authexpired');
  eq('authexpired -> session expired toast', [g('toast').textContent, g('toast').className], ['VI:pf.sessionExpired', 'show err']);

  check('window.ProfileToast is provided for change-password.js', typeof t.win.ProfileToast === 'function');
  t.win.ProfileToast('VI:au.cpOk');
  eq('ProfileToast shows the admin toast', [g('toast').textContent, g('toast').className], ['VI:au.cpOk', 'show']);

  const before = t.calls.length;
  doc.fire('langchange');
  eq('language change on Hồ sơ redraws without new requests', t.calls.length, before);
  check('language change keeps data', g('ad-email').textContent === 'boss@example.test');
})();
