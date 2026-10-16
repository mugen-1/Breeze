/* New and historical order labels use the real i18n data in the existing user page. */
const assert = require('node:assert/strict');
const { load, wait } = require('./helpers/sandbox');

(async () => {
  let checks = 0;
  function check(fn) { fn(); checks++; }
  const statuses = ['pending', 'confirmed', 'processing', 'shipping', 'completed', 'cancelled', 'paid', 'shipped'];
  const rows = statuses.map((status, i) => ({
    id: i + 1, status, created_at: '2026-07-30T10:00:00Z', total_amount: 100000, items: [],
  }));
  Object.assign(rows[0], { order_code: 1001, shipping_version: 2, shipping_method: 'GHN_STANDARD', shipping_provider: 'GHN', shipping_service: 'Saved service', shipping_eta: '2–4 ngày', shipping_tracking_code: 'GHN-BR-1001', shipping_status: 'pending_pickup' });
  const r = load('page-orders.js', {
    deps: ['routes.js', 'order-shipping.js', 'utils-i18n.js', 'order-payment.js', 'utils-format.js', 'i18n.js'],
    window: { AuthHelper: {
      isLoggedIn: () => true,
      apiFetch: async () => ({ ok: true, json: async () => rows }),
    } },
  });
  for (const lang of ['vi', 'en']) {
    r.win.__i18n.current = lang;
    for (const status of statuses) {
      check(() => assert.ok(r.win.__i18n.T[lang].orders.statusMap[status], lang + ': ' + status));
      check(() => assert.notEqual(r.win.__i18n.t('st.' + status), 'st.' + status));
    }
  }
  r.win.__i18n.current = 'vi';
  r.doc.fire('authchange');
  await wait();
  let html = r.doc.getElementById('orders-list').innerHTML;
  check(() => assert.ok(html.includes('Đơn hàng #1001')));
  check(() => assert.ok(html.includes('GHN-BR-1001') && html.includes('Saved service')));
  check(() => assert.ok(html.includes('Chờ lấy hàng')));
  for (const status of statuses) {
    check(() => assert.ok(html.includes(r.win.__i18n.T.vi.orders.statusMap[status]), status));
  }
  r.win.__i18n.current = 'en';
  r.doc.fire('langchange');
  html = r.doc.getElementById('orders-list').innerHTML;
  for (const status of statuses) {
    check(() => assert.ok(html.includes(r.win.__i18n.T.en.orders.statusMap[status]), status));
  }
  console.log('order-status labels: 8 statuses × VI/EN + user order render PASS');
  console.log('KET QUA: ' + checks + ' pass, 0 fail');
})().catch((err) => { console.error(err); process.exitCode = 1; });
