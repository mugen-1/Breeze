/* page-cart.js — bảng giỏ hàng, chặn thanh toán khi có món hết hàng. */
const { check, eq } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');

function setup(cart) {
  const doc = makeDoc();
  const btn = El('button');
  doc._qs['.btn-checkout'] = btn;
  const log = [];
  const r = load('page-cart.js', {
    doc: doc,
    globals: {
      getCart: function () { return cart; },
      formatPrice: function (n) { return Number(n).toLocaleString('vi-VN') + 'd'; },
      updateQty: function (id, d) { log.push(['updateQty', id, d]); },
      removeFromCart: function (id) { log.push(['removeFromCart', id]); },
    },
    window: {
      __i18n: { current: 'vi', T: { vi: { cartPage: { removeTitle: 'Xoa' } } } },
      startCheckout: function () { log.push(['startCheckout']); },
      location: { href: '' },
    },
  });
  r.btn = btn; r.acts = log;
  r.doc.fire('DOMContentLoaded');
  return r;
}
const g = (r, id) => r.doc.getElementById(id);

console.log('page-cart.js');

// Giỏ rỗng
let r = setup([]);
eq('gio rong -> hien khoi empty', g(r, 'cart-empty').style.display, 'block');
eq('gio rong -> an noi dung', g(r, 'cart-content').style.display, 'none');

// Giỏ có hàng
r = setup([{ id: 1, name: 'Ao', price: 100000, qty: 2, img: 'a.png', stock: 5 },
           { id: 2, name: 'Quan', price: 50000, qty: 1, img: 'b.png', stock: 3 }]);
eq('2 mon -> render 2 dong', g(r, 'cart-body').children.length, 2);
eq('tong tien = 100000*2 + 50000', g(r, 'cart-total-price').textContent, '250.000d');
eq('con hang -> nut thanh toan bat', r.btn.disabled, false);

// Vượt tồn kho
r = setup([{ id: 1, name: 'Ao', price: 100000, qty: 9, img: 'a.png', stock: 2 }]);
eq('qty > stock -> khoa nut thanh toan', r.btn.disabled, true);
eq('qty > stock -> hien canh bao', g(r, 'checkout-msg').style.display, 'block');
check('qty > stock -> gan tag het hang',
      g(r, 'cart-body').children[0].innerHTML.includes('cart-soldout-tag'));
r.sandbox.checkout();
check('bam thanh toan khi het hang -> KHONG goi startCheckout',
      !r.acts.some(function (x) { return x[0] === 'startCheckout'; }));

// Luồng bình thường
r = setup([{ id: 1, name: 'Ao', price: 100000, qty: 1, img: 'a.png', stock: 5 }]);
r.sandbox.checkout();
eq('bam thanh toan binh thuong -> goi startCheckout', r.acts, [['startCheckout']]);
r.sandbox.changeQty(1, 1);
r.sandbox.removeItem(1);
eq('changeQty/removeItem goi dung ham cart.js', r.acts.slice(1),
   [['updateQty', 1, 1], ['removeFromCart', 1]]);

// Guest chưa biết tồn kho
r = setup([{ id: 1, name: 'Ao', price: 100000, qty: 99, img: 'a.png', stock: null }]);
eq('guest stock=null -> KHONG coi la het hang', r.btn.disabled, false);

// Hàm gọi từ onclick trong HTML bắt buộc phải ở global
['changeQty', 'removeItem', 'checkout'].forEach(function (k) {
  eq('onclick can global: ' + k, typeof r.sandbox[k], 'function');
});
eq('window.renderCart van duoc gan', typeof r.win.renderCart, 'function');
eq('dang ky du 3 su kien', Object.keys(r.doc._l).sort(),
   ['DOMContentLoaded', 'cartchange', 'langchange']);
