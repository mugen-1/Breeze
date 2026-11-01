'use strict';

// POST /api/account/payment-methods với expected_brand tuỳ chọn. Router + auth thật,
// chỉ thay Firebase và SQL. Kiểm tra kèm bất biến: số thẻ đầy đủ không vào SQL/log/response.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

const VISA = '4111 1111 1111 1111';
const MASTERCARD = '5555-5555-5555-4444';
const MASTERCARD_2 = '2223003122003222';   // dải 2221–2720
const AMEX = '378282246310005';
const PANS = [VISA, MASTERCARD, MASTERCARD_2, AMEX].map(s => s.replace(/[\s-]/g, ''));

let cards, routeQueries;
const result = (rows = [], affected = rows.length) => ({ recordset: rows, rowsAffected: [affected] });

class Transaction { async begin() {} async commit() {} async rollback() {} }
class Request {
  constructor() { this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(text) {
    const q = text.replace(/\s+/g, ' ').trim(), p = this.params;
    if (q.startsWith('SELECT id FROM dbo.users WITH')) return result([{ id: 1 }]);
    if (q.startsWith('MERGE dbo.users')) return result([{ id: 1, firebase_uid: 'user-a', role: 'customer' }]);
    routeQueries.push({ q, p: { ...p } });
    if (q.startsWith('SELECT COUNT(*) AS n FROM dbo.payment_methods')) return result([{ n: cards.length }]);
    if (q.startsWith('UPDATE dbo.payment_methods SET is_default = 0')) return result([], 0);
    if (q.startsWith('INSERT INTO dbo.payment_methods')) {
      cards.push({ id: cards.length + 1, user_id: p.uid, brand: p.brand, last4: p.last4, holder_name: p.holder,
        exp_month: p.month, exp_year: p.year, is_default: p.isdef });
      return result([], 1);
    }
    if (q.startsWith('SELECT id, user_id, brand, last4')) return result(cards.filter(c => c.user_id === p.uid));
    throw new Error('Unexpected SQL: ' + q);
  }
}
const pool = { request: () => new Request() };
require.cache[require.resolve('../db')] = { exports: { getPool: async () => pool, sql: { ...realSql, Transaction, Request } } };
require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({
  async verifyIdToken(token) {
    if (token !== 'user-a') throw Object.assign(new Error('bad'), { code: 'auth/invalid-id-token' });
    return { uid: 'user-a', email: 'a@example.test', email_verified: true };
  },
}) } };

const app = express();
app.use(express.json());
app.use('/api/account/payment-methods', require('../routes/payments'));
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
beforeEach(() => { cards = []; routeQueries = []; });

async function add(extra, t) {
  const logs = [];
  if (t) for (const k of ['log', 'warn', 'error', 'info']) t.mock.method(console, k, (...a) => logs.push(a.join(' ')));
  const r = await fetch(base + '/api/account/payment-methods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-a' },
    body: JSON.stringify({ holder_name: 'NGUYEN VAN A', exp_month: 12, exp_year: 2099, cvv: '123', ...extra }),
  });
  const raw = await r.text();
  return { status: r.status, body: JSON.parse(raw), raw, logs };
}
function assertNoPanLeak(r) {
  const sqlText = JSON.stringify(routeQueries);
  for (const pan of PANS) {
    assert.ok(!sqlText.includes(pan), 'PAN không được vào SQL');
    assert.ok(!r.raw.includes(pan), 'PAN không được vào response');
    assert.ok(!r.logs.some(l => l.includes(pan)), 'PAN không được vào log');
  }
  assert.ok(!sqlText.includes('"123"'), 'CVV không được vào SQL');
}

for (const [card_number, expected_brand, brand, last4] of [
  [VISA, 'visa', 'visa', '1111'],
  [MASTERCARD, 'mastercard', 'mastercard', '4444'],
  [MASTERCARD_2, 'mastercard', 'mastercard', '3222'],
]) {
  test('expected_brand=' + expected_brand + ' khớp số thẻ -> 201, lưu brand ' + brand, async (t) => {
    const r = await add({ card_number, expected_brand }, t);
    assert.equal(r.status, 201);
    assert.equal(r.body.payment_methods.length, 1);
    assert.equal(r.body.payment_methods[0].brand, brand);
    assert.equal(r.body.payment_methods[0].last4, last4);
    const insert = routeQueries.find(x => x.q.startsWith('INSERT'));
    assert.ok(!('expected_brand' in insert.p));
    assertNoPanLeak(r);
  });
}

for (const [card_number, expected_brand, message] of [
  [MASTERCARD, 'visa', 'Số thẻ không phải thẻ Visa'],
  [AMEX, 'visa', 'Số thẻ không phải thẻ Visa'],
  [VISA, 'mastercard', 'Số thẻ không phải thẻ Mastercard'],
  [AMEX, 'mastercard', 'Số thẻ không phải thẻ Mastercard'],
]) {
  test('expected_brand=' + expected_brand + ' lệch số thẻ -> 400 "' + message + '", không ghi DB', async (t) => {
    const r = await add({ card_number, expected_brand }, t);
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { status: 'error', message });
    assert.equal(routeQueries.length, 0);
    assert.equal(cards.length, 0);
    assertNoPanLeak(r);
  });
}

test('expected_brand không phải visa/mastercard -> 400, không ghi DB', async () => {
  for (const expected_brand of ['amex', 'jcb', 'other', 'VISA', 'toString', 1, true, { visa: 1 }]) {
    const r = await add({ card_number: AMEX, expected_brand });
    assert.equal(r.status, 400, JSON.stringify(expected_brand));
    assert.equal(r.body.message, 'Loại thẻ không hợp lệ');
  }
  assert.equal(routeQueries.length, 0);
});

for (const [label, extra] of [['không gửi', {}], ['null', { expected_brand: null }], ["''", { expected_brand: '' }]]) {
  test('expected_brand ' + label + ' -> hành vi cũ: thẻ nào hợp lệ cũng lưu (kể cả amex)', async (t) => {
    for (const [card_number, brand] of [[VISA, 'visa'], [MASTERCARD, 'mastercard'], [AMEX, 'amex']]) {
      const r = await add({ card_number, ...extra }, t);
      assert.equal(r.status, 201);
      assert.equal(r.body.payment_methods.at(-1).brand, brand);
      assertNoPanLeak(r);
    }
    assert.equal(cards.length, 3);
  });
}

test('số thẻ sai Luhn vẫn báo "Số thẻ không hợp lệ" trước khi xét expected_brand', async () => {
  const r = await add({ card_number: '4111111111111112', expected_brand: 'mastercard' });
  assert.equal(r.status, 400);
  assert.equal(r.body.message, 'Số thẻ không hợp lệ');
});

test('expected_brand khớp nhưng hết hạn -> vẫn 400 "Thẻ đã hết hạn"', async () => {
  const r = await add({ card_number: VISA, expected_brand: 'visa', exp_month: 1, exp_year: 2020 });
  assert.equal(r.status, 400);
  assert.equal(r.body.message, 'Thẻ đã hết hạn');
  assert.equal(routeQueries.length, 0);
});
