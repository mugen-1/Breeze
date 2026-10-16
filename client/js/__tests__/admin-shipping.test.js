const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const doc = makeDoc(), calls = [];
let login, select, fail = false, csvBlob, download;
const createElement = doc.createElement;
doc.createElement = tag => { const el = createElement(tag); if (tag === 'a') download = el; return el; };
const order = { id: 25, order_code: 1001, status: 'shipping', shipping_version: 2,
  shipping_method: 'GHN_STANDARD', shipping_provider: 'GHN', shipping_service: 'Saved service', shipping_fee: 20000,
  shipping_tracking_code: 'GHN-BR-1001', shipping_eta: '2–4 ngày', shipping_status: 'picked_up',
  allowed_shipping_statuses: ['in_transit'], items: [], total_amount: 20000,
  payment_transaction: { id: 4, order_id: 25, transaction_code: 'PAY-1001-001', payment_method: 'cod',
    amount: 20000, status: 'pending', created_at: '2026-10-11T00:00:00Z', paid_at: null } };
doc.getElementById('order-body').querySelectorAll = selector => {
  if (selector !== '[data-shipping-order]') return [];
  select = El('select'); select.setAttribute('data-shipping-order', '25'); return [select];
};
load('admin.js', { doc, deps: ['routes.js','utils-format.js','order-shipping.js', 'utils-i18n.js', 'order-payment.js', 'business-report-csv.js'],
  globals: { Blob: class { constructor(parts, options) { csvBlob = { parts, options }; } }, setTimeout: () => 0, clearTimeout() {}, fetch: async () => ({ json: async () => [] }) },
  window: { __i18n: { t: k => k }, AuthHelper: {
    onChange(fn) { login = fn; },
    apiFetch: async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body) });
      let data = {};
      if (url === '/api/me') data = { role: 'admin' };
      else if (url === '/api/categories' || url.startsWith('/api/admin/stats/order-status')) data = [];
      else if (url.startsWith('/api/admin/stats/business-report?')) {
        const query = new URL(url, 'http://example.test').searchParams;
        data = { range: { from: query.get('from'), to: query.get('to') },
          summary: { revenue: 105000, orders: 2, completedOrders: 1, cancelledOrders: 1, customers: 1, aov: 105000, productsSold: 1 },
          dailyRevenue: [{ date: query.get('to'), revenue: 105000, orders: 2, completedOrders: 1, cancelledOrders: 1 }], topProducts: [] };
      }
      else if (url.startsWith('/api/admin/stats?')) data = { current: { revenue: 105000, orders: 2 }, dailyRevenue: [{ date: '2026-10-10', revenue: 105000 }] };
      else if (url.startsWith('/api/admin/orders?')) data = { orders: [order], total: 1, total_pages: 1 };
      else if (url.endsWith('/shipping-status')) {
        if (fail) return { ok: false, status: 409, json: async () => ({ message: 'Conflict' }) };
        order.shipping_status = JSON.parse(opts.body).shipping_status;
        order.allowed_shipping_statuses = ['out_for_delivery'];
        data = { order };
      }
      return { ok: true, status: 200, json: async () => data };
    }
  } }
});
(async () => {
  doc.fire('DOMContentLoaded'); login({ uid: 'admin' }); await wait(50);
  eq('dashboard KPI still renders revenue', doc.getElementById('kpi-revenue-val').textContent, '105.000₫');
  doc.getElementById('dash-export').fire('click');
  await wait();
  check('CSV keeps BOM, business sections and daily revenue', csvBlob.parts.join('').startsWith('\uFEFFreport.title') && csvBlob.parts.join('').includes('report.top') && csvBlob.parts.join('').includes(',105000,2,1,1'));
  check('existing CSV download remains client-side', download.href === 'blob:tmp' && download.download.endsWith('.csv') && csvBlob.options.type === 'text/csv;charset=utf-8;');
  const html = () => doc.getElementById('order-body').innerHTML;
  check('business code is visible; internal ID remains on actions', html().includes('>1001</td>') && html().includes('data-shipping-order="25"'));
  check('saved provider, service, tracking and fee appear', html().includes('GHN-BR-1001') && html().includes('Saved service') && html().includes('20.000₫'));
  check('server supplies permitted next step only', html().includes('value="in_transit"') && !html().includes('value="delivered"'));
  check('Admin order detail includes payment code, amount, status and dates', html().includes('PAY-1001-001') && html().includes('paymenttx.pending') && html().includes('paymenttx.created') && html().includes('paymenttx.paidAt'));
  check('Admin has no customer payment simulation action', !html().includes('order-payment-simulate'));
  select.value = 'in_transit'; select.fire('change');
  eq('shipping update disables control while pending', select.disabled, true);
  await wait();
  const patch = calls.find(x => x.method === 'PATCH');
  eq('PATCH uses internal ID and selected shipping status', patch, { url: '/api/admin/orders/25/shipping-status', method: 'PATCH', body: { shipping_status: 'in_transit' } });
  check('successful update reloads saved status and keeps detail open', html().includes('ship.status.in_transit') && doc.getElementById('oi-25').style.display === 'table-row');
  fail = true; select.value = 'out_for_delivery'; select.fire('change'); await wait();
  check('conflict reloads authoritative saved status', html().includes('value="in_transit"'));
})().catch(e => { console.error(e); process.exitCode = 1; });
