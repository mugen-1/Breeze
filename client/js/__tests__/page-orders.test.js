/* page-orders.js — danh sách đơn hàng của khách. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');

function setup(loggedIn, orders) {
  const log = [];
  const r = load('page-orders.js', {
    deps: ['utils-format.js'],
    window: {
      __i18n: { current: 'vi', T: { vi: { orders: {
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

  // Không có đơn nào
  r = setup(true, []);
  r.doc.fire('authchange');
  await wait();
  eq('khong co don -> hien khoi empty', g(r, 'orders-empty').style.display, 'block');
  eq('khong co don -> danh sach rong', g(r, 'orders-list').innerHTML, '');

  eq('dang ky du 3 su kien', Object.keys(r.doc._l).sort(),
     ['DOMContentLoaded', 'authchange', 'langchange']);
})();
