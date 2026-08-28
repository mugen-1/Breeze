/*
 * Tạo index hỗ trợ lọc + sắp xếp đơn hàng (idempotent — chạy lại không lỗi).
 *   IX_orders_status_created: phục vụ WHERE status = ? + ORDER BY created_at DESC, id DESC
 *   (lọc server-side ở GET /api/admin/orders).
 *
 * Chạy:  node scripts/add-orders-indexes.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool } = require('../db');

(async () => {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE name = 'IX_orders_status_created' AND object_id = OBJECT_ID('dbo.orders')
    )
    CREATE INDEX IX_orders_status_created
      ON dbo.orders (status, created_at DESC, id DESC);`);
  console.log('✅ Index IX_orders_status_created sẵn sàng.');
  process.exit(0);
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
