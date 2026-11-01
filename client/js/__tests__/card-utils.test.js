/* card-utils.js — hàm thuần, mirror quy tắc server (payments.js + payment-readiness.js). */
const { check, eq } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');

console.log('card-utils.js');

const { win, sandbox } = load('card-utils.js');
const C = win.BreezeCard;
eq('chi lo window.BreezeCard voi 6 ham', Object.keys(C).sort(),
  ['brandOf', 'digitsOnly', 'isMomoPhone', 'luhn', 'normalizeVnPhone', 'validateExpiry']);
['digitsOnly', 'luhn', 'brandOf'].forEach(k => eq('IIFE khong ro global: ' + k, typeof sandbox[k], 'undefined'));

// ---- digitsOnly ----
eq('digitsOnly bo khoang trang va gach', C.digitsOnly(' 4242 4242-4242 4242 '), '4242424242424242');
eq('digitsOnly co ky tu la -> rong (khong loc lang le)', C.digitsOnly('4242abcd42424242'), '');
eq('digitsOnly null -> rong', C.digitsOnly(null), '');

// ---- luhn ----
check('luhn 4242424242424242 hop le', C.luhn('4242424242424242'));
check('luhn 4111111111111111 hop le', C.luhn('4111111111111111'));
check('luhn 5555555555554444 hop le', C.luhn('5555555555554444'));
check('luhn doi 1 so (…4243) -> sai', !C.luhn('4242424242424243'));
check('luhn doi 1 so o giua -> sai', !C.luhn('4242424252424242'));
check('luhn chuoi rong / co ky tu la -> sai', !C.luhn('') && !C.luhn('4242 4242 4242 4242') && !C.luhn(null));

// ---- brandOf (mirror server) ----
for (const [num, brand] of [
  ['4242424242424242', 'visa'], ['4000056655665556', 'visa'],
  ['5105105105105100', 'mastercard'], ['5555555555554444', 'mastercard'], ['5199999999999991', 'mastercard'],
  ['2221000000000009', 'mastercard'], ['2223003122003222', 'mastercard'], ['2720999999999996', 'mastercard'],
  ['2220999999999999', 'other'], ['2721000000000000', 'other'], ['5000000000000000', 'other'], ['5600000000000000', 'other'],
  ['378282246310005', 'amex'], ['341111111111111', 'amex'],
  ['3530111333300000', 'jcb'], ['6011111111111117', 'other'],
]) eq('brandOf ' + num.slice(0, 4) + '… -> ' + brand, C.brandOf(num), brand);

// ---- validateExpiry (UTC) ----
// 2026-10-31 23:30 UTC = 01/11/2026 giờ VN: phải còn coi là tháng 10.
const NOW = new Date(Date.UTC(2026, 9, 31, 23, 30));
eq('thang 0 -> loi thang', C.validateExpiry('0', '2030', NOW), 'pf.errExpMonth');
eq('thang 13 -> loi thang', C.validateExpiry('13', '2030', NOW), 'pf.errExpMonth');
eq('thang rong / chu -> loi thang', [C.validateExpiry('', '2030', NOW), C.validateExpiry('ab', '2030', NOW)], ['pf.errExpMonth', 'pf.errExpMonth']);
eq('nam rong -> loi nam', C.validateExpiry('12', '', NOW), 'pf.errExpYear');
eq('nam 3 chu so -> loi nam', C.validateExpiry('12', '203', NOW), 'pf.errExpYear');
eq('nam 2100 -> loi nam', C.validateExpiry('12', '2100', NOW), 'pf.errExpYear');
eq('qua khu (09/2026) -> het han', C.validateExpiry('9', '2026', NOW), 'pf.errCardExpired');
eq('nam truoc -> het han', C.validateExpiry('12', '2025', NOW), 'pf.errCardExpired');
eq('thang hien tai theo UTC (10/2026) -> hop le', C.validateExpiry('10', '2026', NOW), null);
eq('YY 26 = YYYY 2026', [C.validateExpiry('10', '26', NOW), C.validateExpiry('10', '2026', NOW)], [null, null]);
eq('YY 25 -> het han giong 2025', C.validateExpiry('12', '25', NOW), 'pf.errCardExpired');
eq('so (khong phai chuoi) van duoc', C.validateExpiry(1, 2030, NOW), null);
eq('mac dinh dung gio hien tai', C.validateExpiry('12', '2099'), null);

// ---- normalizeVnPhone / isMomoPhone (mirror server) ----
for (const [raw, norm, ok] of [
  ['+84901234567', '0901234567', true], ['84901234567', '0901234567', true],
  ['0901 234 567', '0901234567', true], ['(+84) 912.345-678', '0912345678', true],
  ['0321234567', '0321234567', true], ['0561234567', '0561234567', true],
  ['0771234567', '0771234567', true], ['0812345678', '0812345678', true],
  ['0281234567', '0281234567', false], ['+84 24 3123 4567', '02431234567', false],
  ['0121234567', '0121234567', false], ['0412345678', '0412345678', false], ['0612345678', '0612345678', false],
  ['+14155552671', '+14155552671', false], ['090123456', '090123456', false],
  ['', '', false], [null, '', false],
]) {
  eq('normalize ' + JSON.stringify(raw), C.normalizeVnPhone(raw), norm);
  eq('isMomoPhone ' + JSON.stringify(raw) + ' -> ' + ok, C.isMomoPhone(raw), ok);
}
