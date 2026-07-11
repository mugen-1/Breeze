/*
 * Seed dữ liệu DEMO cho Dashboard: 20 đơn mẫu (mã đơn 1..20) cho 2 KHÁCH THẬT
 * truc@gmail.com và truc1@gmail.com, ngày đặt random trong tháng 7. Mọi con số trên
 * Dashboard vẫn được TÍNH TỪ DB qua /api/admin/stats — script không hardcode số nào.
 *
 * Chạy:  node server/scripts/seed-demo-orders.js
 *
 * LƯU Ý (DB demo BreezeShopDB):
 *   - IDEMPOTENT: mỗi lần chạy sẽ XOÁ TOÀN BỘ đơn (order_items cascade) và reseed identity
 *     để mã đơn luôn là 1..20, rồi chèn mới. Cũng dọn user cũ có tiền tố 'seed_' (từ bản seed trước).
 *   - Không tạo user mới: đơn tham chiếu 2 user THẬT ở trên (lấy id theo email).
 *   - Không đụng bảng users thật ngoài việc dọn 'seed_%'.
 */
// Nạp .env theo vị trí file (server/.env) để chạy được từ mọi cwd, kể cả project root.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool, sql } = require('../db');

// ---- tham số ----
const NUM_ORDERS = 20;
const CUSTOMER_EMAILS = ['truc@gmail.com', 'truc1@gmail.com'];

// Phân bố trạng thái (tổng 100). completed chiếm đa số, cancelled ít.
const STATUS_WEIGHTS = [
  ['completed', 55], ['paid', 20], ['shipped', 10], ['pending', 8], ['cancelled', 7],
];

const VN_NAMES = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Hoàng Cường', 'Phạm Thị Dung', 'Hoàng Văn Em', 'Vũ Thị Hà'];
const VN_STREETS = ['Lê Lợi', 'Nguyễn Huệ', 'Trần Hưng Đạo', 'Hai Bà Trưng', 'Điện Biên Phủ'];
const VN_CITIES = ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ'];

// ---- helpers ----
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function pickStatus() {
  let r = Math.random() * 100, acc = 0;
  for (const [s, w] of STATUS_WEIGHTS) { acc += w; if (r < acc) return s; }
  return 'completed';
}

// Ngày random 01/07..30/07 của NĂM HIỆN TẠI (tháng 7 = index 6), theo UTC.
const CUR_Y = new Date().getUTCFullYear();
function julyDate() {
  return new Date(Date.UTC(CUR_Y, 6, randInt(1, 30), randInt(0, 23), randInt(0, 59), randInt(0, 59)));
}

const DEC = sql.Decimal(18, 2);

(async () => {
  const pool = await getPool();

  // 2 khách thật -> lấy id theo email.
  const uRes = await pool.request().query(`
    SELECT id, email FROM dbo.users WHERE email IN ('${CUSTOMER_EMAILS.join("','")}');`);
  const userIds = uRes.recordset.map((u) => u.id);
  if (userIds.length < CUSTOMER_EMAILS.length) {
    console.error('Không tìm đủ 2 khách (' + CUSTOMER_EMAILS.join(', ') + '). Dừng.');
    process.exit(1);
  }

  // Sản phẩm thật đang bán -> snapshot tên + giá hiệu lực (sale_price nếu có).
  const prodRes = await pool.request().query(`
    SELECT id, name_vi,
           (CASE WHEN sale_price IS NOT NULL THEN sale_price ELSE price END) AS unit_price
    FROM dbo.products WHERE is_active = 1;`);
  const products = prodRes.recordset;
  if (!products.length) {
    console.error('Không có sản phẩm is_active=1 để tạo đơn. Dừng.');
    process.exit(1);
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Dọn sạch để mã đơn về 1..20: xoá hết đơn (order_items cascade) + reseed identity.
    await new sql.Request(tx).query('DELETE FROM dbo.orders;');
    await new sql.Request(tx).query('DELETE FROM dbo.users WHERE firebase_uid LIKE \'seed_%\';');
    await new sql.Request(tx).query("DBCC CHECKIDENT('dbo.orders', RESEED, 0);");

    let orderCount = 0;
    for (let i = 0; i < NUM_ORDERS; i++) {
      // Giỏ: 1-4 sản phẩm khác nhau, quantity 1-3.
      const nItems = randInt(1, Math.min(4, products.length));
      const chosen = shuffle(products.slice()).slice(0, nItems);
      const items = chosen.map((p) => {
        const quantity = randInt(1, 3);
        const unit = Number(p.unit_price);
        return { product_id: p.id, product_name: p.name_vi, unit_price: unit, quantity, line_total: unit * quantity };
      });
      const total = items.reduce((s, it) => s + it.line_total, 0); // total_amount TÍNH TỪ ITEMS

      const uid = pick(userIds);          // khách lộn xộn giữa 2 người
      const created = julyDate();         // ngày random trong tháng 7
      const status = pickStatus();

      const ordRes = await new sql.Request(tx)
        .input('user_id', sql.Int, uid)
        .input('status', sql.VarChar(20), status)
        .input('total', DEC, total)
        .input('sname', sql.NVarChar(200), pick(VN_NAMES))
        .input('sphone', sql.VarChar(20), '09' + randInt(10000000, 99999999))
        .input('saddr', sql.NVarChar(300), randInt(1, 200) + ' ' + pick(VN_STREETS) + ', ' + pick(VN_CITIES))
        .input('created', sql.DateTime2, created)
        .query(`
          INSERT INTO dbo.orders
            (user_id, status, total_amount, currency, shipping_name, shipping_phone, shipping_address, created_at)
          OUTPUT INSERTED.id
          VALUES (@user_id, @status, @total, 'VND', @sname, @sphone, @saddr, @created);`);
      const orderId = ordRes.recordset[0].id;

      for (const it of items) {
        await new sql.Request(tx)
          .input('order_id', sql.Int, orderId)
          .input('product_id', sql.Int, it.product_id)
          .input('product_name', sql.NVarChar(200), it.product_name)
          .input('unit_price', DEC, it.unit_price)
          .input('quantity', sql.Int, it.quantity)
          .input('line_total', DEC, it.line_total)
          .query(`
            INSERT INTO dbo.order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
            VALUES (@order_id, @product_id, @product_name, @unit_price, @quantity, @line_total);`);
      }
      orderCount++;
    }

    await tx.commit();
    console.log(`Đã tạo ${orderCount} đơn (mã 1..${orderCount}) cho 2 khách: ${CUSTOMER_EMAILS.join(', ')}.`);
    process.exit(0);
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* ignore */ }
    console.error('Lỗi seed (đã rollback):', e.message);
    process.exit(1);
  }
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
