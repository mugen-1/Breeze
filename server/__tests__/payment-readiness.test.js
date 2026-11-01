'use strict';

// Unit test lib/payment-readiness.js. SQL được thay bằng pool giả: nó kiểm tra câu lệnh dùng
// đúng tham số (không nối chuỗi) rồi lọc một bảng thẻ trong bộ nhớ theo đúng các tham số đó.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const realSql = require('mssql');

require.cache[require.resolve('../db')] = { exports: { getPool: async () => { throw new Error('no pool'); }, sql: realSql } };
const { normalizeVnPhone, isMomoPhone, hasUsableCard, checkPaymentInfo } = require('../lib/payment-readiness');

// Mốc giờ cố định: 2026-10-31 23:30 UTC (đã là 01/11 theo giờ VN) — ép code phải so theo UTC.
const NOW = new Date(Date.UTC(2026, 9, 31, 23, 30));

function fakePool(cards) {
  const calls = [];
  return {
    calls,
    request() {
      const params = {};
      return {
        input(name, type, value) { params[name] = value; return this; },
        async query(text) {
          const q = text.replace(/\s+/g, ' ').trim();
          calls.push({ q, params: { ...params } });
          assert.match(q, /^SELECT TOP 1 1\b.* FROM dbo\.payment_methods WHERE user_id = @uid AND brand = @brand/);
          assert.match(q, /\(exp_year > @y OR \(exp_year = @y AND exp_month >= @m\)\)/);
          assert.deepEqual(Object.keys(params).sort(), ['brand', 'm', 'uid', 'y']);
          const rows = cards.filter(c => c.user_id === params.uid && c.brand === params.brand &&
            (c.exp_year > params.y || (c.exp_year === params.y && c.exp_month >= params.m)));
          return { recordset: rows.slice(0, 1).map(() => ({ ok: 1 })), rowsAffected: [rows.length ? 1 : 0] };
        },
      };
    },
  };
}

// ---- normalizeVnPhone / isMomoPhone ----
for (const [raw, norm, ok] of [
  ['+84901234567', '0901234567', true],
  ['84901234567', '0901234567', true],
  ['0901 234 567', '0901234567', true],
  ['0901.234.567', '0901234567', true],
  ['(+84) 901-234-567', '0901234567', true],
  ['0901234567', '0901234567', true],
  ['+14155552671', '+14155552671', false],   // số Mỹ
  ['+6591234567', '+6591234567', false],     // số Singapore
  ['090123456', '090123456', false],         // thiếu 1 số
  ['09012345678', '09012345678', false],     // thừa 1 số
  ['0901abc567', '0901abc567', false],
  // Chỉ nhận đầu số di động VN 03/05/07/08/09.
  ['0321234567', '0321234567', true],
  ['0561234567', '0561234567', true],
  ['0771234567', '0771234567', true],
  ['+84 812 345 678', '0812345678', true],
  ['0961234567', '0961234567', true],
  ['0281234567', '0281234567', false],      // số bàn TP.HCM
  ['+84 24 3123 4567', '02431234567', false], // số bàn Hà Nội (11 số)
  ['0241234567', '0241234567', false],      // số bàn 02x, 10 số
  ['0121234567', '0121234567', false],      // 01x
  ['0412345678', '0412345678', false],      // 04x
  ['0612345678', '0612345678', false],      // 06x
  ['0012345678', '0012345678', false],
  ['', '', false],
  ['   ', '', false],
  [null, '', false],
  [undefined, '', false],
]) {
  test('phone ' + JSON.stringify(raw) + ' -> ' + JSON.stringify(norm) + (ok ? ' (hợp lệ)' : ' (không hợp lệ)'), () => {
    assert.equal(normalizeVnPhone(raw), norm);
    assert.equal(isMomoPhone(raw), ok);
  });
}

// ---- hasUsableCard ----
const CARDS = [
  { user_id: 1, brand: 'visa', exp_month: 10, exp_year: 2026 },        // còn hạn tới hết 10/2026
  { user_id: 1, brand: 'mastercard', exp_month: 9, exp_year: 2026 },   // hết hạn
  { user_id: 1, brand: 'amex', exp_month: 12, exp_year: 2030 },
  { user_id: 2, brand: 'mastercard', exp_month: 12, exp_year: 2030 },  // thẻ của user khác
];
test('hasUsableCard: thẻ còn hạn đúng brand -> true (tháng hết hạn = tháng hiện tại, so UTC)', async () => {
  const pool = fakePool(CARDS);
  assert.equal(await hasUsableCard(pool, 1, 'visa', NOW), true);
  assert.deepEqual(pool.calls[0].params, { uid: 1, brand: 'visa', y: 2026, m: 10 });
});
test('hasUsableCard: chỉ có thẻ hết hạn -> false', async () => {
  assert.equal(await hasUsableCard(fakePool(CARDS), 1, 'mastercard', NOW), false);
});
test('hasUsableCard: hết hạn năm trước -> false; năm sau -> true', async () => {
  assert.equal(await hasUsableCard(fakePool([{ user_id: 1, brand: 'visa', exp_month: 12, exp_year: 2025 }]), 1, 'visa', NOW), false);
  assert.equal(await hasUsableCard(fakePool([{ user_id: 1, brand: 'visa', exp_month: 1, exp_year: 2027 }]), 1, 'visa', NOW), true);
});
test('hasUsableCard: chỉ có thẻ khác brand (amex) -> false cho visa/mastercard', async () => {
  const cards = [{ user_id: 1, brand: 'amex', exp_month: 12, exp_year: 2030 }];
  assert.equal(await hasUsableCard(fakePool(cards), 1, 'visa', NOW), false);
  assert.equal(await hasUsableCard(fakePool(cards), 1, 'mastercard', NOW), false);
});
test('hasUsableCard: không có thẻ -> false', async () => {
  assert.equal(await hasUsableCard(fakePool([]), 1, 'visa', NOW), false);
});
test('hasUsableCard: thẻ còn hạn của user khác không được tính', async () => {
  const pool = fakePool(CARDS);
  assert.equal(await hasUsableCard(pool, 1, 'mastercard', NOW), false);
  assert.equal(pool.calls[0].params.uid, 1);
  assert.equal(await hasUsableCard(pool, 2, 'mastercard', NOW), true);
});
test('hasUsableCard: brand ngoài visa/mastercard hoặc userId lạ -> false, không query', async () => {
  const pool = fakePool(CARDS);
  for (const [uid, brand] of [[1, 'amex'], [1, 'other'], [1, "visa' OR 1=1 --"], [0, 'visa'], ['1', 'visa'], [null, 'visa']]) {
    assert.equal(await hasUsableCard(pool, uid, brand, NOW), false);
  }
  assert.equal(pool.calls.length, 0);
});
test('hasUsableCard: mặc định dùng giờ hiện tại (UTC)', async () => {
  const pool = fakePool([]);
  await hasUsableCard(pool, 1, 'visa');
  const now = new Date();
  assert.equal(pool.calls[0].params.y, now.getUTCFullYear());
  assert.equal(pool.calls[0].params.m, now.getUTCMonth() + 1);
});

// ---- checkPaymentInfo ----
test('checkPaymentInfo cod -> luôn ok, không query', async () => {
  const pool = fakePool([]);
  assert.deepEqual(await checkPaymentInfo(pool, { id: 1, phone: null }, 'cod', NOW), { ok: true });
  assert.deepEqual(await checkPaymentInfo(pool, null, 'cod', NOW), { ok: true });
  assert.equal(pool.calls.length, 0);
});
test('checkPaymentInfo momo -> theo user.phone, không query', async () => {
  const pool = fakePool([]);
  assert.deepEqual(await checkPaymentInfo(pool, { id: 1, phone: '+84 901 234 567' }, 'momo', NOW), { ok: true });
  assert.deepEqual(await checkPaymentInfo(pool, { id: 1, phone: '0901234567' }, 'momo', NOW), { ok: true });
  assert.deepEqual(await checkPaymentInfo(pool, { id: 1, phone: null }, 'momo', NOW), { ok: false });
  assert.deepEqual(await checkPaymentInfo(pool, { id: 1, phone: '12345' }, 'momo', NOW), { ok: false });
  assert.equal(pool.calls.length, 0);
});
test('checkPaymentInfo visa / mastercard -> theo thẻ đã lưu', async () => {
  const pool = fakePool(CARDS);
  const user = { id: 1, phone: '0901234567' };
  assert.deepEqual(await checkPaymentInfo(pool, user, 'visa', NOW), { ok: true });
  assert.deepEqual(await checkPaymentInfo(pool, user, 'mastercard', NOW), { ok: false });
  assert.deepEqual(await checkPaymentInfo(pool, { id: 2 }, 'mastercard', NOW), { ok: true });
  assert.deepEqual(pool.calls.map(c => c.params.brand), ['visa', 'mastercard', 'mastercard']);
});
test('checkPaymentInfo phương thức lạ hoặc thiếu user -> không ok', async () => {
  const pool = fakePool(CARDS);
  for (const m of ['amex', 'paypal', '', undefined, null]) {
    assert.deepEqual(await checkPaymentInfo(pool, { id: 1, phone: '0901234567' }, m, NOW), { ok: false });
  }
  assert.deepEqual(await checkPaymentInfo(pool, null, 'visa', NOW), { ok: false });
  assert.deepEqual(await checkPaymentInfo(pool, null, 'momo', NOW), { ok: false });
  assert.equal(pool.calls.length, 0);
});
