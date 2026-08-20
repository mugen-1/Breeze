/* Nhóm B của TASK 7 — 6 cơ chế từng dùng TÊN FILE làm khoá tra cứu.
   Đây là loại hỏng NGẦM: sai khoá thì không có lỗi console, chỉ là tiêu đề không dịch,
   lời chào hiện sai chỗ, giỏ hàng không vẽ lại. Nên phải test bằng khẳng định, không
   dựa vào việc "mở trang thấy vẫn chạy".

   Mỗi cơ chế đều kiểm ở CẢ HAI dạng URL: /x.html (hiện tại) và /x (sau migrate EJS). */
const { check, eq, note } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');
const fs = require('fs'), path = require('path');

const JS = path.join(__dirname, '..');
const DANH_MUC = ['sanpham-ao', 'sanpham-quan', 'sanpham-giay', 'gold-jewellery', 'handbags', 'sale'];
const CHINH_SACH = ['chinhsachbaomat', 'chinhsachdoitra', 'chinhsachgiaohang'];

function i18nAt(pathname) {
  return load('i18n.js', { deps: ['routes.js'], window: { location: { pathname: pathname } } });
}

console.log('nhom B — khoa tra cuu theo route');

// ===== B2 + B3: khoa cua t.page / t.policy phai BO DUOI va khop currentPageKey =====
const r = i18nAt('/index.html');
const T = r.win.__i18n.T;
['vi', 'en'].forEach(function (lang) {
  const page = (T[lang] && T[lang].page) || {};
  const conDuoi = Object.keys(page).filter(k => /\.html$/.test(k));
  eq('B2 t.page[' + lang + '] khong con khoa nao co duoi .html', conDuoi, []);
});
const policy = (T.en && T.en.policy) || {};
eq('B3 t.policy khong con khoa nao co duoi .html',
   Object.keys(policy).filter(k => /\.html$/.test(k)), []);

// Khop THUC SU: khoa sinh ra tu URL phai tra duoc ban dich
const R = load('routes.js', { window: { location: { pathname: '/' } } }).win.BreezeRoutes;
['vi', 'en'].forEach(function (lang) {
  DANH_MUC.forEach(function (slug) {
    const page = T[lang].page;
    ['/' + slug + '.html', '/' + slug].forEach(function (url) {
      const key = R.keyOf(url);
      check('B2 ' + lang + ' — ' + url + ' -> t.page["' + key + '"] co ban dich',
            typeof page[key] === 'string' && page[key].length > 0);
    });
  });
});
CHINH_SACH.forEach(function (slug) {
  ['/' + slug + '.html', '/' + slug].forEach(function (url) {
    const key = R.keyOf(url);
    check('B3 ' + url + ' -> t.policy["' + key + '"] co ban dich EN',
          !!policy[key] && typeof policy[key].title === 'string');
  });
});

// ===== B1: EXCLUDED =====
const src = fs.readFileSync(path.join(JS, 'i18n.js'), 'utf8');
check('B1 EXCLUDED khong con "index.html"', !/EXCLUDED\s*=\s*\[[^\]]*index\.html/.test(src));
check('B1 EXCLUDED dung khoa "index"', /EXCLUDED\s*=\s*\['index'\]/.test(src));
check('B1 currentPage() uy quyen sang BreezeRoutes',
      /function currentPage\(\)\s*\{\s*return window\.BreezeRoutes\.currentPageKey\(\);\s*\}/.test(src));

// ===== B4: nhan dien trang gio hang =====
check('B4 khong con so sanh === "cart.html"', !/===\s*'cart\.html'/.test(src));
check('B4 dung BreezeRoutes.is("cart")', /BreezeRoutes\.is\('cart'\)/.test(src));
eq('B4 /cart.html -> is("cart")', load('routes.js', { window: { location: { pathname: '/cart.html' } } }).win.BreezeRoutes.is('cart'), true);
eq('B4 /cart      -> is("cart")', load('routes.js', { window: { location: { pathname: '/cart' } } }).win.BreezeRoutes.is('cart'), true);
eq('B4 /orders    -> KHONG phai cart', load('routes.js', { window: { location: { pathname: '/orders' } } }).win.BreezeRoutes.is('cart'), false);

// ===== B5: account-menu NO_GREET_PAGES =====
const am = fs.readFileSync(path.join(JS, 'account-menu.js'), 'utf8');
check('B5 NO_GREET_PAGES khong con khoa .html', !/NO_GREET_PAGES\s*=\s*\{[^}]*\.html/.test(am));
check('B5 dung currentPageKey()', /NO_GREET_PAGES\[window\.BreezeRoutes\.currentPageKey\(\)\]/.test(am));
// An loi chao dung tren 5 trang, o CA HAI dang URL
const AN = ['index', 'search', 'chinhsachbaomat', 'chinhsachdoitra', 'chinhsachgiaohang'];
const HIEN = ['cart', 'orders', 'profile', 'product', 'checkout'];
AN.concat(HIEN).forEach(function (slug) {
  ['/' + slug + '.html', '/' + slug].forEach(function (url) {
    const key = load('routes.js', { window: { location: { pathname: url } } }).win.BreezeRoutes.currentPageKey();
    eq('B5 ' + url + ' -> khoa "' + slug + '"', key, slug);
  });
});

// ===== B6: auth.js so tham so ?redirect= =====
const au = fs.readFileSync(path.join(JS, 'auth.js'), 'utf8');
check('B6 khong con so sanh === "checkout.html"', !/redirect === 'checkout\.html'/.test(au));
check('B6 dung keyOf(redirect)', /keyOf\(redirect\) === 'checkout'/.test(au));
eq('B6 ?redirect=checkout.html van nhan', R.keyOf('checkout.html'), 'checkout');
eq('B6 ?redirect=checkout   cung nhan', R.keyOf('checkout'), 'checkout');

// ===== Chan hoi quy: ngoai routes.js, khong file nao duoc biet duoi .html =====
const viPham = [];
fs.readdirSync(JS).filter(f => f.endsWith('.js') && f !== 'routes.js').forEach(function (f) {
  const code = fs.readFileSync(path.join(JS, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  code.split('\n').forEach(function (l, i) {
    if (/['"][\w-]+\.html['"]\s*:/.test(l) || /===?\s*['"][\w-]+\.html['"]/.test(l))
      viPham.push(f + ':' + (i + 1));
  });
});
eq('Khong file nao ngoai routes.js con dung ten file .html lam khoa/ve so sanh', viPham, []);

note('routes.js la file DUY NHAT biet duoi .html — migrate EJS chi sua PATHS trong do.');
