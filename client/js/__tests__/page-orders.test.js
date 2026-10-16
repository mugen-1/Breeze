/* page-orders.js — danh sách đơn hàng của khách. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El } = require('./helpers/dom');

function setup(loggedIn, orders) {
  const log = [];
  const r = load('page-orders.js', {
    deps: ['routes.js', 'order-shipping.js', 'utils-i18n.js', 'order-payment.js', 'utils-format.js'],
    window: {
      __i18n: { current: 'vi', t: function (key) { return key; }, T: { vi: { orders: {
        heading: 'Don Hang Cua Toi', empty: 'Chua co don', orderNo: 'Don hang #',
        date: 'Ngay dat', total: 'Tong tien', statusMap: { paid: 'Da thanh toan' },
        loadError: 'Khong tai duoc don hang.' } } } },
      AuthHelper: {
        isLoggedIn: function () { return loggedIn; },
        apiFetch: function (p) {
          log.push(['api', p]);
          return Promise.resolve({ ok: true, status: 200,
            json: function () { return Promise.resolve(orders); } });
        },
      },
    },
  });
  r.acts = log;
  return r;
}
const g = (r, id) => r.doc.getElementById(id);

const ORDERS = [{
  id: 7, status: 'paid', created_at: '2026-07-30T10:00:00Z', total_amount: 250000,
  items: [{ product_name: 'Ao <script>', unit_price: 100000, quantity: 2, line_total: 200000 }],
}];

(async function () {
  console.log('page-orders.js');

  // Chưa đăng nhập
  let r = setup(false, []);
  r.doc.fire('DOMContentLoaded');
  eq('chua dang nhap -> hien khoi moi dang nhap', g(r, 'orders-login').style.display, 'block');
  eq('chua dang nhap -> heading van duoc dich', g(r, 'orders-heading').textContent, 'Don Hang Cua Toi');

  // Đã đăng nhập nhưng chưa tải xong
  r = setup(true, []);
  r.doc.fire('DOMContentLoaded');
  eq('dang tai -> hien dau cham', g(r, 'orders-status').textContent, '...');

  // Có đơn
  r = setup(true, ORDERS);
  r.doc.fire('authchange');
  await wait();
  eq('authchange -> goi dung endpoint', r.acts, [['api', '/api/orders']]);
  const html = g(r, 'orders-list').innerHTML;
  check('render ra the .order-card', html.includes('order-card'));
  check('money() dinh dang tien VN', /250\.000₫/.test(html));
  check('esc() chan XSS trong ten san pham',
        html.includes('&lt;script&gt;') && !html.includes('<script>'));
  check('statusMap dich trang thai don', html.includes('Da thanh toan'));
  eq('hien nut tiep tuc mua sam', g(r, 'orders-continue').style.display, 'inline-block');
  check('don cu khong hien Size N/A', !html.includes('pd.thSize') && !html.includes('N/A'));
  const sized = setup(true, [{ ...ORDERS[0], items: [{ ...ORDERS[0].items[0], size_snapshot: 'M' }] }]);
  sized.doc.fire('authchange'); await wait();
  check('don moi hien size snapshot', sized.doc.getElementById('orders-list').innerHTML.includes('pd.thSize: M'));

  // Không có đơn nào
  r = setup(true, []);
  r.doc.fire('authchange');
  await wait();
  eq('khong co don -> hien khoi empty', g(r, 'orders-empty').style.display, 'block');
  eq('khong co don -> danh sach rong', g(r, 'orders-list').innerHTML, '');

  eq('dang ky su kien cancel va render', Object.keys(r.doc._l).sort(),
     ['DOMContentLoaded', 'authchange', 'change', 'click', 'keydown', 'langchange']);

  // Nút chỉ render khi backend cho phép; submit thành công tải lại status.
  const cancellable = [{ ...ORDERS[0], status: 'pending', can_cancel: true }];
  r = setup(true, cancellable);
  r.doc.fire('authchange');
  await wait();
  check('pending co nut huy tu can_cancel cua API', g(r, 'orders-list').innerHTML.includes('order-cancel-open'));
  const open = El('button');
  open.setAttribute('data-action', 'order-cancel-open');
  open.setAttribute('data-order-id', '7');
  open._closest = { '[data-action]': open };
  r.doc.fire('click', { target: open });
  eq('mo modal khong huy ngay', g(r, 'orders-cancel-overlay').hidden, false);
  eq('chua POST khi moi mo modal', r.acts, [['api', '/api/orders']]);
  g(r, 'orders-cancel-reason').value = 'wrong_item';
  let posted;
  r.win.AuthHelper.apiFetch = (path, options) => {
    if (options && options.method === 'POST') {
      posted = { path, body: JSON.parse(options.body) };
      return Promise.resolve({ status: 200, json: async () => ({ status: 'ok' }) });
    }
    return Promise.resolve({ ok: true, json: async () => [{ ...cancellable[0], status: 'cancelled', can_cancel: false }] });
  };
  const submit = g(r, 'orders-cancel-submit');
  submit.setAttribute('data-action', 'order-cancel-submit');
  submit._closest = { '[data-action]': submit };
  r.doc.fire('click', { target: submit });
  await wait();
  eq('POST dung endpoint va ly do', posted, { path: '/api/orders/7/cancel', body: { reason: 'wrong_item', details: '' } });
  eq('thanh cong dong modal', g(r, 'orders-cancel-overlay').hidden, true);
  check('refresh status va an nut huy', !g(r, 'orders-list').innerHTML.includes('order-cancel-open'));
  check('thong bao thanh cong ngan gon', !g(r, 'orders-flash').hidden);

  // Admin đổi trạng thái giữa lúc xem và lúc hủy: refresh và ẩn action.
  r = setup(true, cancellable);
  r.doc.fire('authchange');
  await wait();
  r.doc.fire('click', { target: open });
  g(r, 'orders-cancel-reason').value = 'wrong_item';
  r.win.AuthHelper.apiFetch = (path, options) => options && options.method === 'POST'
    ? Promise.resolve({ status: 409, json: async () => ({ error: 'ORDER_NOT_CANCELLABLE' }) })
    : Promise.resolve({ ok: true, json: async () => [{ ...cancellable[0], status: 'processing', can_cancel: false }] });
  r.doc.fire('click', { target: submit });
  await wait();
  check('409 hien thong bao', !g(r, 'orders-flash').hidden && g(r, 'orders-flash').classList.contains('is-error'));
  check('409 refresh va an nut huy', !g(r, 'orders-list').innerHTML.includes('order-cancel-open'));
  
})();

/* ===== Hoi quy: xung dot global _lang giua cart.js va page-orders.js =====
   Ca hai tung khai bao global ten _lang. Tren orders.html chung cung nap, va
   page-orders.js nap SAU nen de mat ban cua cart.js — von la ban day du, co
   nhanh doc localStorage 'ql_lang'. Hau qua: khi i18n.js chua san sang, ten san
   pham trong gio rot ve 'vi' thay vi ngon ngu nguoi dung da luu.
   Da doi ten ban cua page-orders.js thanh _ordersLang. Case duoi khoa hanh vi do. */
(function () {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const JS = path.join(__dirname, '..');

  // Dung boi canh THAT cua orders.html: cart.js truoc, page-orders.js sau.
  const sandbox = {
    console: { error() {}, warn() {}, log() {} },
    URLSearchParams, Promise, Date, Math, JSON, Object, Array, String, Number,
    setTimeout: () => 0, clearTimeout: () => {}, isNaN, parseInt, parseFloat,
    localStorage: { getItem: (k) => (k === 'ql_lang' ? 'en' : null), setItem() {}, removeItem() {} },
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null,
                querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add(){}, remove(){} },
                addEventListener(){}, appendChild(){} }), body: { appendChild(){}, classList:{add(){},remove(){}} },
                dispatchEvent: () => true },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
  };
  // i18n.js CHUA nap -> window.__i18n khong ton tai
  sandbox.window = { addEventListener() {}, location: { search: '', href: '' } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, 'cart.js'), 'utf8'), sandbox, { filename: 'cart.js' });
  vm.runInContext(fs.readFileSync(path.join(JS, 'page-orders.js'), 'utf8'), sandbox, { filename: 'page-orders.js' });

  eq('cart.js + page-orders.js cung nap -> _lang van la ban cua cart.js',
     sandbox._lang(), 'en');
  check('page-orders.js khong con khai bao global _lang',
        typeof sandbox._ordersLang === 'function');
  eq('_ordersLang giu nguyen hanh vi cu (khong doc localStorage)',
     sandbox._ordersLang(), 'vi');

  // Khi i18n.js da san sang thi ca hai deu uu tien __i18n.current
  sandbox.window.__i18n = { current: 'vi' };
  eq('co __i18n -> cart.js uu tien __i18n.current', sandbox._lang(), 'vi');
  sandbox.window.__i18n = { current: 'en' };
  eq('doi sang en -> cart.js theo __i18n.current', sandbox._lang(), 'en');
})();
