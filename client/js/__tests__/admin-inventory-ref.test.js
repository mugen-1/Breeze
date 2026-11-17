/* Modal Lịch sử kho — cột Tham chiếu: đơn đã xoá hiện "#<id> (đã xoá)", gán bằng textContent.
   Chạy admin.js thật + i18n.js thật trên DOM giả (cùng cách dựng với admin-sizes.test.js). */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const { adminMe } = require('./helpers/me');
const i18n = load('i18n.js').win.__i18n;
i18n.current = 'vi';
const doc = makeDoc();
const XSS = '<img src=x onerror=alert(1)>';
const XSS_ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';
// Lớp bảo vệ thứ hai: render thẳng chuỗi độc hại, KHÔNG dựa vào việc server đã lọc ký tự
// (colorName chỉ nhận chữ/số/. _ -, size theo whitelist + CHECK — client vẫn phải tự escape).
const product = { id: 5, name_vi: 'Áo ' + XSS, slug: 'ao-nam', price: 100, stock: 10, category_id: 1, is_active: true };
const movements = [
  { id: 1, movement_type: 'ORDER_CHECKOUT', quantity_delta: -1, stock_before: 3, stock_after: 2,
    order_id: 7, order_reference_id: 7, order_code: 1005 },                    // đơn còn, có mã
  { id: 2, movement_type: 'ORDER_DELETE', quantity_delta: 2, stock_before: 2, stock_after: 4,
    order_id: null, order_reference_id: 9, order_code: null },                 // đơn đã bị xoá (FK SET NULL)
  { id: 3, movement_type: 'ORDER_CHECKOUT', quantity_delta: -1, stock_before: 4, stock_after: 3,
    order_id: 3, order_reference_id: 3, order_code: null },                    // đơn cũ còn, chưa có mã
  { id: 4, movement_type: 'ADMIN_ADJUSTMENT', quantity_delta: 1, stock_before: 3, stock_after: 4,
    order_id: null, order_reference_id: null, reason: XSS },                   // không gắn đơn -> lý do
  { id: 5, movement_type: 'ADMIN_ADJUSTMENT', quantity_delta: 0, stock_before: 4, stock_after: 4,
    order_id: null, order_reference_id: null, reason: null },
];
const buttons = {};
for (const kind of ['edit', 'sizes', 'colors', 'inventory']) {
  const btn = El('button'); btn.setAttribute('data-' + kind, '5');
  buttons['[data-' + kind + ']'] = [btn];
}
doc.getElementById('prod-body').querySelectorAll = s => buttons[s] || [];
// Như trình duyệt: mỗi marker data-inv-ref có trong HTML vừa render là 1 ô <td> thật.
let refCells = [];
const body = doc.getElementById('inventory-body');
body.querySelectorAll = s => {
  if (s !== '[data-inv-ref]') return [];
  refCells = [...body.innerHTML.matchAll(/<td data-inv-ref="(\d+)"><\/td>/g)].map(m => {
    const td = El('td'); td.setAttribute('data-inv-ref', m[1]); return td;
  });
  return refCells;
};
let auth, movementData = movements;
load('admin.js', { doc, deps: ['routes.js', 'utils-format.js'],
  globals: { setTimeout: () => 0, clearTimeout() {}, fetch: async () => ({ json: async () => [] }) },
  window: { __i18n: i18n, AuthHelper: {
    onChange(fn) { auth = fn; },
    apiFetch(url) {
      let data = {};
      if (url === '/api/me') data = adminMe();
      else if (url === '/api/categories') data = [];
      else if (url === '/api/admin/products') data = { products: [product] };
      else if (url.includes('inventory-movements')) data = { movements: movementData, total_pages: 1 };
      return Promise.resolve({ ok: true, status: 200, json: async () => data });
    },
  } },
});
(async function () {
  console.log('admin-inventory-ref.js');
  doc.fire('DOMContentLoaded'); auth({ uid: 'admin' }); await wait(50);
  buttons['[data-inventory]'][0].fire('click'); await wait();
  eq('mỗi dòng có đúng 1 ô Tham chiếu', refCells.length, movements.length);
  eq('cột Tham chiếu (vi): còn đơn / đã xoá / đơn cũ / lý do / trống', refCells.map(c => c.textContent),
    ['#1005', '#9 (đã xoá)', '#3', XSS, '—']);
  check('nhãn loại ORDER_DELETE (vi)', body.innerHTML.includes('Xoá đơn'));
  check('chữ tham chiếu KHÔNG đi qua innerHTML (gán bằng textContent)',
    !body.innerHTML.includes('(đã xoá)') && !body.innerHTML.includes('#1005') && !body.innerHTML.includes('<img'));
  eq('lý do có HTML hiện nguyên văn ở textContent, không thành thẻ', refCells[3].textContent, XSS);

  i18n.current = 'en';
  buttons['[data-inventory]'][0].fire('click'); await wait();
  eq('cột Tham chiếu (en): đơn đã xoá', refCells[1].textContent, '#9 (deleted)');
  check('nhãn loại ORDER_DELETE (en)', body.innerHTML.includes('Order deletion'));

  const UI = i18n.UI;
  check('khoá adm.invRefDeleted có cả vi lẫn en, cùng tham số {id}',
    UI.vi['adm.invRefDeleted'] === '#{id} (đã xoá)' && UI.en['adm.invRefDeleted'] === '#{id} (deleted)');
  check('khoá adm.inv.ORDER_DELETE có cả vi lẫn en',
    UI.vi['adm.inv.ORDER_DELETE'] === 'Xoá đơn' && UI.en['adm.inv.ORDER_DELETE'] === 'Order deletion');

  // --- XSS ở các cột/phần admin nhập tay còn lại: tiêu đề (tên sản phẩm), size, tên màu ---
  const title = doc.getElementById('inventory-title');
  eq('tiêu đề modal: tên sản phẩm độc hại hiện nguyên văn qua textContent',
    title.textContent, 'Inventory history — Áo ' + XSS);
  check('tiêu đề modal không gán qua innerHTML (không tạo thẻ img)', !title.innerHTML.includes('<img'));
  movementData = [{ id: 9, movement_type: 'VARIANT_TRANSFER_IN', quantity_delta: 1, stock_before: 0, stock_after: 1,
    order_id: null, order_reference_id: null, reason: null, size: XSS, color: XSS }];
  i18n.current = 'vi';
  buttons['[data-inventory]'][0].fire('click'); await wait();
  eq('tiêu đề modal (vi) vẫn nguyên văn', title.textContent, 'Lịch sử tồn kho — Áo ' + XSS);
  check('size độc hại được escape trong innerHTML', body.innerHTML.includes('Size: ' + XSS_ESCAPED));
  check('tên màu độc hại được escape trong innerHTML', body.innerHTML.includes('Màu: ' + XSS_ESCAPED));
  eq('size + màu: đúng 2 chỗ escape, không còn thẻ img nào trong bảng',
    [body.innerHTML.split(XSS_ESCAPED).length - 1, body.innerHTML.includes('<img')], [2, false]);
})();
