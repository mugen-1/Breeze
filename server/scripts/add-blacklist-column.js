/*
 * Migration IDEMPOTENT: thêm cột blacklist vào dbo.users + seed 1 LẦN DUY NHẤT.
 *   - IsBlacklisted BIT NOT NULL DEFAULT 0
 *
 * Chạy:  node server/scripts/add-blacklist-column.js
 *
 * CƠ CHẾ SEED (đúng 1 lần, không cần bảng đánh dấu riêng):
 *   Seed CHỈ chạy trong đúng lần ALTER TABLE thêm cột này (tức lần đầu tiên).
 *   Từ lần chạy thứ 2 trở đi, cột đã tồn tại -> BỎ QUA HẲN, không đụng gì tới
 *   IsBlacklisted nữa. Nhờ vậy: user nào sau này được admin bấm "Gỡ Tài Khoản"
 *   (set về 0) sẽ KHÔNG BAO GIỜ bị script này ghi đè lại thành 1, dù họ vẫn còn
 *   đơn huỷ cũ trong lịch sử — đúng yêu cầu "không tính động mỗi lần hiển thị".
 *
 * NGUYÊN TẮC AN TOÀN (giống style add-payment-method-column.js):
 *   - CHỈ ALTER ADD + 1 UPDATE seed lần đầu — không DROP/DELETE.
 *   - Idempotent: chạy lại nhiều lần không lỗi, không seed lại.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool, sql } = require('../db');

async function columnExists(pool, table, column) {
  const r = await pool.request().input('t', table).input('c', column).query(`
    SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @t AND COLUMN_NAME = @c;`);
  return r.recordset.length > 0;
}

(async () => {
  const pool = await getPool();
  console.log('[migrate] add-blacklist-column → dbo.users');

  const exists = await columnExists(pool, 'users', 'IsBlacklisted');
  if (exists) {
    console.log('[migrate]   IsBlacklisted: đã tồn tại → BỎ QUA (không seed lại, tránh ghi đè user đã được gỡ blacklist thủ công)');
    process.exit(0);
  }

  await pool.request().query(
    'ALTER TABLE dbo.users ADD IsBlacklisted BIT NOT NULL CONSTRAINT DF_users_blacklisted DEFAULT 0;'
  );
  console.log('[migrate]   IsBlacklisted: đã THÊM');

  // Seed NGAY (chỉ trong lần tạo cột này): user nào đang có >=1 đơn status='cancelled' -> blacklist.
  const seed = await pool.request().query(`
    UPDATE dbo.users SET IsBlacklisted = 1
    WHERE id IN (SELECT DISTINCT user_id FROM dbo.orders WHERE status = 'cancelled');`);
  console.log(`[migrate]   Seed: đã đưa ${seed.rowsAffected[0]} user (có đơn huỷ) vào danh sách đen.`);

  process.exit(0);
})().catch((e) => { console.error('[migrate] LỖI:', e.message); process.exit(1); });
