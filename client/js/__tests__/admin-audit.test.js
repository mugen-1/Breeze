/* Tab "Nhật ký hoạt động": js/admin-audit.js (hàm thuần + DOM giả) và phần gắn tab / quyền trong js/admin.js.
   DOM giả KHÔNG phân tích innerHTML, nên module dựng DOM bằng createElement + textContent; test duyệt cây phần tử để
   chứng minh dữ liệu (kể cả payload XSS) chỉ nằm ở textContent. Không kiểm được CSS / trình duyệt thật / CSP thật. */
const fs = require('fs');
const path = require('path');
const { check, eq, note } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const { adminMe, staffMe } = require('./helpers/me');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error('KHÔNG đọc được ' + rel + ' — test phải FAIL, không skip');
  return fs.readFileSync(file, 'utf8');
};
const html = read('admin.html'), auditJs = read('js/admin-audit.js');
console.log('admin-audit.js  (TZ=' + (process.env.TZ || '(mặc định máy)') + ', Intl máy: '
  + Intl.DateTimeFormat().resolvedOptions().timeZone + ')');

const XSS = ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "' onmouseover='alert(1)"];
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const page = (logs, extra) => Object.assign({ status: 'ok', page: 1, page_size: 50, total: logs.length, logs }, extra || {});
const ADMIN_LOGS = [
  { id: '3', created_at: '2026-03-15T16:30:00.000Z', actor_role: 'admin', actor_user_id: 1, actor_email: 'admin@example.test',
    actor_deleted: false, action: 'PRODUCT_UPDATE', entity_type: 'product', entity_id: '5',
    before: { price: 100 }, after: { price: 120 }, ip: '203.0.113.5', user_agent: 'UA/1.0' },
  { id: '2', created_at: '2026-03-15T17:30:00.000Z', actor_role: 'customer', actor_user_id: 9, actor_email: null,
    actor_deleted: true, action: 'ORDER_PLACE', entity_type: 'order', entity_id: '77', before: null,
    after: { order: { order_code: 1001, items_count: 2 } }, ip: null, user_agent: null },
  { id: '1', created_at: '2026-12-31T17:30:00.000Z', actor_role: 'cli', actor_user_id: null, actor_email: null,
    actor_deleted: false, action: 'ROLE_CHANGE', entity_type: 'user', entity_id: null, before: { user: { role: 'customer' } },
    after: { user: { role: 'staff' }, source: 'set-role' }, ip: null, user_agent: null },
];
const XSS_LOG = { id: '9', created_at: '2026-11-16T03:00:00.000Z', actor_role: 'customer' + XSS[0], actor_user_id: 4,
  actor_email: XSS[0], actor_deleted: false, action: 'WEIRD_' + XSS[1], entity_type: 'review', entity_id: XSS[1],
  before: { [XSS[0]]: XSS[1], review: { content: XSS[2] } }, after: { [XSS[0]]: XSS[2], list: [XSS[0]] },
  ip: XSS[2], user_agent: XSS[1] };
const stripStaff = l => { const c = Object.assign({}, l); delete c.ip; delete c.user_agent; return c; };

// ---------------- Khung 1: admin-audit.js riêng ----------------
function setupAudit(opts) {
  opts = opts || {};
  const doc = makeDoc(); doc.body.classList.add('adm-authed');
  const i18n = load('i18n.js').win.__i18n; i18n.current = opts.lang || 'vi';
  const calls = [], writes = [];
  let responder = opts.responder || (() => resp(200, page(ADMIN_LOGS)));
  const r = load('admin-audit.js', { doc, deps: ['utils-format.js', 'utils-i18n.js'],
    globals: { localStorage: { getItem: () => null, setItem: (...x) => writes.push(x) }, sessionStorage: { setItem: (...x) => writes.push(x) } },
    window: { __i18n: i18n, AuthHelper: { apiFetch: url => { calls.push(url); return Promise.resolve(responder(url)); } } } });
  doc.fire('DOMContentLoaded');
  const get = id => doc.getElementById(id);
  return { ...r, doc, get, i18n, calls, writes, api: r.win.BreezeAdminAudit, util: r.win.BreezeAdminAudit.util,
    respond: fn => { responder = fn; } };
}
const walk = (n, fn) => { fn(n); (n.children || []).forEach(c => walk(c, fn)); };
const allText = n => (n.textContent || '') + (n.children || []).map(allText).join('');
const findAll = (root, pred) => { const out = []; walk(root, n => { if (pred(n)) out.push(n); }); return out; };
const headLabels = r => r.get('audit-head').children.map(th => th.textContent);
const bodyRows = r => r.get('audit-body').children;
const dataRows = r => bodyRows(r).filter(row => row.className !== 'oi-detail');
const detailRows = r => bodyRows(r).filter(row => row.className === 'oi-detail');
const btnIn = (row, cls) => findAll(row, n => n.tagName === 'BUTTON' && String(n.className).includes(cls))[0];
const ADMIN_PERMS = ['audit:read_admin', 'audit:read_customer'], STAFF_PERMS = ['audit:read_customer'];

(async function () {
  // ---- 1. Giờ Việt Nam (formatToParts, ghép tay, không dấu phẩy) ----
  let r = setupAudit();
  const fmt = r.util.formatVnTime;
  eq('giờ VN: 16:30Z -> 23:30 cùng ngày', fmt('2026-03-15T16:30:00.000Z'), '15/03/2026 23:30:00');
  eq('giờ VN: 17:30Z -> 00:30 ngày hôm sau', fmt('2026-03-15T17:30:00.000Z'), '16/03/2026 00:30:00');
  eq('giờ VN: qua ranh giới năm', fmt('2026-12-31T17:30:00.000Z'), '01/01/2027 00:30:00');
  let threw = false, odd;
  try { odd = [fmt(null), fmt(undefined), fmt(''), fmt('chuỗi rác'), fmt('2026-02-30T00:00:00Z'), fmt('2026-13-01T00:00:00Z'), fmt({})]; }
  catch (e) { threw = true; }
  check('giờ VN: null / rác / ngày không tồn tại không ném lỗi', !threw);
  eq('giờ VN: null / rác / ngày không tồn tại -> —', odd, ['—', '—', '—', '—', '—', '—', '—']);
  check('mã nguồn: timeZone Asia/Ho_Chi_Minh + formatToParts + hourCycle h23',
    /timeZone: 'Asia\/Ho_Chi_Minh'/.test(auditJs) && /formatToParts/.test(auditJs) && /hourCycle: 'h23'/.test(auditJs));

  // ---- 2. Nhãn + fallback; quyết định giao diện theo permission ----
  const lab = r.util.labelOf;
  eq('nhãn VI: action / entity / role', [lab('action', 'ORDER_PLACE'), lab('entity', 'review'), lab('role', 'cli')],
    ['Đặt đơn hàng', 'Đánh giá', 'Dòng lệnh (CLI)']);
  eq('giá trị lạ -> nguyên chuỗi gốc, không lỗi', [lab('action', 'NEW_THING'), lab('role', 'robot'), lab('entity', XSS[0]), lab('action', null)],
    ['NEW_THING', 'robot', XSS[0], '']);
  const vo = r.util.viewOptions;
  eq('quyền: admin (cả 2) -> cột IP + ô chọn nhóm', vo(ADMIN_PERMS), { showIp: true, showUserAgent: true, showGroup: true, customerOnlyNote: false });
  eq('quyền: staff (chỉ read_customer) -> không IP, không nhóm, có dòng chú thích', vo(STAFF_PERMS),
    { showIp: false, showUserAgent: false, showGroup: false, customerOnlyNote: true });
  eq('quyền: chỉ read_admin -> có IP, KHÔNG ô chọn nhóm', vo(['audit:read_admin']), { showIp: true, showUserAgent: true, showGroup: false, customerOnlyNote: false });
  eq('quyền sai chính tả / thiếu -> như không quyền', [vo(['audit:read_admn']), vo(null)].map(o => [o.showIp, o.showGroup]), [[false, false], [false, false]]);

  // ---- 3. Làm phẳng + bảng so sánh ----
  const diff = r.util.diffRows;
  eq('before null (tạo mới) -> chỉ cột Sau', diff(null, { a: 1 }), { columns: ['after'], rows: [{ key: 'a', before: null, after: '1', changed: false }] });
  eq('after null (xoá) -> chỉ cột Trước', diff({ a: 1 }, null), { columns: ['before'], rows: [{ key: 'a', before: '1', after: null, changed: false }] });
  eq('cả hai null -> không cột, không dòng', diff(null, null), { columns: [], rows: [] });
  eq('cả hai {} -> không dòng', diff({}, {}).rows, []);
  eq('khoá lồng làm phẳng bằng dấu chấm; mảng -> JSON; null -> "null"; thiếu -> —; khác nhau -> changed',
    diff({ review: { rating: 4, tags: ['a', 'b'] }, gone: 'x', same: null }, { review: { rating: 5, tags: ['a', 'b'] }, same: null, extra: {} }).rows,
    [{ key: 'review.rating', before: '4', after: '5', changed: true }, { key: 'review.tags', before: '["a","b"]', after: '["a","b"]', changed: false },
      { key: 'gone', before: 'x', after: '—', changed: true }, { key: 'same', before: 'null', after: 'null', changed: false },
      { key: 'extra', before: '—', after: '{}', changed: true }]);
  eq('mảng ở cấp gốc -> khoá —', diff(null, [1, 2]).rows, [{ key: '—', before: null, after: '[1,2]', changed: false }]);

  // ---- 4. URL: staff không gửi group; "Tất cả" không gửi group ----
  const url = r.util.buildUrl;
  const F = { group: 'admin', actor_user_id: '', action: '', entity_type: '', entity_id: '', from: '', to: '' };
  eq('staff: không gửi group dù state có', url(F, 1, vo(STAFF_PERMS)), '/api/admin/audit-logs?page=1');
  eq('admin "Tất cả" -> không gửi group', url(Object.assign({}, F, { group: '' }), 1, vo(ADMIN_PERMS)), '/api/admin/audit-logs?page=1');
  eq('admin chọn nhóm + mã hoá giá trị', url(Object.assign({}, F, { group: 'customer', entity_type: 'order', entity_id: 'a&b=c' }), 2, vo(ADMIN_PERMS)),
    '/api/admin/audit-logs?group=customer&entity_type=order&entity_id=a%26b%3Dc&page=2');

  // ---- 5. DOM admin / staff / chỉ read_admin ----
  await r.api.load(1, ADMIN_PERMS); await wait();
  eq('admin: cột gồm IP', headLabels(r), ['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Chi tiết', 'IP']);
  eq('admin: có ô chọn nhóm, không dòng "chỉ khách"', [r.get('audit-group-wrap').hidden, r.get('audit-customer-note').hidden], [false, true]);
  eq('admin: request không gửi group khi "Tất cả"', r.calls.at(-1), '/api/admin/audit-logs?page=1');
  const rowsA = dataRows(r);
  eq('admin: 3 dòng, mỗi dòng 6 ô', rowsA.map(x => x.children.length), [6, 6, 6]);
  eq('thời gian hiển thị theo giờ VN', rowsA.map(x => x.children[0].textContent), ['15/03/2026 23:30:00', '16/03/2026 00:30:00', '01/01/2027 00:30:00']);
  eq('tài khoản đã xoá -> "Tài khoản đã xóa" + #id, ip null -> —', [allText(rowsA[1].children[1]), rowsA[1].children[5].textContent],
    ['Tài khoản đã xóaKhách hàng#9', '—']);
  eq('cli không id: chỉ pill vai trò; đối tượng không mã -> chỉ loại, không nút', [allText(rowsA[2].children[1]), allText(rowsA[2].children[3]),
    findAll(rowsA[2].children[3], n => n.tagName === 'BUTTON').length], ['—Dòng lệnh (CLI)', 'Tài khoản', 0]);
  eq('ip có giá trị hiện nguyên văn', rowsA[0].children[5].textContent, '203.0.113.5');
  check('pill vai trò dùng class có sẵn', String(findAll(rowsA[0], n => String(n.className).startsWith('pill'))[0].className) === 'pill role-admin');

  r = setupAudit({ responder: () => resp(200, page(ADMIN_LOGS.map(stripStaff))) });
  r.get('audit-group').value = 'admin';
  await r.api.load(1, STAFF_PERMS); await wait();
  eq('staff: KHÔNG có cột IP (không cột rỗng)', headLabels(r), ['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Chi tiết']);
  eq('staff: mỗi dòng 5 ô', dataRows(r).map(x => x.children.length), [5, 5, 5]);
  eq('staff: ẩn ô chọn nhóm, hiện "Chỉ hiển thị hoạt động của khách hàng"', [r.get('audit-group-wrap').hidden, r.get('audit-customer-note').hidden,
    r.get('audit-customer-note').textContent || 'admAudit.customerOnly'], [true, false, 'admAudit.customerOnly']);
  r.get('audit-filters').fire('submit'); await wait();
  eq('staff: bấm Lọc khi ô nhóm (ẩn) có giá trị -> vẫn không gửi group', r.calls.at(-1), '/api/admin/audit-logs?page=1');
  r.get('audit-body').children.forEach((row, i) => { if (row.className !== 'oi-detail') btnIn(row, 'audit-toggle').click(); });
  check('staff: hàng chi tiết không có user agent', !detailRows(r).some(d => allText(d).includes('User agent')));

  r = setupAudit();
  await r.api.load(1, ['audit:read_admin']); await wait();
  eq('chỉ read_admin: có cột IP, KHÔNG ô chọn nhóm, không dòng "chỉ khách"', [headLabels(r).includes('IP'), r.get('audit-group-wrap').hidden,
    r.get('audit-customer-note').hidden], [true, true, true]);

  // ---- 6. XSS: dữ liệu chỉ vào textContent ----
  r = setupAudit({ responder: () => resp(200, page([XSS_LOG])) });
  await r.api.load(1, ADMIN_PERMS); await wait();
  btnIn(dataRows(r)[0], 'audit-toggle').click();
  const tbody = r.get('audit-body');
  const ALLOWED_TAGS = ['TR', 'TD', 'TH', 'DIV', 'SPAN', 'BUTTON', 'TABLE', 'THEAD', 'TBODY', 'P'];
  const ALLOWED_ATTRS = ['type', 'aria-expanded', 'aria-controls', 'id', 'colspan', 'scope'];
  const nodes = findAll(tbody, () => true);
  eq('XSS: chỉ có thẻ do code tạo (không img / script)', [...new Set(nodes.map(n => n.tagName))].filter(t => !ALLOWED_TAGS.includes(t)), []);
  eq('XSS: không thuộc tính lạ / on*', [...new Set(nodes.flatMap(n => Object.keys(n._attrs)))].filter(a => !ALLOWED_ATTRS.includes(a) || /^on/i.test(a)), []);
  check('XSS: giá trị thuộc tính không chứa dữ liệu', nodes.every(n => Object.values(n._attrs).every(v => !/[<>"']|alert/.test(v))));
  check('XSS: không phần tử nào dùng innerHTML', nodes.every(n => n.innerHTML === ''));
  check('XSS: className không lấy từ dữ liệu (role lạ -> "pill")', nodes.every(n => !/alert|</.test(String(n.className))));
  const shown = allText(tbody);
  eq('XSS: email / entity_id / khoá / giá trị / action lạ / ip / user agent hiện NGUYÊN VĂN', [
    shown.includes(XSS[0]), shown.includes('Đánh giá #' + XSS[1]), shown.includes('WEIRD_' + XSS[1]), shown.includes(XSS[0] + XSS[1] + XSS[2]),
    shown.includes('review.content' + XSS[2]), shown.includes(JSON.stringify([XSS[0]])), shown.includes(XSS[2]), shown.includes('User agent: ' + XSS[1])],
    [true, true, true, true, true, true, true, true]);
  check('không ghi response ra storage / console', r.writes.length === 0 && !r.log.some(x => /^console/.test(x[0])));
  check('mã nguồn: không innerHTML, không inline on*, không console.log dữ liệu', !/\.innerHTML\s*=/.test(auditJs) && !/\bon[a-z]+\s*=\s*['"]/i.test(auditJs)
    && !/console\.(log|info|debug)/.test(auditJs) && !/localStorage|sessionStorage/.test(auditJs));

  // ---- 7. Hàng chi tiết: mở / đóng, bảng Khóa | Trước | Sau, nổi bật khác nhau ----
  r = setupAudit();
  await r.api.load(1, ADMIN_PERMS); await wait();
  const toggle = btnIn(dataRows(r)[0], 'audit-toggle');
  eq('chi tiết: mặc định đóng', [detailRows(r)[0].hidden, toggle.getAttribute('aria-expanded'), toggle.textContent], [true, 'false', 'Chi tiết']);
  toggle.click();
  eq('chi tiết: mở -> aria-expanded true, chữ "Ẩn chi tiết", trỏ đúng hàng', [detailRows(r)[0].hidden, toggle.getAttribute('aria-expanded'),
    toggle.textContent, toggle.getAttribute('aria-controls') === detailRows(r)[0].getAttribute('id')], [false, 'true', 'Ẩn chi tiết', true]);
  const d0 = detailRows(r)[0];
  check('chi tiết: id log, đối tượng, user agent (admin)', allText(d0).includes('Mã nhật ký: 3') && allText(d0).includes('Đối tượng: Sản phẩm #5')
    && allText(d0).includes('User agent: UA/1.0'));
  const diffTable = findAll(d0, n => n.className === 'audit-diff')[0];
  eq('chi tiết: bảng Khóa | Trước | Sau, dòng khác nhau được nổi bật', [diffTable.children[0].children[0].children.map(c => c.textContent),
    diffTable.children[1].children.map(row => [row.className, row.children.map(c => c.textContent)])],
  [['Khóa', 'Trước', 'Sau'], [['audit-changed', ['price', '100', '120']]]]);
  toggle.click();
  btnIn(dataRows(r)[1], 'audit-toggle').click();
  eq('before null -> chỉ cột Sau', findAll(detailRows(r)[1], n => n.className === 'audit-diff')[0].children[0].children[0].children.map(c => c.textContent),
    ['Khóa', 'Sau']);
  r.respond(() => resp(200, page([Object.assign({}, ADMIN_LOGS[0], { before: null, after: null }), Object.assign({}, ADMIN_LOGS[0], { id: '4', after: null })])));
  r.get('audit-filters').fire('submit'); await wait();
  dataRows(r).forEach(x => btnIn(x, 'audit-toggle').click());
  eq('cả hai null -> "Không có dữ liệu thay đổi"; after null -> chỉ cột Trước', [allText(detailRows(r)[0]).includes('Không có dữ liệu thay đổi'),
    findAll(detailRows(r)[1], n => n.className === 'audit-diff')[0].children[0].children[0].children.map(c => c.textContent)], [true, ['Khóa', 'Trước']]);

  // ---- 8. Phản hồi cũ đến sau không ghi đè ----
  const pending = [];
  r = setupAudit({ responder: u => new Promise(res => pending.push({ u, res })) });
  r.api.load(1, ADMIN_PERMS);
  r.get('audit-action').value = 'ORDER_DELETE';
  r.get('audit-filters').fire('submit');
  await wait();
  eq('2 request đang chờ', pending.map(p => p.u), ['/api/admin/audit-logs?page=1', '/api/admin/audit-logs?action=ORDER_DELETE&page=1']);
  pending[1].res(resp(200, page([ADMIN_LOGS[1]]))); await wait();
  pending[0].res(resp(200, page(ADMIN_LOGS))); await wait();
  eq('phản hồi cũ đến sau bị bỏ: bảng vẫn là phản hồi mới', dataRows(r).map(x => x.children[2].textContent), ['Đặt đơn hàng']);

  // ---- 9. Bộ lọc đã áp dụng là state riêng ----
  const many = Array.from({ length: 50 }, (_, i) => Object.assign({}, ADMIN_LOGS[0], { id: String(100 + i) }));
  r = setupAudit({ responder: () => resp(200, page(many, { total: 120 })) });
  await r.api.load(1, ADMIN_PERMS); await wait();
  r.get('audit-action').value = 'ORDER_PLACE'; r.get('audit-filters').fire('submit'); await wait();
  eq('Lọc: dùng giá trị ô', r.calls.at(-1), '/api/admin/audit-logs?action=ORDER_PLACE&page=1');
  eq('phân trang: "Trang 1 / 3 (120 bản ghi)", Trước khoá', [r.get('audit-pager').hidden, r.get('audit-page').textContent, r.get('audit-prev').disabled,
    r.get('audit-next').disabled], [false, 'Trang 1 / 3 (120 bản ghi)', true, false]);
  r.get('audit-actor').value = '99'; r.get('audit-action').value = 'ROLE_CHANGE';   // gõ dở, chưa bấm Lọc
  r.get('audit-next').click(); await wait();
  eq('gõ dở rồi sang trang sau -> vẫn dùng bộ lọc ĐÃ áp dụng', r.calls.at(-1), '/api/admin/audit-logs?action=ORDER_PLACE&page=2');
  btnIn(dataRows(r)[0], 'audit-entity-link').click(); await wait();
  eq('click đối tượng -> áp dụng ngay, giữ bộ lọc đã áp dụng khác, không đọc ô gõ dở', r.calls.at(-1),
    '/api/admin/audit-logs?action=ORDER_PLACE&entity_type=product&entity_id=5&page=1');
  eq('chip "Đang xem lịch sử" + 2 ô đối tượng được ghi', [r.get('audit-chip').hidden, r.get('audit-chip-text').textContent,
    r.get('audit-entity-type').value, r.get('audit-entity-id').value], [false, 'Đang xem lịch sử: Sản phẩm #5', 'product', '5']);
  r.get('audit-next').click(); await wait();
  eq('đổi trang giữ bộ lọc đối tượng', r.calls.at(-1), '/api/admin/audit-logs?action=ORDER_PLACE&entity_type=product&entity_id=5&page=2');
  r.get('audit-chip-clear').click(); await wait();
  eq('chip ✕ -> bỏ đối tượng, giữ action, về trang 1, xoá 2 ô', [r.calls.at(-1), r.get('audit-chip').hidden, r.get('audit-entity-type').value,
    r.get('audit-entity-id').value], ['/api/admin/audit-logs?action=ORDER_PLACE&page=1', true, '', '']);
  r.get('audit-clear').click(); await wait();
  eq('Xóa lọc -> áp dụng ngay, xoá mọi ô', [r.calls.at(-1), r.get('audit-actor').value, r.get('audit-action').value], ['/api/admin/audit-logs?page=1', '', '']);

  // ---- 10. from > to báo sớm, tự xoá khi áp dụng bộ lọc hợp lệ ----
  const before10 = r.calls.length;
  r.get('audit-from').value = '2026-03-20'; r.get('audit-to').value = '2026-03-10';
  r.get('audit-filters').fire('submit'); await wait();
  eq('from > to -> báo lỗi, không gửi request', [r.get('audit-filter-error').hidden, r.get('audit-filter-error').textContent, r.calls.length - before10],
    [false, 'Từ ngày phải trước hoặc bằng Đến ngày', 0]);
  r.get('audit-to').value = '2026-03-20'; r.get('audit-filters').fire('submit'); await wait();
  eq('bộ lọc hợp lệ -> dòng lỗi tự xoá, ngày gửi nguyên YYYY-MM-DD', [r.get('audit-filter-error').hidden, r.calls.at(-1)],
    [true, '/api/admin/audit-logs?from=2026-03-20&to=2026-03-20&page=1']);

  // ---- 11. Trạng thái ----
  const cases = [[() => resp(200, page([])), 'Không có nhật ký phù hợp'], [() => resp(401, {}), 'Phiên đăng nhập đã hết hạn — vui lòng đăng nhập lại.'],
    [() => resp(403, { status: 'error', code: 'FORBIDDEN', message: 'x' }), 'Bạn không có quyền xem nhật ký này'],
    [() => resp(400, { status: 'error', message: 'actor_user_id không hợp lệ' }), 'actor_user_id không hợp lệ'],
    [() => { throw new Error('offline'); }, 'Không tải được nhật ký. Kiểm tra kết nối. Thử lại']];
  for (const [fn, text] of cases) {
    r = setupAudit({ responder: fn });
    await r.api.load(1, ADMIN_PERMS); await wait();
    eq('trạng thái: ' + text.slice(0, 30), [allText(r.get('audit-body')), r.get('audit-pager').hidden], [text, true]);
  }
  r.get('audit-action').value = 'ORDER_DELETE'; r.get('audit-filters').fire('submit'); await wait();
  r.get('audit-action').value = 'ROLE_CHANGE';   // gõ dở
  r.respond(() => resp(200, page([ADMIN_LOGS[0]])));
  btnIn(r.get('audit-body').children[0], 'audit-retry').click(); await wait();
  eq('Thử lại -> bộ lọc đã áp dụng, không đọc ô gõ dở', [r.calls.at(-1), dataRows(r).length], ['/api/admin/audit-logs?action=ORDER_DELETE&page=1', 1]);
  r = setupAudit({ responder: () => new Promise(() => {}) });
  r.api.load(1, ADMIN_PERMS); await wait();
  eq('đang tải', allText(r.get('audit-body')), 'Đang tải…');
  r = setupAudit({ responder: () => resp(200, page([Object.assign({}, ADMIN_LOGS[0], { action: 'BRAND_NEW_ACTION', entity_type: 'coupon' })])) });
  threw = false;
  try { await r.api.load(1, ADMIN_PERMS); await wait(); } catch (e) { threw = true; }
  eq('action / entity_type lạ: không lỗi, hiện nguyên chuỗi', [threw, dataRows(r)[0].children[2].textContent, allText(dataRows(r)[0].children[3])],
    [false, 'BRAND_NEW_ACTION', 'coupon #5']);

  // ---- 12. Đổi VI/EN: vẽ lại từ dữ liệu đã tải, giữ hàng đang mở, không gọi API ----
  r = setupAudit();
  await r.api.load(1, ADMIN_PERMS); await wait();
  btnIn(dataRows(r)[1], 'audit-toggle').click();
  const callsBefore = r.calls.length;
  r.i18n.current = 'en'; r.doc.fire('langchange'); await wait();
  const t2 = btnIn(dataRows(r)[1], 'audit-toggle');
  eq('langchange: hàng vẫn mở, aria-expanded đúng, nhãn tiếng Anh, không gọi API', [detailRows(r)[1].hidden, t2.getAttribute('aria-expanded'),
    t2.textContent, headLabels(r)[0], dataRows(r)[1].children[2].textContent, r.calls.length - callsBefore],
  [false, 'true', 'Hide details', 'Time', 'Place order', 0]);
  eq('langchange: hàng khác vẫn đóng; ô chọn hành động đổi nhãn', [detailRows(r)[0].hidden, r.get('audit-action').children[1].textContent], [true, 'Create product']);
  r.get('audit-next').click(); r.get('audit-filters').fire('submit'); await wait();
  check('áp dụng bộ lọc mới -> đóng hết hàng chi tiết', detailRows(r).every(d => d.hidden));
  r.api.reset();
  eq('reset (rời phiên) -> xoá dữ liệu và bộ lọc', [bodyRows(r).length, r.get('audit-action').value], [0, '']);

  // ---- 13. ACTIONS / ENTITY_TYPES khớp server; khoá i18n đủ VI + EN, placeholder giống nhau ----
  const serverAudit = read('../server/lib/audit.js');
  const block = (name) => {
    const m = serverAudit.match(new RegExp('const ' + name + ' = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)'));
    if (!m) throw new Error('KHÔNG cắt được ' + name + ' từ server/lib/audit.js — test phải FAIL');
    return [...m[1].matchAll(/'([A-Za-z_]+)'/g)].map(x => x[1]);
  };
  eq('16 ACTIONS khớp server/lib/audit.js (đúng thứ tự)', r.util.ACTIONS, block('ACTIONS'));
  eq('ENTITY_TYPES khớp server', r.util.ENTITY_TYPES, block('ENTITY_TYPES'));
  eq('ô chọn hành động: Tất cả + 16 hành động theo thứ tự ACTIONS', r.get('audit-action').children.map(o => o.value), [''].concat(block('ACTIONS')));
  const UI = r.i18n.UI;
  const used = new Set([...auditJs.matchAll(/'(admAudit\.[A-Za-z]+)'/g)].map(m => m[1])
    .concat([...html.matchAll(/data-i18n(?:-[a-z]+)?="(admAudit\.[A-Za-z.]+)"/g)].map(m => m[1]))
    .concat(r.util.ACTIONS.map(a => 'admAudit.action.' + a), r.util.ENTITY_TYPES.map(e => 'admAudit.entity.' + e),
      r.util.ROLES.map(x => 'admAudit.role.' + x), ['pf.sessionExpired', 'adm.pgPrev', 'adm.pgNext']));
  const missing = [...used].filter(k => typeof UI.vi[k] !== 'string' || !UI.vi[k].trim() || typeof UI.en[k] !== 'string' || !UI.en[k].trim());
  eq('mọi khoá admAudit.* đang dùng có đủ VI và EN, không rỗng', missing, []);
  const ph = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  eq('placeholder {type} {id} {page} {pages} {total} giống nhau VI/EN', [...used].filter(k => ph(UI.vi[k]) !== ph(UI.en[k])), []);
  eq('placeholder đúng như mong đợi', [ph(UI.vi['admAudit.viewing']), ph(UI.vi['admAudit.pageInfo'])], ['id,type', 'page,pages,total']);
  note(used.size + ' khoá kiểm VI/EN');

  // ---- 14. Gắn tab vào admin.js: danh sách tab, firstPermittedView, đóng mặc định ----
  const NAV = [...html.matchAll(/<button type="button" class="adm-nav-item[^"]*" data-nav="([a-z]+)"(?: data-perm="([a-z_:|]+)")?/g)].map(m => [m[1], m[2] || null]);
  eq('tab auditlog nằm CUỐI menu, data-perm 2 quyền', NAV.at(-1), ['auditlog', 'audit:read_admin|audit:read_customer']);
  const adminJs = read('js/admin.js');
  const views = adminJs.match(/var NAV_VIEWS = \{([\s\S]*?)\};/);
  check('auditlog là mục CUỐI của NAV_VIEWS', !!views && /auditlog: 'view-auditlog'\s*\/\/[^\n]*\s*$/.test(views[1]));
  function setupAdmin(me) {
    const doc = makeDoc(), g = id => doc.getElementById(id), calls = [];
    const navs = NAV.map(([nav, perm]) => { const b = El('button'); b.classList.add('adm-nav-item'); b.setAttribute('data-nav', nav);
      if (perm) b.setAttribute('data-perm', perm); if (nav === 'dashboard') { b.classList.add('active'); b.setAttribute('aria-current', 'page'); } return b; });
    doc._qsa['.adm-nav-item'] = navs; doc._qsa['[data-perm]'] = navs;
    doc.querySelector = s => s === '.adm-nav-item.active' ? navs.find(n => n.classList.contains('active')) || null : null;
    let auth;
    const i18n = load('i18n.js').win.__i18n; i18n.current = 'vi';
    load('admin.js', { doc, deps: ['routes.js', 'utils-format.js', 'order-shipping.js', 'utils-i18n.js', 'order-payment.js', 'admin-audit.js'],
      globals: { setTimeout: () => 0, clearTimeout() {}, fetch: async () => ({ json: async () => [] }) },
      window: { location: { href: 'admin.html', pathname: '/admin.html', search: '' }, __i18n: i18n,
        AuthHelper: { onChange(fn) { auth = fn; }, apiFetch(u) { calls.push(u);
          const data = u === '/api/me' ? me : u.startsWith('/api/admin/audit-logs') ? page([]) : { orders: [], products: [], users: [], total: 0, total_pages: 1, current: {}, dailyRevenue: [] };
          return Promise.resolve({ ok: true, status: 200, json: async () => data }); } } } });
    doc.fire('DOMContentLoaded');
    return { doc, g, calls, navs, visible: () => navs.filter(n => !n.hidden).map(n => n.getAttribute('data-nav')),
      active: () => { const a = navs.find(n => n.classList.contains('active')); return g('view-profile').style.display === 'block' ? 'profile' : a && a.getAttribute('data-nav'); },
      login: async () => { auth({ uid: 'u1' }); await wait(50); } };
  }
  const OLD_TABS = ['dashboard', 'products', 'orders', 'statistics', 'users', 'reviews', 'blacklist', 'feedback'];
  for (const [who, me] of [['admin', adminMe()], ['staff', staffMe()]]) {
    const a = setupAdmin(me); await a.login();
    eq(who + ': tab như trước + auditlog', a.visible(), OLD_TABS.concat('auditlog'));
    eq(who + ': mở trang vẫn vào Tổng quan (firstPermittedView không đổi)', a.active(), 'dashboard');
  }
  const cases14 = [[['product:read', 'order:read'], 'products', ['products', 'orders']], [['user:read', 'audit:read_customer'], 'users', ['users', 'blacklist', 'auditlog']],
    [['audit:read_customer'], 'auditlog', ['auditlog']], [['audit:read_admin'], 'auditlog', ['auditlog']],
    [['audit:read_admn', 'audit_read_customer', 'audit:read_admin '], 'profile', []], [[], 'profile', []]];
  for (const [perms, first, vis] of cases14) {
    const a = setupAdmin({ role: 'staff', permissions: perms }); await a.login();
    eq('firstPermittedView + tab hiện với ' + JSON.stringify(perms), [a.active(), a.visible()], [first, vis]);
    if (first === 'auditlog') check('mở tab Nhật ký -> gọi API audit với quyền từ /api/me', a.calls.some(u => u.startsWith('/api/admin/audit-logs?')));
  }
  note('quyền sai chính tả -> tab ẩn (đóng mặc định)');
})();
