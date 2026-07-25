/*
 * Migration IDEMPOTENT: thêm cột hình thức thanh toán vào bảng dbo.orders.
 *   - PaymentMethod  NVARCHAR(20)  NOT NULL DEFAULT 'cod'
 *
 * Chạy:  node server/scripts/add-payment-method-column.js
 *
 * LƯU Ý: DEFAULT 'cod' chỉ áp dụng cho ĐƠN CŨ đã tồn tại trước migration này (chưa
 * từng lưu lựa chọn thật của khách vì lúc đó cột chưa có) — KHÔNG phải dữ liệu
 * khách thật sự đã chọn. Đơn tạo SAU migration luôn ghi đúng giá trị khách chọn
 * (server whitelist bắt buộc, xem server/routes/orders.js).
 *
 * NGUYÊN TẮC AN TOÀN (giống style add-voucher-columns.js):
 *   - CHỈ ALTER ADD — không DROP / DELETE / UPDATE dữ liệu.
 *   - IDEMPOTENT: cột đã tồn tại thì BỎ QUA (kiểm tra INFORMATION_SCHEMA.COLUMNS).
 *     Chạy lại nhiều lần không lỗi, không thêm trùng.
 *   - In log rõ ràng: cột "đã THÊM" hay "đã tồn tại → bỏ qua".
 */
// Nạp .env theo vị trí file (server/.env) để chạy được từ mọi cwd.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool } = require('../db');

const TABLE = 'orders';

const COLUMNS = [
  {
    name: 'PaymentMethod',
    ddl: "ALTER TABLE dbo.orders ADD PaymentMethod NVARCHAR(20) NOT NULL CONSTRAINT DF_orders_payment_method DEFAULT 'cod';",
  },
];

async function columnExists(pool, table, column) {
  const r = await pool
    .request()
    .input('t', table)
    .input('c', column)
    .query(`
      SELECT 1 AS ok
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @t AND COLUMN_NAME = @c;`);
  return r.recordset.length > 0;
}

(async () => {
  const pool = await getPool();
  console.log('[migrate] add-payment-method-column → dbo.' + TABLE);

  let added = 0, skipped = 0;
  for (const col of COLUMNS) {
    const exists = await columnExists(pool, TABLE, col.name);
    if (exists) {
      console.log(`[migrate]   ${col.name}: đã tồn tại → BỎ QUA`);
      skipped++;
      continue;
    }
    await pool.request().query(col.ddl);
    console.log(`[migrate]   ${col.name}: đã THÊM`);
    added++;
  }

  console.log(`[migrate] xong: ${added} cột thêm mới, ${skipped} cột đã có sẵn.`);
  process.exit(0);
})().catch((e) => { console.error('[migrate] LỖI:', e.message); process.exit(1); });
