/* utils-format.js — hàm định dạng dùng chung, gộp từ 10 bản rải rác (TASK 4). */
const { eq, note } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');

const { sandbox } = load('utils-format.js', {});
const money = sandbox.money;

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

note('checkout.js va voucher.js giu ham money rieng (dung Intl.NumberFormat,');
note('voucher con Math.round). Cung ra ky hieu ₫ nen hien thi da nhat quan.');
