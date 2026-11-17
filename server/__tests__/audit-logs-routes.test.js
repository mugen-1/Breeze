'use strict';

// GET /api/admin/audit-logs qua router /api/admin THẬT (requireBackOffice + requireAnyPermission + securityLogger thật).
// Chỉ thay xác thực và SQL. SQL giả CHỈ nhận đúng các đoạn WHERE đã biết (gặp đoạn lạ -> ném lỗi), lọc theo giá trị tham số
// (@...), rồi sắp xếp + cắt trang như câu SQL. Ngữ nghĩa trên SQL Server thật: scripts/verify-audit-sql.js.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

const XSS = '<img src=x onerror=alert(1)>';
let db, actor, queries, security, failSelect;
const rs = (recordset = []) => ({ recordset, recordsets: [recordset], rowsAffected: [recordset.length] });
const lower = s => (s == null ? null : String(s).toLowerCase());
// Đoạn WHERE đã biết -> điều kiện tương ứng (dài trước: đoạn actor_email chứa "l.actor_role = 'customer'").
const FRAGMENTS = [
  ["((l.actor_role <> 'customer' AND LOWER(l.actor_email) = LOWER(@actor_email)) OR (l.actor_role = 'customer' AND LOWER(u.email) = LOWER(@actor_email)))",
    (r, p, u) => (r.actor_role !== 'customer' ? lower(r.actor_email) === lower(p.actor_email) : !!u && lower(u.email) === lower(p.actor_email))],
  ["l.actor_role IN ('admin', 'staff', 'cli')", r => ['admin', 'staff', 'cli'].includes(r.actor_role)],
  ["l.actor_role = 'customer'", r => r.actor_role === 'customer'],
  ['l.action = @action', (r, p) => r.action === p.action],
  ['l.entity_type = @entity_type', (r, p) => r.entity_type === p.entity_type],
  ['(l.entity_id = @entity_id AND l.entity_id COLLATE Latin1_General_BIN2 = @entity_id AND DATALENGTH(l.entity_id) = DATALENGTH(@entity_id))',
    (r, p) => r.entity_id === p.entity_id],
  ['l.actor_user_id = @actor_user_id', (r, p) => r.actor_user_id === p.actor_user_id],
  ['l.created_at >= @from_utc', (r, p) => r.created_at >= p.from_utc],
  ['l.created_at < @to_utc', (r, p) => r.created_at < p.to_utc],
];
const HEAD = 'SELECT COUNT(*) AS total FROM dbo.audit_logs l LEFT JOIN dbo.users u ON u.id = l.actor_user_id';
const TAIL = ' ORDER BY l.created_at DESC, l.id DESC OFFSET @offset ROWS FETCH NEXT 50 ROWS ONLY;';
const COLS = "SELECT l.id, l.created_at, l.actor_role, l.actor_user_id, CASE WHEN l.actor_role = 'customer' THEN u.email ELSE l.actor_email END AS actor_email, "
  + 'CAST(CASE WHEN l.actor_user_id IS NOT NULL AND u.id IS NULL THEN 1 ELSE 0 END AS BIT) AS actor_deleted, '
  + 'l.action, l.entity_type, l.entity_id, l.before_json, l.after_json';
function predicatesOf(where) {
  let rest = where; const preds = [];
  for (const [frag, fn] of FRAGMENTS) if (rest.includes(frag)) { preds.push(fn); rest = rest.split(frag).join(''); }
  assert.equal(rest.replace(/ AND /g, '').trim(), '', 'đoạn WHERE lạ: ' + rest);
  return preds;
}
class Request {
  constructor() { this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.p;
    if (q.startsWith('INSERT INTO dbo.SecurityEvents')) { security.push({ ...p }); return rs(); }
    queries.push({ q, p });
    if (!q.startsWith(HEAD)) throw new Error('Unexpected SQL: ' + q);
    if (failSelect) throw Object.assign(new Error('PRIVATE sql lỗi'), { code: 'ETIMEOUT' });
    const [count, page] = q.split('; ');
    const where = count.slice(HEAD.length).startsWith(' WHERE ') ? count.slice(HEAD.length + 7) : '';
    assert.ok(page.startsWith(COLS), 'cột trang dữ liệu');
    const withIp = page.startsWith(COLS + ', l.ip, l.user_agent FROM ');
    assert.ok(page.startsWith(COLS + (withIp ? ', l.ip, l.user_agent' : '') + ' FROM dbo.audit_logs l LEFT JOIN dbo.users u ON u.id = l.actor_user_id'
      + (where ? ' WHERE ' + where : '') + TAIL.slice(0, -1)), 'trang dữ liệu cùng FROM / WHERE với COUNT');
    assert.equal(typeof p.offset, 'number');
    const preds = predicatesOf(where), userOf = id => db.users.find(u => u.id === id);
    const hits = db.logs.filter(r => preds.every(fn => fn(r, p, userOf(r.actor_user_id))))
      .sort((a, b) => b.created_at - a.created_at || Number(b.id) - Number(a.id));
    const rows = hits.slice(p.offset, p.offset + 50).map(r => {
      const u = userOf(r.actor_user_id);
      return { id: r.id, created_at: r.created_at, actor_role: r.actor_role, actor_user_id: r.actor_user_id,
        actor_email: r.actor_role === 'customer' ? (u ? u.email : null) : r.actor_email,
        actor_deleted: r.actor_user_id != null && !u, action: r.action, entity_type: r.entity_type, entity_id: r.entity_id,
        before_json: r.before_json, after_json: r.after_json, ...(withIp ? { ip: r.ip, user_agent: r.user_agent } : {}) };
    });
    return { recordset: [{ total: hits.length }], recordsets: [[{ total: hits.length }], rows] };
  }
}
require.cache[require.resolve('../db')] = { exports: {
  sql: { ...realSql, Request }, getPool: async () => ({ request: () => new Request() }),
} };
require.cache[require.resolve('../middleware/auth')] = { exports: {
  verifyFirebaseToken: (req, res, next) => {
    if (!actor) return res.status(401).json({ status: 'error', message: 'Thiếu token. Gửi header: Authorization: Bearer <idToken>' });
    req.user = actor; next();
  },
} };
const { PERMISSIONS, setPermissionsForTest } = require('../lib/permissions');
const app = express();
app.use(require('../middleware/securityLogger').securityLogger);
app.use(express.json());
app.use('/api/admin', require('../routes/admin'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/api/admin/audit-logs';
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

const ADMIN = { id: 1, email: 'admin@example.test', role: 'admin' };
const STAFF = { id: 2, email: 'staff@example.test', role: 'staff' };
const CUSTOMER = { id: 3, email: 'khach.a@example.test', role: 'customer' };
let seq;
const at = iso => new Date(iso);
const log = (over) => ({ id: String(++seq), created_at: at('2026-11-10T00:00:00Z'), actor_user_id: null, actor_email: null,
  entity_type: 'order', entity_id: String(seq), before_json: null, after_json: '{"order":{"status":"pending"}}',
  ip: '203.0.113.' + seq, user_agent: 'UA-' + seq, ...over });
beforeEach(() => {
  seq = 0; actor = ADMIN; queries = []; security = []; failSelect = false;
  const logs = [];
  // 52 log khách ORDER_PLACE của user 3, cách nhau 1 phút (cũ nhất trước).
  for (let i = 0; i < 52; i++) logs.push(log({ actor_role: 'customer', actor_user_id: 3, action: 'ORDER_PLACE',
    created_at: at(new Date(Date.UTC(2026, 10, 1) + i * 60000).toISOString()) }));
  logs.push(log({ actor_role: 'customer', actor_user_id: 4, action: 'REVIEW_UPDATE', entity_type: 'review', entity_id: '91',
    created_at: at('2026-11-12T00:00:00Z'), before_json: '{"review":{"content":"cũ"}}', after_json: JSON.stringify({ review: { content: XSS } }) }));
  logs.push(log({ actor_role: 'customer', actor_user_id: 99, action: 'ORDER_CANCEL_BY_CUSTOMER', created_at: at('2026-11-12T01:00:00Z') })); // 99: đã xoá
  // Ngày giờ VN: 23:30 ngày 15/11 VN = 16:30 UTC 15/11; 00:30 ngày 16/11 VN = 17:30 UTC 15/11.
  logs.push(log({ actor_role: 'customer', actor_user_id: 4, action: 'REVIEW_CREATE', entity_type: 'review', entity_id: 'tz-in',
    created_at: at('2026-11-15T16:30:00Z') }));
  logs.push(log({ actor_role: 'customer', actor_user_id: 4, action: 'REVIEW_DELETE', entity_type: 'review', entity_id: 'tz-out',
    created_at: at('2026-11-15T17:30:00Z') }));
  // Nhóm Quản trị: admin, staff, cli — mới nhất.
  logs.push(log({ actor_role: 'admin', actor_user_id: 1, actor_email: 'admin@example.test', action: 'PRODUCT_UPDATE', entity_type: 'product',
    entity_id: '5', created_at: at('2026-11-16T03:00:00Z'), before_json: '{"name_vi":"Áo"}', after_json: JSON.stringify({ name_vi: 'Áo ' + XSS }) }));
  logs.push(log({ actor_role: 'staff', actor_user_id: 2, actor_email: 'staff@example.test', action: 'ORDER_STATUS_CHANGE',
    created_at: at('2026-11-16T02:00:00Z') }));
  logs.push(log({ actor_role: 'cli', actor_user_id: null, actor_email: null, action: 'ROLE_CHANGE', entity_type: 'user', entity_id: '2',
    created_at: at('2026-11-16T01:00:00Z'), ip: null, user_agent: null }));
  logs.push(log({ actor_role: 'staff', actor_user_id: 77, actor_email: 'nv.cu@example.test', action: 'USER_BLACKLIST', entity_type: 'user',
    entity_id: '3', created_at: at('2026-11-16T00:30:00Z') })); // staff 77 đã xoá: vẫn hiện email đã lưu
  db = { logs, users: [{ id: 1, email: 'admin@example.test' }, { id: 2, email: 'staff@example.test' },
    { id: 3, email: 'khach.a@example.test' }, { id: 4, email: 'Khach.B@Example.test' }] };
});
afterEach(() => setPermissionsForTest());

async function get(query = '', method = 'GET') {
  const r = await fetch(base + query, { method });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch (_) { /* 404 mặc định của Express là HTML */ }
  return { status: r.status, body, cache: r.headers.get('cache-control') };
}
const ids = r => r.body.logs.map(l => l.id);
const roles = r => [...new Set(r.body.logs.map(l => l.actor_role))].sort();
const CUSTOMER_IDS = () => db.logs.filter(l => l.actor_role === 'customer');
const securityRows = async n => { for (let i = 0; i < 50 && security.length < n; i++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 30)); return security; };

test('admin, không tham số: 200, đủ cả 2 nhóm, total = mọi dòng, 50 dòng/trang, created_at DESC, có ip/user_agent, no-store', async () => {
  const r = await get();
  assert.equal(r.status, 200); assert.equal(r.cache, 'no-store');
  assert.deepEqual([r.body.status, r.body.page, r.body.page_size, r.body.total, r.body.logs.length], ['ok', 1, 50, 60, 50]);
  assert.deepEqual(roles(r), ['admin', 'cli', 'customer', 'staff']);
  const times = r.body.logs.map(l => l.created_at);
  assert.deepEqual(times, [...times].sort().reverse(), 'mới nhất trước');
  assert.deepEqual(Object.keys(r.body.logs[0]), ['id', 'created_at', 'actor_role', 'actor_user_id', 'actor_email', 'actor_deleted',
    'action', 'entity_type', 'entity_id', 'before', 'after', 'ip', 'user_agent']);
  assert.deepEqual(r.body.logs[0], { id: '57', created_at: '2026-11-16T03:00:00.000Z', actor_role: 'admin', actor_user_id: 1,
    actor_email: 'admin@example.test', actor_deleted: false, action: 'PRODUCT_UPDATE', entity_type: 'product', entity_id: '5',
    before: { name_vi: 'Áo' }, after: { name_vi: 'Áo ' + XSS }, ip: '203.0.113.57', user_agent: 'UA-57' });
});

test('admin: phân trang — trang 2 phần còn lại, trang vượt quá -> logs [] (total giữ nguyên)', async () => {
  const p1 = await get('?page=1'), p2 = await get('?page=2'), p9 = await get('?page=999');
  assert.deepEqual([p2.body.page, p2.body.total, p2.body.logs.length], [2, 60, 10]);
  assert.equal(new Set([...ids(p1), ...ids(p2)]).size, 60, 'không trùng, không sót');
  assert.deepEqual([p9.status, p9.body.page, p9.body.total, p9.body.logs], [200, 999, 60, []]);
  assert.equal(queries.at(-1).p.offset, 998 * 50);
});

test('admin: lọc từng tham số', async () => {
  const only = async (q, expectIds) => { const r = await get(q); assert.equal(r.status, 200, q);
    assert.deepEqual(ids(r).sort((a, b) => a - b), expectIds.map(String), q); assert.equal(r.body.total, expectIds.length, q); };
  assert.deepEqual(roles(await get('?group=admin')), ['admin', 'cli', 'staff']);
  assert.equal((await get('?group=admin')).body.total, 4);
  assert.deepEqual(roles(await get('?group=customer')), ['customer']);
  assert.equal((await get('?group=customer')).body.total, 56);
  await only('?action=ROLE_CHANGE', [59]);
  await only('?entity_type=review', [53, 55, 56]);
  await only('?entity_type=review&entity_id=91', [53]);
  await only('?entity_type=order&entity_id=91', []);
  await only('?actor_user_id=4', [53, 55, 56]);
  await only('?actor_email=ADMIN@example.TEST', [57]);                 // nhóm Quản trị: email đã lưu, không phân biệt hoa/thường
  await only('?actor_email=khach.b@example.test', [53, 55, 56]);       // khách: email hiện tại trong users
  await only('?actor_email=%20nv.cu@example.test%20', [60]);           // trim
  await only('?group=customer&actor_email=admin@example.test', []);
  await only('?from=2026-11-16', [56, 57, 58, 59, 60]);                // 16/11 giờ VN bắt đầu 17:00 UTC 15/11 -> có cả tz-out (00:30 VN 16/11)
});

test('from/to theo giờ VN: log 23:30 ngày D (16:30 UTC) nằm trong from=to=D; log 00:30 ngày D+1 thì không', async () => {
  const r = await get('?from=2026-11-15&to=2026-11-15&entity_type=review');
  assert.deepEqual(r.body.logs.map(l => l.entity_id), ['tz-in']);
  const next = await get('?from=2026-11-16&to=2026-11-16&entity_type=review');
  assert.deepEqual(next.body.logs.map(l => l.entity_id), ['tz-out']);
  assert.deepEqual([queries.at(-1).p.from_utc.toISOString(), queries.at(-1).p.to_utc.toISOString()],
    ['2026-11-15T17:00:00.000Z', '2026-11-16T17:00:00.000Z']);
});

test('staff: không tham số / group=customer / group=admin / group= -> CHỈ log khách, y hệt nhau, không lỗi', async () => {
  actor = STAFF;
  const out = [];
  for (const q of ['', '?group=customer', '?group=admin', '?group=']) {
    const r = await get(q);
    assert.equal(r.status, 200, q); assert.deepEqual(roles(r), ['customer'], q);
    out.push([r.body.total, ids(r)]);
  }
  assert.ok(out.every(x => JSON.stringify(x) === JSON.stringify(out[0])));
  assert.equal(out[0][0], CUSTOMER_IDS().length);
  for (const { q } of queries) assert.match(q, / WHERE l\.actor_role = 'customer'/);
});

test('staff: lọc theo email admin / action của Quản trị -> 0 dòng; không có khoá ip / user_agent ở bất kỳ dòng nào', async () => {
  actor = STAFF;
  for (const q of ['?actor_email=admin@example.test', '?action=PRODUCT_UPDATE', '?actor_email=staff@example.test&group=admin', '?actor_user_id=1']) {
    const r = await get(q);
    assert.deepEqual([r.status, r.body.total, r.body.logs], [200, 0, []], q);
  }
  const all = [...(await get()).body.logs, ...(await get('?page=2')).body.logs];
  assert.equal(all.length, 56);
  assert.ok(all.every(l => !('ip' in l) && !('user_agent' in l)), 'xoá hẳn khoá');
  assert.ok(queries.every(({ q }) => !q.includes('l.ip')), 'không đọc ip/user_agent từ DB');
});

test('khách -> 403 ở cổng chung; chưa đăng nhập -> 401; không chạm SQL', async () => {
  actor = CUSTOMER;
  const r = await get();
  assert.deepEqual([r.status, r.body.message], [403, 'Chỉ tài khoản quản trị mới được phép thao tác này']);
  actor = null;
  assert.equal((await get()).status, 401);
  assert.deepEqual(queries, []);
});

test('staff không có quyền nào trong 2 quyền -> 403 FORBIDDEN + đúng 1 dòng PERMISSION_DENIED; có 1 quyền là đủ', async () => {
  actor = STAFF;
  setPermissionsForTest({ admin: PERMISSIONS, staff: PERMISSIONS.filter(p => !p.startsWith('audit:')) });
  const r = await get();
  assert.deepEqual([r.status, r.body], [403, { status: 'error', code: 'FORBIDDEN', message: 'Tài khoản không có quyền thực hiện thao tác này' }]);
  const rows = await securityRows(1);
  assert.deepEqual(rows.map(x => [x.event_type, x.status_code, x.method, x.path]), [['PERMISSION_DENIED', 403, 'GET', '/api/admin/audit-logs']]);
  assert.deepEqual(queries, []);
  setPermissionsForTest({ admin: ['audit:read_customer'], staff: ['audit:read_admin'] });
  actor = ADMIN;
  assert.deepEqual(roles(await get()), ['customer'], 'chỉ audit:read_customer -> như staff');
  actor = STAFF;
  assert.deepEqual(roles(await get()), ['admin', 'cli', 'customer', 'staff'], 'có audit:read_admin -> thấy mọi nhóm');
});

test('tài khoản đã xoá: khách -> actor_email null, actor_deleted true; staff đã xoá vẫn hiện email đã lưu; cli -> actor_deleted false', async () => {
  const pick = async q => (await get(q)).body.logs[0];
  const gone = await pick('?actor_user_id=99');
  assert.deepEqual([gone.actor_role, gone.actor_email, gone.actor_deleted], ['customer', null, true]);
  const oldStaff = await pick('?actor_user_id=77');
  assert.deepEqual([oldStaff.actor_email, oldStaff.actor_deleted], ['nv.cu@example.test', true]);
  const cli = await pick('?action=ROLE_CHANGE');
  assert.deepEqual([cli.actor_user_id, cli.actor_email, cli.actor_deleted], [null, null, false]);
  const live = await pick('?actor_user_id=4');
  assert.deepEqual([live.actor_email, live.actor_deleted], ['Khach.B@Example.test', false]);
});

test('XSS trong before/after trả về nguyên văn (JSON đã parse)', async () => {
  const r = await get('?entity_type=review&entity_id=91');
  assert.deepEqual([r.body.logs[0].before, r.body.logs[0].after], [{ review: { content: 'cũ' } }, { review: { content: XSS } }]);
});

test('mọi tham số sai -> 400 {status, message}, không chạy truy vấn nào', async () => {
  const cases = [['?group=all', 'group không hợp lệ'], ['?action=product_update', 'action không hợp lệ'],
    ['?entity_type=payment', 'entity_type không hợp lệ'], ['?entity_id=5', 'entity_id cần đi kèm entity_type'],
    ['?entity_type=order&entity_id=' + 'x'.repeat(51), 'entity_id không hợp lệ'], ['?actor_user_id=0', 'actor_user_id không hợp lệ'],
    ['?actor_user_id=2147483648', 'actor_user_id không hợp lệ'], ['?actor_email=' + 'a'.repeat(256), 'actor_email không hợp lệ'],
    ['?from=2026-02-30', 'from/to phải đúng định dạng YYYY-MM-DD'], ['?from=2026-11-17&to=2026-11-16', 'from phải nhỏ hơn hoặc bằng to'],
    ['?from=0000-01-01', 'Ngày ngoài phạm vi SQL Server hỗ trợ'], ['?page=0', 'page không hợp lệ'], ['?page=1.5', 'page không hợp lệ'],
    ['?action=ORDER_PLACE&action=ORDER_DELETE', 'action không hợp lệ'], ['?page=1&page=2', 'page không hợp lệ']];
  for (const who of [ADMIN, STAFF]) {
    actor = who;
    for (const [q, message] of cases) {
      const r = await get(q);
      assert.deepEqual([r.status, r.body], [400, { status: 'error', message }], who.role + ' ' + q);
    }
  }
  assert.deepEqual(queries, []);
});

test('đọc log không sinh thêm dòng audit (không câu INSERT nào); chỉ đúng 1 câu SELECT mỗi request', async () => {
  await get(); actor = STAFF; await get('?page=2');
  assert.deepEqual(queries.map(x => x.q.startsWith(HEAD)), [true, true]);
  assert.ok(queries.every(x => !/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(x.q)), 'chỉ đọc');
});

test('POST / PUT / PATCH / DELETE /api/admin/audit-logs -> 404 (không có route), không chạm SQL', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await get('', method)).status, 404, method);
    assert.equal((await get('/1', method)).status, 404, method + ' /1');
  }
  assert.deepEqual(queries, []);
});

test('lỗi DB -> 500 {status, message} chung, không lộ chi tiết', async t => {
  t.mock.method(console, 'error', () => {});
  failSelect = true;
  const r = await get();
  assert.deepEqual([r.status, r.body], [500, { status: 'error', message: 'Không tải được audit log' }]);
});
