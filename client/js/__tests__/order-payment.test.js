const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const payment = { id: 8, order_id: 5, transaction_code: 'PAY-1001-001', payment_method: 'visa', amount: 920000,
  status: 'pending', created_at: '2026-10-11T00:00:00Z', paid_at: null };
const order = { id: 5, order_code: 1001, status: 'pending', total_amount: 920000, payment_transaction: payment, items: [] };
const deps = ['routes.js', 'utils-format.js', 'utils-i18n.js', 'order-payment.js'];
const shared = load('order-payment.js', { deps: ['utils-format.js', 'utils-i18n.js'], window: { __i18n: { t: k => k } } });
const helper = shared.win.BreezeOrderPayment;
check('pending online payment permits simulation', helper.canSimulate(order));
for (const method of ['visa', 'mastercard', 'momo']) check(method + ' supported', helper.canSimulate({ ...order, payment_transaction: { ...payment, payment_method: method } }));
for (const status of ['paid', 'failed', 'cancelled']) check(status + ' terminal payment has no actions', !helper.canSimulate({ ...order, payment_transaction: { ...payment, status } }));
for (const status of ['cancelled', 'completed']) check(status + ' order has no actions', !helper.canSimulate({ ...order, status }));
check('COD pending has no simulation', !helper.canSimulate({ ...order, payment_transaction: { ...payment, payment_method: 'cod' } }));
check('legacy order has explicit empty payment state', helper.details({ id: 1 }).includes('paymenttx.legacy'));
const html = helper.details(order, true);
check('payment detail includes code, server amount and timestamps', html.includes('PAY-1001-001') && html.includes('920.000₫') && html.includes('paymenttx.created') && html.includes('paymenttx.paidAt'));
check('User sees explicit success and failure actions with internal order ID', html.includes('data-order-id="5"') && html.includes('data-outcome="success"') && html.includes('data-outcome="failure"'));
check('Admin detail is read-only', !helper.details(order, false).includes('data-action'));
check('busy simulation disables both actions', (helper.details(order, true, true).match(/ disabled/g) || []).length === 2);
check('payment metadata is escaped', !helper.details({ ...order, payment_transaction: { ...payment, transaction_code: '<img onerror=bad>' } }).includes('<img'));

function action(outcome, id = 5) {
  const el = El('button'); el.setAttribute('data-action', 'order-payment-simulate');
  el.setAttribute('data-outcome', outcome); el.setAttribute('data-order-id', id); el._closest = { '[data-action]': el }; return el;
}
function checkout(method, outcome) {
  const doc = makeDoc(), calls = [], redirects = [], timers = [];
  doc.getElementById('co-payment-simulation').hidden = true;
  const submit = El('button'), radio = El('input'); radio.value = method;
  doc.getElementById('co-form').querySelector = () => submit;
  doc._qs['input[name="payment"]:checked'] = radio; doc._qsa['input[name="payment"]'] = [radio];
  let auth, cart = [{ id: 1, qty: 1, price: 900000 }], resolvePayment, failNetwork = false;
  const r = load('checkout.js', { doc, deps, globals: { getCart: () => cart,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} }, window: {
    __i18n: { t: k => k }, location: { replace: url => redirects.push(url) },
    BreezeVoucher: { clear: () => calls.push({ clear: true }) },
    refreshCart: () => { cart = []; doc.fire('cartchange'); },
    AuthHelper: { onChange: cb => { auth = cb; }, apiFetch: async (url, opts) => {
      calls.push({ url, body: opts && JSON.parse(opts.body) });
      if (url === '/api/orders/shipping-methods') return { ok: true, json: async () => [{ key: 'GHN_STANDARD', label_key: 'ship.ghn', eta_key: 'ship.etaGhn', fee: 20000 }] };
      if (url === '/api/me') return { ok: true, json: async () => ({}) };
      if (url === '/api/orders') return { status: 201, json: async () => ({ order: { ...order, payment_transaction: { ...payment, payment_method: method } } }) };
      return new Promise(resolve => { resolvePayment = () => resolve(failNetwork ? { ok: false, json: async () => ({}) } :
        { ok: true, json: async () => ({ payment_transaction: { ...payment, payment_method: method,
          status: outcome === 'success' ? 'paid' : 'failed', paid_at: outcome === 'success' ? '2026-10-11T07:20:00Z' : null } }) }); });
    } }
  } });
  doc.fire('DOMContentLoaded'); auth({ uid: 'a' });
  for (const [field, value] of Object.entries({ firstname: 'A', lastname: 'Nguyen', phone: '0901234567', street: '12 Road', ward: 'Ward', district: 'District', city: 'City' })) doc.getElementById('f-' + field).value = value;
  return { ...r, calls, redirects, timers, submit, resolve: () => resolvePayment(), fail: value => { failNetwork = value; } };
}
(async () => {
  for (const [method, outcome] of [['visa', 'success'], ['mastercard', 'failure'], ['momo', 'success']]) {
    const r = checkout(method, outcome); await wait();
    r.doc.getElementById('co-form').fire('submit'); await wait();
    eq(method + ' creates order once', r.calls.filter(c => c.url === '/api/orders').length, 1);
    eq('simulation visible and checkout hidden', [r.doc.getElementById('co-payment-simulation').hidden, r.doc.getElementById('co-checkout-grid').hidden], [false, true]);
    check('simulation receives focus', r.doc.getElementById('co-payment-simulation')._focused);
    r.timers.forEach(fn => fn()); eq('cleared cart does not redirect before payment', r.redirects, []);
    r.doc.getElementById('co-form').fire('submit'); await wait();
    eq('created order cannot be submitted again', r.calls.filter(c => c.url === '/api/orders').length, 1);
    const button = action(outcome);
    r.doc.fire('click', { target: button }); r.doc.fire('click', { target: button }); await wait();
    eq('double click submits one simulation request', r.calls.filter(c => c.url === '/api/orders/5/payment-simulation').length, 1);
    eq('client sends only explicit outcome', r.calls.find(c => c.url === '/api/orders/5/payment-simulation').body, { outcome });
    check('pending until backend responds', r.doc.getElementById('co-payment-details').innerHTML.includes('<dd>paymenttx.pending</dd>'));
    check('simulation actions disabled while waiting', r.doc.getElementById('co-payment-details').innerHTML.includes(' disabled'));
    r.resolve(); await wait();
    check('renders authoritative ' + outcome, r.doc.getElementById('co-payment-details').innerHTML.includes(outcome === 'success' ? '<dd>paymenttx.paid</dd>' : '<dd>paymenttx.failed</dd>'));
    check('terminal result removes simulation actions', !r.doc.getElementById('co-payment-details').innerHTML.includes('data-outcome'));
    r.win.__i18n.t = k => 'EN:' + k; r.doc.fire('langchange');
    check('language switch retains payment result', r.doc.getElementById('co-payment-details').innerHTML.includes(outcome === 'success' ? '<dd>EN:paymenttx.paid</dd>' : '<dd>EN:paymenttx.failed</dd>'));
  }
  const retry = checkout('visa', 'success'); await wait(); retry.doc.getElementById('co-form').fire('submit'); await wait();
  retry.fail(true); retry.doc.fire('click', { target: action('success') }); await wait(); retry.resolve(); await wait();
  eq('simulation error is announced', retry.doc.getElementById('co-payment-message').textContent, 'paymenttx.error');
  check('failed request preserves pending state and retry actions', retry.doc.getElementById('co-payment-details').innerHTML.includes('<dd>paymenttx.pending</dd>') && retry.doc.getElementById('co-payment-details').innerHTML.includes('data-outcome'));
  retry.fail(false); retry.doc.fire('click', { target: action('success') }); await wait(); retry.resolve(); await wait();
  check('retry uses existing order', retry.doc.getElementById('co-payment-details').innerHTML.includes('<dd>paymenttx.paid</dd>') && retry.calls.filter(c => c.url === '/api/orders').length === 1);

  const cod = checkout('cod'); await wait(); cod.doc.getElementById('co-form').fire('submit'); await wait();
  check('COD skips online simulation', cod.doc.getElementById('co-payment-simulation').hidden);
  cod.timers.forEach(fn => fn());
  eq('COD redirects to existing Orders page', cod.win.location.href, cod.win.BreezeRoutes.to('orders'));
  eq('COD sends no payment simulation request', cod.calls.filter(c => c.url && c.url.includes('payment-simulation')).length, 0);

  const doc = makeDoc(), calls = [];
  const r = load('page-orders.js', { doc, deps: [...deps, 'order-shipping.js'], window: {
    __i18n: { current: 'vi', T: { vi: { orders: {} } }, t: k => k },
    AuthHelper: { isLoggedIn: () => true, apiFetch: async (url, opts) => {
      calls.push({ url, body: opts && JSON.parse(opts.body) });
      return { ok: true, json: async () => opts ? { payment_transaction: { ...payment, status: 'paid', paid_at: '2026-10-11T07:20:00Z' } } : [structuredClone(order)] };
    } }
  } });
  doc.fire('authchange'); await wait();
  check('User order detail can resume pending simulation', doc.getElementById('orders-list').innerHTML.includes('PAY-1001-001') && doc.getElementById('orders-list').innerHTML.includes('data-outcome'));
  doc.fire('click', { target: action('success') }); await wait();
  eq('order page submits simulation for internal order ID', calls.at(-1), { url: '/api/orders/5/payment-simulation', body: { outcome: 'success' } });
  check('order page shows paid result and removes actions', doc.getElementById('orders-list').innerHTML.includes('<dd>paymenttx.paid</dd>') && !doc.getElementById('orders-list').innerHTML.includes('data-outcome'));
})().catch(e => { console.error(e); process.exitCode = 1; });
