'use strict';

// /api/admin/suppliers qua HTTP: router /api/admin + requireBackOffice/requirePermission + securityLogger + lib/audit.js THẬT;
// chỉ thay xác thực và SQL (SQL giả có transaction: begin chép dữ liệu, commit mới áp, rollback bỏ).
// Hàm thuần: suppliers.test.js; SQL thật: scripts/verify-audit-sql.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

let db, actor, events, failAudit, routeSql, security;
const clone = x => structuredClone(x);
const rs = (recordset = [], recordsets) => ({ recordset, recordsets: recordsets || [recordset], rowsAffected: [recordset.length] });
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// LIKE của SQL Server (collation không phân biệt hoa/thường): % _ và [x] (ký tự thoát).
function like(value, pattern) {
  if (value == null) return false;
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '%') re += '.*';
    else if (c === '_') re += '.';
    else if (c === '[') { const j = pattern.indexOf(']', i + 2); re += escRe(pattern.slice(i + 1, j)); i = j; }
    else re += escRe(c);
  }
  return new RegExp('^' + re + '$', 'is').test(value);
}
const COLS = ['id', 'code', 'name', 'contact_name', 'phone', 'email', 'address', 'tax_code', 'note', 'is_active', 'created_at', 'updated_at'];
const pickCols = s => Object.fromEntries(COLS.map(c => [c, s[c]]));
let clock = 0;
const tick = () => new Date(Date.UTC(2026, 10, 27, 0, 0, ++clock));

class Transaction {
  async begin() { this.data = clone(db); events.push('begin'); }
  async commit() { db = this.data; this.data = null; events.push('commit'); }
  async rollback() { this.data = null; events.push('rollback'); }
}
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.p;
    if (q.startsWith('INSERT INTO dbo.SecurityEvents')) { security.push({ ...p }); return rs([]); }
    const d = this.tx ? this.tx.data : db;
    if (!d) throw new Error('SQL sau commit/rollback');
    routeSql.push({ q, tx: !!this.tx });
    if (q.startsWith('INSERT INTO dbo.audit_logs')) {
      assert.ok(this.tx, 'audit phải chạy trong transaction');
      if (failAudit) throw new Error('audit giả lỗi');
      d.audit.push({ actor_user_id: p.actor_user_id, actor_role: p.actor_role, actor_email: p.actor_email, action: p.action,
        entity_type: p.entity_type, entity_id: p.entity_id, before: JSON.parse(p.before_json), after: JSON.parse(p.after_json) });
      return rs([{ id: String(d.audit.length) }]);
    }
    if (q.startsWith('DECLARE @total INT = (SELECT COUNT(*) FROM dbo.suppliers s')) {
      let list = d.suppliers.slice();
      if (q.includes('s.is_active = 1')) list = list.filter(s => s.is_active);
      if (q.includes('s.is_active = 0')) list = list.filter(s => !s.is_active);
      if (q.includes('(s.code LIKE @q OR s.name LIKE @q OR s.phone LIKE @q_phone)')) {
        list = list.filter(s => like(s.code, p.q) || like(s.name, p.q) || like(s.phone, p.q_phone));
      }
      list.sort((a, b) => b.created_at - a.created_at || b.id - a.id);
      const total = list.length, pages = Math.ceil(total / p.limit);
      const page = total === 0 ? 1 : Math.min(p.page, pages);
      assert.match(q, /ORDER BY s\.created_at DESC, s\.id DESC OFFSET \(\(@actualPage - 1\) \* @limit\) ROWS FETCH NEXT @limit ROWS ONLY;$/);
      const rows = list.slice((page - 1) * p.limit, page * p.limit).map(pickCols);
      return rs(rows, [[{ total, page }], rows]);
    }
    if (/^SELECT s\.id, s\.code, .* FROM dbo\.suppliers s (WITH \(UPDLOCK, HOLDLOCK\) )?WHERE s\.id = @id;$/.test(q)) {
      if (q.includes('UPDLOCK')) assert.ok(this.tx, 'khoá dòng phải trong transaction');
      return rs(d.suppliers.filter(s => s.id === p.id).map(pickCols));
    }
    if (q.startsWith('INSERT INTO dbo.suppliers (code, name, contact_name, phone, email, address, tax_code, note) OUTPUT INSERTED.id,')) {
      assert.ok(this.tx, 'INSERT phải trong transaction');
      if (d.suppliers.some(s => s.code === p.code)) throw Object.assign(new Error('Violation of UNIQUE KEY constraint UQ_suppliers_code'), { number: 2627 });
      const at = tick();
      const row = { id: d.nextId++, code: p.code, name: p.name, contact_name: p.contact_name, phone: p.phone, email: p.email,
        address: p.address, tax_code: p.tax_code, note: p.note, is_active: true, created_at: at, updated_at: at };
      d.suppliers.push(row);
      return rs([pickCols(row)]);
    }
    const upd = q.match(/^UPDATE dbo\.suppliers SET (.+), updated_at = SYSUTCDATETIME\(\) OUTPUT INSERTED\.id, .* WHERE id = @id;$/);
    if (upd) {
      assert.ok(this.tx, 'UPDATE phải trong transaction');
      const s = d.suppliers.find(x => x.id === p.id); if (!s) return rs([]);
      for (const part of upd[1].split(', ')) {
        const m = part.match(/^(\w+) = @(\w+)$/); assert.ok(m, 'SET lạ: ' + part);
        s[m[1]] = m[1] === 'is_active' ? !!p[m[2]] : p[m[2]];
      }
      s.updated_at = tick();
      return rs([pickCols(s)]);
    }
    throw new Error('Unexpected SQL: ' + q);
  }
}
require.cache[require.resolve('../db')] = { exports: {
  sql: { ...realSql, Transaction, Request }, getPool: async () => ({ request: () => new Request(null) }),
} };
require.cache[require.resolve('../middleware/auth')] = { exports: {
  verifyFirebaseToken: (req, res, next) => { req.user = actor; next(); },
} };
const app = express();
app.use(require('../middleware/securityLogger').securityLogger);
app.use(express.json());
app.use('/api/admin', require('../routes/admin'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/api/admin/suppliers';
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

const ADMIN = { id: 1, email: 'admin@example.test', role: 'admin' };
const STAFF = { id: 2, email: 'staff@example.test', role: 'staff' };
const CUSTOMER = { id: 3, email: 'khach@example.test', role: 'customer' };
const XSS = '<img src=x onerror=alert(1)>';
const seed = (id, code, name, over = {}) => ({ id, code, name, contact_name: null, phone: null, email: null, address: null,
  tax_code: null, note: null, is_active: true, created_at: new Date(Date.UTC(2026, 0, id)), updated_at: new Date(Date.UTC(2026, 0, id)), ...over });
beforeEach(() => {
  db = { audit: [], nextId: 10, suppliers: [
    seed(1, 'NCC-001', 'Công ty Vải Sài Gòn', { phone: '0901234567', address: '12 Test', email: 'vai@ncc.vn' }),
    seed(2, 'NCC-002', 'Xưởng May 50%_[a]', { phone: '0287654321', is_active: false }),
    seed(3, 'DET-01', 'Dệt Bình Minh', { phone: '+84911222333' }),
  ] };
  actor = ADMIN; events = []; failAudit = false; routeSql = []; security = []; clock = 0;
});
const call = async (method, path = '', body) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') };
};
const quiet = t => t.mock.method(console, 'error', () => {});
const invalid = (field, message) => ({ status: 'error', code: 'SUPPLIER_INVALID_INPUT', ...(message ? { message } : {}), ...(field ? { field } : {}) });
const expectInvalid = (r, field) => {
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.deepEqual([r.body.status, r.body.code, r.body.field], ['error', 'SUPPLIER_INVALID_INPUT', field]);
  assert.ok(typeof r.body.message === 'string' && r.body.message.length > 0);
};
const oneLog = (action, entityId, who = ADMIN) => {
  assert.equal(db.audit.length, 1, 'đúng 1 dòng audit: ' + JSON.stringify(db.audit));
  const log = db.audit[0];
  assert.deepEqual([log.action, log.entity_type, log.entity_id, log.actor_user_id, log.actor_role, log.actor_email],
    [action, 'supplier', String(entityId), who.id, who.role, who.email]);
  return log;
};
const supplierOf = id => db.suppliers.find(s => s.id === id);
async function securityRows(expected) { // securityLogger ghi fire-and-forget sau 'finish'
  for (let i = 0; i < 50 && security.length < expected; i++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 30));
  return security;
}

// ---------------- GET danh sách / chi tiết ----------------
test('GET /: mặc định status all, created_at DESC, page 1 limit 20; no-store; staff cũng được', async () => {
  for (const who of [ADMIN, STAFF]) {
    actor = who;
    const r = await call('GET');
    assert.equal(r.status, 200, who.role);
    assert.equal(r.cache, 'no-store');
    assert.deepEqual([r.body.status, r.body.page, r.body.limit, r.body.total, r.body.totalPages], ['ok', 1, 20, 3, 1]);
    assert.deepEqual(r.body.suppliers.map(s => s.id), [3, 2, 1]);
    assert.deepEqual(r.body.suppliers[2], { id: 1, code: 'NCC-001', name: 'Công ty Vải Sài Gòn', contact_name: null, phone: '0901234567',
      email: 'vai@ncc.vn', address: '12 Test', tax_code: null, note: null, is_active: true,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' });
  }
  assert.equal(db.audit.length, 0, 'đọc không ghi log');
});

test('GET /: lọc status, q theo mã / tên / SĐT (SĐT bỏ dấu cách), q có % _ [ khớp nguyên văn', async () => {
  const ids = async query => (await call('GET', query)).body.suppliers.map(s => s.id);
  assert.deepEqual(await ids('?status=active'), [3, 1]);
  assert.deepEqual(await ids('?status=inactive'), [2]);
  assert.deepEqual(await ids('?status=all'), [3, 2, 1]);
  assert.deepEqual(await ids('?q=ncc-00'), [2, 1], 'mã, không phân biệt hoa/thường');
  assert.deepEqual(await ids('?q=' + encodeURIComponent('bình minh')), [3], 'tên');
  assert.deepEqual(await ids('?q=' + encodeURIComponent('0901 234')), [1], 'SĐT có dấu cách');
  assert.deepEqual(await ids('?q=' + encodeURIComponent('+8491')), [3]);
  assert.deepEqual(await ids('?q=' + encodeURIComponent('50%_[a]')), [2], '% _ [ khớp nguyên văn');
  assert.deepEqual(await ids('?q=' + encodeURIComponent('5_%')), [], '_ và % không phải ký tự đại diện');
  assert.deepEqual(await ids('?q=ncc&status=active'), [1]);
  assert.deepEqual(await ids('?q=' + encodeURIComponent('   ')), [3, 2, 1], 'q chỉ khoảng trắng = không lọc');
  const sqlText = routeSql.map(x => x.q).join('\n');
  assert.ok(!sqlText.includes('bình minh') && !sqlText.includes('50%'), 'q đi qua tham số, không nối vào SQL');
});

test('GET /: phân trang; page vượt số trang -> trang cuối; limit > 50 / sai -> 400', async () => {
  const p = await call('GET', '?limit=2&page=2');
  assert.deepEqual([p.body.page, p.body.limit, p.body.total, p.body.totalPages, p.body.suppliers.map(s => s.id)], [2, 2, 3, 2, [1]]);
  const over = await call('GET', '?limit=2&page=99');
  assert.deepEqual([over.body.page, over.body.suppliers.map(s => s.id)], [2, [1]]);
  const empty = await call('GET', '?q=khongco&page=5');
  assert.deepEqual([empty.body.page, empty.body.total, empty.body.totalPages, empty.body.suppliers], [1, 0, 0, []]);
  assert.equal((await call('GET', '?limit=50')).status, 200);
  for (const [query, field] of [['?limit=51', 'limit'], ['?limit=0', 'limit'], ['?page=0', 'page'], ['?status=deleted', 'status'],
    ['?q=' + 'x'.repeat(101), 'q'], ['?status=active&status=all', 'status']]) expectInvalid(await call('GET', query), field);
});

test('GET /:id: 200 chi tiết; không có -> 404; id sai -> 400; staff được', async () => {
  actor = STAFF;
  const r = await call('GET', '/2');
  assert.deepEqual([r.status, r.body.status, r.body.supplier.code, r.body.supplier.is_active], [200, 'ok', 'NCC-002', false]);
  assert.deepEqual(await call('GET', '/99').then(x => [x.status, x.body]), [404,
    { status: 'error', code: 'SUPPLIER_NOT_FOUND', message: 'Không tìm thấy nhà cung cấp' }]);
  for (const id of ['0', 'abc', '1.5', '2147483648']) expectInvalid(await call('GET', '/' + id), 'id');
});

// ---------------- POST ----------------
test('POST / (admin): 201, chuẩn hoá, tuỳ chọn trống -> null, XSS nguyên văn; đúng 1 dòng SUPPLIER_CREATE cùng tx', async () => {
  const r = await call('POST', '', { code: ' ncc-010 ', name: ' Công ty ' + XSS + ' ', contact_name: '', phone: '090 111 2222',
    email: '  ', address: XSS, tax_code: '0312345678', note: null, foo: 'bỏ qua' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual({ ...r.body.supplier, created_at: undefined, updated_at: undefined }, { id: 10, code: 'NCC-010',
    name: 'Công ty ' + XSS, contact_name: null, phone: '0901112222', email: null, address: XSS, tax_code: '0312345678', note: null,
    is_active: true, created_at: undefined, updated_at: undefined });
  const log = oneLog('SUPPLIER_CREATE', 10);
  assert.equal(log.before, null);
  assert.deepEqual(log.after, { id: 10, code: 'NCC-010', name: 'Công ty ' + XSS, contact_name: null, phone: '0901112222', email: null,
    address: XSS, tax_code: '0312345678', note: null, is_active: true });
  assert.deepEqual(events, ['begin', 'commit']);
  assert.deepEqual(supplierOf(10).code, 'NCC-010');
});

test('POST /: dữ liệu sai -> 400 đúng field, không mở transaction, không chạm SQL', async () => {
  for (const [body, field] of [
    [{ name: 'A' }, 'code'], [{ code: '', name: 'A' }, 'code'], [{ code: 'NCC 1', name: 'A' }, 'code'],
    [{ code: 'ncc-ı', name: 'A' }, 'code'], [{ code: 'ncc-ß', name: 'A' }, 'code'],
    [{ code: 'NCC-9' }, 'name'], [{ code: 'NCC-9', name: '   ' }, 'name'], [{ code: 'NCC-9', name: 'x'.repeat(201) }, 'name'],
    [{ code: 'NCC-9', name: 'A', phone: '090-123-4567' }, 'phone'], [{ code: 'NCC-9', name: 'A', email: 'a@b' }, 'email'],
    [{ code: 'NCC-9', name: 'A', tax_code: '123' }, 'tax_code'], [{ code: 'NCC-9', name: 'A', note: 'x'.repeat(501) }, 'note'],
    [{ code: 'NCC-9', name: 'A', phone: 901234567 }, 'phone'],
    [{ code: 'NCC-9', name: 'A', is_active: false }, 'is_active'],
  ]) expectInvalid(await call('POST', '', body), field);
  const r = await call('POST', '', { code: 'NCC-9', name: 'A', is_active: true });
  assert.match(r.body.message, /PATCH \/api\/admin\/suppliers\/:id\/status/);
  assert.deepEqual([events, routeSql, db.audit, db.suppliers.length], [[], [], [], 3]);
});

test('POST /: trùng mã (kể cả khác hoa/thường) -> 409 SUPPLIER_CODE_EXISTS, rollback, 0 dòng log', async () => {
  const r = await call('POST', '', { code: 'ncc-001', name: 'Trùng' });
  assert.deepEqual([r.status, r.body], [409, { status: 'error', code: 'SUPPLIER_CODE_EXISTS', message: 'Mã nhà cung cấp đã tồn tại' }]);
  assert.deepEqual([events, db.audit.length, db.suppliers.length], [['begin', 'rollback'], 0, 3]);
});

test('POST /: audit() lỗi -> 500, rollback, NCC không được tạo', async t => {
  quiet(t); failAudit = true;
  const r = await call('POST', '', { code: 'NCC-011', name: 'Không lưu' });
  assert.deepEqual([r.status, r.body], [500, { status: 'error', code: 'SUPPLIER_ADMIN_ERROR', message: 'Không xử lý được nhà cung cấp. Vui lòng thử lại' }]);
  assert.deepEqual([events, db.audit.length, db.suppliers.length], [['begin', 'rollback'], 0, 3]);
});

// ---------------- PUT ----------------
test('PUT /:id: sửa từng phần, khoá UPDLOCK trong tx; tuỳ chọn "" -> null; 1 dòng SUPPLIER_UPDATE chỉ cột đổi', async () => {
  actor = ADMIN;
  const r = await call('PUT', '/1', { name: ' Vải SG mới ', address: '', note: XSS });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.status, r.body.supplier.name, r.body.supplier.address, r.body.supplier.note, r.body.supplier.phone,
    r.body.supplier.email], ['ok', 'Vải SG mới', null, XSS, '0901234567', 'vai@ncc.vn']);
  assert.notEqual(r.body.supplier.updated_at, '2026-01-01T00:00:00.000Z', 'updated_at đổi');
  const log = oneLog('SUPPLIER_UPDATE', 1);
  assert.deepEqual([log.before, log.after], [{ name: 'Công ty Vải Sài Gòn', address: '12 Test', note: null },
    { name: 'Vải SG mới', address: null, note: XSS }]);
  assert.deepEqual(events, ['begin', 'commit']);
  const lock = routeSql.find(x => x.q.includes('WITH (UPDLOCK, HOLDLOCK)'));
  assert.ok(lock && lock.tx, 'đọc dòng có khoá UPDLOCK trong transaction');
  assert.ok(routeSql.indexOf(lock) < routeSql.findIndex(x => x.q.startsWith('UPDATE dbo.suppliers')), 'khoá trước UPDATE');
});

test('PUT /:id: gửi code trùng mã hiện tại (chuẩn hoá) kèm trường khác -> 200, log chỉ có trường đổi', async () => {
  const r = await call('PUT', '/1', { code: ' ncc-001 ', contact_name: 'Anh C' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(oneLog('SUPPLIER_UPDATE', 1).after, { contact_name: 'Anh C' });
});

test('PUT /:id: không đổi gì -> 200, vẫn đúng 1 dòng SUPPLIER_UPDATE {} / {} (như PRODUCT_UPDATE)', async () => {
  const r = await call('PUT', '/1', { name: 'Công ty Vải Sài Gòn', phone: ' 0901 234 567 ' });
  assert.equal(r.status, 200);
  const log = oneLog('SUPPLIER_UPDATE', 1);
  assert.deepEqual([log.before, log.after], [{}, {}]);
  assert.deepEqual(events, ['begin', 'commit']);
});

test('PUT /:id: code khác mã hiện tại -> 400 SUPPLIER_CODE_IMMUTABLE, rollback, 0 dòng, NCC không đổi', async () => {
  const before = clone(supplierOf(1));
  const r = await call('PUT', '/1', { code: 'NCC-999', name: 'Đổi tên' });
  assert.deepEqual([r.status, r.body], [400, { status: 'error', code: 'SUPPLIER_CODE_IMMUTABLE',
    message: 'Mã nhà cung cấp không sửa được sau khi tạo', field: 'code' }]);
  assert.deepEqual([events, db.audit.length, supplierOf(1)], [['begin', 'rollback'], 0, before]);
  const only = await call('PUT', '/1', { code: 'NCC-999' });
  assert.equal(only.body.code, 'SUPPLIER_CODE_IMMUTABLE', 'chỉ gửi code khác cũng báo không sửa được mã');
});

test('PUT /:id: chỉ gửi code trùng mã hiện tại / body rỗng -> 400 không có trường để sửa, 0 dòng', async () => {
  const same = await call('PUT', '/1', { code: 'NCC-001' });
  assert.deepEqual([same.status, same.body], [400, invalid(undefined, 'Không có trường hợp lệ nào để cập nhật')]);
  assert.deepEqual(events, ['begin', 'rollback']);
  events = []; routeSql = [];
  for (const body of [{}, { id: 5, created_at: 'x' }]) {
    const r = await call('PUT', '/1', body);
    assert.deepEqual([r.status, r.body], [400, invalid(undefined, 'Không có trường hợp lệ nào để cập nhật')]);
  }
  assert.deepEqual([events, routeSql, db.audit.length], [[], [], 0], 'body rỗng: không mở transaction');
});

test('PUT /:id: name / code "" -> 400 (không thành NULL); is_active -> 400 báo dùng PATCH; trường sai -> 400; 0 SQL', async () => {
  for (const [body, field] of [[{ name: '' }, 'name'], [{ name: '  ' }, 'name'], [{ name: null }, 'name'], [{ code: '' }, 'code'],
    [{ code: '  ' }, 'code'], [{ is_active: false }, 'is_active'], [{ name: 'A', is_active: true }, 'is_active'],
    [{ email: 'sai@' }, 'email'], [{ tax_code: '12' }, 'tax_code'], [{ phone: 'abc' }, 'phone'], [{ address: 'x'.repeat(301) }, 'address'],
    [{ contact_name: 'x'.repeat(121) }, 'contact_name']]) expectInvalid(await call('PUT', '/1', body), field);
  assert.match((await call('PUT', '/1', { is_active: false })).body.message, /PATCH \/api\/admin\/suppliers\/:id\/status/);
  expectInvalid(await call('PUT', '/abc', { name: 'A' }), 'id');
  assert.deepEqual([events, routeSql, db.audit.length], [[], [], 0]);
});

test('PUT /:id: không có -> 404, rollback, 0 dòng', async () => {
  const r = await call('PUT', '/99', { name: 'A' });
  assert.deepEqual([r.status, r.body.code], [404, 'SUPPLIER_NOT_FOUND']);
  assert.deepEqual([events, db.audit.length], [['begin', 'rollback'], 0]);
});

test('PUT /:id: audit() lỗi -> 500, rollback, NCC không đổi', async t => {
  quiet(t); failAudit = true;
  const before = clone(supplierOf(1));
  const r = await call('PUT', '/1', { name: 'Không lưu' });
  assert.deepEqual([r.status, r.body.code], [500, 'SUPPLIER_ADMIN_ERROR']);
  assert.deepEqual([events, db.audit.length, supplierOf(1)], [['begin', 'rollback'], 0, before]);
});

// ---------------- PATCH status ----------------
test('PATCH /:id/status: ngừng -> 200, 1 dòng SUPPLIER_STATUS {is_active:true} -> {false}; lặp lại -> 200, 0 dòng', async () => {
  const r = await call('PATCH', '/1/status', { is_active: false });
  assert.deepEqual([r.status, r.body.status, r.body.supplier.is_active], [200, 'ok', false]);
  const log = oneLog('SUPPLIER_STATUS', 1);
  assert.deepEqual([log.before, log.after], [{ is_active: true }, { is_active: false }]);
  assert.equal(supplierOf(1).is_active, false);
  assert.ok(routeSql.some(x => x.q.includes('WITH (UPDLOCK, HOLDLOCK)') && x.tx), 'khoá dòng');
  db.audit = []; events = []; routeSql = [];
  const again = await call('PATCH', '/1/status', { is_active: false });
  assert.deepEqual([again.status, again.body.supplier.is_active, db.audit.length], [200, false, 0]);
  assert.ok(!routeSql.some(x => x.q.startsWith('UPDATE')), 'không UPDATE khi đã đúng trạng thái');
  const back = await call('PATCH', '/2/status', { is_active: true });
  assert.deepEqual([back.status, back.body.supplier.is_active], [200, true]);
  assert.deepEqual([db.audit[0].action, db.audit[0].before, db.audit[0].after], ['SUPPLIER_STATUS', { is_active: false }, { is_active: true }]);
});

test('PATCH /:id/status: is_active không phải boolean -> 400; không có -> 404; audit() lỗi -> 500 rollback', async t => {
  for (const body of [{}, { is_active: 0 }, { is_active: 'false' }, { is_active: null }]) expectInvalid(await call('PATCH', '/1/status', body), 'is_active');
  assert.deepEqual([events, routeSql], [[], []]);
  assert.equal((await call('PATCH', '/99/status', { is_active: false })).status, 404);
  quiet(t); failAudit = true; events = [];
  const r = await call('PATCH', '/1/status', { is_active: false });
  assert.deepEqual([r.status, r.body.code, events, supplierOf(1).is_active, db.audit.length], [500, 'SUPPLIER_ADMIN_ERROR', ['begin', 'rollback'], true, 0]);
});

// ---------------- Quyền ----------------
test('staff: POST / PUT / PATCH -> 403 FORBIDDEN, không chạm SQL, mỗi lần đúng 1 dòng SecurityEvents PERMISSION_DENIED', async () => {
  actor = STAFF;
  for (const [method, path, body] of [['POST', '', { code: 'NCC-020', name: 'A' }], ['PUT', '/1', { name: 'B' }],
    ['PATCH', '/1/status', { is_active: false }]]) {
    security = [];
    const r = await call(method, path, body);
    assert.deepEqual([r.status, r.body], [403, { status: 'error', code: 'FORBIDDEN', message: 'Tài khoản không có quyền thực hiện thao tác này' }], method);
    const rows = await securityRows(1);
    assert.deepEqual(rows.map(x => [x.event_type, x.status_code, x.method]), [['PERMISSION_DENIED', 403, method]], method);
  }
  assert.deepEqual([routeSql, events, db.audit.length, db.suppliers.length], [[], [], 0, 3]);
});

test('customer: mọi route -> 403 ở cổng chung, không chạm SQL', async () => {
  actor = CUSTOMER;
  for (const [method, path, body] of [['GET', ''], ['GET', '/1'], ['POST', '', { code: 'NCC-020', name: 'A' }],
    ['PUT', '/1', { name: 'B' }], ['PATCH', '/1/status', { is_active: false }]]) {
    const r = await call(method, path, body);
    assert.deepEqual([r.status, r.body.message], [403, 'Chỉ tài khoản quản trị mới được phép thao tác này'], method + path);
  }
  assert.deepEqual([routeSql, db.audit.length], [[], 0]);
});
