'use strict';

// Bước 3 Phase A: các chỗ trước đây viết cứng 'admin' nay coi staff là "phía quản trị".
// Router + middleware + lib thật; chỉ thay Firebase và SQL (cùng kiểu security.test.js).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

const USERS = {
  'tok-staff': { id: 201, firebase_uid: 'u-staff', email: 'nv@example.test', role: 'staff' },
  'tok-staff-boss': { id: 202, firebase_uid: 'u-staff-boss', email: 'boss@example.test', role: 'staff' },
  'tok-admin': { id: 203, firebase_uid: 'u-admin', email: 'admin2@example.test', role: 'admin' },
  'tok-customer': { id: 204, firebase_uid: 'u-customer', email: 'kh@example.test', role: 'customer' },
};
let state, db;
const PAST_ROLE_CHECK = 'PAST_ROLE_CHECK';
const result = (rows = [], affected = rows.length) => ({ recordset: rows, rowsAffected: [affected] });
const byUid = uid => Object.values(db).find(u => u.firebase_uid === uid);
const byId = id => Object.values(db).find(u => u.id === id);
const row = u => ({ ...u, display_name: null, created_at: null, last_login: null, phone: null, dob: null,
  gender: null, country: null, avatar_url: null, is_blacklisted: false });

class Transaction { async begin() {} async commit() {} async rollback() { state.events.push('rollback'); } }
class Request {
  constructor() { this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.params;
    if (q.startsWith('SELECT id FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE firebase_uid')) return result([{ id: byUid(p.uid).id }]);
    if (q.startsWith('MERGE dbo.users')) return result([row(byUid(p.uid))]);
    if (q.startsWith("UPDATE dbo.users SET role = 'admin' WHERE firebase_uid = @uid")) {
      state.events.push('promote:' + p.uid);
      byUid(p.uid).role = 'admin';
      return result([row(byUid(p.uid))]);
    }
    state.queries.push(q);
    // Support lib: role SQL hiện tại (state.sqlRole cho phép giả lập role đổi giữa chừng).
    if (q.startsWith('SELECT role FROM dbo.users WITH (UPDLOCK,HOLDLOCK) WHERE id=@uid')) {
      return result([{ role: state.sqlRole || byId(p.uid).role }]);
    }
    if (q.startsWith('SELECT u.id,u.role,c.id AS conversation_id FROM dbo.users u')) {
      return result([{ id: p.uid, role: state.sqlRole || byId(p.uid).role, conversation_id: null }]);
    }
    if (q.startsWith('SELECT conversation_id FROM dbo.support_guest_sessions WHERE token_hash=@hash')) return result([]);
    // Xoá tài khoản.
    if (q.startsWith("SELECT TOP 1 1 AS x FROM dbo.orders WHERE user_id = @uid AND status = 'pending'")) return result([]);
    if (q.startsWith("SELECT COUNT(*) AS n FROM dbo.users WHERE role = 'admin'")) return result([{ n: state.adminCount }]);
    if (/^(UPDATE dbo\.orders SET user_id = NULL|DELETE FROM dbo\.)/.test(q)) { state.events.push('sql-delete'); return result([], 0); }
    // Qua được bước kiểm role thì dừng bằng lỗi đánh dấu — không cần giả lập phần còn lại.
    throw Object.assign(new Error(PAST_ROLE_CHECK), { q });
  }
}
const pool = { request: () => new Request() };
require.cache[require.resolve('../db')] = { exports: { sql: { ...realSql, Request, Transaction }, getPool: async () => pool } };
require.cache[require.resolve('../firebase')] = { exports: {
  getAuth: () => ({
    async verifyIdToken(token, revoked) {
      assert.equal(revoked, true);
      const u = db[token];
      if (!u) throw Object.assign(new Error('PRIVATE_TOKEN'), { code: 'auth/invalid-id-token' });
      return { uid: u.firebase_uid, email: u.email, email_verified: state.verified };
    },
    async deleteUser(uid) { state.events.push('firebase-delete:' + uid); },
  }),
  async verifyPassword() { return { ok: true }; },
} };

const support = require('../lib/customer-support');
const sessions = require('../lib/support-session');
const app = express();
app.use(express.json());
app.use('/api/orders', require('../routes/orders'));
app.use('/api/support', require('../routes/support'));
app.use('/api/account', require('../routes/account'));
app.use('/api/me', require('../routes/me'));
let server, base;
const savedAdmins = process.env.ADMIN_EMAILS;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = savedAdmins;
  await new Promise(r => server.close(r));
});
beforeEach(() => {
  process.env.ADMIN_EMAILS = '';
  db = structuredClone(USERS);
  state = { queries: [], events: [], sqlRole: null, adminCount: 1, verified: true };
});

async function call(method, path, token, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: {
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}

// ---- orders.js: staff bị chặn như admin, message giữ nguyên ----
const ORDER_BLOCKS = [
  ['POST', '/api/orders', {}, 'Tài khoản quản trị không được đặt hàng'],
  ['POST', '/api/orders/5/payment-simulation', { outcome: 'success' }, 'Chỉ chủ đơn hàng được mô phỏng thanh toán'],
  ['POST', '/api/orders/5/cancel', { reason: 'other', details: 'x' }, 'Tài khoản quản trị không thể dùng chức năng hủy đơn của khách'],
];
for (const [method, path, body, message] of ORDER_BLOCKS) {
  for (const token of ['tok-staff', 'tok-admin']) {
    test(token + ' ' + method + ' ' + path + ' -> 403, message cũ, không chạm SQL đơn hàng', async () => {
      const r = await call(method, path, token, body);
      assert.equal(r.status, 403);
      assert.deepEqual(r.body, { status: 'error', message });
      assert.deepEqual(state.queries, []);
    });
  }
}
test('customer POST /api/orders không bị chặn ở bước role (control)', async () => {
  const r = await call('POST', '/api/orders', 'tok-customer', {});
  assert.notEqual(r.status, 403);
  assert.notEqual(r.body && r.body.message, 'Tài khoản quản trị không được đặt hàng');
});

// ---- lib/customer-support.js: kiểm role SQL trong transaction ----
test('inbox phía quản trị: role SQL admin và staff qua được, customer bị 403', async () => {
  for (const role of ['admin', 'staff']) {
    state.sqlRole = role;
    await assert.rejects(support.inbox(pool, { kind: 'admin', userId: 201 }, support.inboxInput({})),
      e => e.message === PAST_ROLE_CHECK, role);
  }
  for (const role of ['customer', 'Admin', 'guest']) {
    state.sqlRole = role;
    await assert.rejects(support.inbox(pool, { kind: 'admin', userId: 201 }, support.inboxInput({})),
      e => e.status === 403 && e.code === 'SUPPORT_FORBIDDEN', role);
  }
});
test('hội thoại phía khách: chỉ role customer; staff/admin bị 403', async () => {
  state.sqlRole = 'customer';
  await assert.rejects(support.history(pool, { kind: 'customer', userId: 204 }, null, support.historyInput({})),
    e => e.message === PAST_ROLE_CHECK);
  for (const role of ['staff', 'admin']) {
    state.sqlRole = role;
    await assert.rejects(support.history(pool, { kind: 'customer', userId: 204 }, null, support.historyInput({})),
      e => e.status === 403 && e.code === 'SUPPORT_FORBIDDEN', role);
  }
});
test('luồng SSE: staff mở được luồng quản trị; mất quyền (về customer) thì 403', async () => {
  const scope = await support.streamAccess(pool, { kind: 'admin', userId: 201, firebaseUid: 'u-staff' });
  assert.equal(scope.kind, 'admin');
  assert.equal(scope.userId, 201);
  state.sqlRole = 'customer';
  await assert.rejects(support.streamAccess(pool, { kind: 'admin', userId: 201, firebaseUid: 'u-staff' }),
    e => e.status === 403 && e.code === 'SUPPORT_FORBIDDEN');
  state.sqlRole = 'staff';
  await assert.rejects(support.streamAccess(pool, { kind: 'customer', userId: 201, firebaseUid: 'u-staff' }),
    e => e.status === 403, 'staff không mở được luồng phía khách');
});

// ---- lib/support-session.js ----
test('discardGuest: admin và staff được, customer bị 403; mergeGuest vẫn chỉ cho customer', async () => {
  for (const role of ['admin', 'staff']) {
    state.sqlRole = role;
    assert.deepEqual(await sessions.discardGuest(pool, { kind: 'admin', userId: 201 }, Buffer.alloc(32)), { discarded: false });
  }
  state.sqlRole = 'customer';
  await assert.rejects(sessions.discardGuest(pool, { kind: 'admin', userId: 201 }, Buffer.alloc(32)), e => e.status === 403);
  state.sqlRole = 'staff';
  await assert.rejects(sessions.mergeGuest(pool, { kind: 'customer', userId: 201 }, Buffer.alloc(32)), e => e.status === 403);
});

// ---- routes/support.js: staff gọi API phía khách -> xử lý như admin ----
test('staff gọi API chat phía khách -> 403 SUPPORT_CUSTOMER_ONLY như admin', async () => {
  for (const token of ['tok-staff', 'tok-admin']) {
    for (const [method, path, body] of [['GET', '/api/support/conversation'], ['GET', '/api/support/conversation/messages'],
      ['POST', '/api/support/messages', { text: 'hi', clientMessageId: '00000000-0000-4000-8000-000000000000' }],
      ['POST', '/api/support/guest-session', {}], ['POST', '/api/support/heartbeat', {}]]) {
      const r = await call(method, path, token, body);
      assert.equal(r.status, 403, token + ' ' + path);
      assert.equal(r.body.code, 'SUPPORT_CUSTOMER_ONLY');
    }
  }
  assert.deepEqual(state.queries, []);
});
test('staff POST /api/support/session -> nhánh admin: role "admin", huỷ phiên khách, không nhận hội thoại', async () => {
  const cookie = { Cookie: 'breeze_support_guest=' + 'a'.repeat(43) };
  for (const token of ['tok-staff', 'tok-admin']) {
    state.queries = [];
    const r = await call('POST', '/api/support/session', token, {}, cookie);
    assert.equal(r.status, 200, token);
    assert.deepEqual(r.body, { role: 'admin', active: false, merged: false, discarded: false });
    assert.match(r.headers.get('set-cookie') || '', /breeze_support_guest=;/, 'xoá cookie khách');
    assert.ok(state.queries.some(q => q.startsWith('SELECT role FROM dbo.users WITH (UPDLOCK,HOLDLOCK)')), 'đi qua discardGuest');
  }
  const c = await call('POST', '/api/support/session', 'tok-customer', {});
  assert.deepEqual([c.status, c.body.role], [200, 'customer'], 'control: customer vẫn nhánh customer');
});

// ---- middleware/auth.js: ADMIN_EMAILS không nâng staff ngoài danh sách ----
test('ADMIN_EMAILS: staff có email NGOÀI danh sách giữ nguyên staff, không chạy UPDATE role', async () => {
  process.env.ADMIN_EMAILS = 'boss@example.test';
  const r = await call('GET', '/api/me', 'tok-staff');
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'staff');
  assert.deepEqual(state.events.filter(e => e.startsWith('promote')), []);
});
test('ADMIN_EMAILS: email trong danh sách nhưng CHƯA xác minh -> vẫn staff', async () => {
  process.env.ADMIN_EMAILS = 'boss@example.test';
  state.verified = false;
  assert.equal((await call('GET', '/api/me', 'tok-staff-boss')).body.role, 'staff');
  assert.deepEqual(state.events, []);
});
test('ADMIN_EMAILS: email trong danh sách + đã xác minh -> nâng admin (hành vi cũ; create-staff từ chối email này)', async () => {
  process.env.ADMIN_EMAILS = ' Boss@Example.test , other@example.test';
  const r = await call('GET', '/api/me', 'tok-staff-boss');
  assert.equal(r.body.role, 'admin');
  assert.deepEqual(state.events, ['promote:u-staff-boss']);
});

// ---- routes/account.js: không xoá được admin cuối cùng ----
test('xoá tài khoản admin cuối cùng -> 409 LAST_ADMIN, Firebase và SQL không bị xoá', async () => {
  state.adminCount = 1;
  const r = await call('DELETE', '/api/account', 'tok-admin', { password: 'x' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'LAST_ADMIN');
  assert.deepEqual(state.events, []);
});
test('xoá admin khi còn admin khác -> 200, xoá Firebase rồi SQL', async () => {
  state.adminCount = 2;
  const r = await call('DELETE', '/api/account', 'tok-admin', { password: 'x' });
  assert.equal(r.status, 200);
  assert.equal(state.events[0], 'firebase-delete:u-admin');
  assert.ok(state.events.includes('sql-delete'));
});
test('staff/customer xoá tài khoản không bị kiểm "admin cuối" (không đếm admin)', async () => {
  state.adminCount = 0; // nếu lỡ đếm thì sẽ ra 409
  for (const token of ['tok-staff', 'tok-customer']) {
    state.events = []; state.queries = [];
    const r = await call('DELETE', '/api/account', token, { password: 'x' });
    assert.equal(r.status, 200, token);
    assert.ok(!state.queries.some(q => q.includes('COUNT(*) AS n FROM dbo.users')), token);
    assert.equal(state.events[0], 'firebase-delete:' + db[token].firebase_uid);
  }
});
test('lỗi SQL khi đếm admin -> 500, KHÔNG xoá Firebase', async () => {
  const orig = Request.prototype.query;
  Request.prototype.query = async function (raw) {
    if (/COUNT\(\*\) AS n FROM dbo\.users/.test(raw)) throw Object.assign(new Error('PRIVATE'), { code: 'ETIMEOUT' });
    return orig.call(this, raw);
  };
  const saved = console.error; console.error = () => {};
  try {
    const r = await call('DELETE', '/api/account', 'tok-admin', { password: 'x' });
    assert.equal(r.status, 500);
    assert.deepEqual(state.events, []);
  } finally { Request.prototype.query = orig; console.error = saved; }
});
