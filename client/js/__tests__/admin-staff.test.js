/* Role staff trên trang admin (Phase A bước 4): cổng UI, permissions từ /api/me, ẩn theo
   data-perm, chỉ gọi loader khi có quyền, pill "Nhân viên". Backend tự kiểm quyền thật
   (requirePermission) — ở đây chỉ là lớp ẩn/hiện. DOM giả KHÔNG kiểm được CSS thật
   ([data-perm][hidden] có ẩn hay không) — phần đó nằm trong CHECKLIST-STAFF.md. */
const fs = require('fs');
const path = require('path');
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const { adminMe, staffMe } = require('./helpers/me');
const { PERMISSIONS } = require('../../../server/lib/permissions');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'admin.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js', 'admin.js'), 'utf8');
const i18n = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');

console.log('admin-staff.js');

// ---- Markup / CSS / i18n tĩnh ------------------------------------------------
const NAV = [...html.matchAll(/<button type="button" class="adm-nav-item[^"]*" data-nav="([a-z]+)"(?: data-perm="([a-z_:]+)")?/g)]
  .map(m => [m[1], m[2] || null]);
eq('mục menu trái mang data-perm theo bảng quyền', NAV, [
  ['dashboard', 'dashboard:read'], ['products', 'product:read'], ['orders', 'order:read'], ['statistics', 'dashboard:read'],
  ['users', 'user:read'], ['reviews', 'review:moderate'], ['blacklist', 'user:read'], ['feedback', 'support:reply']]);
check('nút Thêm sản phẩm cần product:write', /id="btn-add-prod" data-perm="product:write"/.test(html));
const htmlPerms = [...html.matchAll(/data-perm="([^"]+)"/g)].map(m => m[1]);
const jsPerms = [...js.matchAll(/(?:permAttrs|can)\('([^']+)'\)/g)].map(m => m[1]);
check('mọi data-perm trong admin.html là permission có thật ở server', htmlPerms.length === 9 && htmlPerms.every(p => PERMISSIONS.includes(p)), htmlPerms.join(','));
check('mọi permAttrs()/can() trong admin.js là permission có thật', jsPerms.length > 10 && jsPerms.every(p => PERMISSIONS.includes(p)),
  jsPerms.filter(p => !PERMISSIONS.includes(p)).join(','));
check('pill Nhân viên nằm ngay sau tên trong user card, mặc định ẩn, chữ qua data-i18n',
  /<span class="adm-user-name" id="adm-user-name"><\/span>\s*<span class="pill role-staff adm-user-role" id="adm-user-role" data-i18n="adm.roleStaff" hidden>Nhân viên<\/span>/.test(html));
check('CSS: pill staff dùng token màu', /\.pill\.role-staff \{ background:var\(--c-bg\); color:var\(--c-ink\); border:1px solid var\(--c-ink\); \}/.test(css));
check('CSS: phần tử thiếu quyền ẩn hẳn, thắng display của nút/mục menu', /\[data-perm\]\[hidden\] \{ display:none !important; \}/.test(css));
check('CSS: pill user card tôn trọng [hidden] (thắng display của .pill)', /\.adm-user-role\[hidden\] \{ display:none; \}/.test(css));
for (const [k, vi, en] of [['adm.roleStaff', 'Nhân viên', 'Staff'],
  ['acc.adminBlocked', 'Tài Khoản Không Đúng — tài khoản quản trị không thể thanh toán đơn hàng.', 'Wrong Account — a back-office account cannot place orders.'],
  ['co.adminBlocked', 'Tài Khoản Không Đúng — tài khoản quản trị không thể thanh toán đơn hàng.', 'Wrong Account — a back-office account cannot place orders.']]) {
  const vals = [...i18n.matchAll(new RegExp("'" + k.replace('.', '\\.') + "': '([^']*)'", 'g'))].map(m => m[1]);
  eq('i18n ' + k + ' có cả VI và EN', vals, [vi, en]);
}
check('logo: chữ nhỏ có id + data-i18n, giữ nguyên href/class',
  html.includes('<a href="index.html" class="adm-logo">BREEZE <small id="adm-logo-role" data-i18n="adm.logoAdmin">Admin</small></a>'));
check('logo: CSS in hoa chữ nhỏ (Admin/Staff hiện ADMIN/STAFF)', /\.adm-topbar \.adm-logo small \{[^}]*text-transform:uppercase/.test(css));
for (const [k, v] of [['adm.logoAdmin', 'Admin'], ['adm.logoStaff', 'Staff']]) {
  eq('i18n ' + k + ' có cả VI và EN', [...i18n.matchAll(new RegExp("'" + k.replace('.', '\\.') + "': '([^']*)'", 'g'))].map(m => m[1]), [v, v]);
}
check('logo đổi bằng textContent, không innerHTML',
  js.includes("el.textContent = tr(key, null, staff ? 'Staff' : 'Admin');") && !/adm-logo-role'\)\.innerHTML/.test(js));
check('không còn câu "tài khoản admin không thể thanh toán"', !/tài khoản admin không thể thanh toán|an admin account cannot place/.test(i18n));

// ---- Hành vi admin.js -------------------------------------------------------
const product = { id: 5, name_vi: 'Áo', slug: 'ao-nam', price: 100, stock: 10, category_id: 1,
  size_kind: 'apparel', size_configured: true, is_active: true };
const order = { id: 25, order_code: 1001, user_id: 3, user_email: 'kh@example.test', status: 'pending',
  allowed_next_statuses: ['confirmed'], items: [], total_amount: 20000, created_at: '2026-10-11T00:00:00Z' };
const USERS = [
  { id: 3, email: 'kh@example.test', display_name: 'Khách', role: 'customer', is_blacklisted: false },
  { id: 4, email: 'nv@example.test', display_name: 'Nhân viên A', role: 'staff', is_blacklisted: false },
  { id: 1, email: 'boss@example.test', display_name: 'Chủ', role: 'admin', is_blacklisted: false }];
const BLACKLIST = [{ user_id: 9, user_email: 'bl@example.test', order_id: null }];

function setup(me) {
  const doc = makeDoc(), g = id => doc.getElementById(id), calls = [], publicCalls = [];
  const navs = NAV.map(([nav, perm]) => {
    const b = El('button'); b.classList.add('adm-nav-item'); b.setAttribute('data-nav', nav);
    if (perm) b.setAttribute('data-perm', perm);
    if (nav === 'dashboard') { b.classList.add('active'); b.setAttribute('aria-current', 'page'); }
    return b;
  });
  g('btn-add-prod').setAttribute('data-perm', 'product:write');
  doc._qsa['.adm-nav-item'] = navs;
  doc._qsa['[data-perm]'] = navs.concat([g('btn-add-prod')]);
  doc.querySelector = s => s === '.adm-nav-item.active' ? navs.find(n => n.classList.contains('active')) || null
    : (/^\.adm-nav-item\[data-nav="([a-z]+)"\]$/.exec(s) || [])[1] ? navs.find(n => n.getAttribute('data-nav') === /"([a-z]+)"/.exec(s)[1]) : null;
  g('adm-user-role').hidden = true;   // như markup: mặc định ẩn
  let auth, current = me;
  load('admin.js', { doc, deps: ['routes.js', 'utils-format.js', 'order-shipping.js', 'utils-i18n.js', 'order-payment.js'],
    globals: { setTimeout: () => 0, clearTimeout() {}, fetch: async url => { publicCalls.push(url); return { json: async () => [] }; } },
    window: { location: { href: 'admin.html', pathname: '/admin.html', search: '' }, __i18n: { current: 'vi', t: k => k },
      AuthHelper: {
        onChange(fn) { auth = fn; },
        apiFetch(url) {
          calls.push(url);
          let data = {};
          if (url === '/api/me') data = current;
          else if (url === '/api/categories' || url.startsWith('/api/admin/stats/')) data = [];
          else if (url.startsWith('/api/admin/stats?')) data = { current: { revenue: 0, orders: 0 }, dailyRevenue: [] };
          else if (url.startsWith('/api/admin/products')) data = { products: [product] };
          else if (url.startsWith('/api/admin/orders?')) data = { orders: [order], total: 1, total_pages: 1 };
          else if (url.startsWith('/api/admin/users?')) data = { users: USERS, total: 3, total_pages: 1 };
          else if (url.startsWith('/api/admin/blacklist?')) data = { orders: BLACKLIST, total: 1, total_pages: 1 };
          return Promise.resolve({ ok: true, status: 200, json: async () => data });
        },
      } },
  });
  doc.fire('DOMContentLoaded');
  const nav = name => navs.find(n => n.getAttribute('data-nav') === name);
  const adminCalls = () => calls.filter(u => u !== '/api/me').map(u => u.split('?')[0]);
  return { doc, g, calls, publicCalls, navs, nav, adminCalls, setMe: m => { current = m; },
    login: async () => { auth({ uid: 'u1' }); await wait(50); }, logout: async () => { auth(null); await wait(); } };
}
// /api/categories là API công khai, admin.js gọi bằng fetch (không qua apiFetch) -> kiểm riêng.
// Một dòng <tr> của bảng (theo chuỗi nhận diện, vd email) — để kiểm từng ô của đúng tài khoản.
const rowOf = (html, needle) => (html.split('<tr>').find(r => r.includes(needle)) || '');
const ALL_LOADERS = ['/api/admin/products', '/api/admin/orders', '/api/admin/stats',
  '/api/admin/stats/order-status', '/api/admin/stats/top-products', '/api/admin/users', '/api/admin/blacklist'];

(async function () {
  // 1. Staff Phase A (đủ quyền trừ user:manage_role): giao diện như admin + pill Nhân viên.
  let t = setup(staffMe({ display_name: 'Nhân viên A' }));
  await t.login();
  check('staff qua cổng trang admin', t.doc.body.classList.contains('adm-authed'));
  eq('staff thấy pill Nhân viên', t.g('adm-user-role').hidden, false);
  eq('staff: mọi mục menu đều hiện', t.navs.filter(n => n.hidden).map(n => n.getAttribute('data-nav')), []);
  eq('staff: nút Thêm sản phẩm hiện', t.g('btn-add-prod').hidden, false);
  check('staff: nạp đủ dữ liệu như admin', ALL_LOADERS.every(u => t.adminCalls().includes(u)), t.adminCalls().join(' '));
  eq('staff: nạp danh mục (fetch công khai)', t.publicCalls, ['/api/categories']);
  const users = t.g('user-body').innerHTML;
  check('bảng user: staff có badge role-staff, chữ adm.roleStaff', users.includes('<span class="pill role-staff">adm.roleStaff</span>'));
  check('bảng user: admin/khách giữ badge cũ', users.includes('<span class="pill role-admin">adm.roleAdmin</span>') &&
    users.includes('<span class="pill role-customer">adm.roleCustomer</span>'));
  eq('bảng user: chỉ khách có nút blacklist (staff/admin hiện "—")', [...users.matchAll(/data-blacklist="(\d+)"/g)].map(m => m[1]), ['3']);
  check('nút blacklist của khách hiện (có quyền user:blacklist)', /data-blacklist="3" data-perm="user:blacklist">/.test(users));
  // Phase C: dòng admin vẫn hiện nhưng không có "Xem chi tiết" (ô hiện —); khách/staff vẫn xem được.
  check('bảng user: dòng admin vẫn hiện', rowOf(users, 'boss@example.test').includes('adm.roleAdmin'));
  check('bảng user: dòng admin KHÔNG có nút Xem chi tiết, ô hiện —', !rowOf(users, 'boss@example.test').includes('data-customer-detail') &&
    rowOf(users, 'boss@example.test').endsWith('<td>—</td></tr>'));
  eq('bảng user: khách và staff vẫn có nút Xem chi tiết', [...users.matchAll(/data-customer-detail="(\d+)"/g)].map(m => m[1]), ['3', '4']);
  eq('logo: staff -> chữ nhỏ Staff (data-i18n adm.logoStaff)', [t.g('adm-logo-role').textContent, t.g('adm-logo-role').getAttribute('data-i18n')], ['Staff', 'adm.logoStaff']);
  const orders = t.g('order-body').innerHTML;
  check('đơn: chọn trạng thái bật (có order:update_status)', /<select class="status-sel" data-order="25"[^>]*data-current="pending">/.test(orders));
  check('đơn: staff KHÔNG thấy nút xoá (Phase C: thiếu order:delete)', /data-del-order="25" data-order-code="1001" data-perm="order:delete" hidden>/.test(orders));
  const prods = t.g('prod-body').innerHTML;
  check('sản phẩm: Sửa/Size hiện (product:write); Xoá ẩn (Phase C: thiếu product:delete)',
    /data-edit="5" data-perm="product:write">/.test(prods) && /data-sizes="5" data-perm="product:write">/.test(prods) && /data-del="5" data-perm="product:delete" hidden>/.test(prods));
  const bl = t.g('blacklist-body').innerHTML;
  check('blacklist: staff KHÔNG có nút Gỡ (thiếu user:blacklist_release), ô hiện —', !bl.includes('data-release') && bl.includes('<td style="white-space:nowrap;">—</td>'));

  // 2. Admin: không có pill; cùng giao diện.
  t = setup(adminMe({ display_name: 'Chủ' }));
  await t.login();
  eq('admin không có pill Nhân viên', t.g('adm-user-role').hidden, true);
  check('admin nạp đủ dữ liệu', ALL_LOADERS.every(u => t.adminCalls().includes(u)));
  check('admin: thấy nút Xoá sản phẩm và Xoá đơn', /data-del="5" data-perm="product:delete">/.test(t.g('prod-body').innerHTML) &&
    /data-del-order="25" data-order-code="1001" data-perm="order:delete">/.test(t.g('order-body').innerHTML));
  check('admin: thấy nút Gỡ blacklist (user:blacklist_release)', /data-release="9" data-perm="user:blacklist_release">/.test(t.g('blacklist-body').innerHTML));
  eq('admin: có nút Xem chi tiết cả dòng admin', [...t.g('user-body').innerHTML.matchAll(/data-customer-detail="(\d+)"/g)].map(m => m[1]), ['3', '4', '1']);
  eq('logo: admin -> chữ nhỏ Admin', [t.g('adm-logo-role').textContent, t.g('adm-logo-role').getAttribute('data-i18n')], ['Admin', 'adm.logoAdmin']);

  // 3. Customer: bị chặn ở cổng, không gọi API quản trị nào.
  t = setup({ role: 'customer', permissions: [] });
  await t.login();
  eq('customer -> state-forbidden', t.g('state-forbidden').style.display, 'block');
  check('customer không qua cổng', !t.doc.body.classList.contains('adm-authed'));
  eq('customer không gọi API quản trị', t.adminCalls(), []);
  eq('customer bị chặn: logo vẫn Admin', [t.g('adm-logo-role').textContent, t.g('adm-logo-role').getAttribute('data-i18n')], ['Admin', 'adm.logoAdmin']);

  // 4. Staff THIẾU permissions trong /api/me -> coi như không quyền nào (đóng mặc định).
  t = setup({ role: 'staff', display_name: 'NV' });
  await t.login();
  check('thiếu permissions vẫn qua cổng (role hợp lệ)', t.doc.body.classList.contains('adm-authed'));
  eq('thiếu permissions: mọi mục menu bị ẩn', t.navs.filter(n => !n.hidden).length, 0);
  eq('thiếu permissions: nút Thêm sản phẩm ẩn', t.g('btn-add-prod').hidden, true);
  eq('thiếu permissions: không gọi loader nào', t.adminCalls(), []);
  eq('thiếu permissions: mở Hồ sơ thay vì Tổng quan rỗng', [t.g('view-profile').style.display, t.g('view-dashboard').style.display], ['block', 'none']);
  for (const bad of [null, 'order:read', { 0: 'order:read' }, [1, null, { p: 1 }]]) {
    t = setup({ role: 'staff', permissions: bad });
    await t.login();
    eq('permissions không hợp lệ ' + JSON.stringify(bad) + ' -> không loader nào', t.adminCalls(), []);
  }

  // 5. Staff chỉ có order:read (giả lập Phase C): chỉ nạp đơn, mở thẳng Đơn hàng, không sửa/xoá.
  t = setup({ role: 'staff', permissions: ['order:read'] });
  await t.login();
  eq('chỉ order:read -> chỉ gọi API đơn hàng, không nạp danh mục', [t.adminCalls(), t.publicCalls], [['/api/admin/orders'], []]);
  eq('chỉ order:read -> chỉ mục Đơn hàng hiện', t.navs.filter(n => !n.hidden).map(n => n.getAttribute('data-nav')), ['orders']);
  eq('chỉ order:read -> mở thẳng view Đơn hàng', [t.g('tab-orders').style.display, t.g('view-dashboard').style.display], ['block', 'none']);
  const ro = t.g('order-body').innerHTML;
  check('không order:update_status -> chọn trạng thái bị khoá (vẫn thấy trạng thái)', /<select class="status-sel" data-order="25"[^>]*data-current="pending" disabled>/.test(ro));
  check('không order:delete -> nút xoá đơn ẩn', /data-del-order="25" data-order-code="1001" data-perm="order:delete" hidden>/.test(ro));
  check('xem chi tiết / hoá đơn vẫn còn', ro.includes('data-toggle="25"') && ro.includes('data-invoice="25"'));

  // 6. Có user:read nhưng không user:blacklist: thấy danh sách, nút blacklist/gỡ bị ẩn.
  t = setup({ role: 'staff', permissions: ['user:read'] });
  await t.login();
  eq('chỉ user:read -> gọi users + blacklist', t.adminCalls(), ['/api/admin/users', '/api/admin/blacklist']);
  check('không user:blacklist -> không có nút thêm blacklist, ô của khách hiện —',
    !t.g('user-body').innerHTML.includes('data-blacklist') && rowOf(t.g('user-body').innerHTML, 'kh@example.test').includes('<td>—</td>'));
  check('không user:blacklist_release -> không có nút gỡ, ô hiện —', !t.g('blacklist-body').innerHTML.includes('data-release'));
  check('không user:view_admin_detail -> dòng admin không có nút Xem chi tiết', !rowOf(t.g('user-body').innerHTML, 'boss@example.test').includes('data-customer-detail'));

  // 7. product:read không write/delete: thấy sản phẩm, nút Sửa/Size/Xoá/Thêm ẩn.
  t = setup({ role: 'staff', permissions: ['product:read'] });
  await t.login();
  eq('chỉ product:read -> chỉ gọi sản phẩm (+ danh mục công khai)', [t.adminCalls(), t.publicCalls], [['/api/admin/products'], ['/api/categories']]);
  const rp = t.g('prod-body').innerHTML;
  check('không product:write -> Sửa và Size ẩn', /data-edit="5" data-perm="product:write" hidden>/.test(rp) && /data-sizes="5" data-perm="product:write" hidden>/.test(rp));
  check('không product:delete -> Xoá ẩn', /data-del="5" data-perm="product:delete" hidden>/.test(rp));
  eq('không product:write -> nút Thêm sản phẩm ẩn', t.g('btn-add-prod').hidden, true);

  // 8. Ô tìm kiếm topbar mở Đơn hàng -> cần order:read.
  for (const [perms, expect] of [[['product:read'], false], [['order:read'], true]]) {
    t = setup({ role: 'staff', permissions: perms });
    await t.login();
    t.calls.length = 0;
    t.g('top-search').value = '1001';
    t.g('top-search').fire('keydown', { key: 'Enter' }); await wait();
    eq('tìm kiếm topbar với ' + perms + ' -> ' + (expect ? 'tải đơn' : 'không gọi API'),
      t.calls.some(u => u.startsWith('/api/admin/orders?')), expect);
  }

  // 9. Đăng xuất rồi tài khoản khác (ít quyền hơn) vào cùng tab: quyền cũ không còn sót.
  t = setup(staffMe());
  await t.login();
  check('tài khoản 1 (đủ quyền): mọi mục menu hiện', t.navs.every(n => !n.hidden));
  eq('tài khoản 1 (staff): logo Staff', t.g('adm-logo-role').textContent, 'Staff');
  await t.logout();
  eq('đăng xuất -> về màn đăng nhập', t.g('state-login').style.display, 'block');
  eq('đăng xuất -> logo về Admin, không sót Staff', [t.g('adm-logo-role').textContent, t.g('adm-logo-role').getAttribute('data-i18n')], ['Admin', 'adm.logoAdmin']);
  t.setMe({ role: 'staff', permissions: ['support:reply'] }); t.calls.length = 0;
  await t.login();
  eq('tài khoản 2: chỉ mục Phản hồi hiện', t.navs.filter(n => !n.hidden).map(n => n.getAttribute('data-nav')), ['feedback']);
  eq('tài khoản 2: không nạp dữ liệu của quyền cũ', t.adminCalls(), []);
  eq('tài khoản 2 (staff): pill hiện', t.g('adm-user-role').hidden, false);
  t.setMe(adminMe()); await t.logout(); await t.login();
  eq('tài khoản 3 là admin: pill Nhân viên của staff trước đó bị ẩn', t.g('adm-user-role').hidden, true);
  eq('tài khoản 3 là admin: menu hiện lại đủ', t.navs.filter(n => n.hidden).length, 0);
  eq('tài khoản 3 là admin: logo Admin (đổi từ staff sang admin)', [t.g('adm-logo-role').textContent, t.g('adm-logo-role').getAttribute('data-i18n')], ['Admin', 'adm.logoAdmin']);
})();
