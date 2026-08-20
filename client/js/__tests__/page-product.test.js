/* page-product.js — chi tiết sản phẩm động theo ?id. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');

const P = {
  id: 5, name_vi: 'Áo Sơ Mi', name_en: 'Shirt', description_vi: 'Mo ta', description_en: 'Desc',
  price: 300000, sale_price: 250000, stock: 7, category_slug: 'sanpham-ao',
  images: ['a.png', 'b.png'],
};
const RELATED = [{ id: 9, name_vi: 'Quan', name_en: 'Pants', price: 100000, sale_price: null, images: ['q.png'] }];

function setup(url, product, related) {
  const doc = makeDoc();
  // Code đọc các phần tử này ngay lúc parse, không kiểm tra null.
  ['pd-root', 'pd-name', 'pd-price', 'pd-desc', 'pd-main-img', 'pd-thumbs',
   'pd-sizes', 'sg-overlay', 'sg-open', 'sg-close', 'pd-related-list'].forEach(function (id) {
    doc.getElementById(id);
  });
  const addBtn = El('button');
  doc._qs['.pd-add'] = addBtn;
  doc._qs['.pd-size-head'] = El('div');
  doc._qs['.sg-table thead tr'] = El('tr');
  doc._qs['.sg-table tbody'] = El('tbody');

  const log = [];
  const r = load('page-product.js', {
    deps: ['routes.js', 'utils-format.js', 'utils-i18n.js'],
    doc: doc,
    globals: {
      fetch: function (u) {
        log.push(['fetch', u]);
        const isDetail = /\/api\/products\/\d+$/.test(u);
        if (isDetail && product === 404) return Promise.resolve({ ok: false, status: 404 });
        return Promise.resolve({ ok: true, status: 200,
          json: function () { return Promise.resolve(isDetail ? product : (related || [])); } });
      },
    },
    window: {
      API_BASE: 'http://x', location: { search: url },
      __i18n: { current: 'vi', t: function (k) { return 'T:' + k; },
                T: { vi: { cart: { add: 'Them vao gio' } } } },
      _injectAddToCartButtons: function () { log.push(['inject']); },
    },
  });
  r.addBtn = addBtn; r.acts = log;
  return r;
}
const g = (r, id) => r.doc.getElementById(id);

(async function () {
  console.log('page-product.js');

  // Không có ?id
  let r = setup('', P);
  eq('khong co ?id -> bao khong tim thay', g(r, 'pd-name').textContent, 'T:pd.notFound');
  eq('khong co ?id -> khoa nut them gio', r.addBtn.disabled, true);
  eq('khong co ?id -> KHONG goi fetch', r.acts.length, 0);

  // id hợp lệ
  r = setup('?id=5', P, RELATED);
  await wait();
  eq('goi dung endpoint chi tiet', r.acts[0][1], 'http://x/api/products/5');
  eq('dien ten san pham', g(r, 'pd-name').textContent, 'Áo Sơ Mi');
  eq('dat document.title', r.sandbox.document.title, 'Áo Sơ Mi - BREEZE');
  eq('gan data-id cho addToCart (cart.js)', g(r, 'pd-root').getAttribute('data-id'), '5');
  eq('gan data-stock de chan them gio', g(r, 'pd-root').getAttribute('data-stock'), '7');
  eq('anh chinh lay anh dau tien', g(r, 'pd-main-img').src, 'a.png');
  eq('dung so thumbnail', g(r, 'pd-thumbs').children.length, 2);
  check('co sale_price -> hien ca gia gach ngang lan gia sale',
        /line-through/.test(g(r, 'pd-price').innerHTML) && /price-sale/.test(g(r, 'pd-price').innerHTML));
  eq('danh muc ao -> size mac dinh S/M/L/XL', g(r, 'pd-sizes').innerHTML.match(/data-size="(\w+)"/g),
     ['data-size="S"', 'data-size="M"', 'data-size="L"', 'data-size="XL"']);
  eq('con hang -> nut la "them vao gio"', r.addBtn.textContent, 'T:pd.addToCart');
  eq('con hang -> nut khong bi khoa', r.addBtn.disabled, false);
  await wait();
  check('render san pham lien quan', /data-id="9"/.test(g(r, 'pd-related-list').innerHTML));
  check('goi lai _injectAddToCartButtons cho card lien quan',
        r.acts.some(function (x) { return x[0] === 'inject'; }));

  // Hết hàng
  let c = setup('?id=5', Object.assign({}, P, { stock: 0 }));
  await wait();
  eq('stock=0 -> khoa nut', c.addBtn.disabled, true);
  eq('stock=0 -> doi chu thanh het hang', c.addBtn.textContent, 'T:sr.soldOut');
  check('stock=0 -> gan class sold-out', c.addBtn.classList.contains('sold-out'));

  // Size theo danh mục
  let cg = setup('?id=5', Object.assign({}, P, { category_slug: 'sanpham-giay' }));
  await wait();
  eq('danh muc giay -> size so 41-44',
     g(cg, 'pd-sizes').innerHTML.match(/data-size="(\d+)"/g),
     ['data-size="41"', 'data-size="42"', 'data-size="43"', 'data-size="44"']);

  let cj = setup('?id=5', Object.assign({}, P, { category_slug: 'handbags' }));
  await wait();
  eq('danh muc tui xach -> an han o chon size', g(cj, 'pd-sizes').style.display, 'none');
  eq('danh muc tui xach -> an ca tieu de size', cj.doc._qs['.pd-size-head'].style.display, 'none');

  // 404
  let c4 = setup('?id=99', 404);
  await wait();
  eq('API 404 -> bao khong tim thay', g(c4, 'pd-name').textContent, 'Không tìm thấy sản phẩm');
  eq('API 404 -> khoa nut', c4.addBtn.disabled, true);

  // Đổi ngôn ngữ
  r.sandbox.window.__i18n.current = 'en';
  r.doc.fire('langchange');
  eq('doi sang EN -> ten doi theo', g(r, 'pd-name').textContent, 'Shirt');
  eq('doi sang EN -> title doi theo', r.sandbox.document.title, 'Shirt - BREEZE');

  // Modal bảng size
  g(r, 'sg-open').fire('click');
  check('mo bang size -> overlay open', g(r, 'sg-overlay').classList.contains('open'));
  eq('mo bang size -> khoa cuon trang', r.sandbox.document.body.style.overflow, 'hidden');
  r.doc.fire('keydown', { key: 'Escape' });
  check('nhan Escape -> dong overlay', !g(r, 'sg-overlay').classList.contains('open'));
  eq('dong overlay -> tra lai cuon trang', r.sandbox.document.body.style.overflow, '');

  ['pName', 'currentLang', 'renderProduct', 'loadRelated'].forEach(function (k) {
    eq('IIFE khong ro global: ' + k, typeof r.sandbox[k], 'undefined');
  });
  // money nay la global DUNG CHUNG tu utils-format.js (TASK 4) — phai co, khong phai ro ri.
  eq('money la global dung chung tu utils-format.js', typeof r.sandbox.money, 'function');
  eq('esc la global dung chung tu utils-format.js', typeof r.sandbox.esc, 'function');
  eq('t la global dung chung tu utils-i18n.js', typeof r.sandbox.t, 'function');
})();
