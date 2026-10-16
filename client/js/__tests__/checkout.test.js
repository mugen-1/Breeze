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
