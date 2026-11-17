'use strict';

// ROLE_CHANGE: tham số tuỳ chọn { sql } của audit(), roleChange (lib/user-review-audit.js), và
// db/create-staff.js ghi log trong transaction bằng sql TIÊM vào (Firebase + SQL đều giả, không tạo tài khoản thật).
// set-role.js chạy main() ngay khi nạp -> kiểm bằng tiến trình con trên DB tạm: scripts/verify-audit-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const realSql = require('mssql');

// sql "của ../db" giả: ghi nhận audit() dùng Request nào khi KHÔNG truyền tham số thứ 4.
const moduleCalls = [];
class ModuleRequest {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(n, t, v) { this.p[n] = v; return this; }
  async query(q) { moduleCalls.push({ tx: this.tx, q, p: this.p }); return { recordset: [{ id: 'm1' }] }; }
}
require.cache[require.resolve('../db')] = { exports: { sql: { ...realSql, Request: ModuleRequest } } };
const { audit, buildAuditRow } = require('../lib/audit');
const { roleChange } = require('../lib/user-review-audit');
const staff = require('../db/create-staff');

const entry = { action: 'ROLE_CHANGE', entityType: 'user', entityId: 5, actor: { role: 'cli' },
  before: { user: { email: 'a@x', role: 'customer' } }, after: { user: { email: 'a@x', role: 'staff' }, source: 'set-role' } };

test('audit(): KHÔNG truyền tham số 4 -> dùng sql của ../db y như cũ (cùng tx, cùng tham số, trả id)', async () => {
  moduleCalls.length = 0;
  const tx = { tag: 'tx' };
  assert.equal(await audit(tx, null, entry), 'm1');
  assert.equal(await audit(tx, null, entry, {}), 'm1', '{} cũng như không truyền');
  assert.equal(moduleCalls.length, 2);
  assert.equal(moduleCalls[0].tx, tx);
  assert.deepEqual(moduleCalls[0].p.after_json, JSON.stringify(entry.after));
});

test('audit(): truyền { sql } -> dùng ĐÚNG sql.Request được tiêm, không đụng sql của ../db', async () => {
  moduleCalls.length = 0;
  const injected = [];
  class InjectedRequest extends ModuleRequest { async query(q) { injected.push({ tx: this.tx, q, p: this.p }); return { recordset: [{ id: 'i1' }] }; } }
  const tx = { tag: 'tx2' };
  assert.equal(await audit(tx, null, entry, { sql: { ...realSql, Request: InjectedRequest } }), 'i1');
  assert.equal(moduleCalls.length, 0);
  assert.equal(injected.length, 1); assert.equal(injected[0].tx, tx);
  assert.match(injected[0].q, /INSERT INTO dbo\.audit_logs/);
  assert.deepEqual(Object.keys(injected[0].p).sort(), ['action', 'actor_email', 'actor_role', 'actor_user_id', 'after_json',
    'before_json', 'entity_id', 'entity_type', 'ip', 'user_agent']);
});

test('roleChange qua buildAuditRow (req = null, actor cli): email ở cả 2 phía, actor id/email/ip/user_agent NULL', () => {
  const r = buildAuditRow(null, { action: 'ROLE_CHANGE', entityType: 'user', entityId: 5, actor: { role: 'cli' },
    ...roleChange({ email: 'nv@example.test', oldRole: 'customer', newRole: 'staff', source: 'set-role' }) });
  assert.deepEqual([r.actor_role, r.actor_user_id, r.actor_email, r.ip, r.user_agent, r.entity_type, r.entity_id],
    ['cli', null, null, null, null, 'user', '5']);
  assert.deepEqual([JSON.parse(r.before_json), JSON.parse(r.after_json)], [{ user: { email: 'nv@example.test', role: 'customer' } },
    { user: { email: 'nv@example.test', role: 'staff' }, source: 'set-role' }]);
});

test('roleChange: cùng role -> null (0 dòng); tài khoản mới (oldRole null) -> before null', () => {
  assert.equal(roleChange({ email: 'a@x', oldRole: 'staff', newRole: 'staff', source: 'set-role' }), null);
  assert.deepEqual(roleChange({ email: 'a@x', oldRole: null, newRole: 'staff', source: 'create-staff' }),
    { before: null, after: { user: { email: 'a@x', role: 'staff' }, source: 'create-staff' } });
});

// Thế giới giả tối thiểu cho create-staff (cùng kiểu __tests__/create-staff.test.js).
function world(opts = {}) {
  const st = { events: [], audits: [], fbUsers: new Map(), rows: (opts.rows || []).map(r => ({ ...r })) };
  const auth = {
    async getUserByEmail(email) { if (st.fbUsers.has(email)) return { uid: 'x' }; throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); },
    async createUser(p) { st.events.push('fb:create'); st.created = p; st.fbUsers.set(p.email, 'uid-new'); return { uid: 'uid-new' }; },
    async deleteUser(uid) { st.events.push('fb:delete:' + uid); st.fbUsers.clear(); },
  };
  class Transaction {
    async begin() { st.events.push('tx:begin'); }
    async commit() { st.events.push('tx:commit'); }
    async rollback() { st.events.push('tx:rollback'); }
  }
  class Request {
    constructor(tx) { this.tx = tx; this.p = {}; }
    input(n, t, v) { this.p[n] = v; return this; }
    async query(raw) {
      const q = raw.replace(/\s+/g, ' ').trim(), p = this.p;
      if (q.startsWith('SELECT TOP 1 id, role FROM dbo.users')) return { recordset: st.rows.filter(r => r.email === p.email) };
      if (q.startsWith('SELECT TOP 1 id FROM dbo.users WITH')) return { recordset: [] };
      if (q.startsWith('MERGE dbo.users')) return { recordset: [{ id: 501, firebase_uid: p.uid, email: p.email, display_name: p.displayName, role: 'staff' }] };
      if (q.startsWith('INSERT INTO dbo.audit_logs')) {
        assert.ok(this.tx, 'audit trong transaction');
        if (opts.auditError) throw Object.assign(new Error('PRIVATE audit fail'), { code: 'EREQUEST' });
        st.audits.push(p); return { recordset: [{ id: '1' }] };
      }
      throw new Error('Unexpected SQL: ' + q);
    }
  }
  const lines = { out: [], err: [] };
  const typed = [...(opts.typed || [])];
  const io = { interactive: true, out: l => lines.out.push(l), err: l => lines.err.push(l), warn: () => {},
    promptHidden: async () => typed.shift(), confirm: async () => false };
  const deps = { auth, pool: { request: () => new Request(null) }, sql: { ...realSql, Transaction, Request }, adminEmails: new Set(['boss@example.test']) };
  return { st, lines, go: argv => staff.run(argv, deps, io) };
}
const val = p => ({ ...p }); // Request giả lưu thẳng giá trị tham số

test('create-staff: thành công -> đúng 1 dòng ROLE_CHANGE (cli, before null, source create-staff) bằng sql TIÊM, trong tx', async () => {
  moduleCalls.length = 0;
  const w = world();
  assert.equal(await w.go(['NV@Example.test', 'Nhân Viên']), 0);
  assert.equal(w.st.audits.length, 1); assert.equal(moduleCalls.length, 0, 'không dùng sql của ../db');
  const a = val(w.st.audits[0]);
  assert.deepEqual([a.action, a.entity_type, a.entity_id, a.actor_role, a.actor_user_id, a.actor_email, a.ip, a.user_agent, a.before_json],
    ['ROLE_CHANGE', 'user', '501', 'cli', null, null, null, null, null]);
  assert.deepEqual(JSON.parse(a.after_json), { user: { email: 'nv@example.test', role: 'staff' }, source: 'create-staff' });
  assert.ok(!a.after_json.includes(w.st.created.password), 'mật khẩu sinh ra không vào log');
  assert.deepEqual(w.st.events, ['fb:create', 'tx:begin', 'tx:commit']);
});

test('create-staff --password: mật khẩu tự nhập KHÔNG xuất hiện trong after_json', async () => {
  const pw = 'Tq7#vLx9!mW2pRz';
  const w = world({ typed: [pw, pw] });
  assert.equal(await w.go(['nv2@example.test', 'NV', '--password']), 0);
  assert.equal(w.st.audits.length, 1);
  assert.ok(!JSON.stringify(val(w.st.audits[0])).includes(pw));
});

test('create-staff: email đã có trong DB / email admin -> exit 1 như cũ, 0 dòng log', async () => {
  const dup = world({ rows: [{ id: 9, email: 'nv@example.test', role: 'customer' }] });
  assert.equal(await dup.go(['nv@example.test', 'NV']), 1);
  assert.match(dup.lines.err[0], /^LỖI: Email đã có trong dbo\.users \(id 9, role customer\)/);
  const boss = world();
  assert.equal(await boss.go(['boss@example.test', 'Sếp']), 1);
  assert.match(boss.lines.err[0], /^LỖI: Email nằm trong ADMIN_EMAILS/);
  assert.deepEqual([dup.st.audits.length, boss.st.audits.length, dup.st.events, boss.st.events], [0, 0, [], []]);
});

test('create-staff: audit() lỗi -> rollback, xoá user Firebase vừa tạo, exit 1 với thông báo SQL_FAILED sẵn có', async () => {
  const w = world({ auditError: true });
  assert.equal(await w.go(['nv3@example.test', 'NV']), 1);
  assert.deepEqual(w.st.events, ['fb:create', 'tx:begin', 'tx:rollback', 'fb:delete:uid-new']);
  assert.deepEqual(w.lines.err, ['LỖI: Ghi dbo.users thất bại (lỗi SQL (EREQUEST)). Đã xoá user Firebase vừa tạo — chưa có gì thay đổi.']);
  assert.equal(w.st.fbUsers.size, 0);
  assert.ok(!w.lines.err.join('').includes('PRIVATE'));
});
