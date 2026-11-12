'use strict';

// PATCH /api/me/phone qua HTTP: router + middleware auth thật, chỉ thay Firebase và SQL.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

const USERS = {
  'user-a': { id: 1, firebase_uid: 'user-a', email: 'a@example.test', role: 'customer', display_name: 'A',
    created_at: '2026-01-01T00:00:00.000Z', last_login: '2026-10-31T00:00:00.000Z', is_blacklisted: false,
    phone: null, dob: '2000-01-02', gender: 'female', country: 'VN', avatar_url: null },
  'user-b': { id: 2, firebase_uid: 'user-b', email: 'b@example.test', role: 'customer',
    phone: null, dob: null, gender: null, country: null, avatar_url: null },
};
let db, routeQueries, poolCalls;
const result = (rows = [], affected = rows.length) => ({ recordset: rows, rowsAffected: [affected] });

class Transaction { async begin() {} async commit() {} async rollback() {} }
class Request {
  constructor() { this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(text) {
    const q = text.replace(/\s+/g, ' ').trim(), p = this.params;
    if (q.startsWith('SELECT id FROM dbo.users WITH')) return result([{ id: db[p.uid].id }]);
    if (q.startsWith('MERGE dbo.users')) return result([{ ...db[p.uid] }]);
    routeQueries.push({ q, p: { ...p } });
    if (q.startsWith('UPDATE dbo.users SET phone = @phone WHERE firebase_uid = @uid;')) {
      db[p.uid].phone = p.phone;
      return result([{ ...db[p.uid] }]);
    }
    throw new Error('Unexpected SQL: ' + q);
  }
}
const pool = { request: () => new Request() };
require.cache[require.resolve('../db')] = { exports: {
  getPool: async () => { poolCalls++; return pool; }, sql: { ...realSql, Transaction, Request },
} };
require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({
  async verifyIdToken(token) {
    if (!USERS[token]) throw Object.assign(new Error('bad'), { code: 'auth/invalid-id-token' });
    return { uid: token, email: USERS[token].email, email_verified: true };
  },
}) } };

const app = express();
app.use(express.json());
app.use('/api/me', require('../routes/me'));
let server, base;
const savedAdmins = process.env.ADMIN_EMAILS;
before(async () => {
  process.env.ADMIN_EMAILS = '';
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = savedAdmins;
  await new Promise(r => server.close(r));
});
// Limiter của PATCH /phone khoá theo req.user.id và giữ bộ đếm suốt file. Mỗi test cho
// user-a một id mới để các test không cộng dồn lượt; user-b giữ id 2 cho test rate limit.
let nextId = 100;
beforeEach(() => {
  db = structuredClone(USERS);
  db['user-a'].id = nextId++;
  routeQueries = []; poolCalls = 0;
});

async function patch(body, token = 'user-a') {
  const r = await fetch(base + '/api/me/phone', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
}

for (const phone of ['12345', '090123456', '09012345678', '+14155552671', 'abc', '', '   ', null, 901234567, ['0901234567'],
  '0281234567', '+84 28 1234 567', '0121234567', '0412345678', '0612345678']) {
  test('sai định dạng ' + JSON.stringify(phone) + ' -> 400, không ghi DB', async () => {
    const r = await patch({ phone });
    assert.equal(r.status, 400);
    assert.equal(r.body.status, 'error');
    assert.equal(r.body.message, 'Số điện thoại di động không hợp lệ (10 số, đầu 03/05/07/08/09)');
    assert.equal(routeQueries.length, 0);
    assert.equal(db['user-a'].phone, null);
  });
}
test('thiếu phone trong body -> 400', async () => {
  assert.equal((await patch({})).status, 400);
  assert.equal(routeQueries.length, 0);
});

for (const [raw, saved] of [['0901234567', '0901234567'], ['+84 901 234 567', '0901234567'],
  ['84901234567', '0901234567'], ['(090) 123.45-67', '0901234567'], ['0321234567', '0321234567'],
  ['+84 561 234 567', '0561234567'], ['0771234567', '0771234567'], ['84812345678', '0812345678']]) {
  test('đúng định dạng ' + JSON.stringify(raw) + ' -> 200, lưu bản chuẩn hoá ' + saved, async () => {
    const r = await patch({ phone: raw });
    assert.equal(r.status, 200);
    assert.equal(r.body.phone, saved);
    assert.equal(db['user-a'].phone, saved);
    assert.equal(routeQueries.length, 1);
    assert.deepEqual(routeQueries[0].p, { uid: 'user-a', phone: saved });
  });
}

test('chỉ ghi cột phone, tham số SQL chỉ gồm uid + phone; dob/gender/country giữ nguyên', async () => {
  const r = await patch({ phone: '0901234567' });
  assert.equal(r.status, 200);
  const { q, p } = routeQueries[0];
  assert.deepEqual(Object.keys(p).sort(), ['phone', 'uid']);
  const update = q.split(';')[0];
  assert.equal(update, 'UPDATE dbo.users SET phone = @phone WHERE firebase_uid = @uid');
  assert.doesNotMatch(update, /dob|gender|country|role|avatar/);
  assert.equal(r.body.dob, '2000-01-02');
  assert.equal(r.body.gender, 'female');
  assert.equal(r.body.country, 'VN');
  assert.equal(r.body.role, 'customer');
});

test('uid lấy từ token, bỏ qua firebase_uid/role/id giả trong body', async () => {
  const r = await patch({ phone: '0901234567', firebase_uid: 'user-b', uid: 'user-b', id: 2, role: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(routeQueries[0].p.uid, 'user-a');
  assert.equal(db['user-b'].phone, null);
  assert.equal(r.body.role, 'customer');
});

test('response cùng dạng toDto với các route khác của /api/me', async () => {
  const r = await patch({ phone: '0901234567' });
  assert.deepEqual(Object.keys(r.body).sort(), ['avatar_url', 'country', 'created_at', 'display_name', 'dob',
    'email', 'firebase_uid', 'gender', 'id', 'last_login', 'permissions', 'phone', 'role']);
  assert.deepEqual(r.body.permissions, [], 'customer: không quyền quản trị nào');
  assert.ok(!('is_blacklisted' in r.body));
});

test('không token -> 401, không chạm DB', async () => {
  const r = await patch({ phone: '0901234567' }, null);
  assert.equal(r.status, 401);
  assert.equal(poolCalls, 0);
});
test('token sai -> 401, không ghi DB', async () => {
  const r = await patch({ phone: '0901234567' }, 'forged');
  assert.equal(r.status, 401);
  assert.equal(routeQueries.length, 0);
});

test('rate limit theo user: quá 20 lần / 15 phút -> 429, user khác không bị ảnh hưởng', async () => {
  for (let i = 0; i < 20; i++) assert.equal((await patch({ phone: '0901234567' }, 'user-b')).status, 200);
  const r = await patch({ phone: '0901234567' }, 'user-b');
  assert.equal(r.status, 429);
  assert.match(r.body.message, /số điện thoại/);
  assert.equal((await patch({ phone: '0901234567' }, 'user-a')).status, 200);
});
