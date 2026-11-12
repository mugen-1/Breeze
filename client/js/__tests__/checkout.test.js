const { check, eq } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');
const { makeDoc } = require('./helpers/dom');

console.log('checkout.js');

const doc = makeDoc();
let items = [
  { id: 7, variant_id: 51, size: 'M', name: 'Ao', img: 'm.jpg', price: 100000, qty: 2 },
  { id: 7, variant_id: 52, size: 'L', name: 'Ao', img: 'l.jpg', price: 100000, qty: 1 },
];
const events = [];
doc.addEventListener('checkout:summary', e => events.push(e.detail));
const r = load('checkout.js', {
  deps: ['routes.js', 'utils-format.js', 'utils-i18n.js'],
  doc,
  globals: {
    getCart: () => items,
    setTimeout: () => 1,
    clearTimeout: () => {},
  },
  window: {
    location: { href: '', replace: () => {} },
    __i18n: { t: key => key },
  },
});
doc.fire('DOMContentLoaded');

function rows() { return (doc.getElementById('co-oi-list').innerHTML.match(/class="co-oi-item"/g) || []).length; }
eq('hai size cung product hien thanh hai dong', rows(), 2);
check('checkout hien ca hai nhan size',
  doc.getElementById('co-oi-list').innerHTML.includes('co.metaSize: M') &&
  doc.getElementById('co-oi-list').innerHTML.includes('co.metaSize: L'));
eq('tong SL va tien cua hai size',
  [doc.getElementById('co-oi-count').textContent, doc.getElementById('co-oi-subtotal').textContent],
  [3, '300.000₫']);
eq('voucher nhan subtotal dung', events[0], { subtotal: 300000, ship: 0 });

// Du lieu cart tam thoi thieu size hien thi van phai giu hai variant rieng.
items = [
  { id: 7, variant_id: 51, name: 'Ao', price: 100000, qty: 1 },
  { id: 7, variant_id: 52, name: 'Ao', price: 100000, qty: 1 },
];
doc.fire('cartchange');
eq('variant ID khac nhau khong bi gop du thieu size hien thi', rows(), 2);
eq('tong tien sau cartchange', doc.getElementById('co-oi-subtotal').textContent, '200.000₫');

items = [{ id: 8, name: 'San pham khong size', price: 50000, qty: 1 }];
doc.fire('cartchange');
eq('san pham khong size cu van hien mot dong', rows(), 1);
check('san pham khong size khong hien nhan size',
  !doc.getElementById('co-oi-list').innerHTML.includes('co.metaSize'));

/* ===== Task 3: nút "Đặt hàng" theo panel thanh toán (js/checkout-payment.js) =====
   Module panel được thay bằng stub { isReady, refresh }; khi không có stub, checkout.js
   phải chạy y như trước (các test cũ ở trên và checkout-shipping.test.js không nạp nó). */
const { El } = require('./helpers/dom');
const { wait } = require('./helpers/sandbox');

function gateSetup(opts = {}) {
  const gdoc = makeDoc(), calls = [], alerts = [], replaced = [];
  const submit = El('button'), radio = El('input'); radio.value = opts.method || 'visa';
  gdoc.getElementById('co-form').querySelector = () => submit;
  gdoc._qs['input[name="payment"]:checked'] = radio;
  gdoc._qsa['input[name="payment"]'] = [radio];
  const panelInput = El('input', 'co-pay-number');
  gdoc._qs['#co-pay-panel .co-pay-block:not([hidden]) input'] = opts.noPanelInput ? null : panelInput;
  const pay = { ready: opts.ready !== false, refreshes: 0 };
  let login;
  const win = {
    __i18n: { t: key => key }, location: { replace(u) { replaced.push(u); }, href: '' }, alert: m => alerts.push(m),
    AuthHelper: { onChange: cb => { login = cb; }, apiFetch: async (url, o) => {
      calls.push({ url, body: o && o.body ? JSON.parse(o.body) : undefined });
      if (url === '/api/me') return { ok: true, json: async () => (opts.me || {}) };
      if (url === '/api/orders/shipping-methods') return { ok: true, json: async () => [{ key: 'GHN_STANDARD', label_key: 'a', eta_key: 'b', fee: 20000 }] };
      return opts.order ? opts.order() : { status: 201, json: async () => ({ order: { id: 5, order_code: 1001 } }) };
    } },
  };
  if (!opts.noModule) win.BreezeCheckoutPayment = { isReady: () => pay.ready, refresh: () => { pay.refreshes++; return Promise.resolve(pay.ready); } };
  const g = load('checkout.js', { deps: ['routes.js', 'utils-format.js', 'utils-i18n.js'], doc: gdoc,
    globals: { getCart: () => [{ id: 1, variant_id: 10, qty: 1, price: 100000 }], setTimeout: () => 1, clearTimeout() {} }, window: win });
  gdoc.fire('DOMContentLoaded');
  const fill = () => { for (const [f, v] of Object.entries({ firstname: 'A', lastname: 'B', phone: '0901234567', street: '1 Road', ward: 'W', district: 'D', city: 'C' })) gdoc.getElementById('f-' + f).value = v; };
  return { ...g, doc: gdoc, submit, radio, panelInput, pay, calls, fill, alerts, replaced, login: async () => { login({ uid: 'u' }); await wait(); },
    orders: () => calls.filter(c => c.url === '/api/orders') };
}

(async () => {
  // Phía quản trị (admin + staff) mở thẳng checkout.html -> báo lỗi rồi rời trang; khách thì không.
  for (const role of ['admin', 'staff', 'customer']) {
    const rg = gateSetup({ me: { role } }); await rg.login(); await wait();
    const blocked = role !== 'customer';
    eq(role + ': thong bao chan dat hang', rg.alerts, blocked ? ['co.adminBlocked'] : []);
    eq(role + ': roi trang checkout', rg.replaced, blocked ? ['index.html'] : []);
  }

  let g = gateSetup({ noModule: true }); await g.login();
  eq('khong co BreezeCheckoutPayment: Visa + ship -> nut mo nhu cu', g.submit.disabled, false);
  eq('khong co module: khong hien ly do khoa', [g.doc.getElementById('co-pay-gate-msg').hidden, g.doc.getElementById('co-pay-gate-msg').textContent], [true, '']);
  g.fill(); g.doc.getElementById('co-form').fire('submit'); await wait();
  eq('khong co module: dat hang binh thuong', g.orders().length, 1);

  g = gateSetup({ ready: false }); await g.login();
  eq('isReady()=false -> nut "Dat hang" disabled', [g.submit.disabled, g.submit.getAttribute('aria-disabled')], [true, 'true']);
  eq('ly do khoa doc duoc', [g.doc.getElementById('co-pay-gate-msg').hidden, g.doc.getElementById('co-pay-gate-msg').textContent], [false, 'co.payInfoNeeded']);
  g.pay.ready = true; g.doc.fire('checkout:payready');
  eq('checkout:payready (ready) -> nut mo', g.submit.disabled, false);
  eq('het ly do khoa -> xoa chu + an', [g.doc.getElementById('co-pay-gate-msg').hidden, g.doc.getElementById('co-pay-gate-msg').textContent], [true, '']);
  g.pay.ready = false; g.doc.fire('checkout:payready');
  eq('checkout:payready (chua san sang) -> khoa lai', g.submit.disabled, true);

  // Submit lọt qua (vd Enter ở ô địa chỉ) khi chưa sẵn sàng -> không gọi API, focus vào panel.
  g.fill(); g.doc.getElementById('co-form').fire('submit'); await wait();
  eq('chua san sang -> khong POST /api/orders', g.orders().length, 0);
  eq('chua san sang -> loi o #f-pay-err', [g.doc.getElementById('f-pay-err').hidden, g.doc.getElementById('f-pay-err').textContent], [false, 'co.payInfoNeeded']);
  eq('chua san sang -> focus o dau trong panel', g.panelInput._focused, true);
  g = gateSetup({ ready: false, noPanelInput: true }); await g.login();
  g.fill(); g.doc.getElementById('co-form').fire('submit'); await wait();
  eq('panel chua co o nhap (dang tai) -> focus radio dang chon', g.radio._focused, true);

  g = gateSetup({ method: 'cod', ready: true }); await g.login();
  eq('COD (isReady=true) -> nut mo', g.submit.disabled, false);

  g = gateSetup({ order: () => ({ status: 400, json: async () => ({ status: 'error', error: 'PAYMENT_INFO_REQUIRED', payment_method: 'visa', message: 'server text' }) }) });
  await g.login(); g.fill();
  g.doc.getElementById('co-form').fire('submit'); await wait();
  eq('PAYMENT_INFO_REQUIRED -> thong bao i18n rieng', g.doc.getElementById('co-form-msg').textContent, 'co.payInfoRequired');
  eq('PAYMENT_INFO_REQUIRED -> goi refresh() mo lai panel', g.pay.refreshes, 1);
  g = gateSetup({ order: () => ({ status: 400, json: async () => ({ status: 'error', message: 'Giỏ hàng trống, không thể đặt đơn' }) }) });
  await g.login(); g.fill();
  g.doc.getElementById('co-form').fire('submit'); await wait();
  eq('400 khac van hien message server nhu cu', [g.doc.getElementById('co-form-msg').textContent, g.pay.refreshes], ['Giỏ hàng trống, không thể đặt đơn', 0]);
})().catch(e => { check('test nut Dat hang khong nem loi', false, e && e.message); });
