const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
function setup(options = {}) {
  const doc = makeDoc(), calls = [], redirects = [];
  const submit = El('button'), payment = El('input'); payment.value = 'cod';
  doc.getElementById('co-form').querySelector = () => submit;
  doc._qs['input[name="payment"]:checked'] = payment;
  doc._qsa['input[name="payment"]'] = [payment];
  let login;
  const r = load('checkout.js', { deps: ['routes.js','utils-format.js','utils-i18n.js'], doc,
    globals: { getCart: () => [{ id: 1, variant_id: 10, qty: 1, price: 100000 }], setTimeout: () => 1, clearTimeout() {} },
    window: { __i18n: { t: key => key === 'ship.standard' ? 'Giao hàng tiêu chuẩn' : key }, location: { replace: url => redirects.push(url) },
      AuthHelper: { onChange: cb => { login = cb; }, apiFetch: async (url, opts) => {
        calls.push({ url, body: opts && JSON.parse(opts.body) });
        if (url === '/api/me') return { ok: true, json: async () => ({ display_name: 'Nguyen Van A', phone: '0901234567' }) };
        if (url === '/api/orders/shipping-methods') {
          return { ok: !options.failMethods, json: async () => [{ key: 'GHN_STANDARD', label_key: 'ship.standard', eta_key: 'ship.etaGhn', fee: options.fee ?? 20000 },
            { key: 'GHTK_ECONOMY', label_key: 'ship.ghtk', eta_key: 'ship.etaGhtk', fee: 15000 },
            { key: 'BREEZE_EXPRESS', label_key: 'ship.express', eta_key: 'ship.etaExpress', fee: 35000 }] };
        }
        return options.limit ? { status: 409, json: async () => ({ error: 'ORDER_CODE_LIMIT' }) } : { status: 201, json: async () => ({ order: { id: 5, order_code: 1001 } }) };
      } }, BreezeVoucher: { getAppliedCode: () => 'GIAMGIALANDAU' } } });
  doc.fire('DOMContentLoaded');
  return { ...r, calls, redirects, login, submit, doc };
}
(async () => {
  const r = setup();
  eq('payment selected but methods still loading -> disabled', r.submit.disabled, true);
  r.login({ uid: 'test' }); await wait();
  eq('prefill profile firstname', r.doc.getElementById('f-firstname').value, 'A');
  eq('prefill profile lastname', r.doc.getElementById('f-lastname').value, 'Nguyen Van');
  eq('prefill phone', r.doc.getElementById('f-phone').value, '0901234567');
  eq('shipping fee loaded from API, no client constant', r.doc.getElementById('co-oi-ship').textContent, '20.000₫');
  check('method label shows STANDARD fee', r.doc.getElementById('co-shipping-methods').innerHTML.includes('Giao hàng tiêu chuẩn — 20.000₫'));
  eq('summary includes server quoted fee', r.doc.getElementById('co-oi-total').textContent, '120.000₫');
  eq('method loaded + payment -> enabled', r.submit.disabled, false);
  r.doc.getElementById('co-form').fire('submit'); await wait();
  check('missing street prevents order request', !r.calls.some(c => c.url === '/api/orders'));
  for (const [field,value] of Object.entries({ street: '12 Road', building: 'Floor 2', ward: 'Ward', district: 'District', city: 'City', note: 'Call first' })) {
    r.doc.getElementById('f-' + field).value = value;
  }
  r.doc.fire('langchange');
  eq('language switch preserves selected fee', r.doc.getElementById('co-oi-ship').textContent, '20.000₫');
  r.doc.getElementById('co-form').fire('submit'); await wait();
  const posted = r.calls.find(c => c.url === '/api/orders').body;
  eq('address components sent separately', [posted.shipping_address, posted.shipping_ward, posted.shipping_district, posted.shipping_city],
    ['12 Road, Floor 2','Ward','District','City']);
  eq('only method key, note and voucher selection sent', [posted.shipping_method,posted.delivery_note,posted.voucherCode],
    ['GHN_STANDARD','Call first','GIAMGIALANDAU']);
  check('no client fee, subtotal, discount or total authority', !['shipping_fee','subtotal','total','discountAmount'].some(k => k in posted));
  r.doc.getElementById('co-shipping-methods').fire('change', { target: { value: 'GHTK_ECONOMY' } });
  eq('economy selection updates fee and total', [r.doc.getElementById('co-oi-ship').textContent,r.doc.getElementById('co-oi-total').textContent], ['15.000₫','115.000₫']);
  r.doc.getElementById('co-shipping-methods').fire('change', { target: { value: 'BREEZE_EXPRESS' } });
  r.doc.fire('langchange');
  eq('express fee survives language switch', r.doc.getElementById('co-oi-ship').textContent, '35.000₫');
  check('server ETA and simulation notice are visible', r.doc.getElementById('co-shipping-methods').innerHTML.includes('ship.etaExpress') && r.doc.getElementById('co-shipping-methods').innerHTML.includes('ship.simulation'));
  const limited = setup({ limit: true }); limited.login({ uid: 'test' }); await wait();
  let refreshed = 0, cleared = 0;
  limited.win.refreshCart = () => refreshed++;
  limited.win.BreezeVoucher.clear = () => cleared++;
  for (const field of ['street','ward','district','city']) limited.doc.getElementById('f-' + field).value = 'Retained';
  limited.doc.getElementById('co-form').fire('submit'); await wait();
  eq('limit has specific visible message', limited.doc.getElementById('co-form-msg').textContent, 'co.orderCodeLimit');
  eq('limit retains cart, voucher, address and enables retry', [refreshed,cleared,limited.doc.getElementById('f-street').value,limited.submit.disabled], [0,0,'Retained',false]);
  const guest = setup(); guest.login(null);
  eq('guest redirects to login checkout', guest.redirects, ['login.html?redirect=checkout']);
  const failed = setup({ failMethods: true }); failed.login({ uid: 'test' }); await wait();
  eq('failed method fetch keeps checkout disabled', failed.submit.disabled, true);
  eq('failed methods display translated error', failed.doc.getElementById('co-form-msg').textContent, 'ship.loadError');
  const edited = setup(); edited.doc.getElementById('f-firstname').value = 'Manual';
  edited.login({ uid: 'test' }); await wait();
  eq('late prefill never overwrites typed name', edited.doc.getElementById('f-firstname').value, 'Manual');
  const changed = setup({ fee: 35000 }); changed.login({ uid: 'test' }); await wait();
  eq('frontend follows API fee instead of hardcoding 20000', changed.doc.getElementById('co-oi-ship').textContent, '35.000₫');
})().catch(e => { console.error(e); process.exitCode = 1; });
