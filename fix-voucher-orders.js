/*
 * fix-voucher-orders.js — vá lỗi voucher trong server/routes/orders.js
 *
 * Chạy:  node fix-voucher-orders.js
 * (đặt file này ở thư mục gốc project, cạnh thư mục server/)
 *
 * SỬA 2 CHỖ:
 *   1) Dòng import: bỏ `checkCondition` (config/vouchers.js KHÔNG export hàm này
 *      -> gọi vào sẽ throw -> mọi đơn có nhập voucher đều trả 500).
 *   2) Khối kiểm tra điều kiện voucher (bước 3b): thay `voucher.condition.type`
 *      bằng cờ `firstOrderOnly` — đúng với hình dạng dữ liệu thật trong
 *      config/vouchers.js, và khớp với logic đang chạy đúng ở routes/vouchers.js.
 *
 * AN TOÀN:
 *   - Tự sao lưu thành orders.js.bak trước khi ghi đè.
 *   - Idempotent: chạy lại lần 2 sẽ báo "đã vá rồi", không sửa gì thêm.
 *   - Giữ nguyên kiểu xuống dòng gốc của file (LF hay CRLF).
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'server', 'routes', 'orders.js');

if (!fs.existsSync(TARGET)) {
  console.error('[fix] Không tìm thấy:', TARGET);
  console.error('[fix] Hãy đặt script này ở thư mục gốc project (cạnh thư mục server/).');
  process.exit(1);
}

let src = fs.readFileSync(TARGET, 'utf8');
const usesCRLF = src.indexOf('\r\n') !== -1;
const NL = usesCRLF ? '\r\n' : '\n';
// Chuẩn hoá về LF để so khớp cho dễ, cuối cùng trả lại đúng kiểu gốc
src = src.replace(/\r\n/g, '\n');

let changed = 0;

/* ---- Sửa 1: dòng import ---- */
const IMPORT_OLD = "const { getVoucher, calcDiscount, checkCondition, isFirstTimeCustomer } = require('../config/vouchers');";
const IMPORT_NEW = "const { getVoucher, calcDiscount, isFirstTimeCustomer } = require('../config/vouchers');";

if (src.includes(IMPORT_OLD)) {
  src = src.replace(IMPORT_OLD, IMPORT_NEW);
  console.log('[fix] (1/2) Đã bỏ checkCondition khỏi dòng import.');
  changed++;
} else if (src.includes(IMPORT_NEW)) {
  console.log('[fix] (1/2) Dòng import đã đúng — bỏ qua.');
} else {
  console.error('[fix] (1/2) KHÔNG khớp dòng import. Cần sửa tay. Dừng lại để tránh làm hỏng file.');
  process.exit(1);
}

/* ---- Sửa 2: khối kiểm tra điều kiện voucher ---- */
const BLOCK_OLD = [
  '      if (ok) {',
  '        // KIỂM TRA LẠI điều kiện tại thời điểm đặt (tính lại từ giỏ đã khoá) — không tin client.',
  '        const cartQty = rows.reduce((s, r) => s + r.quantity, 0);',
  '        let isFirstTime;',
  "        if (voucher.condition && voucher.condition.type === 'first_order') {",
  '          isFirstTime = await isFirstTimeCustomer(req.user.id, pool);',
  '        }',
  '        ok = checkCondition(voucher, { cartQuantity: cartQty, isFirstTime: isFirstTime }).ok;',
  '      }',
].join('\n');

const BLOCK_NEW = [
  '      // KIỂM TRA LẠI điều kiện tại thời điểm đặt — KHÔNG tin kết quả validate trước đó.',
  '      // Giữa lúc khách bấm "Áp dụng" và lúc bấm "Đặt hàng" có thể trôi qua vài phút,',
  '      // trong khoảng đó điều kiện có thể đã đổi (vd: khách vừa hoàn tất 1 đơn ở tab khác',
  '      // -> không còn là khách mua lần đầu). Dùng cùng logic với routes/vouchers.js.',
  '      if (ok && voucher.firstOrderOnly) {',
  '        ok = await isFirstTimeCustomer(req.user.id, pool);',
  '      }',
].join('\n');

if (src.includes(BLOCK_OLD)) {
  src = src.replace(BLOCK_OLD, BLOCK_NEW);
  console.log('[fix] (2/2) Đã thay khối kiểm tra điều kiện sang cờ firstOrderOnly.');
  changed++;
} else if (src.includes('if (ok && voucher.firstOrderOnly)')) {
  console.log('[fix] (2/2) Khối điều kiện đã vá rồi — bỏ qua.');
} else {
  console.error('[fix] (2/2) KHÔNG khớp khối điều kiện. Cần sửa tay.');
  console.error('[fix]       Xem hướng dẫn sửa tay trong DONG-BO-CODE.md.');
  process.exit(1);
}

if (changed === 0) {
  console.log('[fix] File đã vá từ trước, không có gì thay đổi.');
  process.exit(0);
}

/* ---- Ghi file (có sao lưu) ---- */
fs.copyFileSync(TARGET, TARGET + '.bak');
fs.writeFileSync(TARGET, usesCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');

console.log('[fix] Đã sao lưu bản cũ: server/routes/orders.js.bak');
console.log('[fix] Đã ghi bản vá:    server/routes/orders.js');
console.log('[fix] XONG. Khởi động lại server rồi thử đặt đơn có mã GIAMGIA10.');
