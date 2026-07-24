/*
 * Migration IDEMPOTENT: thêm 2 cột voucher vào bảng dbo.orders.
 *   - VoucherCode     NVARCHAR(50)   NULL
 *   - DiscountAmount  DECIMAL(18,2)  NOT NULL DEFAULT 0
 *
 * Chạy:  node server/scripts/add-voucher-columns.js
 *
 * NGUYÊN TẮC AN TOÀN (giống style seed-demo-orders.js):
 *   - CHỈ ALTER ADD — không DROP / DELETE / UPDATE dữ liệu.
 *   - IDEMPOTENT: cột nào đã tồn tại thì BỎ QUA (kiểm tra INFORMATION_SCHEMA.COLUMNS).
 *     Chạy lại nhiều lần không lỗi, không thêm trùng.
 *   - In log rõ ràng: mỗi cột "đã THÊM" hay "đã tồn tại → bỏ qua".
 */
// Nạp .env theo vị trí file (server/.env) để chạy được từ mọi cwd.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool } = require('../db');

const TABLE = 'orders';

// Mỗi cột: tên + câu ALTER thêm. defaultConstraint tách riêng để log gọn.
const COLUMNS = [
  { name: 'VoucherCode',    ddl: 'ALTER TABLE dbo.orders ADD VoucherCode NVARCHAR(50) NULL;' },
  { name: 'DiscountAmount', ddl: 'ALTER TABLE dbo.orders ADD DiscountAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_orders_discount DEFAULT 0;' },
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
  console.log('[migrate] add-voucher-columns → dbo.' + TABLE);

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
