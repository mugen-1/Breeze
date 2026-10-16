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
    deps: ['routes.js', 'utils-format.js'],
    globals: {
      CART_MAX_QTY: 99,
      getCart: function () { return cart; },
      updateQty: function (id, d) { log.push(['updateQty', id, d]); },
      removeFromCart: function (id) { log.push(['removeFromCart', id]); },
    },
    window: {
      __i18n: { current: 'vi', t: function (k) { return k; }, T: { vi: { cartPage: { removeTitle: 'Xoa' } } } },
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
eq('tong tien = 100000*2 + 50000', g(r, 'cart-total-price').textContent, '250.000₫');
eq('con hang -> nut thanh toan bat', r.btn.disabled, false);
r = setup([{ id: 1, variant_id: 10, size: 'M', name: 'Ao', price: 100, qty: 2, stock: 2 },
           { id: 1, variant_id: 11, size: 'L', name: 'Ao', price: 100, qty: 1, stock: 5 }]);
eq('M va L cung product co 2 dong', g(r, 'cart-body').children.length, 2);
check('cart hien size M va key variant', /pd.thSize: M/.test(g(r, 'cart-body').children[0].innerHTML) && /data-id="v10"/.test(g(r, 'cart-body').children[0].innerHTML));
check('nut tang khoa tai stock rieng size', /data-delta="1" disabled/.test(g(r, 'cart-body').children[0].innerHTML));

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

// Trần 99: nút "+" bị khoá khi chạm trần, còn bật khi chưa; nút "−" không bao giờ khoá
r = setup([{ id: 1, name: 'Ao', price: 1, qty: 99, img: 'a.png', stock: null },
           { id: 2, name: 'Quan', price: 1, qty: 98, img: 'b.png', stock: null }]);
const rows = g(r, 'cart-body').children;
check('qty=99 -> nut "+" bi khoa', rows[0].innerHTML.includes('data-delta="1" disabled>+</button>'));
check('qty=99 -> nut "-" van bat', !rows[0].innerHTML.includes('data-delta="-1" disabled'));
check('qty=98 -> nut "+" van bat', !rows[1].innerHTML.includes('disabled'));

// CSP: không còn handler inline trong HTML sinh ra
check('dong gio KHONG con onclick/onerror inline', !/\son[a-z]+=/i.test(rows[0].innerHTML));

// Click nút (delegation ở document qua data-action) -> gọi đúng hàm cart.js
function btn(attrs) {
  const b = El('button');
  Object.keys(attrs).forEach(function (k) { b.setAttribute(k, attrs[k]); });
  b._closest = { '[data-action]': b };
  return b;
}
r = setup([{ id: -1700000000000, name: 'Ao', price: 1, qty: 1, img: 'a.png', stock: 5 }]);
r.doc.fire('click', { target: btn({ 'data-action': 'cart-qty', 'data-id': '-1700000000000', 'data-delta': '-1' }) });
r.doc.fire('click', { target: btn({ 'data-action': 'cart-remove', 'data-id': '7' }) });
r.doc.fire('click', { target: btn({ 'data-action': 'cart-checkout' }) });
r.doc.fire('click', { target: btn({ 'data-action': 'khong-phai-cua-gio' }) });
r.doc.fire('click', { target: El('div') });   // click ngoài mọi nút
eq('click data-action -> dung ham, dung id (ke ca id am cua gio khach)', r.acts,
   [['updateQty', -1700000000000, -1], ['removeFromCart', 7], ['startCheckout']]);

// Tên sản phẩm / ảnh là DỮ LIỆU -> phải escape trước khi vào innerHTML
r = setup([{ id: 1, name: '<img src=x onerror=alert(1)>', price: 1, qty: 1, img: 'a.png" onerror="alert(2)', stock: 5 }]);
const xss = g(r, 'cart-body').children[0].innerHTML;
check('ten san pham duoc escape', xss.includes('&lt;img src=x onerror=alert(1)&gt;') && !xss.includes('<img src=x'));
check('duong dan anh duoc escape (khong thoat khoi thuoc tinh src)', xss.includes('a.png&quot; onerror=&quot;alert(2)'));

// Ảnh lỗi -> ảnh dự phòng, đúng một lần (thay onerror inline)
const img = El('img'); img.classList.add('cart-item-img'); img.setAttribute('src', 'hong.png');
img.getAttribute = function (k) { return k === 'src' ? img.src || 'hong.png' : null; };
r.doc.fire('error', { target: img });
eq('anh loi -> doi sang gc8.png', img.src, 'img/gc8.png');
img.src = 'img/gc8.png';
r.doc.fire('error', { target: img });
eq('anh du phong cung loi -> dung, khong lap', img.src, 'img/gc8.png');
const other = El('img'); other.src = 'x.png'; other.getAttribute = function () { return 'x.png'; };
r.doc.fire('error', { target: other });
eq('anh khac (khong phai anh gio) -> khong dung vao', other.src, 'x.png');

// Hàm cũ vẫn global (không còn bắt buộc cho onclick, giữ cho tương thích)
['changeQty', 'removeItem', 'checkout'].forEach(function (k) {
  eq('van global: ' + k, typeof r.sandbox[k], 'function');
});
eq('window.renderCart van duoc gan', typeof r.win.renderCart, 'function');
eq('dang ky du 5 su kien', Object.keys(r.doc._l).sort(),
   ['DOMContentLoaded', 'cartchange', 'click', 'error', 'langchange']);
