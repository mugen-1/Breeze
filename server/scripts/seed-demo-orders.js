/*
 * Seed dữ liệu DEMO cho Dashboard: bơm KHÁCH + ĐƠN mẫu để stats/chart có số thật
 * (mọi con số vẫn được TÍNH TỪ DB qua /api/admin/stats — script không hardcode số nào).
 *
 * Chạy:  node server/scripts/seed-demo-orders.js
 *
 * AN TOÀN:
 *   - Mọi user seed có firebase_uid tiền tố 'seed_' để tách khỏi data thật.
 *   - IDEMPOTENT: mỗi lần chạy, TRONG 1 transaction sẽ dọn seed cũ trước (xoá đơn của
 *     user 'seed_%' -> order_items cascade theo -> xoá chính user 'seed_%') rồi chèn mới.
 *   - TUYỆT ĐỐI không đụng user/đơn KHÔNG có tiền tố 'seed_'.
 */
// Nạp .env theo vị trí file (server/.env) để chạy được từ mọi cwd, kể cả project root.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool, sql } = require('../db');

// ---- tham số ----
const NUM_USERS = 10;
const MIN_ORDERS = 50;
const MAX_ORDERS = 70;

// Phân bố trạng thái (tổng 100). completed chiếm đa số, cancelled ít.
const STATUS_WEIGHTS = [
  ['completed', 55], ['paid', 20], ['shipped', 10], ['pending', 8], ['cancelled', 7],
];

const VN_NAMES = [
  'Nguyễn Văn An', 'Trần Thị Bình', 'Lê Hoàng Cường', 'Phạm Thị Dung', 'Hoàng Văn Em',
  'Vũ Thị Hà', 'Đặng Minh Khôi', 'Bùi Thị Lan', 'Đỗ Văn Minh', 'Ngô Thị Nga',
  'Dương Văn Phúc', 'Lý Thị Quỳnh', 'Phan Văn Sơn', 'Võ Thị Trang', 'Đinh Văn Uy',
];
const VN_STREETS = ['Lê Lợi', 'Nguyễn Huệ', 'Trần Hưng Đạo', 'Hai Bà Trưng', 'Cách Mạng Tháng 8', 'Điện Biên Phủ'];
const VN_CITIES = ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ'];

// ---- helpers ngẫu nhiên ----
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

// Ngày trong "tháng offset" (0 = 11 tháng trước ... 11 = tháng hiện tại), theo UTC.
const NOW = new Date();
const CUR_Y = NOW.getUTCFullYear();
const CUR_M = NOW.getUTCMonth();
function dateInMonthOffset(offset) {
  const monthsAgo = 11 - offset;
  let y = CUR_Y, mo = CUR_M - monthsAgo;
  while (mo < 0) { mo += 12; y -= 1; }
  let maxDay = 28;                                   // tránh lệ thuộc độ dài tháng
  if (y === CUR_Y && mo === CUR_M) maxDay = Math.max(1, NOW.getUTCDate()); // tháng này: không vượt hôm nay
  return new Date(Date.UTC(y, mo, randInt(1, maxDay), randInt(0, 23), randInt(0, 59), randInt(0, 59)));
}

const DEC = sql.Decimal(18, 2);

(async () => {
  const pool = await getPool();

  // Sản phẩm thật đang bán -> lấy snapshot tên + giá hiệu lực (sale_price nếu có).
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
    // 1) Dọn seed cũ (chỉ 'seed_%'): xoá đơn của user seed (order_items cascade) rồi xoá user seed.
    await new sql.Request(tx).query(`
      DELETE FROM dbo.orders
      WHERE user_id IN (SELECT id FROM dbo.users WHERE firebase_uid LIKE 'seed_%');`);
    await new sql.Request(tx).query(`DELETE FROM dbo.users WHERE firebase_uid LIKE 'seed_%';`);

    // 2) Chèn khách mẫu, created_at rải trong 12 tháng.
    const names = shuffle(VN_NAMES.slice()).slice(0, NUM_USERS);
    const userIds = [];
    for (let i = 0; i < NUM_USERS; i++) {
      const created = dateInMonthOffset(randInt(0, 11));
      const r = await new sql.Request(tx)
        .input('uid', sql.VarChar(128), 'seed_' + (i + 1))
        .input('email', sql.VarChar(256), 'customer' + (i + 1) + '@example.com')
        .input('name', sql.NVarChar(200), names[i] || ('Khách ' + (i + 1)))
        .input('created', sql.DateTime2, created)
        .query(`
          INSERT INTO dbo.users (firebase_uid, email, display_name, role, created_at, last_login)
          OUTPUT INSERTED.id
          VALUES (@uid, @email, @name, 'customer', @created, @created);`);
      userIds.push(r.recordset[0].id);
    }

    // 3) Chèn đơn. Rải đều 12 tháng bằng round-robin (mỗi tháng đều có đơn) rồi xáo trộn.
    const totalOrders = randInt(MIN_ORDERS, MAX_ORDERS);
    const monthAssign = [];
    for (let i = 0; i < totalOrders; i++) monthAssign.push(i % 12);
    shuffle(monthAssign);

    let orderCount = 0;
    for (let i = 0; i < totalOrders; i++) {
      // Giỏ hàng: 1-4 sản phẩm khác nhau, quantity 1-3.
      const nItems = randInt(1, Math.min(4, products.length));
      const chosen = shuffle(products.slice()).slice(0, nItems);
      const items = chosen.map((p) => {
        const quantity = randInt(1, 3);
        const unit = Number(p.unit_price);
        return { product_id: p.id, product_name: p.name_vi, unit_price: unit, quantity, line_total: unit * quantity };
      });
      const total = items.reduce((s, it) => s + it.line_total, 0); // total_amount TÍNH TỪ ITEMS

      const uid = pick(userIds);
      const created = dateInMonthOffset(monthAssign[i]);
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
    console.log(`Đã tạo ${userIds.length} khách, ${orderCount} đơn.`);
    process.exit(0);
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* ignore */ }
    console.error('Lỗi seed (đã rollback):', e.message);
    process.exit(1);
  }
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
