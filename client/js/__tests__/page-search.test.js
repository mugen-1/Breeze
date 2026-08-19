/* page-search.js — tìm kiếm sản phẩm, lọc phía client từ /api/products. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { makeDoc } = require('./helpers/dom');

const CATALOG = [
  { id: 1, name_vi: 'Quần Nam Ống Suông', name_en: 'Straight Leg Pants',
    price: 500000, sale_price: null, stock: 5, images: ['a.png', 'b.png'] },
  { id: 2, name_vi: 'Áo Sơ Mi Trắng', name_en: 'White Shirt',
    price: 300000, sale_price: 250000, stock: 0, images: ['c.png'] },
  { id: 3, name_vi: 'Đầm Dạ Hội', name_en: 'Evening Dress',
    price: 900000, sale_price: null, stock: 2, images: [] },
];

function setup(query) {
  const doc = makeDoc();
  const log = [];
  // page-search.js đọc DOM NGAY LÚC PARSE -> phần tử phải có sẵn trước khi nạp.
  ['search-input', 'search-title', 'results', 'no-result'].forEach(function (id) {
    doc.getElementById(id);
  });
  const r = load('page-search.js', {
    doc: doc,
    globals: {
      fetch: function (u) {
        log.push(['fetch', u]);
        return Promise.resolve({ ok: true, status: 200,
          json: function () { return Promise.resolve(CATALOG); } });
      },
    },
    window: {
      API_BASE: 'http://x', location: { search: query },
      __i18n: { current: 'vi', t: function (k, p) { return p ? k + JSON.stringify(p) : k; } },
      _injectAddToCartButtons: function () { log.push(['inject']); },
    },
  });
  r.acts = log;
  return r;
}
const g = (r, id) => r.doc.getElementById(id);

(async function () {
  console.log('page-search.js');

  // Không có từ khoá -> không được gọi API
  let r = setup('');
  eq('khong tu khoa -> hien loi nhac', g(r, 'search-title').textContent, 'sr.enterKeyword');
  eq('khong tu khoa -> KHONG goi fetch', r.acts.length, 0);

  // Gõ không dấu, nhiều từ, sai thứ tự
  r = setup('?q=quan%20nam%20suong');
  eq('doc DOM luc parse -> dien lai tu khoa vao o input',
     g(r, 'search-input').value, 'quan nam suong');
  await wait();
  eq('goi dung endpoint san pham that', r.acts[0][1], 'http://x/api/products');
  let html = g(r, 'results').innerHTML;
  check('go khong dau sai thu tu van khop "Quan Nam Ong Suong"', html.includes('data-id="1"'));
  eq('chi ra dung 1 ket qua', (html.match(/product-item/g) || []).length, 1);
  check('goi lai _injectAddToCartButtons cho card dung sau DOMContentLoaded',
        r.acts.some(function (x) { return x[0] === 'inject'; }));

  // Hết hàng + giá sale
  r = setup('?q=ao');
  await wait();
  html = g(r, 'results').innerHTML;
  check('stock=0 -> gan class is-soldout', html.includes('is-soldout'));
  check('co sale_price -> hien price-sale', html.includes('price-sale'));

  // Ảnh rỗng + ký tự đ
  r = setup('?q=dam');
  await wait();
  html = g(r, 'results').innerHTML;
  check('san pham khong co anh -> fallback img/breeze.png', html.includes('img/breeze.png'));
  check('go "dam" khop "Đầm" (xu ly chu d gach ngang)', html.includes('data-id="3"'));

  // Không khớp gì
  r = setup('?q=xyzkhongco');
  await wait();
  eq('khong khop -> hien khoi no-result', g(r, 'no-result').style.display, 'block');
  eq('khong khop -> danh sach rong', g(r, 'results').innerHTML, '');

  // Toàn bộ nằm trong IIFE, không được rò ra global
  ['t', 'lang', 'esc', 'formatPrice', 'norm', 'cardHTML', 'productName'].forEach(function (k) {
    eq('IIFE khong ro global: ' + k, typeof r.sandbox[k], 'undefined');
  });
})();
