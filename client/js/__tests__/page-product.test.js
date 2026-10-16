/* page-product.js — chi tiết sản phẩm động theo ?id. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const fs = require('fs');
const path = require('path');
const productView = fs.readFileSync(path.join(__dirname, '../../../server/views/pages/product.ejs'), 'utf8');
const productPage = require('../../../server/lib/pages-config').product;
const guideHead = productView.match(/<thead>\s*<tr>([\s\S]*?)<\/tr>\s*<\/thead>/)[1];
const guideBody = productView.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];

const P = {
  id: 5, name_vi: 'Áo Sơ Mi', name_en: 'Shirt', description_vi: 'Mo ta', description_en: 'Desc',
  price: 300000, sale_price: 250000, stock: 7, category_slug: 'sanpham-ao',
  images: ['a.png', 'b.png'],
  available: true, size_configured: true,
  variants: ['S', 'M', 'L', 'XL'].map((size, i) => ({ id: 50 + i, size, available: true })),
};
const RELATED = [{ id: 9, name_vi: 'Quan', name_en: 'Pants', price: 100000, sale_price: null, images: ['q.png'] }];

function setup(url, product, related) {
  const doc = makeDoc();
  // Code đọc các phần tử này ngay lúc parse, không kiểm tra null.
  ['pd-root', 'pd-category', 'pd-name', 'pd-price', 'pd-desc', 'pd-detail',
   'pd-main-img', 'pd-gallery-empty', 'pd-prev', 'pd-next', 'pd-selection-status', 'pd-thumbs',
   'pd-sizes', 'sg-overlay', 'sg-open', 'sg-close', 'pd-related-list'].forEach(function (id) {
    doc.getElementById(id);
  });
  const addBtn = El('button');
  doc._qs['.pd-add'] = addBtn;
  doc._qs['.pd-size-head'] = El('div');
  doc._qs['.sg-table thead tr'] = El('tr');
  doc._qs['.sg-table tbody'] = El('tbody');
  doc._qs['.sg-table thead tr'].innerHTML = guideHead;
  doc._qs['.sg-table tbody'].innerHTML = guideBody;

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
                T: { vi: { page: { 'sanpham-ao': 'Áo', 'sanpham-giay': 'Giày & Dép', handbags: 'Túi Xách' },
                           cart: { add: 'Them vao gio' } },
                     en: { page: { 'sanpham-ao': 'Shirt', 'sanpham-giay': 'Shoes & Sandals', handbags: 'Handbags' },
                           cart: { add: 'Add to cart' } } } },
      _injectAddToCartButtons: function () { log.push(['inject']); },
    },
  });
  r.addBtn = addBtn; r.acts = log;
  return r;
}
const g = (r, id) => r.doc.getElementById(id);

(async function () {
  console.log('page-product.js');
  eq('bang size quan ao van du 4 hang tr', (guideBody.match(/<tr>/g) || []).length, 4);
  check('bang size quan ao khong the t loi', !/<\/?t>/.test(guideBody));
  const sizeCss = fs.readFileSync(path.join(__dirname, '../../../server/views/partials/product-style.ejs'), 'utf8');
  const sizeRules = (sizeCss.match(/\.pd-size(?=[\s.:{])[^{]*\{[^}]*\}/g) || []).join('\n');
  check('size button khong duong cheo/gach do', !/linear-gradient|line-through|::before|::after|rotate\(/.test(sizeRules));
  check('size button giu kich thuoc cu', /min-width: 54px/.test(sizeRules) && /height: 50px/.test(sizeRules));
  check('responsive co tablet va mobile rieng', /max-width: 1020px/.test(sizeCss) &&
    /max-width: 600px/.test(sizeCss) && /overflow-x: auto/.test(sizeCss));
  check('product co viewport va standards mode de breakpoint mobile dung thuc te',
    productPage.headVariant === 'standard' && productPage.closeHtml === true &&
    /overflow-x: clip/.test(sizeCss));
  check('layout co gallery nav va status accessible', /id="pd-prev"/.test(productView) &&
    /id="pd-next"/.test(productView) && /id="pd-selection-status"[^>]*role="status"/.test(productView));

  // Không có ?id
  let r = setup('', P);
  eq('khong co ?id -> bao khong tim thay', g(r, 'pd-name').textContent, 'T:pd.notFound');
  eq('khong co ?id -> khoa nut them gio', r.addBtn.disabled, true);
  eq('khong co ?id -> KHONG goi fetch', r.acts.length, 0);
  g(r, 'sg-open').fire('click');
  check('chua tai san pham -> khong mo bang size', !g(r, 'sg-overlay').classList.contains('open'));

  // id hợp lệ
  r = setup('?id=5', P, RELATED);
  await wait();
  eq('goi dung endpoint chi tiet', r.acts[0][1], 'http://x/api/products/5');
  eq('dien ten san pham', g(r, 'pd-name').textContent, 'Áo Sơ Mi');
  eq('danh muc lay tu i18n co san', g(r, 'pd-category').textContent, 'Áo');
  eq('mo ta that nam sau CTA', g(r, 'pd-desc').textContent, 'Mo ta');
  eq('co mo ta -> hien details', g(r, 'pd-detail').hidden, false);
  eq('dat document.title', r.sandbox.document.title, 'Áo Sơ Mi - BREEZE');
  eq('gan data-id cho addToCart (cart.js)', g(r, 'pd-root').getAttribute('data-id'), '5');
  eq('gan co sellable cho cart.js', g(r, 'pd-root').getAttribute('data-stock'), '1');
  eq('anh chinh lay anh dau tien', g(r, 'pd-main-img').src, 'a.png');
  eq('dung so thumbnail', g(r, 'pd-thumbs').children.length, 2);
  eq('main image khong stretch', /object-fit: contain/.test(sizeCss), true);
  eq('gallery nhieu anh -> navigation enabled', g(r, 'pd-next').disabled, false);
  check('co sale_price -> hien ca gia gach ngang lan gia sale',
        /line-through/.test(g(r, 'pd-price').innerHTML) && /price-sale/.test(g(r, 'pd-price').innerHTML));
  eq('danh muc ao -> size mac dinh S/M/L/XL', g(r, 'pd-sizes').innerHTML.match(/data-size="(\w+)"/g),
     ['data-size="S"', 'data-size="M"', 'data-size="L"', 'data-size="XL"']);
  eq('ao -> hien nut bang size', g(r, 'sg-open').style.display, '');
  eq('ao -> giu nguyen cac hang so do trong EJS', r.doc._qs['.sg-table tbody'].innerHTML, guideBody);
  eq('ao -> giu tieu de va khoa dich cua bang', r.doc._qs['.sg-table thead tr'].innerHTML, guideHead);
  eq('chua chon -> khong gan variant vao nut mua', g(r, 'pd-root').getAttribute('data-variant-id'), null);
  eq('chua chon size -> CTA disabled', r.addBtn.disabled, true);
  eq('chua chon size -> status huong dan', g(r, 'pd-selection-status').textContent, 'T:pd.selectSize');
  const chosen = El('button');
  chosen.setAttribute('data-variant-id', '51'); chosen._closest = { '.pd-size': chosen };
  g(r, 'pd-sizes').fire('click', { target: chosen });
  eq('chon M -> gan dung variant', g(r, 'pd-root').getAttribute('data-variant-id'), '51');
  eq('chon M -> metadata size M', g(r, 'pd-root').getAttribute('data-size'), 'M');
  eq('chon M -> status con hang', g(r, 'pd-selection-status').textContent, 'T:pd.inStock');
  const unavailable = El('button'); unavailable.disabled = true;
  unavailable.setAttribute('data-variant-id', '52'); unavailable._closest = { '.pd-size': unavailable };
  g(r, 'pd-sizes').fire('click', { target: unavailable });
  eq('disabled khong doi size da chon', g(r, 'pd-root').getAttribute('data-variant-id'), '51');
  eq('con hang -> nut la "them vao gio"', r.addBtn.textContent, 'T:pd.addToCart');
  eq('con hang -> nut khong bi khoa', r.addBtn.disabled, false);
  await wait();
  check('render san pham lien quan', /data-id="9"/.test(g(r, 'pd-related-list').innerHTML));
  check('goi lai _injectAddToCartButtons cho card lien quan',
        r.acts.some(function (x) { return x[0] === 'inject'; }));
  const relatedNoImage = setup('?id=5', P, [{ ...RELATED[0], images: [] }]); await wait();
  check('related khong co anh -> placeholder chu, khong anh gay',
    /pd-related-placeholder/.test(g(relatedNoImage, 'pd-related-list').innerHTML) &&
    !/img\/breeze\.png/.test(g(relatedNoImage, 'pd-related-list').innerHTML));

  let gallery = setup('?id=5', P); await wait();
  g(gallery, 'pd-thumbs').children[1].click();
  eq('click thumbnail doi anh chinh', g(gallery, 'pd-main-img').src, 'b.png');
  eq('thumbnail selected co aria-pressed', g(gallery, 'pd-thumbs').children[1].getAttribute('aria-pressed'), 'true');
  g(gallery, 'pd-next').click();
  eq('gallery next quay ve anh dau', g(gallery, 'pd-main-img').src, 'a.png');
  g(gallery, 'pd-prev').click();
  eq('gallery prev quay ve anh cuoi', g(gallery, 'pd-main-img').src, 'b.png');
  g(gallery, 'pd-main-img').fire('error');
  eq('anh loi -> chuyen sang anh hop le con lai', g(gallery, 'pd-main-img').src, 'a.png');
  g(gallery, 'pd-main-img').fire('error');
  eq('het anh -> placeholder khong broken', g(gallery, 'pd-gallery-empty').hidden, false);
  eq('het anh -> img an', g(gallery, 'pd-main-img').hidden, true);
  check('khong dung placeholder file thieu', !g(gallery, 'pd-main-img').src.includes('breeze.png'));

  // Tồn kho tổng không quyết định availability; exact variant mới là nguồn sự thật.
  let aggregateStale = setup('?id=5', { ...P, stock: 0, available: false });
  await wait();
  const staleSize = El('button');
  staleSize.setAttribute('data-variant-id', '51'); staleSize._closest = { '.pd-size': staleSize };
  g(aggregateStale, 'pd-sizes').fire('click', { target: staleSize });
  eq('variant con hang van mua duoc khi stock tong lech', aggregateStale.addBtn.disabled, false);
  eq('cart gate theo variant thay vi stock tong', g(aggregateStale, 'pd-root').getAttribute('data-stock'), '1');
  let c = setup('?id=5', { ...P, stock: 0, available: false,
    variants: P.variants.map(v => ({ ...v, available: false })) });
  await wait();
  eq('khong variant sellable -> khoa nut', c.addBtn.disabled, true);
  eq('khong variant sellable -> doi chu thanh het hang', c.addBtn.textContent, 'T:sr.soldOut');
  check('khong variant sellable -> gan class sold-out', c.addBtn.classList.contains('sold-out'));

  // Size theo danh mục
  const shoes = ['39', '40', '40.5', '41', '42', '42.5', '43', '44', '44.5', '45', '45.5', '46'];
  let cg = setup('?id=5', Object.assign({}, P, { category_slug: 'sanpham-giay',
    variants: shoes.map((size, i) => ({ id: 100 + i, size, available: i !== 0 })) }));
  await wait();
  eq('danh muc giay -> dung 12 size nam tu API',
     Array.from(g(cg, 'pd-sizes').innerHTML.matchAll(/data-size="([^"]+)"/g), m => m[1]), shoes);
  check('size giay khong co EU prefix', !/EU/.test(g(cg, 'pd-sizes').innerHTML));
  check('size het hang disabled khong duong cheo', /data-size="39"[^>]* disabled/.test(g(cg, 'pd-sizes').innerHTML));
  check('khong tu chon size', !/class="pd-size selected/.test(g(cg, 'pd-sizes').innerHTML));
  eq('giay -> van hien phan chon size', cg.doc._qs['.pd-size-head'].style.display, '');
  eq('giay -> an nut bang size', g(cg, 'sg-open').style.display, 'none');
  g(cg, 'sg-open').fire('click');
  check('giay -> khong mo modal ke ca kich hoat nut bang code', !g(cg, 'sg-overlay').classList.contains('open'));
  check('giay -> khong khoa cuon trang', cg.doc.body.style.overflow !== 'hidden');
  cg.sandbox.window.__i18n.current = 'en';
  cg.doc.fire('langchange');
  eq('giay -> doi ngon ngu van an bang size', g(cg, 'sg-open').style.display, 'none');

  let pants = setup('?id=5', Object.assign({}, P, { category_slug: 'sanpham-quan' }));
  await wait();
  eq('quan -> giu nguyen bang so do', pants.doc._qs['.sg-table tbody'].innerHTML, guideBody);
  eq('quan -> hien nut bang size', g(pants, 'sg-open').style.display, '');
  const inactive = setup('?id=5', { ...P, variants: [{ id: 99, size: 'XL', is_active: false, available: true }] });
  await wait();
  check('inactive size khong render', !g(inactive, 'pd-sizes').innerHTML.includes('XL'));
  g(pants, 'sg-open').fire('click');
  check('quan -> van mo duoc bang size', g(pants, 'sg-overlay').classList.contains('open'));

  let cj = setup('?id=5', Object.assign({}, P, { category_slug: 'handbags', size_configured: false,
    variants: [{ id: 5, size: null, available: true }] }));
  await wait();
  eq('danh muc tui xach -> an han o chon size', g(cj, 'pd-sizes').style.display, 'none');
  eq('danh muc tui xach -> an ca tieu de size', cj.doc._qs['.pd-size-head'].style.display, 'none');
  eq('BASE-only -> exact BASE gan tu API', g(cj, 'pd-root').getAttribute('data-variant-id'), '5');
  eq('BASE-only -> CTA enabled', cj.addBtn.disabled, false);

  const noImage = setup('?id=5', { ...P, images: [], description_vi: '', description_en: '' });
  await wait();
  eq('khong co anh -> placeholder BREEZE', g(noImage, 'pd-gallery-empty').hidden, false);
  eq('khong co mo ta -> an details', g(noImage, 'pd-detail').hidden, true);

  const colored = { ...P, color_configured: true, stock: 3,
    colors: [{ key:'den', label:'Đen', swatch_hex:'#000000', images:['black.png'], available:true },
      { key:'trang', label:'Trắng <script>', swatch_hex:null, images:[], available:false }],
    variants: [{ id:71, size:'M', color:'den', available:true },
      { id:72, size:'M', color:'trang', available:false }] };
  let cc = setup('?id=5', colored); await wait();
  check('color selector render va escape label', /data-color-key="den"/.test(g(cc,'pd-colors').innerHTML) &&
    /Trắng &lt;script&gt;/.test(g(cc,'pd-colors').innerHTML));
  eq('chua chon mau -> khong co size variant', g(cc,'pd-root').getAttribute('data-variant-id'), null);
  eq('size×color chua chon -> CTA disabled', cc.addBtn.disabled, true);
  eq('size×color chua chon -> status mau', g(cc,'pd-selection-status').textContent, 'T:pd.selectColor');
  const black = El('button'); black.setAttribute('data-color-key','den'); black._closest={'.pd-color':black};
  g(cc,'pd-colors').fire('click',{target:black});
  eq('chon Den -> gallery theo mau', g(cc,'pd-main-img').src, 'black.png');
  eq('chon Den -> status size', g(cc,'pd-selection-status').textContent, 'T:pd.selectSize');
  eq('chon Den -> thumbnail co anh rieng', g(cc,'pd-thumbs').children.length, 1);
  check('chon Den -> chi co size Den', /data-variant-id="71"/.test(g(cc,'pd-sizes').innerHTML) &&
    !/data-variant-id="72"/.test(g(cc,'pd-sizes').innerHTML));
  const blackM = El('button'); blackM.setAttribute('data-variant-id','71'); blackM._closest={'.pd-size':blackM};
  g(cc,'pd-sizes').fire('click',{target:blackM});
  eq('chon Den M -> exact variant', g(cc,'pd-root').getAttribute('data-variant-id'), '71');
  eq('chon Den M -> CTA enabled', cc.addBtn.disabled, false);
  g(cc,'pd-main-img').fire('error');
  eq('anh mau loi -> fallback gallery product', g(cc,'pd-main-img').src, 'a.png');
  const white = El('button'); white.setAttribute('data-color-key','trang'); white._closest={'.pd-color':white};
  g(cc,'pd-colors').fire('click',{target:white});
  eq('doi mau -> bo size da chon', g(cc,'pd-root').getAttribute('data-variant-id'), null);
  eq('mau chua co anh -> gallery fallback product', g(cc,'pd-main-img').src, 'a.png');
  check('mau het hang -> size disabled', /data-variant-id="72"[^>]* disabled/.test(g(cc,'pd-sizes').innerHTML));
  eq('mau het hang -> nut mua disabled', cc.addBtn.disabled, true);

  const brokenSwatch = setup('?id=5', colored); await wait();
  const failedThumb = El('img'); failedThumb.setAttribute('src', 'black.png');
  g(brokenSwatch, 'pd-colors').fire('error', { target: failedThumb });
  eq('thumbnail mau loi -> an anh hong', failedThumb.hidden, true);
  g(brokenSwatch, 'pd-colors').fire('click', { target: black });
  eq('anh mau loi truoc khi chon -> fallback product', g(brokenSwatch, 'pd-main-img').src, 'a.png');

  const colorOnly = { ...P, category_slug:'handbags', size_configured:false, color_configured:true,
    colors:[{ key:'den', label:'Đen', images:[], available:true }],
    variants:[{ id:73, size:null, color:'den', available:true }] };
  let co = setup('?id=5', colorOnly); await wait();
  eq('color-only -> an size', g(co,'pd-sizes').style.display, 'none');
  eq('color-only chua chon -> CTA disabled', co.addBtn.disabled, true);
  g(co,'pd-colors').fire('click',{target:black});
  eq('color-only -> chon mau gan variant', g(co,'pd-root').getAttribute('data-variant-id'), '73');
  eq('color-only chon mau -> CTA enabled', co.addBtn.disabled, false);

  // 404
  let c4 = setup('?id=99', 404);
  await wait();
  eq('API 404 -> bao khong tim thay', g(c4, 'pd-name').textContent, 'Không tìm thấy sản phẩm');
  eq('API 404 -> khoa nut', c4.addBtn.disabled, true);

  // Đổi ngôn ngữ
  r.sandbox.window.__i18n.current = 'en';
  r.doc.fire('langchange');
  eq('doi sang EN -> ten doi theo', g(r, 'pd-name').textContent, 'Shirt');
  eq('doi sang EN -> category doi theo', g(r, 'pd-category').textContent, 'Shirt');
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
