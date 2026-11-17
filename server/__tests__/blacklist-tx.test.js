'use strict';

// 2 route blacklist (routes/admin.js) chạy trong 1 transaction: POST /users/:userId/blacklist (đọc user
// WITH (UPDLOCK, ROWLOCK)) và POST /blacklist/:userId/release (chỉ 1 câu UPDATE giữ khoá X). Router +
// requireBackOffice/requirePermission thật qua HTTP; chỉ thay xác thực và SQL (SQL giả có transaction:
// begin chụp bản sao, commit ghi đè, rollback bỏ). Hành vi bên ngoài phải y như bản cũ.
// SQL thật trên DB tạm: scripts/verify-order-shipping-sql.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

let db, actor, events, queries, failStage;
const clone = x => structuredClone(x);
const rs = (recordset = []) => ({ recordset, rowsAffected: [recordset.length] });
class Transaction {
  async begin() { this.data = clone(db); events.push('begin'); }
  async commit() { db = this.data; events.push('commit'); }
  async rollback() { this.data = null; events.push('rollback'); }
}
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.p;
    if (q.startsWith('INSERT INTO dbo.audit_logs')) return rs([{ id: '1' }]);
    queries.push({ q, tx: this.tx });
    assert.ok(this.tx, 'mọi câu SQL của route phải chạy trong transaction: ' + q);
    const d = this.tx.data;
    if (q.startsWith('SELECT id, role FROM dbo.users')) {
      assert.match(q, /^SELECT id, role FROM dbo\.users WITH \(UPDLOCK, ROWLOCK\) WHERE id = @uid;$/);
      return rs(d.users.filter(u => u.id === p.uid).map(({ id, role }) => ({ id, role })));
    }
    if (q.startsWith("SELECT TOP 1 id FROM dbo.orders WHERE user_id = @uid AND status = 'cancelled'")) {
      return rs(d.orders.filter(o => o.user_id === p.uid && o.status === 'cancelled').slice(0, 1).map(o => ({ id: o.id })));
    }
    const m = q.match(/^UPDATE dbo\.users SET IsBlacklisted = ([01]) OUTPUT INSERTED\.id, INSERTED\.email, INSERTED\.IsBlacklisted AS is_blacklisted, DELETED\.IsBlacklisted AS was_blacklisted WHERE id = @uid;$/);
    if (m) {
      if (failStage === 'update') throw Object.assign(new Error('PRIVATE_SQL_DETAIL'), { number: 51099 });
      const u = d.users.find(x => x.id === p.uid);
      if (!u) return rs([]);
      const was = u.IsBlacklisted; u.IsBlacklisted = m[1] === '1';
      return rs([{ id: u.id, email: u.email, is_blacklisted: u.IsBlacklisted, was_blacklisted: was }]);
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
app.use(express.json());
app.use('/api/admin', require('../routes/admin'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
  db = { users: [
    { id: 7, email: 'khach@example.test', role: 'customer', IsBlacklisted: false },
    { id: 8, email: 'staff@example.test', role: 'staff', IsBlacklisted: false },
    { id: 9, email: 'admin@example.test', role: 'admin', IsBlacklisted: false },
    { id: 10, email: 'moi@example.test', role: 'customer', IsBlacklisted: false },
  ], orders: [{ id: 70, user_id: 7, status: 'cancelled' }, { id: 71, user_id: 10, status: 'completed' }] };
  actor = { id: 1, role: 'admin' }; events = []; queries = []; failStage = null;
});
const call = async path => {
  const r = await fetch(base + '/api/admin' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return { status: r.status, body: await r.json() };
};
const block = id => call(`/users/${id}/blacklist`);
const release = id => call(`/blacklist/${id}/release`);
// Mọi câu SQL chạy trên CÙNG 1 transaction, transaction đó đã kết thúc (commit hoặc rollback).
function oneTx(end) {
  assert.ok(queries.length > 0);
  assert.ok(queries.every(x => x.tx === queries[0].tx), 'cùng một transaction');
  assert.deepEqual(events, ['begin', end]);
}
const quiet = t => t.mock.method(console, 'error', () => {});

test('chặn thành công: 200, JSON đúng 3 trường cũ, 3 câu SQL trên 1 transaction, đọc user có UPDLOCK', async () => {
  const r = await block(7);
  assert.deepEqual(r, { status: 200, body: { status: 'ok', user: { id: 7, email: 'khach@example.test', is_blacklisted: true } } });
  assert.equal(db.users[0].IsBlacklisted, true);
  assert.equal(queries.length, 3);
  assert.match(queries[0].q, /WITH \(UPDLOCK, ROWLOCK\)/);
  oneTx('commit');
});

test('gỡ thành công: 200, JSON đúng 3 trường cũ, chỉ 1 câu UPDATE trên 1 transaction', async () => {
  db.users[0].IsBlacklisted = true;
  const r = await release(7);
  assert.deepEqual(r, { status: 200, body: { status: 'ok', user: { id: 7, email: 'khach@example.test', is_blacklisted: false } } });
  assert.equal(db.users[0].IsBlacklisted, false);
  assert.equal(queries.length, 1);
  oneTx('commit');
});

test('gọi lặp lại vẫn 200 như cũ (chặn 2 lần, gỡ 2 lần)', async () => {
  for (const fn of [block, block]) assert.equal((await fn(7)).status, 200);
  assert.equal(db.users[0].IsBlacklisted, true);
  for (const fn of [release, release]) {
    const r = await fn(7);
    assert.deepEqual(r.body, { status: 'ok', user: { id: 7, email: 'khach@example.test', is_blacklisted: false } });
  }
});

const ERRORS = [
  ['chặn: 404 không thấy user', () => block(99), 404, 'Không tìm thấy người dùng', 1],
  ['chặn: 400 tài khoản staff', () => block(8), 400, 'Không thể đưa tài khoản quản trị vào danh sách đen', 1],
  ['chặn: 400 tài khoản admin', () => block(9), 400, 'Không thể đưa tài khoản quản trị vào danh sách đen', 1],
  ['chặn: 400 không có đơn đã huỷ', () => block(10), 400, 'Hành Động Không Thành Công', 2],
  ['gỡ: 404 không thấy user', () => release(99), 404, 'Không tìm thấy người dùng', 1],
];
for (const [name, run, status, message, count] of ERRORS) {
  test(`${name} -> JSON y như cũ, dừng đúng chỗ, transaction ROLLBACK (không treo)`, async () => {
    const original = clone(db);
    assert.deepEqual(await run(), { status, body: { status: 'error', message } });
    assert.equal(queries.length, count);
    oneTx('rollback');
    assert.deepEqual(db, original);
  });
}

for (const [name, run, message] of [
  ['chặn', () => block(7), 'Không thêm được vào danh sách đen'],
  ['gỡ', () => { db.users[0].IsBlacklisted = true; return release(7); }, 'Không gỡ được người dùng khỏi danh sách đen'],
]) {
  test(`${name}: câu UPDATE ném lỗi -> 500 đúng thông báo cũ, rollback, dữ liệu không đổi, không lộ lỗi SQL`, async (t) => {
    quiet(t);
    const r0 = run; failStage = 'update';
    const original = name === 'gỡ' ? null : clone(db);
    const r = await r0();
    assert.deepEqual(r, { status: 500, body: { status: 'error', message } });
    assert.ok(!JSON.stringify(r.body).includes('PRIVATE_SQL_DETAIL'));
    oneTx('rollback');
    if (original) assert.deepEqual(db, original);
    else assert.equal(db.users[0].IsBlacklisted, true, 'gỡ thất bại -> vẫn đang bị chặn');
  });
}

test('id sai -> 400 như cũ, KHÔNG mở transaction', async () => {
  for (const run of [() => call('/users/abc/blacklist'), () => call('/blacklist/0/release')]) {
    events = []; queries = [];
    assert.deepEqual(await run(), { status: 400, body: { status: 'error', message: 'userId phải là số nguyên >= 1' } });
    assert.deepEqual([events, queries], [[], []]);
  }
});

test('staff: CHẶN được (200), GỠ -> 403 FORBIDDEN, không mở transaction', async () => {
  actor = { id: 2, role: 'staff' };
  assert.equal((await block(7)).status, 200);
  assert.equal(db.users[0].IsBlacklisted, true);
  events = []; queries = [];
  const r = await release(7);
  assert.equal(r.status, 403); assert.equal(r.body.code, 'FORBIDDEN');
  assert.deepEqual([events, queries], [[], []]);
  assert.equal(db.users[0].IsBlacklisted, true);
});
