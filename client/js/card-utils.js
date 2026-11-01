/* card-utils.js — hàm thuần cho thẻ / SĐT MoMo ở checkout. Không đụng DOM, không gọi API.
   Cung cấp window.BreezeCard = { digitsOnly, luhn, brandOf, validateExpiry, normalizeVnPhone, isMomoPhone }.

   MIRROR server — đổi một bên thì sửa cả bên kia:
     brandOf            <-> brandOf trong server/routes/payments.js
     validateExpiry     <-> vExp trong server/routes/payments.js (so theo UTC, YY -> 20YY)
     normalizeVnPhone,
     isMomoPhone        <-> server/lib/payment-readiness.js

   BẢO MẬT: các hàm nhận số thẻ chỉ tính rồi trả kết quả; không log, không giữ lại gì. */
(function () {
  'use strict';

  // Bỏ khoảng trắng và '-' (giống parseCard của server). Còn ký tự khác chữ số -> ''
  // để bước kiểm tra sau báo "Số thẻ không hợp lệ" thay vì lặng lẽ lọc bỏ.
  function digitsOnly(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\s-]/g, '');
    return /^\d+$/.test(s) ? s : '';
  }

  // Luhn checksum. Nhận chuỗi CHỈ gồm chữ số; chuỗi khác -> false.
  function luhn(digits) {
    if (typeof digits !== 'string' || !/^\d+$/.test(digits)) return false;
    var sum = 0, alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var n = digits.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  // 4 -> visa; 51–55 / 2221–2720 -> mastercard; 34/37 -> amex; 35 -> jcb; còn lại -> other.
  function brandOf(digits) {
    var d = String(digits == null ? '' : digits);
    if (d[0] === '4') return 'visa';
    var p2 = Number(d.slice(0, 2));
    var p4 = Number(d.slice(0, 4));
    if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return 'mastercard';
    if (p2 === 34 || p2 === 37) return 'amex';
    if (p2 === 35) return 'jcb';
    return 'other';
  }

  // Trả KHOÁ i18n của lỗi, hoặc null nếu hợp lệ. Tháng 1–12; năm YY (-> 20YY) hoặc YYYY.
  // Thẻ còn hạn tới hết tháng ghi trên thẻ. `now` chỉ để test.
  function validateExpiry(monthRaw, yearRaw, now) {
    var ms = String(monthRaw == null ? '' : monthRaw).trim();
    var ys = String(yearRaw == null ? '' : yearRaw).trim();
    if (!/^\d{1,2}$/.test(ms)) return 'pf.errExpMonth';
    var m = Number(ms);
    if (m < 1 || m > 12) return 'pf.errExpMonth';
    if (!/^(\d{2}|\d{4})$/.test(ys)) return 'pf.errExpYear';
    var y = Number(ys);
    if (y < 100) y += 2000;
    if (y < 2000 || y > 2099) return 'pf.errExpYear';
    var d = now || new Date();
    var cy = d.getUTCFullYear(), cm = d.getUTCMonth() + 1;
    if (y < cy || (y === cy && m < cm)) return 'pf.errCardExpired';
    return null;
  }

  // Bỏ khoảng trắng . - ( ) ; "+84…" / "84…" -> "0…".
  function normalizeVnPhone(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\s.\-()]/g, '');
    if (s.indexOf('+84') === 0) s = '0' + s.slice(3);
    else if (s.indexOf('84') === 0) s = '0' + s.slice(2);
    return s;
  }

  // Chỉ số DI ĐỘNG VN: 10 số, đầu 03/05/07/08/09.
  function isMomoPhone(raw) {
    return /^0[35789]\d{8}$/.test(normalizeVnPhone(raw));
  }

  window.BreezeCard = {
    digitsOnly: digitsOnly,
    luhn: luhn,
    brandOf: brandOf,
    validateExpiry: validateExpiry,
    normalizeVnPhone: normalizeVnPhone,
    isMomoPhone: isMomoPhone
  };
})();
