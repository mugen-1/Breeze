/* Trang "Nhập kho": js/admin-receipts.js (hàm thuần + DOM giả) và phần markup / i18n / gắn tab.
   DOM giả KHÔNG phân tích innerHTML, nên module dựng DOM bằng createElement + textContent; test duyệt cây phần tử để chứng
   minh dữ liệu (kể cả payload XSS) chỉ nằm ở textContent, nút thao tác đúng trạng thái + quyền, chống bấm 2 lần.
   Không kiểm được CSS / focus thật / trình duyệt thật — phần đó phải kiểm tay trên trình duyệt. */
const fs = require('fs');
const path = require('path');
const { check, eq, note } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { makeDoc } = require('./helpers/dom');
const { adminMe, staffMe } = require('./helpers/me');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error('KHÔNG đọc được ' + rel + ' — test phải FAIL, không skip');
  return fs.readFileSync(file, 'utf8');
};
const html = read('admin.html'), src = read('js/admin-receipts.js'), adminJs = read('js/admin.js'), css = read('css/admin-receipts.css');
console.log('admin-receipts.js');

const XSS = '<img src=x onerror=alert(1)>';
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });
const AT = '2026-11-26T17:30:00.000Z';
const SUPS = [{ id: 1, code: 'NCC-001', name: 'Vải ' + XSS, is_active: true }, { id: 2, code: 'NCC-002', name: 'Đã ngừng', is_active: false },
  { id: 3, code: 'NCC-003', name: 'Dệt BM', is_active: true }];
const actor = (id, extra) => Object.assign({ id, display_name: 'Nhân viên', email: null, deleted: false, at: AT }, extra || {});
const ITEMS = [{ id: 1, product_id: 5, variant_id: 52, name: 'Áo ' + XSS, sku: 'SKU-52', size: 'S', color: null, quantity: 10, unit_cost: 90000, line_total: 900000 },
  { id: 2, product_id: 8, variant_id: 81, name: 'Áo 8', sku: 'SKU-81', size: 'M', color: 'Đen', quantity: 4, unit_cost: 150000, line_total: 600000 }];
const receipt = (id, status, over) => Object.assign({ id, code: 'PN-' + String(id).padStart(6, '0'), status,
  supplier: { id: 1, code: 'NCC-001', name: 'Vải ' + XSS, is_active: true }, note: null, expected_date: '2026-12-05',
  reject_reason: null, cancel_reason: null, created_at: AT, updated_at: AT,
  actors: { created: actor(2), submitted: null, approved: null, rejected: null, received: null, cancelled: null },
  items: ITEMS, item_count: 2, total_quantity: 14, total_cost: 1500000 }, over || {});
const toRow = r => ({ id: r.id, code: r.code, status: r.status, supplier: r.supplier, item_count: r.item_count, total_quantity: r.total_quantity,
  total_cost: r.total_cost, expected_date: r.expected_date, created_at: r.created_at, updated_at: r.updated_at, created_by: r.actors.created });
const PRODUCTS = [{ id: 5, name_vi: 'Áo thun ' + XSS, slug: 'ao-thun', is_active: true }, { id: 0, name_vi: 'Túi cói', slug: 'tui-coi', is_active: false },
  { id: 8, name_vi: 'Áo size màu', slug: 'ao-8', is_active: true }];
const RECEIVABLE = {
  5: { status: 'ok', product: { id: 5, name_vi: 'Áo thun ' + XSS, slug: 'ao-thun', is_active: true, mode: 'size' }, variants: [
    { id: 52, sku: 'SKU-52', size: 'S', color_key: null, color_label: null, stock: 3, is_active: true, color_active: null },
    { id: 53, sku: 'SKU-53', size: 'M', color_key: null, color_label: null, stock: 0, is_active: false, color_active: null }] },
  0: { status: 'ok', product: { id: 0, name_vi: 'Túi cói', slug: 'tui-coi', is_active: false, mode: 'base' }, variants: [
    { id: 1, sku: 'BR-P0-BASE', size: null, color_key: null, color_label: null, stock: 4, is_active: true, color_active: null }] },
  8: { status: 'ok', product: { id: 8, name_vi: 'Áo size màu', slug: 'ao-8', is_active: true, mode: 'size_color' }, variants: [
    { id: 81, sku: 'SKU-81', size: 'M', color_key: 'den', color_label: 'Đen', stock: 2, is_active: true, color_active: false }] },
};
const ADMIN = adminMe().permissions, STAFF = staffMe().permissions;

function setup(opts) {
  opts = opts || {};
  const doc = makeDoc(); doc.body.classList.add('adm-authed');
  const i18n = load('i18n.js').win.__i18n; i18n.current = 'vi';
  const calls = [], toasts = [], native = [];
  const db = { receipts: opts.receipts || [receipt(1, 'draft'), receipt(2, 'pending'), receipt(3, 'approved'), receipt(4, 'received'), receipt(5, 'cancelled')] };
  const handlers = {};
  function defaultResponder(url, method, body) {
    if (handlers[method + ' ' + url]) return handlers[method + ' ' + url](body);
    if (url.startsWith('/api/admin/suppliers?')) return resp(200, { status: 'ok', page: 1, limit: 50, total: SUPS.length, totalPages: 1, suppliers: SUPS });
    if (url.startsWith('/api/admin/receipts?')) {
      return resp(200, { status: 'ok', page: 1, limit: 20, total: db.receipts.length, totalPages: 1, receipts: db.receipts.map(toRow) });
    }
    if (url === '/api/admin/products') return resp(200, { products: PRODUCTS });
    const rv = url.match(/^\/api\/admin\/receipts\/receivable-variants\?product_id=(\d+)$/);
    if (rv) return RECEIVABLE[rv[1]] ? resp(200, RECEIVABLE[rv[1]]) : resp(404, { status: 'error', code: 'RECEIPT_PRODUCT_NOT_FOUND' });
    const one = url.match(/^\/api\/admin\/receipts\/(\d+)$/);
    if (one && method === 'GET') {
      const r = db.receipts.find(x => x.id === Number(one[1]));
      return r ? resp(200, { status: 'ok', receipt: r }) : resp(404, { status: 'error', code: 'RECEIPT_NOT_FOUND' });
    }
    return resp(500, { status: 'error' });
  }
  const r = load('admin-receipts.js', { doc, deps: ['utils-format.js', 'utils-i18n.js'],
    globals: { confirm: (...x) => { native.push(['confirm', x]); return true; }, alert: (...x) => { native.push(['alert', x]); } },
    window: { __i18n: i18n, ProfileToast: msg => toasts.push(msg),
      confirm: (...x) => { native.push(['confirm', x]); return true; }, alert: (...x) => { native.push(['alert', x]); },
      AuthHelper: { apiFetch: (url, o) => {
        const method = (o && o.method) || 'GET', body = o && o.body ? JSON.parse(o.body) : null;
        calls.push({ url, method, body });
        return Promise.resolve(defaultResponder(url, method, body));
      } } } });
  doc.fire('DOMContentLoaded');
  const get = id => doc.getElementById(id);
  return { ...r, doc, get, i18n, calls, toasts, native, db, handlers, api: r.win.BreezeAdminReceipts, util: r.win.BreezeAdminReceipts.util };
}
const walk = (n, fn) => { fn(n); (n.children || []).forEach(c => walk(c, fn)); };
const allText = n => (n.textContent || '') + (n.children || []).map(allText).join('');
const findAll = (root, pred) => { const out = []; walk(root, n => { if (pred(n)) out.push(n); }); return out; };
const rows = r => r.get('rcp-body').children.filter(row => row.getAttribute('data-receipt-id') !== null);
const btn = (root, text) => findAll(root, n => n.tagName === 'BUTTON' && n.textContent === text)[0];
const actionKinds = r => r.get('rcp-detail-actions').children.map(b => b.getAttribute('data-rcp-action'));
const actionBtn = (r, kind) => r.get('rcp-detail-actions').children.find(b => b.getAttribute('data-rcp-action') === kind);
const posts = r => r.calls.filter(c => c.method !== 'GET');
const noInnerHtml = root => findAll(root, n => n.innerHTML !== '').length === 0;

(async function () {
  // ---- 1. Hàm thuần ----
  let r = setup();
  const U = r.util;
  eq('parseAmount: bỏ . , khoảng trắng; sai -> null', ['1.500.000', ' 25,000 ', '0', '12a', '', '-1', '1.5e3', 42, 1.5].map(U.parseAmount),
    [1500000, 25000, 0, null, null, null, null, 42, null]);
  eq('validateDraft hợp lệ', U.validateDraft({ supplierId: 1, expectedDate: '', note: '', items: [{ qty: '1', cost: '0' }] }), { rows: {} });
  eq('validateDraft sai: NCC, ngày, ghi chú, SL, giá', U.validateDraft({ supplierId: null, expectedDate: '05/12/2026', note: 'x'.repeat(501),
    items: [{ qty: '0', cost: '' }, { qty: '100001', cost: '1000000001' }, { qty: '2', cost: '5' }] }), {
    rows: { 0: { qty: 'admRcp.err.qty', cost: 'admRcp.err.cost' }, 1: { qty: 'admRcp.err.qty', cost: 'admRcp.err.cost' } },
    supplier: 'admRcp.err.supplier', expected_date: 'admRcp.err.expected_date', note: 'admRcp.err.note' });
  eq('validateDraft: không có dòng / quá 200 dòng', [U.validateDraft({ supplierId: 1, items: [] }).items,
    U.validateDraft({ supplierId: 1, items: Array.from({ length: 201 }, () => ({ qty: '1', cost: '1' })) }).items], ['admRcp.err.items', 'admRcp.err.tooMany']);
  eq('buildBody: số nguyên, ghi chú trim', U.buildBody({ supplierId: 3, expectedDate: '2026-12-05', note: ' n ',
    items: [{ product_id: 0, variant_id: 1, qty: '1.000', cost: '25.000.000', name: 'bỏ' }] }),
  { supplier_id: 3, note: 'n', expected_date: '2026-12-05', items: [{ product_id: 0, variant_id: 1, quantity: 1000, unit_cost: 25000000 }] });
  const E = U.serverError;
  eq('serverError: ITEMS_INVALID -> đúng dòng theo index + lý do', E(409, { code: 'RECEIPT_ITEMS_INVALID', items: [{ index: 1, reason: 'NOT_LEAF' },
    { index: 3, reason: 'PRODUCT_MISMATCH' }] }), { rows: { 1: 'admRcp.reason.NOT_LEAF', 3: 'admRcp.reason.PRODUCT_MISMATCH' }, general: 'admRcp.err.rowsInvalid' });
  eq('serverError: OVERFLOW / NCC ngừng / sai trạng thái / SL sai ở dòng / lý do / 403', [
    E(409, { code: 'RECEIPT_STOCK_OVERFLOW', items: [{ index: 0 }] }), E(409, { code: 'RECEIPT_SUPPLIER_INACTIVE' }),
    E(409, { code: 'RECEIPT_INVALID_STATE', current_status: 'received' }), E(400, { code: 'RECEIPT_INVALID_INPUT', field: 'quantity', index: 2 }),
    E(400, { code: 'RECEIPT_INVALID_INPUT', field: 'reason' }), E(403, { code: 'FORBIDDEN' })], [
    { rows: { 0: 'admRcp.reason.OVERFLOW' }, general: 'admRcp.err.rowsInvalid' }, { supplier: 'admRcp.err.supplierInactive' },
    { general: 'admRcp.err.state', state: 'received' }, { rows: { 2: 'admRcp.err.qty' }, general: 'admRcp.err.rowsInvalid' },
    { field: { name: 'reason', key: 'admRcp.err.reason' } }, { general: 'admRcp.err.forbidden' }]);
  const A = U.availableActions, adminCan = { create: true, approve: true, receive: true }, staffCan = { create: true, approve: false, receive: true };
  eq('nút theo trạng thái — admin', ['draft', 'pending', 'approved', 'received', 'cancelled'].map(s => A(s, adminCan)),
    [['edit', 'submit', 'cancel'], ['approve', 'reject', 'cancel'], ['receive', 'cancel'], [], []]);
  eq('nút theo trạng thái — staff (không duyệt / từ chối, không huỷ phiếu đã duyệt)', ['draft', 'pending', 'approved'].map(s => A(s, staffCan)),
    [['edit', 'submit', 'cancel'], ['cancel'], ['receive']]);
  eq('không quyền gì -> không nút', A('draft', {}), []);
  eq('listUrl', U.listUrl(2, 'pn-00 1', 'pending', '3'), '/api/admin/receipts?page=2&limit=20&status=pending&supplier_id=3&q=pn-00%201');
  eq('filterProducts: tên / slug / id, rỗng -> []', [U.filterProducts(PRODUCTS, 'áo').map(p => p.id), U.filterProducts(PRODUCTS, '8').map(p => p.id),
    U.filterProducts(PRODUCTS, 'AO-THUN').map(p => p.id), U.filterProducts(PRODUCTS, '  ')], [[5, 8], [8], [5], []]);
  eq('filterProducts: SP đang ẩn không hiện (theo id / tên / slug)', [U.filterProducts(PRODUCTS, '0'), U.filterProducts(PRODUCTS, 'túi'),
    U.filterProducts(PRODUCTS, 'TUI')], [[], [], []]);
  eq('ngày', [U.formatDate('2026-12-05'), U.formatDate(null), U.formatVnTime(AT)], ['05/12/2026', '—', '27/11/2026 00:30']);
  eq('người thao tác: đã xoá / có email / không tên', [U.actorText({ id: 9, deleted: true }), U.actorText({ id: 1, display_name: 'A', email: 'a@x.vn' }),
    U.actorText({ id: 7, display_name: null, email: null }), U.actorText(null)], ['Tài khoản đã xóa (#9)', 'A · a@x.vn', '#7', '—']);
  eq('cảnh báo', U.warnings({ productOff: true, variantOff: true, colorOff: true, invalid: true }),
    ['admRcp.warn.invalid', 'admRcp.warn.product', 'admRcp.warn.variant', 'admRcp.warn.color']);

  // ---- 2. Markup / CSP / CSS ----
  const ids = [...new Set([...src.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))];
  eq('mọi id script dùng có trong admin.html', ids.filter(id => !html.includes('id="' + id + '"')), []);
  for (const id of ['rcp-q', 'rcp-status', 'rcp-supplier', 'rcp-f-supplier', 'rcp-f-expected', 'rcp-f-note', 'rcp-product-q', 'rcp-action-reason']) {
    check('ô ' + id + ' có <label for>', html.includes('<label for="' + id + '"'));
  }
  for (const id of ['rcp-editor', 'rcp-detail', 'rcp-action']) {
    check('modal ' + id + ': role=dialog + aria-modal + aria-labelledby', new RegExp('id="' + id + '" role="dialog" aria-modal="true" aria-labelledby="' + id + '-title"').test(html));
  }
  check('hộp lỗi của modal có role=alert', ['rcp-editor-err', 'rcp-detail-err', 'rcp-action-err'].every(id => new RegExp('id="' + id + '" role="alert"').test(html)));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('script (bỏ chú thích) không dùng innerHTML / confirm() / alert() / eval', code.length > 20000 && !/innerHTML|\bconfirm\(|\balert\(|\beval\(|new Function/.test(code));
  check('script nạp sau admin-suppliers.js, trước admin.js; CSS sau admin-suppliers.css',
    html.includes('<script src="js/admin-receipts.js"></script>') && html.indexOf('js/admin-suppliers.js') < html.indexOf('js/admin-receipts.js')
    && html.indexOf('js/admin-receipts.js') < html.indexOf('js/admin.js') && html.indexOf('css/admin-suppliers.css') < html.indexOf('css/admin-receipts.css'));
  check('CSS: [hidden] thắng display trong trang + 3 modal', /#view-receipts \[hidden\], #rcp-editor \[hidden\], #rcp-detail \[hidden\], #rcp-action \[hidden\] \{ display:none !important; \}/.test(css));
  check('CSS: badge 5 trạng thái', ['draft', 'pending', 'approved', 'received', 'cancelled'].every(s => css.includes('.pill.rcp-st-' + s + ' {')));
  check('không handler inline trong markup Nhập kho', !/id="(rcp-[a-z_-]+|view-receipts)"[^>]*\son[a-z]+=/.test(html));
  check('admin.js gắn tab receipts (NAV_VIEWS, load với bản sao quyền, reset)', /receipts: 'view-receipts'/.test(adminJs)
    && /t === 'receipts' && window\.BreezeAdminReceipts\) window\.BreezeAdminReceipts\.load\(1, _perms\.slice\(\)\)/.test(adminJs)
    && /window\.BreezeAdminReceipts\.reset\(\)/.test(adminJs));
  const NAV = [...html.matchAll(/data-nav="([a-z]+)"(?: data-perm="([a-z_:|]+)")?/g)].map(m => [m[1], m[2] || null]);
  eq('mục Nhập kho ngay sau Nhà cung cấp, cần receipt:read', NAV.slice(2, 4), [['suppliers', 'supplier:read'], ['receipts', 'receipt:read']]);

  // ---- 3. i18n ----
  const UI = r.i18n.UI;
  const dyn = [].concat(['draft', 'pending', 'approved', 'received', 'cancelled'].map(s => 'admRcp.st.' + s),
    ['edit', 'submit', 'approve', 'reject', 'cancel', 'receive'].map(a => 'admRcp.act.' + a),
    ['submit', 'approve', 'reject', 'cancel', 'receive'].flatMap(a => ['admRcp.toast.' + a, 'admRcp.' + a + 'Title']),
    ['submit', 'approve', 'reject', 'cancel', 'receive'].map(a => 'admRcp.' + a + 'Msg'),
    ['created', 'submitted', 'approved', 'rejected', 'received', 'cancelled'].map(k => 'admRcp.actor.' + k),
    ['base', 'size', 'color', 'size_color'].map(m => 'admRcp.mode.' + m), ['NOT_FOUND', 'PRODUCT_MISMATCH', 'NOT_LEAF', 'OVERFLOW'].map(x => 'admRcp.reason.' + x),
    ['admRcp.err.expected_date', 'admRcp.err.note', 'admRcp.err.items']);
  const used = new Set([...src.matchAll(/'(admRcp\.[A-Za-z_.]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('.'))
    .concat([...html.matchAll(/data-i18n(?:-[a-z]+)?="(admRcp\.[A-Za-z_.]+)"/g)].map(m => m[1])).concat(dyn)
    .concat(['com.loading', 'com.cancel', 'com.close', 'adm.pgPage', 'adm.pgPrev', 'adm.pgNext']));
  eq('mọi khoá đang dùng có đủ VI và EN, không rỗng', [...used].filter(k => typeof UI.vi[k] !== 'string' || !UI.vi[k].trim()
    || typeof UI.en[k] !== 'string' || !UI.en[k].trim()), []);
  const ph = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  eq('placeholder giống nhau VI/EN', [...used].filter(k => ph(UI.vi[k]) !== ph(UI.en[k])), []);
  note(used.size + ' khoá kiểm VI/EN');

  // ---- 4. Danh sách (admin) ----
  r = setup();
  await r.api.load(1, ADMIN); await wait();
  eq('request: danh sách + NCC (status=all)', r.calls.map(c => c.url).sort(), ['/api/admin/receipts?page=1&limit=20&status=all',
    '/api/admin/suppliers?page=1&limit=50&status=all']);
  eq('5 dòng', rows(r).length, 5);
  eq('cột dòng 1: mã, NCC, số dòng, tổng SL, tổng tiền (₫), ngày', rows(r)[0].children.filter((_, i) => i !== 5 && i < 7).map(td => td.textContent),
    ['PN-000001', 'NCC-001 — Vải ' + XSS, '2', '14', '1.500.000₫', '27/11/2026 00:30']);
  eq('badge 5 màu', rows(r).map(x => [x.children[5].children[0].className, x.children[5].children[0].textContent]), [
    ['pill rcp-st rcp-st-draft', 'Nháp'], ['pill rcp-st rcp-st-pending', 'Chờ duyệt'], ['pill rcp-st rcp-st-approved', 'Đã duyệt'],
    ['pill rcp-st rcp-st-received', 'Đã nhận hàng'], ['pill rcp-st rcp-st-cancelled', 'Đã huỷ']]);
  check('mỗi dòng chỉ có nút Xem (aria-label kèm mã)', rows(r).every(x => findAll(x, n => n.tagName === 'BUTTON').length === 1)
    && rows(r)[0].children[7].children[0].getAttribute('aria-label') === 'Xem phiếu PN-000001');
  check('XSS chỉ ở textContent', allText(r.get('rcp-body')).includes(XSS) && noInnerHtml(r.get('rcp-body')));
  eq('ô lọc NCC: Tất cả + mọi NCC, NCC ngừng có hậu tố', r.get('rcp-supplier').children.map(o => o.textContent),
    ['Tất cả', 'NCC-001 — Vải ' + XSS, 'NCC-002 — Đã ngừng (đã ngừng)', 'NCC-003 — Dệt BM']);
  check('admin: nút Lập phiếu hiện', r.get('rcp-add').hidden === false);
  r.get('rcp-q').value = ' pn-0001 '; r.get('rcp-status').value = 'pending'; r.get('rcp-status').fire('change'); await wait();
  r.get('rcp-supplier').value = '2'; r.get('rcp-supplier').fire('change'); await wait();
  r.get('rcp-filter-form').fire('submit'); await wait();
  eq('lọc trạng thái + NCC + mã phiếu, về trang 1', r.calls[r.calls.length - 1].url, '/api/admin/receipts?page=1&limit=20&status=pending&supplier_id=2&q=pn-0001');

  // ---- 5. Chi tiết: nút theo trạng thái + quyền, lý do từ chối, tài khoản đã xoá ----
  r = setup({ receipts: [receipt(1, 'draft', { reject_reason: 'Sai giá ' + XSS, actors: { created: actor(9, { deleted: true, display_name: null }),
    submitted: actor(2), approved: null, rejected: actor(1, { display_name: 'Quản trị', email: 'admin@x.vn' }), received: null, cancelled: null } }),
  receipt(2, 'pending'), receipt(3, 'approved'), receipt(5, 'cancelled', { cancel_reason: 'Hết nhu cầu' })] });
  await r.api.load(1, ADMIN); await wait();
  rows(r)[0].children[7].children[0].click(); await wait();
  check('mở chi tiết: modal mở, focus nút Đóng', r.get('rcp-detail').classList.contains('open') && r.get('rcp-detail-close')._focused === true);
  eq('nháp từng bị từ chối: hộp lý do hiện, kèm người + thời điểm', [r.get('rcp-reject-box').hidden, r.get('rcp-reject-reason').textContent,
    r.get('rcp-reject-by').textContent], [false, 'Sai giá ' + XSS, 'Quản trị · admin@x.vn · 27/11/2026 00:30']);
  check('mốc "Lập phiếu" của tài khoản đã xoá -> "Tài khoản đã xóa"', allText(r.get('rcp-detail-actors')).includes('Tài khoản đã xóa (#9)'));
  eq('admin + nháp: Sửa / Gửi duyệt / Huỷ', actionKinds(r), ['edit', 'submit', 'cancel']);
  check('dòng hàng + tổng ở chi tiết', allText(r.get('rcp-detail-items')).includes('SKU-81') && r.get('rcp-detail-totals').textContent === 'Tổng: 2 dòng · 14 sản phẩm · 1.500.000₫');
  check('chi tiết không innerHTML', noInnerHtml(r.get('rcp-detail-info')) && noInnerHtml(r.get('rcp-detail-items')) && noInnerHtml(r.get('rcp-detail-actors')));
  r.get('rcp-detail-close').click();
  rows(r)[1].children[7].children[0].click(); await wait();
  eq('admin + chờ duyệt: Duyệt / Từ chối / Huỷ', actionKinds(r), ['approve', 'reject', 'cancel']);
  check('chờ duyệt không có hộp từ chối', r.get('rcp-reject-box').hidden === true);
  r.get('rcp-detail-close').click();
  rows(r)[3].children[7].children[0].click(); await wait();
  check('đã huỷ: không nút, hiện lý do huỷ', actionKinds(r).length === 0 && allText(r.get('rcp-detail-info')).includes('Hết nhu cầu'));
  r.get('rcp-detail-close').click();

  r = setup({ receipts: [receipt(2, 'pending'), receipt(3, 'approved')] });
  await r.api.load(1, STAFF); await wait();
  check('staff: có nút Lập phiếu (receipt:create)', r.get('rcp-add').hidden === false);
  rows(r)[0].children[7].children[0].click(); await wait();
  eq('staff + chờ duyệt: chỉ Huỷ (không Duyệt / Từ chối)', actionKinds(r), ['cancel']);
  r.get('rcp-detail-close').click();
  rows(r)[1].children[7].children[0].click(); await wait();
  eq('staff + đã duyệt: chỉ Nhận hàng (không Huỷ)', actionKinds(r), ['receive']);
  r.get('rcp-detail-close').click();

  // ---- 5b. Chi tiết: không còn khung trống (tiêu đề section / hộp từ chối) ở cả 5 trạng thái, admin lẫn staff ----
  const DETAIL_BLOCKS = ['rcp-reject-box', 'rcp-detail-info', 'rcp-detail-items-h', 'rcp-detail-items-wrap', 'rcp-detail-totals',
    'rcp-detail-actors-h', 'rcp-detail-actors'];
  const shown = r => DETAIL_BLOCKS.filter(id => r.get(id).hidden !== true);
  const ALL_STATUSES = () => [
    receipt(1, 'draft'),
    receipt(2, 'pending', { actors: { created: actor(2), submitted: actor(2), approved: null, rejected: null, received: null, cancelled: null } }),
    receipt(3, 'approved', { actors: { created: actor(2), submitted: actor(2), approved: actor(1), rejected: null, received: null, cancelled: null } }),
    receipt(4, 'received', { actors: { created: actor(2), submitted: actor(2), approved: actor(1), rejected: null, received: actor(2), cancelled: null } }),
    receipt(5, 'cancelled', { cancel_reason: 'Hết nhu cầu', actors: { created: actor(2), submitted: null, approved: null, rejected: null, received: null, cancelled: actor(1) } })];
  const FULL = ['rcp-detail-info', 'rcp-detail-items-h', 'rcp-detail-items-wrap', 'rcp-detail-totals', 'rcp-detail-actors-h', 'rcp-detail-actors'];
  for (const [role, perms] of [['admin', ADMIN], ['staff', STAFF]]) {
    r = setup({ receipts: ALL_STATUSES() });
    await r.api.load(1, perms); await wait();
    const seen = [];
    for (let i = 0; i < 5; i++) {
      rows(r)[i].children[7].children[0].click(); await wait();
      seen.push([r.db.receipts[i].status, shown(r), r.get('rcp-detail-items').children.length > 0, r.get('rcp-detail-actors').children.length > 0,
        r.get('rcp-detail-totals').textContent !== '']);
      r.get('rcp-detail-close').click();
    }
    eq(role + ': 5 trạng thái — không hộp từ chối; tiêu đề chỉ hiện khi khối của nó có nội dung',
      seen, ['draft', 'pending', 'approved', 'received', 'cancelled'].map(s => [s, FULL, true, true, true]));
  }
  r = setup({ receipts: [receipt(1, 'draft', { reject_reason: 'Sai giá' }), receipt(2, 'draft', { reject_reason: '   ' }),
    receipt(3, 'pending', { reject_reason: 'Lý do cũ' }),
    receipt(4, 'received', { items: [], item_count: 0, total_quantity: 0, total_cost: 0,
      actors: { created: null, submitted: null, approved: null, rejected: null, received: null, cancelled: null } })] });
  await r.api.load(1, STAFF); await wait();
  const emptyCases = [];
  for (let i = 0; i < 4; i++) {
    rows(r)[i].children[7].children[0].click(); await wait();
    emptyCases.push(shown(r));
    r.get('rcp-detail-close').click();
  }
  eq('hộp từ chối chỉ hiện khi nháp + lý do có chữ; khối rỗng -> ẩn cả tiêu đề lẫn khung', emptyCases, [
    ['rcp-reject-box'].concat(FULL), FULL, FULL, ['rcp-detail-info', 'rcp-detail-totals']]);
  const subRule = (css.match(/\.rcp-sub \{[^}]*\}/) || [''])[0];
  check('CSS .rcp-sub ghi đè h4 của global.css (không viền, không padding, chữ xám thắng #fff !important)',
    /border:none !important/.test(subRule) && /color:var\(--c-muted\) !important/.test(subRule) && /padding:0;/.test(subRule) && /display:block/.test(subRule));
  check('mọi h4 trong admin.html phần Nhập kho đều mang class rcp-sub',
    [...html.matchAll(/<h4\b[^>]*>/g)].map(m => m[0]).filter(t => /rcp-/.test(t)).every(t => /class="rcp-sub"/.test(t)));

  r = setup();
  await r.api.load(1, ['dashboard:read']); await wait();
  eq('không receipt:read -> không gọi API', r.calls.length, 0);

  // ---- 6. Lập phiếu: chọn NCC, tìm SP, biến thể lá + cảnh báo, dòng hàng, lỗi theo dòng ----
  r = setup({ receipts: [] });
  await r.api.load(1, ADMIN); await wait();
  r.get('rcp-add').click(); await wait();
  check('mở form lập phiếu', r.get('rcp-editor').classList.contains('open') && r.get('rcp-editor-title').textContent === 'Lập phiếu nhập');
  eq('ô NCC: chỉ NCC đang hợp tác', r.get('rcp-f-supplier').children.map(o => o.value), ['', '1', '3']);
  r.get('rcp-f-supplier').value = '1';
  r.get('rcp-product-q').value = 'áo'; r.get('rcp-product-q').fire('input');
  eq('kết quả tìm SP (theo tên)', findAll(r.get('rcp-product-results'), n => n.tagName === 'BUTTON').map(b => b.textContent.split(' (')[0]),
    ['Áo thun ' + XSS, 'Áo size màu']);
  r.get('rcp-product-q').value = 'tui'; r.get('rcp-product-q').fire('input');
  check('SP đang ẩn không hiện trong kết quả tìm', findAll(r.get('rcp-product-results'), n => n.tagName === 'BUTTON').length === 0
    && allText(r.get('rcp-product-results')).includes('Không có sản phẩm phù hợp'));
  r.get('rcp-product-q').value = 'ao-thun'; r.get('rcp-product-q').fire('input');
  findAll(r.get('rcp-product-results'), n => n.tagName === 'BUTTON')[0].click(); await wait();
  check('chọn SP -> gọi receivable-variants', r.calls.some(c => c.url === '/api/admin/receipts/receivable-variants?product_id=5'));
  eq('bảng biến thể lá: SKU / size / màu / tồn / cảnh báo', r.get('rcp-variants-body').children.map(row => row.children.slice(0, 5).map(td => allText(td))),
    [['SKU-52', 'S', '—', '3', '—'], ['SKU-53', 'M', '—', '0', 'Biến thể đang tắt']]);
  check('tiêu đề bảng biến thể có chế độ', r.get('rcp-variants-title').textContent.endsWith('Theo size'));
  btn(r.get('rcp-variants-body'), 'Thêm').click();
  btn(r.get('rcp-variants-body'), 'Thêm').click();
  eq('2 dòng hàng; nút đổi "Đã thêm" + khoá', [r.get('rcp-items-body').children.length, r.get('rcp-variants-body').children.map(row => {
    const b = findAll(row, n => n.tagName === 'BUTTON')[0]; return [b.textContent, b.disabled]; })], [2, [['Đã thêm', true], ['Đã thêm', true]]]);
  check('dòng biến thể tắt mang badge cảnh báo', allText(r.get('rcp-items-body').children[1]).includes('Biến thể đang tắt'));
  r.get('rcp-form').fire('submit'); await wait();
  eq('thiếu giá nhập -> lỗi đúng dòng, không gửi', [posts(r).length, r.get('rcp-items-body').children.map(row => row._cost.getAttribute('aria-invalid'))], [0, ['true', 'true']]);
  const [row0, row1] = r.get('rcp-items-body').children;
  row0._qty.value = '1.000'; row0._qty.fire('input'); row0._cost.value = '25.000.000'; row0._cost.fire('input');
  row1._cost.value = '0'; row1._cost.fire('input');
  eq('tổng phiếu cập nhật khi gõ', r.get('rcp-totals').textContent, 'Tổng: 2 dòng · 1.001 sản phẩm · 25.000.000.000₫');
  eq('thành tiền dòng 1', row0._total.textContent, '25.000.000.000₫');
  r.handlers['POST /api/admin/receipts'] = () => resp(409, { status: 'error', code: 'RECEIPT_ITEMS_INVALID', items: [{ index: 1, product_id: 5, variant_id: 53, reason: 'NOT_LEAF' }] });
  r.get('rcp-form').fire('submit'); await wait();
  eq('POST body đúng (số nguyên, bỏ dấu chấm)', posts(r)[0].body, { supplier_id: 1, note: '', expected_date: '', items: [
    { product_id: 5, variant_id: 52, quantity: 1000, unit_cost: 25000000 }, { product_id: 5, variant_id: 53, quantity: 1, unit_cost: 0 }] });
  eq('ITEMS_INVALID -> đúng dòng index 1 tô đỏ + lý do; hộp lỗi chung', [r.get('rcp-items-body').children.map(x => x.className),
    allText(r.get('rcp-items-body').children[1]).includes('Không còn là biến thể nhập kho hợp lệ.'), r.get('rcp-editor-err').textContent],
  [['', 'rcp-row-bad'], true, 'Có dòng hàng không hợp lệ — xem các dòng báo đỏ.']);
  r.handlers['POST /api/admin/receipts'] = () => resp(409, { status: 'error', code: 'RECEIPT_SUPPLIER_INACTIVE', field: 'supplier_id' });
  r.get('rcp-form').fire('submit'); await wait();
  eq('NCC ngừng -> lỗi ở ô NCC', [r.get('rcp-e-supplier').hidden, r.get('rcp-e-supplier').textContent, r.get('rcp-f-supplier').getAttribute('aria-invalid')],
    [false, 'Nhà cung cấp đã ngừng hợp tác, không lập phiếu mới được.', 'true']);
  const created = receipt(7, 'draft');
  r.handlers['POST /api/admin/receipts'] = () => resp(201, { status: 'ok', receipt: created });
  const n0 = posts(r).length;
  r.get('rcp-form').fire('submit'); r.get('rcp-form').fire('submit'); await wait();
  eq('bấm Lưu 2 lần liền -> chỉ 1 request', posts(r).length - n0, 1);
  check('lưu xong: đóng form, toast, mở chi tiết phiếu mới', !r.get('rcp-editor').classList.contains('open') && r.toasts.includes('Đã lưu nháp phiếu PN-000007')
    && r.get('rcp-detail').classList.contains('open') && r.get('rcp-detail-title').textContent === 'Phiếu nhập PN-000007');

  // ---- 7. Sửa phiếu nháp có NCC đã ngừng + dòng không còn hợp lệ ----
  const oldDraft = receipt(1, 'draft', { supplier: { id: 2, code: 'NCC-002', name: 'Đã ngừng', is_active: false },
    items: [ITEMS[0], { id: 3, product_id: 5, variant_id: 99, name: 'Áo cũ', sku: 'SKU-99', size: 'XL', color: null, quantity: 1, unit_cost: 1, line_total: 1 }] });
  r = setup({ receipts: [oldDraft] });
  await r.api.load(1, ADMIN); await wait();
  rows(r)[0].children[7].children[0].click(); await wait();
  actionBtn(r, 'edit').click(); await wait(); await wait();
  check('Sửa: đóng chi tiết, mở form "Sửa phiếu PN-000001"', !r.get('rcp-detail').classList.contains('open') && r.get('rcp-editor-title').textContent === 'Sửa phiếu PN-000001');
  eq('ô NCC: NCC đã ngừng hiện được vì là NCC hiện tại + gợi ý', [r.get('rcp-f-supplier').children.map(o => o.value), r.get('rcp-f-supplier').value,
    r.get('rcp-h-supplier').hidden], [['', '1', '2', '3'], '2', false]);
  eq('dòng có sẵn: SKU-99 không còn là lá -> đỏ "Không còn hợp lệ"', r.get('rcp-items-body').children.map(x => [x.className, allText(x).includes('Không còn hợp lệ')]),
    [['', false], ['rcp-row-bad', true]]);
  findAll(r.get('rcp-items-body').children[1], n => n.tagName === 'BUTTON')[0].click();
  r.handlers['PUT /api/admin/receipts/1'] = () => resp(200, { status: 'ok', receipt: oldDraft });
  r.get('rcp-form').fire('submit'); await wait();
  eq('PUT giữ NCC cũ, chỉ còn dòng hợp lệ', [posts(r)[0].url, posts(r)[0].body.supplier_id, posts(r)[0].body.items.map(i => i.variant_id)],
    ['/api/admin/receipts/1', 2, [52]]);

  // ---- 8. Từ chối / huỷ: lý do bắt buộc trong modal, không hộp thoại trình duyệt ----
  r = setup({ receipts: [receipt(2, 'pending')] });
  await r.api.load(1, ADMIN); await wait();
  rows(r)[0].children[7].children[0].click(); await wait();
  actionBtn(r, 'reject').click();
  check('modal từ chối: ô lý do hiện, focus ô lý do', r.get('rcp-action').classList.contains('open') && r.get('rcp-action-reason-wrap').hidden === false
    && r.get('rcp-action-reason')._focused === true && r.get('rcp-action-title').textContent === 'Từ chối phiếu PN-000002');
  r.get('rcp-action-ok').click(); await wait();
  eq('lý do trống -> báo lỗi, không gửi', [posts(r).length, r.get('rcp-action-reason-err').hidden], [0, false]);
  r.handlers['POST /api/admin/receipts/2/reject'] = body => resp(200, { status: 'ok', receipt: receipt(2, 'draft', { reject_reason: body.reason }) });
  r.get('rcp-action-reason').value = '  Sai giá  ';
  r.get('rcp-action-ok').click(); await wait();
  eq('POST /reject { reason trim }', posts(r).map(c => [c.url, c.body]), [['/api/admin/receipts/2/reject', { reason: 'Sai giá' }]]);
  check('từ chối xong: đóng modal, toast, chi tiết cập nhật (nháp + hộp lý do)', !r.get('rcp-action').classList.contains('open')
    && r.toasts.includes('Đã từ chối phiếu PN-000002') && r.get('rcp-reject-box').hidden === false);
  actionBtn(r, 'cancel').click();
  r.handlers['POST /api/admin/receipts/2/cancel'] = () => resp(409, { status: 'error', code: 'RECEIPT_INVALID_STATE', current_status: 'cancelled' });
  r.get('rcp-action-reason').value = 'x';
  const before = r.calls.length;
  r.get('rcp-action-ok').click(); await wait();
  check('sai trạng thái -> báo + tải lại chi tiết và danh sách', r.get('rcp-action-err').style.display === 'block'
    && allText(r.get('rcp-action-err')).includes('Phiếu đã đổi trạng thái (hiện là: Đã huỷ)')
    && r.calls.slice(before).some(c => c.method === 'GET' && c.url === '/api/admin/receipts/2'));
  r.get('rcp-action-cancel').click();

  // ---- 9. Nhận hàng: xác nhận liệt kê SL, kết quả tồn trước -> sau, chống bấm 2 lần ----
  r = setup({ receipts: [receipt(3, 'approved')] });
  await r.api.load(1, STAFF); await wait();
  rows(r)[0].children[7].children[0].click(); await wait();
  actionBtn(r, 'receive').click();
  eq('xác nhận nhận hàng: liệt kê SKU / size / màu / SL sẽ cộng', r.get('rcp-action-body').children.map(x => x.children.map(td => td.textContent)),
    [['SKU-52', 'Áo ' + XSS, 'S', '—', '+10'], ['SKU-81', 'Áo 8', 'M', 'Đen', '+4']]);
  check('nhận hàng: không ô lý do', r.get('rcp-action-reason-wrap').hidden === true);
  let release;
  r.handlers['POST /api/admin/receipts/3/receive'] = () => new Promise(res => { release = () => res(resp(200, { status: 'ok', receipt: receipt(3, 'received'),
    stock_changes: [{ product_id: 5, variant_id: 52, quantity: 10, stock_before: 3, stock_after: 13 }, { product_id: 8, variant_id: 81, quantity: 4, stock_before: 2, stock_after: 6 }] })); });
  r.get('rcp-action-ok').click(); r.get('rcp-action-ok').click(); await wait();
  check('đang gửi: nút khoá, chỉ 1 request', r.get('rcp-action-ok').disabled === true && r.get('rcp-action-cancel').disabled === true && posts(r).length === 1);
  release(); await wait();
  eq('kết quả: tồn trước -> sau từng biến thể', r.get('rcp-action-body').children.map(x => x.children.map(td => td.textContent)),
    [['SKU-52', 'Áo ' + XSS, 'S', '—', '3', '+10', '13'], ['SKU-81', 'Áo 8', 'M', 'Đen', '2', '+4', '6']]);
  check('kết quả: nút xác nhận ẩn, nút còn lại là Đóng, toast', r.get('rcp-action-ok').hidden === true && r.get('rcp-action-cancel').textContent === 'Đóng'
    && r.toasts.includes('Đã nhận hàng theo phiếu PN-000003'));
  r.get('rcp-action-ok').click(); await wait();
  eq('bấm lại sau khi xong -> không gửi thêm', posts(r).length, 1);
  r.get('rcp-action-cancel').click();
  eq('chi tiết sau khi nhận: không còn nút', actionKinds(r), []);
  eq('không lần nào gọi confirm() / alert() của trình duyệt', r.native, []);

  // ---- 9b. Mở từ popup Lịch sử tồn kho: chỉ xem, không cần mở tab Nhập kho trước ----
  let h = setup({ receipts: [receipt(3, 'approved')] });
  const trigger = { focus() { trigger._focused = true; }, isConnected: true };
  await h.api.openFromHistory(3, trigger, ADMIN); await wait();
  eq('openFromHistory: chỉ GET chi tiết (không tải danh sách / NCC)', h.calls.map(c => [c.method, c.url]), [['GET', '/api/admin/receipts/3']]);
  check('chi tiết mở, đủ dữ liệu', h.get('rcp-detail').classList.contains('open') && h.get('rcp-detail-title').textContent === 'Phiếu nhập PN-000003'
    && allText(h.get('rcp-detail-items')).includes('SKU-81'));
  eq('chỉ xem: không nút thao tác dù admin có đủ quyền', actionKinds(h), []);
  h.get('rcp-detail-close').click();
  check('đóng -> focus về nút mã phiếu trong popup', trigger._focused === true && !h.get('rcp-detail').classList.contains('open'));
  h = setup();
  await h.api.openFromHistory(3, null, STAFF.filter(p => p !== 'receipt:read')); await wait();
  eq('không receipt:read -> không mở, không gọi API', [h.calls.length, h.get('rcp-detail').classList.contains('open')], [0, false]);
  await h.api.openFromHistory('3', null, ADMIN); await h.api.openFromHistory(0, null, ADMIN);
  eq('id không hợp lệ -> bỏ qua', h.calls.length, 0);

  // ---- 10. Đổi ngôn ngữ / rời phiên ----
  r.i18n.current = 'en'; r.doc.fire('langchange');
  eq('EN: vẽ lại từ dữ liệu đã tải', rows(r)[0].children[5].children[0].textContent, 'Approved');
  const n = r.calls.length;
  r.api.reset();
  eq('reset: xoá bảng + bộ lọc, đóng modal, không gọi API', [rows(r).length, r.get('rcp-q').value, r.get('rcp-status').value,
    r.get('rcp-detail').classList.contains('open'), r.calls.length], [0, '', 'all', false, n]);
})();
