'use strict';

// lib/audit.js — buildAuditRow (thuần) + audit() với Request giả. Kiểm thật trên SQL Server
// (commit/rollback, trigger, ISJSON): scripts/verify-audit-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const realSql = require('mssql');

const executed = [];
class FakeRequest {
  constructor(tx) { this.tx = tx; this.inputs = {}; }
  input(name, type, value) { this.inputs[name] = { type, value }; return this; }
  async query(q) { executed.push({ tx: this.tx, q, inputs: this.inputs }); return { recordset: [{ id: '42' }] }; }
}
require.cache[require.resolve('../db')] = { exports: { sql: { ...realSql, Request: FakeRequest } } };
const { audit, buildAuditRow, ACTIONS, ENTITY_TYPES } = require('../lib/audit');

const XSS = '<img src=x onerror=alert(1)>';
const mkReq = (role, over = {}) => ({ user: { id: 7, email: role + '@example.test', role }, ip: '203.0.113.9',
  socket: {}, headers: { 'user-agent': 'UA-test' }, ...over });
const base = (over = {}) => ({ action: 'PRODUCT_UPDATE', entityType: 'product', entityId: 5, ...over });
const row = (req, over) => buildAuditRow(req, base(over));
const parse = s => (s === null ? null : JSON.parse(s));
const SECRETS = { card_number: '4111111111111111', cvv: '123', idToken: 'tok', firebase_uid: 'fb', password: 'pw' };

test('ACTIONS / ENTITY_TYPES đúng danh sách, không sửa được', () => {
  assert.equal(ACTIONS.length, 16);
  assert.ok(ACTIONS.includes('ORDER_DELETE') && ACTIONS.includes('REVIEW_DELETE'));
  assert.deepEqual([...ENTITY_TYPES], ['order', 'product', 'user', 'review']);
  assert.ok(Object.isFrozen(ACTIONS) && Object.isFrozen(ENTITY_TYPES));
});

test('action / entityType sai -> throw; entityId > 50 ký tự -> throw; số -> chuỗi; rỗng -> NULL', () => {
  const req = mkReq('admin');
  assert.throws(() => row(req, { action: 'ORDER_HACK' }), /action không hợp lệ/);
  assert.throws(() => row(req, { action: undefined }), /action/);
  assert.throws(() => row(req, { entityType: 'payment' }), /entityType/);
  assert.throws(() => row(req, { entityId: 'x'.repeat(51) }), /50/);
  assert.equal(row(req, { entityId: 'x'.repeat(50) }).entity_id.length, 50);
  assert.equal(row(req, { entityId: 123 }).entity_id, '123');
  for (const empty of [undefined, null, '']) assert.equal(row(req, { entityId: empty }).entity_id, null);
  assert.throws(() => row(req, { entityId: { id: 1 } }), /entityId/);
  assert.throws(() => buildAuditRow(req, null), /entry/);
});

test('actor admin/staff lưu email; customer -> actor_email NULL, vẫn có actor_user_id', () => {
  for (const role of ['admin', 'staff']) {
    const r = row(mkReq(role));
    assert.deepEqual([r.actor_user_id, r.actor_role, r.actor_email], [7, role, role + '@example.test']);
  }
  const c = row(mkReq('customer'));
  assert.deepEqual([c.actor_user_id, c.actor_role, c.actor_email], [7, 'customer', null]);
  assert.equal(row(mkReq('admin', { user: { id: 7, role: 'admin', email: 'e'.repeat(300) } })).actor_email.length, 255);
});

test('role lạ/thiếu -> throw; thiếu req.user -> throw; req + entry.actor -> throw (không cho ghi đè actor)', () => {
  for (const role of ['Admin', 'guest', 'cli', undefined, '']) {
    assert.throws(() => row(mkReq(role)), /role/, String(role));
  }
  assert.throws(() => row({ headers: {} }), /req\.user/);
  assert.throws(() => row(mkReq('admin', { user: { id: '7', role: 'admin' } })), /id/);
  assert.throws(() => row(mkReq('staff'), { actor: { role: 'cli' } }), /entry\.actor/);
});

test("req = null: thiếu actor -> throw; actor.role 'cli' -> OK, ip/user_agent NULL; 'admin' -> throw", () => {
  assert.throws(() => row(null), /cli/);
  assert.throws(() => row(null, { actor: { role: 'admin', email: 'a@x' } }), /cli/);
  assert.throws(() => row(null, { actor: { role: 'cli', userId: 'abc' } }), /userId/);
  const r = row(null, { actor: { role: 'cli', userId: 3, email: 'ops@example.test' } });
  assert.deepEqual([r.actor_role, r.actor_user_id, r.actor_email, r.ip, r.user_agent], ['cli', 3, 'ops@example.test', null, null]);
  const bare = row(null, { actor: { role: 'cli' } });
  assert.deepEqual([bare.actor_user_id, bare.actor_email], [null, null]);
});

test('lọc nhạy cảm: card/cvv/token/firebase_uid/password (lồng sâu + mảng) mất với MỌI role', () => {
  const after = { name: 'Áo', ...SECRETS, Authorization: 'Bearer x', clientSecret: 's', PASSWD: 'p', cvc: '9',
    nested: { deep: { ...SECRETS, keep: 1 } }, list: [{ ...SECRETS, keep: 2 }, 'plain'] };
  for (const role of ['admin', 'staff', 'customer']) {
    const a = parse(row(mkReq(role), { before: null, after }).after_json);
    assert.deepEqual(a, { name: 'Áo', nested: { deep: { keep: 1 } }, list: [{ keep: 2 }, 'plain'] }, role);
  }
  const cli = parse(row(null, { actor: { role: 'cli' }, before: SECRETS, after: null }).before_json);
  assert.deepEqual(cli, {});
});

test('address/phone chỉ bị lọc với customer; admin/staff vẫn giữ (snapshot xoá đơn)', () => {
  const snap = { shipping_address: '12 Test', Phone: '0901234567', shipping_phone: '0901', items: [{ address: 'x', qty: 1 }], total: 5 };
  assert.deepEqual(parse(row(mkReq('customer'), { before: snap, after: null }).before_json), { items: [{ qty: 1 }], total: 5 });
  for (const role of ['admin', 'staff']) {
    assert.deepEqual(parse(row(mkReq(role), { before: snap, after: null }).before_json), snap, role);
  }
});

test('diff: chỉ giữ khóa đổi; không đổi -> {} / {}; before = null giữ nguyên after; khóa chỉ có 1 phía', () => {
  const req = mkReq('admin');
  const d = row(req, { before: { price: 100, name: 'A', tags: ['x'], meta: { a: 1 } },
    after: { price: 120, name: 'A', tags: ['x'], meta: { a: 2 }, sale: 90 } });
  assert.deepEqual([parse(d.before_json), parse(d.after_json)],
    [{ price: 100, meta: { a: 1 } }, { price: 120, meta: { a: 2 }, sale: 90 }]);
  const same = row(req, { before: { price: 100 }, after: { price: 100 } });
  assert.deepEqual([same.before_json, same.after_json], ['{}', '{}']);
  const created = row(req, { before: null, after: { price: 1, name: 'B' } });
  assert.deepEqual([created.before_json, parse(created.after_json)], [null, { price: 1, name: 'B' }]);
  const deleted = row(req, { before: { id: 9, status: 'pending' }, after: undefined });
  assert.deepEqual([parse(deleted.before_json), deleted.after_json], [{ id: 9, status: 'pending' }, null]);
  const removed = row(req, { before: { a: 1, b: 2 }, after: { a: 1 } });
  assert.deepEqual([parse(removed.before_json), parse(removed.after_json)], [{ b: 2 }, {}]);
  const secretOnly = row(req, { before: { password: 'old' }, after: { password: 'new' } });
  assert.deepEqual([secretOnly.before_json, secretOnly.after_json], ['{}', '{}'], 'khóa nhạy cảm bị lọc TRƯỚC khi diff');
});

test('JSON hợp lệ: Date -> ISO, BigInt -> chuỗi, undefined bỏ; vòng tham chiếu -> throw; scalar -> throw', () => {
  const at = new Date('2026-11-15T01:02:03.004Z');
  const r = row(mkReq('admin'), { before: null, after: { at, big: 12345678901234567890n, gone: undefined,
    arr: [undefined, 1], nan: NaN, nested: { when: at } } });
  assert.deepEqual(parse(r.after_json), { at: '2026-11-15T01:02:03.004Z', big: '12345678901234567890',
    arr: [null, 1], nan: null, nested: { when: '2026-11-15T01:02:03.004Z' } });
  const loop = { a: 1 }; loop.self = loop;
  assert.throws(() => row(mkReq('admin'), { before: null, after: loop }), /vòng tham chiếu/);
  const deep = { x: { y: [] } }; deep.x.y.push(deep);
  assert.throws(() => row(mkReq('admin'), { before: deep, after: null }), /vòng tham chiếu/);
  const shared = { v: 1 };
  assert.doesNotThrow(() => row(mkReq('admin'), { before: null, after: { a: shared, b: shared } }), 'tham chiếu dùng chung không phải vòng');
  for (const scalar of ['text', 5, true]) {
    assert.throws(() => row(mkReq('admin'), { before: scalar, after: null }), /object/);
  }
  assert.deepEqual(parse(row(mkReq('admin'), { before: null, after: [1, { a: 2 }] }).after_json), [1, { a: 2 }]);
});

test('chuỗi XSS lưu NGUYÊN VĂN trong JSON (thoát là việc của giao diện)', () => {
  const r = row(mkReq('admin'), { before: { name: 'Áo' }, after: { name: XSS } });
  assert.equal(parse(r.after_json).name, XSS);
  assert.ok(r.after_json.includes(XSS));
});

test('ip = clientIp(req) cắt 45 (bỏ ::ffff:); user_agent cắt 400; thiếu -> NULL', () => {
  assert.equal(row(mkReq('admin', { ip: '::ffff:198.51.100.7' })).ip, '198.51.100.7');
  assert.equal(row(mkReq('admin', { ip: 'a'.repeat(60) })).ip.length, 45);
  assert.equal(row(mkReq('admin', { ip: undefined, socket: { remoteAddress: '192.0.2.1' } })).ip, '192.0.2.1');
  assert.equal(row(mkReq('admin', { ip: undefined, socket: {} })).ip, null);
  assert.equal(row(mkReq('admin', { headers: { 'user-agent': 'u'.repeat(500) } })).user_agent.length, 400);
  assert.equal(row(mkReq('admin', { headers: {} })).user_agent, null);
  assert.equal(row(mkReq('admin', { headers: undefined })).user_agent, null);
});

test('audit(): INSERT tham số hoá trong ĐÚNG tx, trả id; thiếu tx / entry sai -> throw, không chạy SQL', async () => {
  executed.length = 0;
  const tx = { name: 'caller-tx' };
  const id = await audit(tx, mkReq('staff'), base({ before: { name: 'A' }, after: { name: XSS } }));
  assert.equal(id, '42');
  assert.equal(executed.length, 1);
  const { tx: usedTx, q, inputs } = executed[0];
  assert.equal(usedTx, tx);
  assert.match(q, /INSERT INTO dbo\.audit_logs[\s\S]*OUTPUT INSERTED\.id[\s\S]*VALUES \(@actor_user_id, @actor_email, @actor_role/);
  assert.ok(!q.includes('staff@example.test') && !q.includes(XSS) && !q.includes('PRODUCT_UPDATE'), 'không nối chuỗi giá trị vào SQL');
  assert.deepEqual(Object.keys(inputs).sort(), ['action', 'actor_email', 'actor_role', 'actor_user_id', 'after_json',
    'before_json', 'entity_id', 'entity_type', 'ip', 'user_agent']);
  assert.equal(inputs.actor_user_id.type, realSql.Int);
  assert.equal(inputs.after_json.value, JSON.stringify({ name: XSS }));
  await assert.rejects(audit(null, mkReq('staff'), base()), /transaction/);
  await assert.rejects(audit(tx, mkReq('staff'), base({ action: 'NOPE' })), /action/);
  assert.equal(executed.length, 1, 'entry sai không được chạm DB');
});
