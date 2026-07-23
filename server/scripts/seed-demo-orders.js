/*
 * Seed dữ liệu DEMO cho Dashboard: đơn hàng 4 tháng 04–07/2026, mỗi tháng 15–25 đơn.
 * Một script duy nhất tái lập được toàn bộ dữ liệu demo (DB trắng -> sinh đủ 4 tháng;
 * DB hiện tại -> tháng nào đã có đơn thì tự BỎ QUA, nên không đụng số liệu tháng 7).
 *
 * Chạy thật:  node server/scripts/seed-demo-orders.js
 * Chạy thử:   node server/scripts/seed-demo-orders.js --dry-run   (INSERT rồi ROLLBACK, không ghi gì)
 *
 * NGUYÊN TẮC AN TOÀN:
 *   - CHỈ INSERT — không DELETE / TRUNCATE / UPDATE bất kỳ bảng nào.
 *   - IDEMPOTENT theo THÁNG: tháng đã có đơn (bất kỳ) -> BỎ QUA, chạy lại không nhân đôi.
 *   - user_id: query user thật, LOẠI role='admin', random chọn — không tạo user, không hardcode id.
 *   - unit_price = giá thật (sale_price ?? price); total_amount = TỔNG line_total của items.
 *   - Sinh kèm order_items (widget "Sản phẩm bán chạy" đọc bảng này).
 *   - Không có ngày tương lai (created_at <= thời điểm chạy).
 *   - Mọi giá trị đều parameterized (request.input) — không nối chuỗi vào SQL.
 *   - Tháng 4, 5 không có 'pending' (đơn cũ nghiêng về completed/shipped/cancelled).
 */
// Nạp .env theo vị trí file (server/.env) để chạy được từ mọi cwd, kể cả project root.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool, sql } = require('../db');

const DRY_RUN = process.argv.includes('--dry-run');

// ---- tham số ----
const YEAR = 2026;
const MONTHS = [4, 5, 6, 7];               // các tháng cần seed (1-based)
const MIN_ORDERS = 15;
const MAX_ORDERS = 25;

// Trọng số status (tổng 100).
// Tháng gần (6, 7): như bản seed tháng 7 cũ. Tháng cũ (4, 5): KHÔNG pending,
// nghiêng completed/shipped/cancelled — đơn 3 tháng chưa xử lý là chi tiết dễ bị hỏi.
const WEIGHTS_RECENT = [['completed', 55], ['paid', 20], ['shipped', 10], ['pending', 8], ['cancelled', 7]];
const WEIGHTS_OLD = [['completed', 72], ['shipped', 10], ['cancelled', 18]];
const OLD_MONTHS = [4, 5];

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
function pickStatus(weights) {
  let r = Math.random() * 100, acc = 0;
  for (const [s, w] of weights) { acc += w; if (r < acc) return s; }
  return 'completed';
}
function pad2(n) { return String(n).padStart(2, '0'); }

// Ngày random trong tháng (UTC), KHÔNG vượt quá thời điểm hiện tại:
// - tháng hiện tại: chỉ random tới NGÀY hôm nay; nếu giờ random vẫn lỡ rơi vào tương lai
//   thì kéo về một thời điểm ngẫu nhiên đã qua trong hôm nay.
function randomDateInMonth(year, month1) {
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  const isCurrentMonth = year === now.getUTCFullYear() && month1 === now.getUTCMonth() + 1;
  const maxDay = isCurrentMonth ? Math.min(daysInMonth, now.getUTCDate()) : daysInMonth;
  let d = new Date(Date.UTC(year, month1 - 1, randInt(1, maxDay), randInt(0, 23), randInt(0, 59), randInt(0, 59)));
  if (d > now) d = new Date(now.getTime() - randInt(60, 6 * 3600) * 1000);
  return d;
}

const DEC = sql.Decimal(18, 2);

(async () => {
  const pool = await getPool();

  // Khách thật, LOẠI admin — random chọn khi tạo đơn (không hardcode id).
  const uRes = await pool.request().query("SELECT id FROM dbo.users WHERE role <> 'admin';");
  const userIds = uRes.recordset.map((u) => u.id);
  if (!userIds.length) { console.error('Không có user nào role khác admin. Dừng.'); process.exit(1); }

  // Sản phẩm đang bán + giá hiệu lực (sale_price nếu có, không thì price).
  const prodRes = await pool.request().query(`
    SELECT id, name_vi,
           (CASE WHEN sale_price IS NOT NULL THEN sale_price ELSE price END) AS unit_price
    FROM dbo.products WHERE is_active = 1;`);
  const products = prodRes.recordset;
  if (!products.length) { console.error('Không có sản phẩm is_active=1 để tạo đơn. Dừng.'); process.exit(1); }

  if (DRY_RUN) console.log('[seed] --dry-run: INSERT xong sẽ ROLLBACK từng tháng, DB không đổi.');

  for (const month of MONTHS) {
    const label = pad2(month) + '/' + YEAR;
    const monthStart = new Date(Date.UTC(YEAR, month - 1, 1));
    const nextStart = new Date(Date.UTC(YEAR, month, 1));

    // Idempotent theo tháng: đã có đơn -> BỎ QUA (chỉ đọc).
    const cntRes = await pool.request()
      .input('s', sql.DateTime2, monthStart)
      .input('e', sql.DateTime2, nextStart)
      .query('SELECT COUNT(*) AS c FROM dbo.orders WHERE created_at >= @s AND created_at < @e;');
    const existing = cntRes.recordset[0].c;
    if (existing > 0) {
      console.log(`[seed] ${label}: đã có ${existing} đơn → BỎ QUA`);
      continue;
    }

    // Tháng chưa tới -> không có ngày hợp lệ để sinh.
    if (monthStart > new Date()) {
      console.log(`[seed] ${label}: tháng tương lai → BỎ QUA`);
      continue;
    }

    const weights = OLD_MONTHS.includes(month) ? WEIGHTS_OLD : WEIGHTS_RECENT;
    const numOrders = randInt(MIN_ORDERS, MAX_ORDERS);

    // Mỗi tháng 1 transaction: lỗi giữa chừng -> rollback cả tháng, chạy lại an toàn.
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (let i = 0; i < numOrders; i++) {
        // Giỏ: 1-4 sản phẩm khác nhau, quantity 1-3 (logic random giữ từ bản seed tháng 7).
        const nItems = randInt(1, Math.min(4, products.length));
        const chosen = shuffle(products.slice()).slice(0, nItems);
        const items = chosen.map((p) => {
          const quantity = randInt(1, 3);
          const unit = Number(p.unit_price);
          return { product_id: p.id, product_name: p.name_vi, unit_price: unit, quantity, line_total: unit * quantity };
        });
        const total = items.reduce((s, it) => s + it.line_total, 0); // total_amount TÍNH TỪ ITEMS

        const ordRes = await new sql.Request(tx)
          .input('user_id', sql.Int, pick(userIds))
          .input('status', sql.VarChar(20), pickStatus(weights))
          .input('total', DEC, total)
          .input('sname', sql.NVarChar(200), pick(VN_NAMES))
          .input('sphone', sql.VarChar(20), '09' + randInt(10000000, 99999999))
          .input('saddr', sql.NVarChar(300), randInt(1, 200) + ' ' + pick(VN_STREETS) + ', ' + pick(VN_CITIES))
          .input('created', sql.DateTime2, randomDateInMonth(YEAR, month))
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
      }

      if (DRY_RUN) {
        await tx.rollback();
        console.log(`[seed] ${label}: trống → (dry-run) thử tạo ${numOrders} đơn OK, đã ROLLBACK`);
      } else {
        await tx.commit();
        console.log(`[seed] ${label}: trống → tạo ${numOrders} đơn`);
      }
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ignore */ }
      console.error(`[seed] ${label}: LỖI (${e.message}) — đã rollback tháng này.`);
      process.exitCode = 1;
    }
  }

  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
