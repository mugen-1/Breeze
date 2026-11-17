'use strict';

// log blacklist + ẩn/hiện đánh giá qua HTTP: POST /api/admin/users/:userId/blacklist,
// POST /api/admin/blacklist/:userId/release, PATCH /api/admin/reviews/:reviewId/visibility.
// Router + requireBackOffice/requirePermission + lib/audit.js THẬT; chỉ thay xác thực và SQL (SQL giả có transaction).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

let db, actor, events, failAudit;
const clone = x => structuredClone(x);
const rs = (recordset = []) => ({ recordset, recordsets: [recordset], rowsAffected: [recordset.length] });
class Transaction {
  async begin() { this.data = clone(db); events.push('begin'); }
  async commit() { db = this.data; events.push('commit'); }
  async rollback() { this.data = null; events.push('rollback'); }
}
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.p, d = this.tx ? this.tx.data : db;
    if (!d) throw new Error('SQL sau rollback');
    if (q.startsWith('INSERT INTO dbo.audit_logs')) {
      assert.ok(this.tx, 'audit phải chạy trong transaction');
      if (failAudit) throw new Error('audit giả lỗi');
      d.audit.push({ actor_user_id: p.actor_user_id, actor_email: p.actor_email, actor_role: p.actor_role, action: p.action,
        entity_type: p.entity_type, entity_id: p.entity_id, before_json: p.before_json, after_json: p.after_json,
        before: JSON.parse(p.before_json), after: JSON.parse(p.after_json) });
      return rs([{ id: String(d.audit.length) }]);
    }
    if (q.startsWith('SELECT id, role FROM dbo.users WITH (UPDLOCK, ROWLOCK)')) {
      return rs(d.users.filter(u => u.id === p.uid).map(({ id, role }) => ({ id, role })));
    }
    if (q.startsWith("SELECT TOP 1 id FROM dbo.orders WHERE user_id = @uid AND status = 'cancelled'")) {
      return rs(d.orders.filter(o => o.user_id === p.uid && o.status === 'cancelled').slice(0, 1).map(o => ({ id: o.id })));
    }
    const m = q.match(/^UPDATE dbo\.users SET IsBlacklisted = ([01]) /);
    if (m) {
      const u = d.users.find(x => x.id === p.uid); if (!u) return rs([]);
      const was = u.IsBlacklisted; u.IsBlacklisted = m[1] === '1';
      return rs([{ id: u.id, email: u.email, is_blacklisted: u.IsBlacklisted, was_blacklisted: was }]);
    }
    if (q.startsWith('UPDATE dbo.reviews SET is_hidden=@hidden')) {
      assert.match(q, /OUTPUT INSERTED\.id,INSERTED\.is_hidden,DELETED\.is_hidden AS was_hidden,INSERTED\.product_id/);
      const r = d.reviews.find(x => x.id === p.rid); if (!r) return rs([]);
      const was = r.is_hidden; r.is_hidden = p.hidden; r.updated_at = 'vis';
      return rs([{ id: r.id, is_hidden: r.is_hidden, was_hidden: was, product_id: r.product_id }]);
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
  base = 'http://127.0.0.1:' + server.address().port + '/api/admin';
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
const ADMIN = { id: 1, email: 'admin@example.test', role: 'admin' };
const STAFF = { id: 2, email: 'staff@example.test', role: 'staff' };
beforeEach(() => {
  db = { audit: [],
    users: [{ id: 7, email: 'khach@example.test', role: 'customer', IsBlacklisted: false },
      { id: 8, email: 'nv@example.test', role: 'staff', IsBlacklisted: false },
      { id: 10, email: 'moi@example.test', role: 'customer', IsBlacklisted: false }],
    orders: [{ id: 70, user_id: 7, status: 'cancelled' }],
    reviews: [{ id: 9, product_id: 5, is_hidden: false, comment: '<b>nội dung</b>', updated_at: 'u' }] };
  actor = ADMIN; events = []; failAudit = false;
});
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
};
const block = id => call('POST', `/users/${id}/blacklist`, {});
const release = id => call('POST', `/blacklist/${id}/release`, {});
const visibility = (id, isHidden) => call('PATCH', `/reviews/${id}/visibility`, { isHidden });
const quiet = t => t.mock.method(console, 'error', () => {});
const oneRow = (action, entityType, entityId, who = ADMIN) => {
  assert.equal(db.audit.length, 1, 'đúng 1 dòng log');
  const r = db.audit[0];
  assert.deepEqual([r.actor_user_id, r.actor_role, r.actor_email, r.action, r.entity_type, r.entity_id],
    [who.id, who.role, who.email, action, entityType, String(entityId)]);
  return r;
};
const userBody = b => ({ status: 200, body: { status: 'ok', user: { id: 7, email: 'khach@example.test', is_blacklisted: b } } });

// ---------------- USER_BLACKLIST ----------------
for (const who of [ADMIN, STAFF]) {
  test(`USER_BLACKLIST (${who.role}): JSON y như cũ, 1 dòng user{email, is_blacklisted} false -> true, không lưu role`, async () => {
    actor = who;
    assert.deepEqual(await block(7), userBody(true));
    const log = oneRow('USER_BLACKLIST', 'user', 7, who);
    assert.deepEqual([log.before, log.after], [{ user: { email: 'khach@example.test', is_blacklisted: false } },
      { user: { email: 'khach@example.test', is_blacklisted: true } }]);
    assert.doesNotMatch(log.before_json + log.after_json, /role|customer|firebase/);
  });
}
test('USER_BLACKLIST: chặn lần 2 -> 200 như cũ, 0 dòng mới; 400 id sai / staff / không đơn huỷ, 404 -> 0 dòng', async () => {
  await block(7);
  assert.deepEqual(await block(7), userBody(true)); assert.equal(db.audit.length, 1);
  db.audit = [];
  assert.equal((await call('POST', '/users/abc/blacklist', {})).status, 400);
  assert.equal((await block(8)).status, 400);
  assert.deepEqual(await block(10), { status: 400, body: { status: 'error', message: 'Hành Động Không Thành Công' } });
  assert.equal((await block(99)).status, 404);
  assert.equal(db.audit.length, 0);
});
test('USER_BLACKLIST: audit() lỗi -> rollback, IsBlacklisted không đổi, 500 như cũ', async (t) => {
  quiet(t); failAudit = true;
  assert.deepEqual(await block(7), { status: 500, body: { status: 'error', message: 'Không thêm được vào danh sách đen' } });
  assert.equal(db.users[0].IsBlacklisted, false); assert.equal(events.at(-1), 'rollback');
});

// ---------------- USER_UNBLACKLIST ----------------
test('USER_UNBLACKLIST (admin): JSON y như cũ, 1 dòng true -> false; gỡ lần 2 -> 200, 0 dòng mới', async () => {
  db.users[0].IsBlacklisted = true;
  assert.deepEqual(await release(7), userBody(false));
  const log = oneRow('USER_UNBLACKLIST', 'user', 7);
  assert.deepEqual([log.before, log.after], [{ user: { email: 'khach@example.test', is_blacklisted: true } },
    { user: { email: 'khach@example.test', is_blacklisted: false } }]);
  assert.deepEqual(await release(7), userBody(false)); assert.equal(db.audit.length, 1);
});
test('USER_UNBLACKLIST: staff -> 403, 404 -> 0 dòng; audit() lỗi -> 500 như cũ, vẫn bị chặn', async (t) => {
  db.users[0].IsBlacklisted = true;
  actor = STAFF; const r = await release(7);
  assert.equal(r.status, 403); assert.equal(r.body.code, 'FORBIDDEN');
  actor = ADMIN; assert.equal((await release(99)).status, 404);
  assert.equal(db.audit.length, 0);
  quiet(t); failAudit = true;
  assert.deepEqual(await release(7), { status: 500, body: { status: 'error', message: 'Không gỡ được người dùng khỏi danh sách đen' } });
  assert.equal(db.users[0].IsBlacklisted, true);
});

// ---------------- REVIEW_VISIBILITY ----------------
for (const who of [ADMIN, STAFF]) {
  test(`REVIEW_VISIBILITY (${who.role}): JSON y như cũ, 1 dòng review{product_id, is_hidden}, không nội dung đánh giá`, async () => {
    actor = who;
    assert.deepEqual(await visibility(9, true), { status: 200, body: { id: 9, isHidden: true } });
    const log = oneRow('REVIEW_VISIBILITY', 'review', 9, who);
    assert.deepEqual([log.before, log.after], [{ review: { product_id: 5, is_hidden: false } }, { review: { product_id: 5, is_hidden: true } }]);
    assert.doesNotMatch(log.before_json + log.after_json, /comment|nội dung/);
  });
}
test('REVIEW_VISIBILITY: ẩn lần 2 -> 200 như cũ, 0 dòng mới; hiện lại -> 1 dòng; 400 / 404 / khách 403 -> 0 dòng', async () => {
  await visibility(9, true);
  assert.deepEqual(await visibility(9, true), { status: 200, body: { id: 9, isHidden: true } });
  assert.equal(db.audit.length, 1);
  assert.deepEqual(await visibility(9, false), { status: 200, body: { id: 9, isHidden: false } });
  assert.equal(db.audit.length, 2);
  assert.deepEqual([db.audit[1].before, db.audit[1].after], [{ review: { product_id: 5, is_hidden: true } }, { review: { product_id: 5, is_hidden: false } }]);
  db.audit = [];
  assert.equal((await call('PATCH', '/reviews/9/visibility', { isHidden: 'yes' })).status, 400);
  assert.equal((await call('PATCH', '/reviews/abc/visibility', { isHidden: true })).status, 400);
  assert.equal((await visibility(99, true)).status, 404);
  actor = { id: 3, email: 'k@example.test', role: 'customer' }; assert.equal((await visibility(9, true)).status, 403);
  assert.equal(db.audit.length, 0);
});
test('REVIEW_VISIBILITY: audit() lỗi -> rollback, is_hidden không đổi, 500 như cũ', async (t) => {
  quiet(t); failAudit = true;
  assert.deepEqual(await visibility(9, true), { status: 500, body: { status: 'error', code: 'REVIEW_ADMIN_ERROR',
    message: 'Không xử lý được đánh giá. Vui lòng thử lại' } });
  assert.equal(db.reviews[0].is_hidden, false); assert.equal(events.at(-1), 'rollback');
});
