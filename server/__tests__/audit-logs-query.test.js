'use strict';

// phần thuần của GET /api/admin/audit-logs: lib/audit-logs-query.js (kiểm tham số, dựng SQL, đổi dòng ra JSON).
// Route + SQL giả: audit-logs-routes.test.js; SQL thật: scripts/verify-audit-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../db')] = { exports: { sql: require('mssql') } };
const { PAGE_SIZE, parseAuditQuery, buildAuditQuery, toLogDto, vnDayStart, vnDayEnd } = require('../lib/audit-logs-query');

const ADMIN = { canReadAdmin: true }, STAFF = { canReadAdmin: false };
const DEFAULTS = { group: null, action: null, entityType: null, entityId: null, actorUserId: null, actorEmail: null,
  start: null, end: null, page: 1 };
const ok = (query, who = ADMIN) => { const r = parseAuditQuery(query, who); assert.equal(r.ok, true, JSON.stringify(r)); return r.filters; };
const bad = (query, message, who = ADMIN) => assert.deepEqual(parseAuditQuery(query, who), { ok: false, error: message }, JSON.stringify(query));

test('không tham số -> mặc định: không lọc, page 1; cỡ trang cố định 50', () => {
  assert.deepEqual(ok({}), DEFAULTS);
  assert.deepEqual(ok(undefined), DEFAULTS);
  assert.equal(PAGE_SIZE, 50);
});

test('tham số rỗng = không truyền; tham số lạ (limit, page_size) bị bỏ qua', () => {
  assert.deepEqual(ok({ group: '', action: '', entity_type: '', entity_id: '', actor_user_id: '', actor_email: '', from: '', to: '', page: '' }), DEFAULTS);
  assert.deepEqual(ok({ limit: '1000', page_size: '5', sort: 'asc' }), DEFAULTS);
  assert.equal(ok({ actor_email: '   ' }).actorEmail, null, 'email chỉ có khoảng trắng -> sau trim là rỗng');
});

test('giá trị hợp lệ của từng tham số', () => {
  assert.deepEqual(ok({ group: 'admin', action: 'ORDER_DELETE', entity_type: 'order', entity_id: ' 12 ', actor_user_id: '2147483647',
    actor_email: '  Admin@Example.TEST ', page: '3' }),
  { ...DEFAULTS, group: 'admin', action: 'ORDER_DELETE', entityType: 'order', entityId: ' 12 ', actorUserId: 2147483647,
    actorEmail: 'Admin@Example.TEST', page: 3 });
  assert.equal(ok({ group: 'customer' }).group, 'customer');
  assert.equal(ok({ entity_type: 'review', entity_id: 'x'.repeat(50) }).entityId.length, 50);
  assert.equal(ok({ actor_email: 'a'.repeat(255) }).actorEmail.length, 255);
});

test('from / to theo giờ VN: from = 00:00 VN (17:00 UTC hôm trước), to tính HẾT ngày; cho phép 1 phía; from = to hợp lệ', () => {
  const f = ok({ from: '2026-11-16', to: '2026-11-16' });
  assert.deepEqual([f.start.toISOString(), f.end.toISOString()], ['2026-11-15T17:00:00.000Z', '2026-11-16T17:00:00.000Z']);
  assert.deepEqual([ok({ from: '2026-11-16' }).end, ok({ to: '2026-11-16' }).start], [null, null]);
  assert.equal(ok({ to: '2026-12-31' }).end.toISOString(), '2026-12-31T17:00:00.000Z');
  assert.deepEqual([vnDayStart('2028-02-29').toISOString(), vnDayEnd('2028-02-29').toISOString()],
    ['2028-02-28T17:00:00.000Z', '2028-02-29T17:00:00.000Z']);
});

test('mọi tham số sai -> lỗi đúng câu thông báo', () => {
  for (const group of ['x', 'Admin', 'CUSTOMER', 'all', ' admin']) bad({ group }, 'group không hợp lệ');
  for (const action of ['product_update', 'NOPE', 'PRODUCT_UPDATE ']) bad({ action }, 'action không hợp lệ');
  for (const entity_type of ['Order', 'payment', 'order ']) bad({ entity_type }, 'entity_type không hợp lệ');
  bad({ entity_type: 'order', entity_id: 'x'.repeat(51) }, 'entity_id không hợp lệ');
  bad({ entity_id: '12' }, 'entity_id cần đi kèm entity_type');
  for (const actor_user_id of ['0', '-1', '+5', '05', '5.0', ' 5', '5 ', '1e3', '2147483648', 'abc', '0x10'])
    bad({ actor_user_id }, 'actor_user_id không hợp lệ');
  bad({ actor_email: 'a'.repeat(256) }, 'actor_email không hợp lệ');
  for (const from of ['2026-2-1', '2026/02/01', '2026-02-30', '2027-02-29', '2026-13-01', '16-11-2026', 'hôm nay'])
    bad({ from }, 'from/to phải đúng định dạng YYYY-MM-DD');
  bad({ to: '2026-04-31' }, 'from/to phải đúng định dạng YYYY-MM-DD');
  bad({ from: '2026-11-17', to: '2026-11-16' }, 'from phải nhỏ hơn hoặc bằng to');
  bad({ from: '0000-01-01' }, 'Ngày ngoài phạm vi SQL Server hỗ trợ');
  bad({ from: '0001-01-01' }, 'Ngày ngoài phạm vi SQL Server hỗ trợ');
  for (const page of ['0', '-1', '1.5', 'abc', '2147483648', '01']) bad({ page }, 'page không hợp lệ');
});

test('tham số lặp (mảng) / không phải chuỗi -> lỗi', () => {
  for (const name of ['group', 'action', 'entity_type', 'entity_id', 'actor_user_id', 'actor_email', 'from', 'to', 'page']) {
    bad({ entity_type: 'order', [name]: ['a', 'b'] }, name + ' không hợp lệ');
    bad({ entity_type: 'order', [name]: { x: '1' } }, name + ' không hợp lệ');
  }
});

test('staff (không audit:read_admin): group luôn là customer — kể cả group=admin / rỗng / không gửi; group sai vẫn 400', () => {
  for (const q of [{}, { group: '' }, { group: 'admin' }, { group: 'customer' }]) assert.equal(ok(q, STAFF).group, 'customer', JSON.stringify(q));
  bad({ group: 'x' }, 'group không hợp lệ', STAFF);
});

test('buildAuditQuery: chỉ chỗ giữ chỗ @..., giá trị nằm trong params (không nối chuỗi); sắp xếp + trang 50 cố định', () => {
  const XSS = "x' OR 1=1 --<img src=x onerror=alert(1)>";
  const f = ok({ group: 'admin', action: 'ROLE_CHANGE', entity_type: 'user', entity_id: XSS.slice(0, 40), actor_user_id: '7',
    actor_email: XSS, from: '2026-11-01', to: '2026-11-16', page: '2' });
  const { sql, params } = buildAuditQuery(f, ADMIN);
  for (const v of [XSS, XSS.slice(0, 40), 'ROLE_CHANGE', "'user'"]) assert.ok(!sql.includes(v), 'không nối giá trị vào SQL: ' + v);
  assert.deepEqual(params.map(p => [p.name, p.value instanceof Date ? p.value.toISOString() : p.value]), [
    ['action', 'ROLE_CHANGE'], ['entity_type', 'user'], ['entity_id', XSS.slice(0, 40)], ['actor_user_id', 7], ['actor_email', XSS],
    ['from_utc', '2026-10-31T17:00:00.000Z'], ['to_utc', '2026-11-16T17:00:00.000Z'], ['offset', 50]]);
  assert.match(sql, /^SELECT COUNT\(\*\) AS total FROM dbo\.audit_logs l LEFT JOIN dbo\.users u ON u\.id = l\.actor_user_id WHERE /);
  assert.match(sql, /ORDER BY l\.created_at DESC, l\.id DESC OFFSET @offset ROWS FETCH NEXT 50 ROWS ONLY;$/);
  assert.match(sql, /l\.actor_role IN \('admin', 'staff', 'cli'\)/);
  assert.match(sql, /l\.ip, l\.user_agent FROM/);
  const where = sql.split('\n')[0].split(' WHERE ')[1], where2 = sql.split('\n')[1].split(' WHERE ')[1];
  assert.equal(where.replace(/;$/, ''), where2, 'COUNT và trang dữ liệu cùng điều kiện');
  assert.equal(buildAuditQuery(ok({ page: '2147483647' }), ADMIN).params.find(p => p.name === 'offset').value, (2147483647 - 1) * 50);
});

test('buildAuditQuery staff: luôn có actor_role = customer, KHÔNG đọc ip / user_agent; admin không lọc gì khi không tham số', () => {
  const s = buildAuditQuery(ok({ group: 'admin' }, STAFF), STAFF).sql;
  assert.match(s, / WHERE l\.actor_role = 'customer';/);
  assert.doesNotMatch(s, /l\.ip|user_agent|IN \('admin'/);
  const a = buildAuditQuery(ok({}), ADMIN);
  assert.doesNotMatch(a.sql, /WHERE/);
  assert.deepEqual(a.params.map(p => p.name), ['offset']);
});

test('action / entity nhà cung cấp + phiếu nhập: lọc được; staff lọc theo chúng vẫn chỉ ra nhóm Khách hàng', () => {
  const f = ok({ action: 'RECEIPT_APPROVE', entity_type: 'receipt', entity_id: '9' });
  assert.deepEqual([f.action, f.entityType, f.entityId], ['RECEIPT_APPROVE', 'receipt', '9']);
  assert.equal(ok({ entity_type: 'supplier' }).entityType, 'supplier');
  assert.equal(ok({ action: 'SUPPLIER_STATUS' }).action, 'SUPPLIER_STATUS');
  const s = buildAuditQuery(ok({ group: 'admin', action: 'RECEIPT_RECEIVE', entity_type: 'receipt' }, STAFF), STAFF).sql;
  assert.match(s, /l\.actor_role = 'customer'/);
  assert.doesNotMatch(s, /IN \('admin'/);
});

test('entity_id khớp NGUYÊN VĂN trên SQL: thêm so nhị phân (BIN2) + DATALENGTH, giữ vế = để dùng index', () => {
  const { sql } = buildAuditQuery(ok({ entity_type: 'order', entity_id: '5' }), ADMIN);
  assert.match(sql, /\(l\.entity_id = @entity_id AND l\.entity_id COLLATE Latin1_General_BIN2 = @entity_id AND DATALENGTH\(l\.entity_id\) = DATALENGTH\(@entity_id\)\)/);
});

// Hàm ngày VN mới phải cho CÙNG mốc với parseYMD / VN_OFFSET_MS của routes/admin.js (thống kê). Hai thứ đó không export,
// admin.js không được sửa -> cắt đúng mã nguồn của chúng và chạy trong vm. Cắt / chạy không được -> FAIL rõ ràng, không skip.
test('vnDayStart / vnDayEnd khớp parseYMD - VN_OFFSET_MS (đầu ngày) và parseYMD + 1 ngày - VN_OFFSET_MS (cuối ngày) của admin.js', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const file = path.join(__dirname, '..', 'routes', 'admin.js');
  const src = fs.readFileSync(file, 'utf8');
  const offsetSrc = src.match(/^const VN_OFFSET_MS = [^;\n]+;/m);
  const parseSrc = src.match(/^function parseYMD\(s\) \{\r?\n[\s\S]*?\r?\n\}\r?\n/m);
  if (!offsetSrc || !parseSrc) {
    assert.fail('Không cắt được ' + (!offsetSrc ? '"const VN_OFFSET_MS = ...;"' : '"function parseYMD(s) { ... }"')
      + ' từ routes/admin.js — hàm/hằng đã đổi tên hoặc đổi dạng; sửa test này cho khớp rồi so lại.');
  }
  const ctx = vm.createContext({});
  try {
    vm.runInContext(offsetSrc[0] + '\n' + parseSrc[0] + '\nthis.VN_OFFSET_MS = VN_OFFSET_MS; this.parseYMD = parseYMD;', ctx, { filename: 'admin.js(cắt)' });
  } catch (err) {
    assert.fail('Chạy VN_OFFSET_MS / parseYMD cắt từ routes/admin.js lỗi: ' + err.message);
  }
  if (typeof ctx.parseYMD !== 'function' || ctx.VN_OFFSET_MS !== 7 * 60 * 60 * 1000) {
    assert.fail('parseYMD / VN_OFFSET_MS cắt từ routes/admin.js không đúng dạng mong đợi (VN_OFFSET_MS = ' + ctx.VN_OFFSET_MS + ')');
  }
  const DAY = 86400000;
  const days = ['2026-01-31', '2026-02-28', '2028-02-29', '2024-02-29', '2026-04-30', '2026-06-30', '2026-11-16', '2026-12-31',
    '2027-01-01', '1999-12-31', '9999-12-31'];
  for (const s of days) {
    const base = ctx.parseYMD(s);
    assert.ok(base, 'admin.js parseYMD nhận ' + s);
    assert.deepEqual([vnDayStart(s).getTime(), vnDayEnd(s).getTime()],
      [base.getTime() - ctx.VN_OFFSET_MS, base.getTime() + DAY - ctx.VN_OFFSET_MS], s);
  }
  for (const s of ['2027-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-2-1', '2026/02/01', '', 'x']) {
    assert.deepEqual([ctx.parseYMD(s), vnDayStart(s), vnDayEnd(s)], [null, null, null], 'cả hai cùng từ chối ' + JSON.stringify(s));
  }
});

test('toLogDto: id chuỗi, created_at ISO UTC, before/after đã parse (XSS nguyên văn), actor_deleted boolean; staff không có khoá ip/user_agent', () => {
  const row = { id: '42', created_at: new Date('2026-11-16T01:02:03.004Z'), actor_role: 'customer', actor_user_id: 9, actor_email: null,
    actor_deleted: true, action: 'REVIEW_UPDATE', entity_type: 'review', entity_id: '91',
    before_json: '{"review":{"content":"cũ"}}', after_json: '{"review":{"content":"<img src=x onerror=alert(1)>"}}', ip: '1.2.3.4', user_agent: 'UA' };
  const base = { id: '42', created_at: '2026-11-16T01:02:03.004Z', actor_role: 'customer', actor_user_id: 9, actor_email: null,
    actor_deleted: true, action: 'REVIEW_UPDATE', entity_type: 'review', entity_id: '91',
    before: { review: { content: 'cũ' } }, after: { review: { content: '<img src=x onerror=alert(1)>' } } };
  assert.deepEqual(toLogDto(row, ADMIN), { ...base, ip: '1.2.3.4', user_agent: 'UA' });
  const staffDto = toLogDto(row, STAFF);
  assert.deepEqual(staffDto, base);
  assert.ok(!('ip' in staffDto) && !('user_agent' in staffDto), 'xoá khoá, không để null');
  assert.deepEqual(toLogDto({ ...row, before_json: null, after_json: null, actor_deleted: false, actor_user_id: null, ip: null, user_agent: null }, ADMIN),
    { ...base, before: null, after: null, actor_deleted: false, actor_user_id: null, ip: null, user_agent: null });
});
