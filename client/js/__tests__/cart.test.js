/* cart.js — server TỪ CHỐI một thao tác giỏ (mọi status không ok) thì phải hoàn tác thay
   đổi lạc quan + toast, KHÔNG được đem body lỗi áp vào giỏ (trước đây chỉ bắt 403, còn
   400/401/500 làm giỏ hiện trống). Và trần 99 / dòng, khớp MAX_QTY ở server/routes/cart.js. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El } = require('./helpers/dom');

function res(status, body) {
  return { ok: status >= 200 && status < 300, status: status,
           json: function () { return Promise.resolve(body); } };
}
function srvItem(id, qty) {
  return { product_id: id, name_vi: 'SP' + id, name_en: 'P' + id, image: 'a.png',
           unit_price: 1000, quantity: qty, stock: 500 };
}
// Nút "Thêm vào giỏ" nằm trong .product-item[data-id]
function productBtn(id) {
  const item = El('div');
  item.setAttribute('data-id', String(id));
  item.setAttribute('data-size-configured', 'false');
  const btn = El('button');
  btn._closest = { '.product-item': item };
  return btn;
}

/* Dựng cart.js rồi báo trạng thái đăng nhập: opts.guest -> khách, ngược lại uid 'u1' với
   giỏ server `items`. opts.localCart là giỏ khách đang nằm trong localStorage.
   setReply(fn) đặt phản hồi cho các lời gọi API SAU đó, đồng thời xoá nhật ký + toast. */
async function setup(items, opts) {
  opts = opts || {};
  const calls = [];
  let onAuth = null;
  let reply = function () { return res(200, { items: items }); };
  const local = JSON.stringify(opts.localCart || []);
  const r = load('cart.js', {
    globals: {
      localStorage: { getItem: function (k) { return k === 'bookstore_cart' ? local : null; },
                      setItem: function () {} },
    },
    window: {
      AuthHelper: {
        onChange: function (fn) { onAuth = fn; },
        apiFetch: function (url, o) {
          calls.push({ url: url, method: (o && o.method) || 'GET',
                       body: o && o.body ? JSON.parse(o.body) : null });
          return Promise.resolve(reply(url, o));
        },
      },
    },
  });
  r.doc.fire('DOMContentLoaded');
  onAuth(opts.guest ? null : { uid: 'u1' });
  await wait();
  r.calls = calls;
  r.setReply = function (fn) { reply = fn; calls.length = 0; r.doc.body.children = []; };
  r.cart = function () { return r.sandbox.getCart().map(function (i) { return [i.id, i.qty]; }); };
  r.toasts = function () {
    return r.doc.body.children.filter(function (c) { return c.className === 'cart-toast'; })
      .map(function (c) { return c.textContent; });
  };
  return r;
}

console.log('cart.js');

(async function () {
  let r = await setup([srvItem(1, 2), srvItem(2, 1)]);
  eq('dang nhap -> nap gio server', r.cart(), [[1, 2], [2, 1]]);

  // 400 (vd vượt trần) — trước đây rơi vào _applyServerCart -> giỏ trống
  r.setReply(function () { return res(400, { status: 'error', message: 'quantity phải là số nguyên từ 1 đến 99' }); });
  r.sandbox.updateQty(1, 1);
  eq('updateQty: cap nhat lac quan ngay', r.cart(), [[1, 3], [2, 1]]);
  await wait();
  eq('updateQty 400 -> hoan tac, gio KHONG trong', r.cart(), [[1, 2], [2, 1]]);
  eq('updateQty 400 -> toast cau i18n, khong lo message ky thuat', r.toasts(), ['acc.errUpdCart']);

  // 500 khi xoá — trước đây cũng làm giỏ trống
  r.setReply(function () { return res(500, { status: 'error', message: 'Lỗi máy chủ' }); });
  r.sandbox.removeFromCart(1);
  eq('removeFromCart: xoa lac quan ngay', r.cart(), [[2, 1]]);
  await wait();
  eq('removeFromCart 500 -> mon quay lai DUNG vi tri cu', r.cart(), [[1, 2], [2, 1]]);
  eq('removeFromCart 500 -> toast', r.toasts(), ['acc.errUpdCart']);

  // 403 blacklist — giữ nguyên hành vi cũ
  r.setReply(function () { return res(403, { status: 'error', error: 'BLACKLISTED', message: 'x' }); });
  r.sandbox.addToCart(productBtn(2));
  eq('addToCart: cong lac quan ngay', r.cart(), [[1, 2], [2, 2]]);
  await wait();
  eq('addToCart 403 blacklist -> hoan tac', r.cart(), [[1, 2], [2, 1]]);
  eq('addToCart 403 blacklist -> toast acc.blocked (nhu cu)', r.toasts(), ['acc.blocked']);

  // 401 với món MỚI — phải gỡ đúng món đó, không đụng món khác
  r.setReply(function () { return res(401, { status: 'error', message: 'Token không hợp lệ' }); });
  r.sandbox.addToCart(productBtn(7));
  await wait();
  eq('addToCart mon moi 401 -> go dung mon do', r.cart(), [[1, 2], [2, 1]]);
  eq('addToCart 401 -> toast cau i18n', r.toasts(), ['acc.errAddCart']);

  // 403 không phải blacklist — vẫn hiện message server như cũ
  r.setReply(function () { return res(403, { status: 'error', message: 'Bi chan' }); });
  r.sandbox.updateQty(2, 1);
  await wait();
  eq('403 thuong -> hoan tac', r.cart(), [[1, 2], [2, 1]]);
  eq('403 thuong -> hien message server (nhu cu)', r.toasts(), ['Bi chan']);

  // Thành công — vẫn áp giỏ server trả về, không toast
  r.setReply(function () { return res(200, { items: [srvItem(1, 2), srvItem(2, 5)] }); });
  r.sandbox.updateQty(2, 1);
  await wait();
  eq('200 -> ap gio server tra ve', r.cart(), [[1, 2], [2, 5]]);
  eq('200 -> khong toast', r.toasts(), []);

  // Trần 99 ở server mode. Phản hồi được đặt để LÀM ĐỔI giỏ nếu lỡ gọi API.
  r = await setup([srvItem(1, 99), srvItem(2, 120)]);
  r.setReply(function () { return res(200, { items: [] }); });
  r.sandbox.updateQty(1, 1);
  await wait();
  eq('updateQty +1 o 99 -> khong goi API', r.calls.length, 0);
  eq('updateQty +1 o 99 -> giu 99', r.cart(), [[1, 99], [2, 120]]);
  r.sandbox.addToCart(productBtn(1));
  await wait();
  eq('addToCart o 99 -> khong goi API', r.calls.length, 0);
  eq('addToCart o 99 -> toast acc.maxQty', r.toasts(), ['acc.maxQty']);
  r.setReply(function () { return res(200, { items: [srvItem(1, 99), srvItem(2, 119)] }); });
  r.sandbox.updateQty(2, -1);
  await wait();
  eq('gio cu da vuot tran van GIAM duoc', r.calls.map(function (c) { return c.body.quantity; }), [119]);

  // Trần 99 ở chế độ khách
  r = await setup([], { guest: true, localCart: [{ id: 3, name: 'X', price: 1, img: '', qty: 99 }] });
  eq('khach -> nap gio localStorage', r.cart(), [[3, 99]]);
  r.sandbox.addToCart(productBtn(3));
  r.sandbox.updateQty(3, 1);
  eq('khach o 99: addToCart/updateQty khong vuot tran', r.cart(), [[3, 99]]);
  eq('khach o 99: addToCart bao toast', r.toasts(), ['acc.maxQty']);

  // Đăng nhập: gộp giỏ khách lên server, món vượt trần bị kẹp chứ không bị 400 rồi mất
  r = await setup([], { localCart: [{ id: 3, name: 'X', price: 1, img: '', qty: 150 },
                                    { id: 4, name: 'Y', price: 1, img: '', qty: 2 }] });
  const posts = r.calls.filter(function (c) { return c.method === 'POST'; })
    .map(function (c) { return [c.body.product_id, c.body.quantity, c.body.mode]; });
  eq('merge gio khach: 150 kep ve 99, mon khac giu nguyen', posts, [[3, 99, 'add'], [4, 2, 'add']]);
  check('CART_MAX_QTY la global = 99 (page-cart/cart-drawer doc bien nay)', r.sandbox.CART_MAX_QTY === 99);

  r = await setup([], { guest: true });
  const sizeBtn = productBtn(5), root = sizeBtn._closest['.product-item'];
  root.id = 'pd-root'; root.setAttribute('data-size-configured', 'true');
  eq('chua chon size -> tra false khong mo drawer', r.sandbox.addToCart(sizeBtn), false);
  eq('chua chon size -> gio khong doi', r.cart(), []);
  eq('chua chon size -> thong bao nhe', r.toasts(), ['pd.selectSize']);
  root.setAttribute('data-variant-id', '51'); root.setAttribute('data-size', 'M');
  r.sandbox.addToCart(sizeBtn);
  root.setAttribute('data-variant-id', '52'); root.setAttribute('data-size', 'L');
  r.sandbox.addToCart(sizeBtn);
  eq('guest M/L khong merge cung product', r.sandbox.getCart().map(x => [x.variant_id,x.size,x.qty]), [[51,'M',1],[52,'L',1]]);
  r.sandbox.updateQty('v51', 1);
  eq('tang M khong doi L', r.sandbox.getCart().map(x => x.qty), [2,1]);
  r.sandbox.removeFromCart('v51');
  eq('xoa M van giu L', r.sandbox.getCart().map(x => x.variant_id), [52]);

  r = await setup([{ ...srvItem(5, 1), variant_id: 51, size: 'M' }, { ...srvItem(5, 1), variant_id: 52, size: 'L' }]);
  r.setReply(function () { return res(409, { error: 'INSUFFICIENT_STOCK' }); });
  root.setAttribute('data-variant-id', '51'); root.setAttribute('data-size', 'M');
  r.sandbox.addToCart(sizeBtn); await wait();
  eq('Add M gui dung variant_id', r.calls[0].body.variant_id, 51);
  eq('rollback M khong doi L', r.sandbox.getCart().map(x => [x.variant_id,x.qty]), [[51,1],[52,1]]);
  r.setReply(function () { return res(200, { items: [{ ...srvItem(5,1), variant_id: 52, size: 'L' }] }); });
  r.sandbox.removeFromCart('v51'); await wait();
  eq('xoa server dung endpoint variant', r.calls[0].url, '/api/cart/variant/51');

  // data-action thay onclick inline (CSP). add-to-cart phải gọi window.addToCart — bản mà
  // cart-drawer.js bọc lại để mở drawer — chứ không gọi thẳng hàm trong cart.js.
  const called = [];
  const r2 = load('cart.js', {
    window: { addToCart: function (b) { called.push(['window.addToCart', b.getAttribute('data-action')]); } },
  });
  function el(attrs, closest) {
    const e = El(attrs.tag || 'button');
    Object.keys(attrs).forEach(function (k) { if (k !== 'tag') e.setAttribute(k, attrs[k]); });
    e._closest = Object.assign({ '[data-action]': e }, closest || {});
    return e;
  }
  const addBtn = el({ 'data-action': 'add-to-cart' });
  r2.doc.fire('click', { target: addBtn });
  eq('click add-to-cart -> goi window.addToCart (ban da boc)', called, [['window.addToCart', 'add-to-cart']]);

  const form = El('form');
  form.submit = function () { called.push(['form.submit']); };
  let prevented = false;
  r2.doc.fire('click', { target: el({ tag: 'a', 'data-action': 'submit-search' }, { form: form }),
                         preventDefault: function () { prevented = true; } });
  eq('click kinh lup -> form.submit() cua form chua no', called.slice(1), [['form.submit']]);
  check('click kinh lup -> chan dieu huong "#"', prevented);

  r2.doc.fire('click', { target: el({ 'data-action': 'cart-qty' }) });   // của page-cart.js
  r2.doc.fire('click', { target: El('div') });
  eq('data-action khac / click ngoai nut -> cart.js khong lam gi', called.length, 2);
})();
