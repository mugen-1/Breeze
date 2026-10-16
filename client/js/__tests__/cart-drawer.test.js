const { check, eq } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');
const { makeDoc } = require('./helpers/dom');

console.log('cart-drawer.js');

const doc = makeDoc();
doc.readyState = 'loading';
const originalGet = doc.getElementById;
let drawerExists = false;
doc.getElementById = function (id) {
  if (id === 'cart-drawer' && !drawerExists) return null;
  return originalGet(id);
};
const originalAppend = doc.body.appendChild;
doc.body.appendChild = function (el) {
  if (el.id === 'cart-drawer') drawerExists = true;
  return originalAppend(el);
};

let items = [
  { id: 7, variant_id: 51, size: 'M', name: 'Ao', img: 'm.jpg', price: 100000, qty: 2, stock: 2 },
  { id: 7, variant_id: 52, size: 'L', name: 'Ao', img: 'l.jpg', price: 100000, qty: 1, stock: 5 },
];
const actions = [];
let addSucceeds = false;
const r = load('cart-drawer.js', {
  deps: ['routes.js', 'utils-format.js'],
  doc,
  globals: {
    getCart: () => items,
    updateQty: (id, delta) => actions.push(['qty', id, delta]),
    removeFromCart: id => actions.push(['remove', id]),
    CART_MAX_QTY: 99,
    _updateAllBadges: () => {},
  },
  window: {
    __i18n: { t: key => key },
    addToCart: () => addSucceeds,
    location: { href: '' },
  },
});
doc.fire('DOMContentLoaded');

const body = doc.getElementById('cart-drawer-body');
const drawer = doc.body.children.find(el => el.id === 'cart-drawer');
check('moi size co dong va variant ID rieng',
  body.innerHTML.includes('data-id="v51"') && body.innerHTML.includes('data-id="v52"'));
check('size duoc hien thi trong drawer',
  body.innerHTML.includes('pd.thSize: M') && body.innerHTML.includes('pd.thSize: L'));
check('size het ton khong cho tang so luong',
  /data-id="v51"[\s\S]*?data-act="inc"[^>]*disabled/.test(body.innerHTML));
eq('tong so luong', doc.getElementById('cart-drawer-count').textContent, 3);
eq('tong tien', doc.getElementById('cart-drawer-total').textContent, '300.000₫');

r.win.addToCart({});
eq('them gio bi tu choi thi drawer van dong', drawer.getAttribute('aria-hidden'), 'true');
addSucceeds = true;
r.win.addToCart({});
eq('them gio thanh cong thi drawer mo', drawer.getAttribute('aria-hidden'), 'false');
doc.fire('keydown', { key: 'Escape' });
eq('Escape dong drawer', drawer.getAttribute('aria-hidden'), 'true');

function clickLine(variantId, action) {
  const line = { getAttribute: () => 'v' + variantId };
  const btn = { getAttribute: () => action };
  body.fire('click', { target: { closest: s => s === '[data-act]' ? btn : line } });
}
clickLine(52, 'inc');
clickLine(51, 'remove');
eq('nut tang va xoa gui dung variant, khong gui product ID', actions,
  [['qty', 'v52', 1], ['remove', 'v51']]);

items = [];
doc.fire('cartchange');
check('gio rong render lai sau cartchange', body.innerHTML.includes('cart-empty'));
