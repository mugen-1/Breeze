/* routes.js — bảng đường dẫn tập trung (TASK 7).
   Điểm sống còn: currentPageKey() phải trả CÙNG một khoá cho cả /cart.html lẫn /cart,
   vì đó là lý do tồn tại của module này. */
const { check, eq, note } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');

function withPath(pathname) {
  return load('routes.js', { window: { location: { pathname: pathname } } }).win.BreezeRoutes;
}
const R = withPath('/index.html');

console.log('routes.js');

eq('BreezeRoutes la global', typeof R, 'object');
eq('PATHS co du 21 trang', Object.keys(R.PATHS).length, 21);

// ===== keyOf: 2 dang URL + cac dang la =====
const cases = [
  ['cart.html',            'cart',   'dang hien tai (co duoi)'],
  ['cart',                 'cart',   'dang tuong lai (khong duoi)'],
  ['/cart.html',           'cart',   'co dau / dau'],
  ['/cart',                'cart',   'khong duoi, co / dau'],
  ['/cart/',               'cart',   'co dau / cuoi'],
  ['/CART.HTML',           'cart',   'duoi VIET HOA'],
  ['cart.html?x=1',        'cart',   'co query'],
  ['cart.html#top',        'cart',   'co hash'],
  ['/a/b/cart.html?x=1#y', 'cart',   'duong dan sau + query + hash'],
  ['',                     'index',  'chuoi rong -> trang chu'],
  ['/',                    'index',  'goc site -> trang chu'],
  ['/index.html',          'index',  'index.html -> index'],
  [null,                   'index',  'null khong lam vo'],
  [undefined,              'index',  'undefined khong lam vo'],
];
for (const [inp, want, mota] of cases) {
  eq('keyOf(' + JSON.stringify(inp) + ') — ' + mota, R.keyOf(inp), want);
}

// Ten file co dau gach ngang van dung
eq('keyOf giu nguyen slug co gach ngang', R.keyOf('/gold-jewellery.html'), 'gold-jewellery');
eq('keyOf slug gach ngang, khong duoi', R.keyOf('/forgot-password'), 'forgot-password');

// ===== currentPageKey doc tu location.pathname =====
eq('currentPageKey tren /cart.html', withPath('/cart.html').currentPageKey(), 'cart');
eq('currentPageKey tren /cart (route tuong lai)', withPath('/cart').currentPageKey(), 'cart');
eq('currentPageKey tren /', withPath('/').currentPageKey(), 'index');
check('is() so dung khoa', withPath('/cart.html').is('cart') && !withPath('/cart.html').is('orders'));

// ===== to() — cho DUY NHAT biet duoi .html =====
eq('to("cart")', R.to('cart'), 'cart.html');
eq('to("forgot-password")', R.to('forgot-password'), 'forgot-password.html');
eq('to voi query', R.to('login', { redirect: 'checkout' }), 'login.html?redirect=checkout');
eq('to voi nhieu query', R.to('login', { redirect: 'profile', notice: 'session-expired' }),
   'login.html?redirect=profile&notice=session-expired');
eq('to bo qua gia tri rong', R.to('login', { redirect: '', notice: 'x' }), 'login.html?notice=x');
eq('to khong query -> khong co dau ?', R.to('index'), 'index.html');
eq('to voi khoa la -> tra chinh no, KHONG nem loi', R.to('khong-ton-tai'), 'khong-ton-tai');
eq('to escape ky tu dac biet trong query', R.to('search', { q: 'quần nam' }),
   'search.html?q=' + encodeURIComponent('quần nam'));
eq('product(5)', R.product(5), 'product.html?id=5');

// ===== Vong tron: moi trang trong PATHS phai tu quay ve chinh no =====
let loi = [];
Object.keys(R.PATHS).forEach(function (k) {
  if (R.keyOf(R.to(k)) !== k) loi.push(k + ' -> ' + R.to(k) + ' -> ' + R.keyOf(R.to(k)));
  // Va ca o dang KHONG duoi (URL tuong lai)
  const khongDuoi = R.PATHS[k].replace(/\.html$/, '');
  if (R.keyOf(khongDuoi) !== k) loi.push(k + ' (khong duoi) -> ' + R.keyOf(khongDuoi));
});
eq('21 trang: keyOf(to(k)) === k o CA HAI dang URL', loi, []);

// ===== PATHS khop file that tren dia =====
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', '..');
const thieu = Object.keys(R.PATHS).filter(k => !fs.existsSync(path.join(dir, R.PATHS[k])));
eq('moi duong dan trong PATHS deu ung voi file that', thieu, []);
const tren_dia = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
eq('PATHS khong bo sot trang nao tren dia', tren_dia.length, Object.keys(R.PATHS).length);

note('to() la cho DUY NHAT biet duoi .html — migrate EJS chi can sua PATHS.');
