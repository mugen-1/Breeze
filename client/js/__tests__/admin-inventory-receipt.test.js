/* Popup Lịch sử tồn kho — dòng "Nhập hàng từ NCC" (PURCHASE_RECEIPT): nhãn VI / EN, mã phiếu ở cột Tham chiếu;
   có receipt:read -> nút mở chi tiết phiếu (BreezeAdminReceipts.openFromHistory, chỉ xem), không quyền -> chữ.
   Chạy admin.js thật + i18n.js thật trên DOM giả (cùng cách dựng với admin-inventory-ref.test.js). Phần chi tiết chỉ xem
   của admin-receipts.js: admin-receipts.test.js. */
const fs = require('fs');
const path = require('path');
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const { adminMe } = require('./helpers/me');

const XSS = '<img src=x onerror=alert(1)>';
const product = { id: 0, name_vi: 'Áo thun', slug: 'ao-thun', price: 100, stock: 10, category_id: 1, is_active: true };
const MOVES = [
  { id: 9, movement_type: 'PURCHASE_RECEIPT', size: 'S', color: null, quantity_delta: 10, stock_before: 3, stock_after: 13,
    order_id: null, order_reference_id: null, reason: null, receipt_id: 12, receipt_code: 'PN-000012' },
  { id: 8, movement_type: 'PURCHASE_RECEIPT', size: 'M', color: 'Đen', quantity_delta: 5, stock_before: 0, stock_after: 5,
    order_id: null, order_reference_id: null, reason: null, receipt_id: 12, receipt_code: 'PN-000012' + XSS },
  { id: 7, movement_type: 'PURCHASE_RECEIPT', size: null, color: null, quantity_delta: 1, stock_before: 5, stock_after: 6,
    order_id: null, order_reference_id: null, reason: null, receipt_id: 13, receipt_code: null },
  { id: 6, movement_type: 'ORDER_CHECKOUT', quantity_delta: -1, stock_before: 6, stock_after: 5,
    order_id: 7, order_reference_id: 7, order_code: 1005, receipt_id: null, receipt_code: null },
  { id: 5, movement_type: 'ADMIN_ADJUSTMENT', quantity_delta: 1, stock_before: 5, stock_after: 6,
    order_id: null, order_reference_id: null, reason: 'Kiểm kê' },                       // DB chưa có 029: không có 2 khoá receipt_*
];

function setup(me) {
  const i18n = load('i18n.js').win.__i18n; i18n.current = 'vi';
  const doc = makeDoc();
  const buttons = {};
  for (const kind of ['edit', 'sizes', 'colors', 'inventory']) {
    const btn = El('button'); btn.setAttribute('data-' + kind, '0');
    buttons['[data-' + kind + ']'] = [btn];
  }
  doc.getElementById('prod-body').querySelectorAll = s => buttons[s] || [];
  let refCells = [];
  const body = doc.getElementById('inventory-body');
  body.querySelectorAll = s => {
    if (s !== '[data-inv-ref]') return [];
    refCells = [...body.innerHTML.matchAll(/<td data-inv-ref="(\d+)"><\/td>/g)].map(m => {
      const td = El('td'); td.setAttribute('data-inv-ref', m[1]); return td;
    });
    return refCells;
  };
  const opened = [];
  let auth;
  load('admin.js', { doc, deps: ['routes.js', 'utils-format.js'],
    globals: { setTimeout: () => 0, clearTimeout() {}, fetch: async () => ({ json: async () => [] }) },
    window: { __i18n: i18n,
      BreezeAdminReceipts: { openFromHistory: (id, trigger, perms) => { opened.push({ id, trigger, perms }); return Promise.resolve(); },
        reset() {}, load() { return Promise.resolve(); } },
      AuthHelper: {
        onChange(fn) { auth = fn; },
        apiFetch(url) {
          let data = {};
          if (url === '/api/me') data = me;
          else if (url === '/api/categories') data = [];
          else if (url === '/api/admin/products') data = { products: [product] };
          else if (url.includes('inventory-movements')) data = { movements: MOVES, total_pages: 1 };
          return Promise.resolve({ ok: true, status: 200, json: async () => data });
        },
      } },
  });
  return { doc, body, i18n, opened, buttons, cells: () => refCells,
    open: async () => { doc.fire('DOMContentLoaded'); auth({ uid: 'u' }); await wait(50); buttons['[data-inventory]'][0].fire('click'); await wait(); } };
}
const btnIn = cell => cell.children.find(c => c.tagName === 'BUTTON');

(async function () {
  console.log('admin-inventory-receipt.js');
  // ---- có receipt:read (admin) ----
  let r = setup(adminMe());
  await r.open();
  eq('mỗi dòng 1 ô Tham chiếu', r.cells().length, MOVES.length);
  check('nhãn loại "Nhập hàng từ NCC" (vi), 3 dòng', r.body.innerHTML.split('Nhập hàng từ NCC').length - 1 === 3);
  check('size / màu của dòng nhập vẫn hiện', r.body.innerHTML.includes('Size: S') && r.body.innerHTML.includes('Màu: Đen'));
  const [c0, c1, c2, c3, c4] = r.cells();
  const b0 = btnIn(c0);
  eq('có mã phiếu + có quyền -> nút "link" mang mã phiếu', [!!b0, b0 && b0.textContent, b0 && b0.className, b0 && b0.type],
    [true, 'PN-000012', 'inv-receipt-link', 'button']);
  eq('nút có aria-label + aria-haspopup', [b0.getAttribute('aria-label'), b0.getAttribute('aria-haspopup')], ['Xem phiếu nhập PN-000012', 'dialog']);
  eq('mã phiếu chứa ký tự HTML: chỉ ở textContent của nút, không tạo thẻ', [btnIn(c1).textContent, btnIn(c1).innerHTML,
    r.body.innerHTML.includes('PN-000012')], ['PN-000012' + XSS, '', false]);
  eq('thiếu receipt_code -> "#<receipt_id>" dạng chữ, không nút', [c2.textContent, !!btnIn(c2)], ['#13', false]);
  eq('dòng loại khác giữ nguyên tham chiếu (đơn / lý do; DB chưa có 029 vẫn chạy)', [c3.textContent, c4.textContent, !!btnIn(c3), !!btnIn(c4)],
    ['#1005', 'Kiểm kê', false, false]);
  b0.click();
  eq('bấm mã phiếu -> openFromHistory(id phiếu, nút, BẢN SAO quyền)', r.opened.map(o => [o.id, o.trigger === b0, Array.isArray(o.perms),
    o.perms.includes('receipt:read')]), [[12, true, true, true]]);

  // ---- EN ----
  r.i18n.current = 'en';
  r.buttons['[data-inventory]'][0].fire('click'); await wait();
  check('nhãn loại EN "Supplier receipt"', r.body.innerHTML.includes('Supplier receipt'));
  eq('aria-label EN', btnIn(r.cells()[0]).getAttribute('aria-label'), 'View stock receipt PN-000012');

  // ---- không có receipt:read -> chỉ chữ ----
  const noReceipt = adminMe(); noReceipt.permissions = noReceipt.permissions.filter(p => !p.startsWith('receipt:'));
  r = setup(noReceipt);
  await r.open();
  eq('không receipt:read: mã phiếu là chữ, không nút', [r.cells()[0].textContent, !!btnIn(r.cells()[0]), r.cells()[1].textContent],
    ['PN-000012', false, 'PN-000012' + XSS]);
  eq('không mở được chi tiết', r.opened.length, 0);

  // ---- i18n + markup ----
  const UI = r.i18n.UI;
  check('adm.inv.PURCHASE_RECEIPT + adm.invReceiptAria có đủ VI / EN, cùng tham số', UI.vi['adm.inv.PURCHASE_RECEIPT'] === 'Nhập hàng từ NCC'
    && UI.en['adm.inv.PURCHASE_RECEIPT'] === 'Supplier receipt' && /\{code\}/.test(UI.vi['adm.invReceiptAria']) && /\{code\}/.test(UI.en['adm.invReceiptAria']));
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'admin.html'), 'utf8');
  check('modal chi tiết phiếu nằm SAU popup tồn kho trong DOM (cùng z-index -> phủ lên trên)',
    html.indexOf('id="inventory-modal"') > 0 && html.indexOf('id="rcp-detail"') > html.indexOf('id="inventory-modal"'));
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'admin-receipts.css'), 'utf8');
  check('CSS: nút mã phiếu có focus rõ', /\.inv-receipt-link:focus-visible \{ outline:2px solid var\(--c-ink\)/.test(css));
})();
