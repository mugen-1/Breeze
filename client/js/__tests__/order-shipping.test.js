const { check, eq } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');
const r = load('order-shipping.js', { deps: ['utils-format.js'], window: { __i18n: { t: k => k } } });
const shipping = r.win.BreezeOrderShipping;
const attack = '<img src=x onerror=alert(1)>';
const order = { shipping_name: attack, shipping_phone: '0901234567', shipping_address: attack,
  shipping_ward: 'Ward', shipping_district: 'District', shipping_city: 'City', delivery_note: attack,
  shipping_method: 'STANDARD', shipping_fee: 20000, total_amount: 105000, discount_amount: 15000,
  items: [{ line_total: 100000 }] };
const html = shipping.details(order);
check('recipient/address/note XSS is escaped for history and admin', !html.includes(attack) &&
  (html.match(/&lt;img/g) || []).length === 3);
check('history/admin breakdown includes stored STANDARD fee and total', html.includes('20.000₫') && html.includes('105.000₫') && html.includes('15.000₫'));
check('old zero fee snapshot is preserved in history/admin', shipping.details({ ...order, shipping_fee: 0, total_amount: 85000 }).includes('ship.fee: 0₫'));
eq('full address uses snapshot components', shipping.address(order), attack + ', Ward, District, City');
eq('standard label translated', shipping.method(order), 'ship.standard');
check('legacy never invents recipient or method', shipping.details({ items: [], total_amount: 0 }).includes('ship.legacy'));
check('legacy has no undefined/null/NaN', !/undefined|null|NaN/.test(shipping.details({ items: [], total_amount: 0 })));

eq('new order code takes priority over ID', shipping.code({ id: 17, order_code: 1001 }), 1001);
eq('historical order falls back to ID', shipping.code({ id: 17, order_code: null }), 17);
const tracked = shipping.details({ ...order, shipping_version: 2, shipping_service: 'Saved service', shipping_provider: attack,
  shipping_tracking_code: attack, shipping_eta: attack, shipping_status: 'out_for_delivery' });
check('saved tracking details are escaped and status rendered', !tracked.includes(attack) && tracked.includes('Saved service') && tracked.includes('ship.status.out_for_delivery'));
check('legacy order never invents tracking', !html.includes('ship.tracking'));
