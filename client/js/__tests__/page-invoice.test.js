/* page-invoice.js — hoá đơn để in.
   Trang này KHÔNG dùng html2pdf.js: nút "In hoá đơn" gọi window.print() của trình
   duyệt, bố cục bản in do @media print trong <style> của invoice.html lo. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { makeDoc } = require('./helpers/dom');

const ORDER = {
  id: 42, user_id: 3, shipping_name: 'Nguyen A', shipping_phone: '0900',
  shipping_address: 'So 1, HCM', created_at: '2026-07-05T08:00:00Z',
  payment_method: 'cod', total_amount: 450000, discount_amount: 50000, voucher_code: 'SALE50',
  items: [{ product_name: 'Ao <b>x</b>', quantity: 2, unit_price: 250000, line_total: 500000 }],
};

function setup(search, res) {
  const doc = makeDoc();
  // Khớp markup thật: 3 phần tử này có sẵn thuộc tính hidden trong invoice.html.
  ['inv-discount-row', 'inv-content', 'inv-actions'].forEach(function (id) {
    doc.getElementById(id).hidden = true;
  });
  const acts = [];
  let onChangeCb = null;
  const r = load('page-invoice.js', {
    deps: ['routes.js', 'utils-format.js', 'utils-i18n.js'],
    doc: doc,
    window: {
      location: { search: search },
      __i18n: { current: 'vi', t: function (k, p) { return p ? k + JSON.stringify(p) : k; } },
      AuthHelper: {
        onChange: function (cb) { onChangeCb = cb; },
        apiFetch: function (p) {
          acts.push(['api', p]);
          const x = res || { ok: true, status: 200, body: {} };
          return Promise.resolve({ ok: x.ok !== false, status: x.status || 200,
            json: function () { return Promise.resolve(x.body || {}); } });
        },
      },
    },
  });
  r.acts = acts;
  doc.fire('DOMContentLoaded');
  r.login = function (u) { return onChangeCb && onChangeCb(u); };
  return r;
}
const g = (r, id) => r.doc.getElementById(id);
const donCo = (body) => ({ body: { orders: [body] } });

(async function () {
  console.log('page-invoice.js');

  // Chưa đăng nhập / id sai
  let r = setup('?orderId=42');
  r.login(null); await wait();
  check('chua dang nhap -> hien loi nhac dang nhap',
        g(r, 'inv-state').innerHTML.indexOf('inv.needLogin') === 0);
  eq('chua dang nhap -> KHONG goi API', r.acts.length, 0);

  r = setup('?orderId=abc');
  r.login({ uid: 'u' }); await wait();
  eq('orderId khong phai so -> bao id sai', g(r, 'inv-state').innerHTML, 'inv.badId');
  eq('orderId khong phai so -> KHONG goi API', r.acts.length, 0);

  // Đơn hợp lệ
  r = setup('?orderId=42', donCo(ORDER));
  r.login({ uid: 'u' }); await wait();
  eq('goi dung endpoint tra cuu don', r.acts[0][1], '/api/admin/orders?q=42&limit=1');
  eq('ten khach hang', g(r, 'inv-customer').textContent, 'Nguyen A');
  eq('ngay dinh dang dd-mm-yyyy', g(r, 'inv-date').textContent, '05-07-2026');
  eq('ma don co dau #', g(r, 'inv-id').textContent, '#42');
  eq('tam tinh = tong line_total', g(r, 'inv-subtotal').textContent, '500.000₫');
  eq('giam gia hien dau tru', g(r, 'inv-discount').textContent, '−50.000₫');
  eq('TONG lay total_amount THAT tu DB (khong phai tam tinh)',
     g(r, 'inv-total').textContent, '450.000₫');
  eq('hinh thuc thanh toan dich qua khoa pay.*', g(r, 'inv-payment').textContent, 'pay.cod');
  check('escapeHtml chan the HTML trong ten san pham',
        g(r, 'inv-items').innerHTML.includes('&lt;b&gt;') && !g(r, 'inv-items').innerHTML.includes('<b>'));
  eq('tai xong -> hien noi dung', g(r, 'inv-content').hidden, false);
  eq('tai xong -> hien nut in', g(r, 'inv-actions').hidden, false);
  eq('dat document.title theo ma don', r.sandbox.document.title, 'inv.docTitleN{"id":42}');

  /* Ẩn/hiện dòng giảm giá phải dựa trên GIÁ TRỊ, không phải sự tồn tại của field.
     Điều kiện thật trong code: if (discount > 0 || o.voucher_code) */
  const cases = [
    ['field discount_amount VANG MAT',   function (o) { delete o.discount_amount; o.voucher_code = null; }, true],
    ['field TON TAI, gia tri so 0',      function (o) { o.discount_amount = 0;     o.voucher_code = null; }, true],
    ['field TON TAI, chuoi "0"',         function (o) { o.discount_amount = '0';   o.voucher_code = null; }, true],
    ['giam 0 NHUNG co voucher_code',     function (o) { o.discount_amount = 0;     o.voucher_code = 'FREESHIP'; }, false],
    ['giam > 0',                         function (o) { o.discount_amount = 50000; o.voucher_code = null; }, false],
  ];
  for (const [ten, sua, phaiAn] of cases) {
    const o = JSON.parse(JSON.stringify(ORDER));
    sua(o);
    const c = setup('?orderId=42', donCo(o));
    c.login({ uid: 'u' }); await wait();
    const an = g(c, 'inv-discount-row').hidden === true;
    eq('dong giam gia — ' + ten + ' -> ' + (phaiAn ? 'AN' : 'HIEN'), an, phaiAn);
  }

  // Không tìm thấy đơn / không đủ quyền
  let c5 = setup('?orderId=99', { body: { orders: [] } });
  c5.login({ uid: 'u' }); await wait();
  eq('khong tim thay don -> bao dung ma', g(c5, 'inv-state').innerHTML, 'inv.notFound{"id":"99"}');

  let c6 = setup('?orderId=42', { ok: false, status: 403 });
  c6.login({ uid: 'u' }); await wait();
  eq('HTTP 403 -> bao khong du quyen', g(c6, 'inv-state').innerHTML, 'inv.forbidden');
  eq('HTTP 403 -> KHONG hien nut in', g(c6, 'inv-actions').hidden, true);

  // Đổi ngôn ngữ -> dựng lại từ đơn đã nhớ
  r.sandbox.window.__i18n.t = function (k) { return 'EN:' + k; };
  r.doc.fire('langchange');
  eq('langchange -> ve lai noi dung da sinh', r.sandbox.document.title, 'EN:inv.docTitleN');

  ['render', 'load', 'fmtDateVN'].forEach(function (k) {
    eq('IIFE khong ro global: ' + k, typeof r.sandbox[k], 'undefined');
  });
  // money nay la global DUNG CHUNG tu utils-format.js (TASK 4) — phai co, khong phai ro ri.
  eq('money la global dung chung tu utils-format.js', typeof r.sandbox.money, 'function');
  eq('esc la global dung chung tu utils-format.js', typeof r.sandbox.esc, 'function');
  eq('t la global dung chung tu utils-i18n.js', typeof r.sandbox.t, 'function');
})();
