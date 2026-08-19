/* utils-format.js — hàm định dạng dùng chung, gộp từ 10 bản rải rác (TASK 4). */
const { eq, note } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');

const { sandbox } = load('utils-format.js', {});
const money = sandbox.money;
const esc = sandbox.esc;

console.log('utils-format.js');

eq('money la global (script co dien, khong phai module)', typeof money, 'function');

// Định dạng thường
eq('money(250000)', money(250000), '250.000₫');
eq('money(0)', money(0), '0₫');
eq('money(1000)', money(1000), '1.000₫');
eq('money(999)', money(999), '999₫');

/* Khoá hành vi với dữ liệu thiếu — đây là lý do phải gộp về bản có `|| 0`.
   Bản cũ ở orders/product/search dùng Number(n) nên ra "NaN₫" hiện ra giao diện;
   bản cũ ở cart.js gọi n.toLocaleString() không bọc Number() nên ném TypeError. */
eq('money(null)      -> 0₫, KHONG phai NaN', money(null), '0₫');
eq('money(undefined) -> 0₫, KHONG phai NaN', money(undefined), '0₫');
eq('money()          -> 0₫, khong nem loi', money(), '0₫');
eq('money("")        -> 0₫', money(''), '0₫');

// Chuỗi số vẫn phải ra đúng (API đôi khi trả DECIMAL dạng chuỗi)
eq('money("250000") tu chuoi so', money('250000'), '250.000₫');

// Số thập phân giữ nguyên cách toLocaleString xử lý — không tự làm tròn
eq('money(1234.5)', money(1234.5), (1234.5).toLocaleString('vi-VN') + '₫');

// ----- esc -----
eq('esc la global', typeof esc, 'function');
eq('esc(null)', esc(null), '');
eq('esc(undefined)', esc(undefined), '');
eq('esc chan the script', esc('<script>alert(1)</script>'),
   '&lt;script&gt;alert(1)&lt;/script&gt;');
eq('esc doi & truoc tien (khong escape 2 lan)', esc('a & b'), 'a &amp; b');
eq('esc doi dau nhay KEP', esc('say "hi"'), 'say &quot;hi&quot;');
/* Ban gop lay theo admin.js — 8 ban cu KHONG escape dau nhay don, de lot XSS qua
   thuoc tinh HTML viet bang nhay don kieu title='...'. Case nay khoa hanh vi moi. */
eq('esc doi dau nhay DON (8 ban cu de lot)', esc("it's"), 'it&#39;s');
eq('esc giu nguyen tieng Viet co dau', esc('Áo Sơ Mi'), 'Áo Sơ Mi');
eq('esc doi so thanh chuoi', esc(42), '42');

note('checkout.js va voucher.js giu ham money rieng (dung Intl.NumberFormat,');
note('voucher con Math.round). Cung ra ky hieu ₫ nen hien thi da nhat quan.');
