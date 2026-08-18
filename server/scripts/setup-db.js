/*
 * setup-db.js — dựng lại TOÀN BỘ database BreezeShopDB đúng thứ tự.
 *
 * Chạy (từ thư mục gốc project):  node server/scripts/setup-db.js
 * (Cần server/.env đã cấu hình.)
 *
 * VÌ SAO CẦN FILE NÀY:
 *   Thư mục server/db/migrations/ hiện có 17 file, trong đó 6 file đã đánh số
 *   (001..006) trùng nội dung với 6 bản cũ KHÔNG đánh số. Nhưng 5 file chỉ tồn
 *   tại ở dạng không đánh số (payment_methods, user_privacy_settings,
 *   users_avatar_url, orders_user_nullable, remove_personalization) — chạy thiếu
 *   là mất bảng, sai lược đồ so với mô tả trong khoá luận.
 *   Ngoài ra 4 cột (VoucherCode, DiscountAmount, PaymentMethod, IsBlacklisted)
 *   được thêm bằng script .js riêng chứ không phải .sql.
 *
 *   File này gom đúng thứ tự cần chạy vào 1 lệnh duy nhất.
 *
 * AN TOÀN:
 *   - schema.sql + seed.sql XOÁ SẠCH dữ liệu cũ (DROP/DELETE + RESEED). Chỉ chạy
 *     khi muốn dựng lại từ đầu. Dùng cờ --keep-data để bỏ qua 2 bước này.
 *   - Toàn bộ migration còn lại đều idempotent (chạy lại nhiều lần không lỗi).
 *   - Dừng ngay khi có bước lỗi, in rõ file nào hỏng.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// File nằm ở server/scripts/ nên phải lùi 2 cấp mới ra thư mục gốc project.
const ROOT = path.join(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
// MẶC ĐỊNH = AN TOÀN: chỉ chạy migration, KHÔNG đụng dữ liệu.
// Muốn dựng lại từ đầu (XOÁ SẠCH) phải khai báo rõ --fresh.
const FRESH = process.argv.includes('--fresh');

if (!fs.existsSync(SERVER)) {
  console.error('[setup] Không thấy thư mục server/. Đặt file này ở gốc project.');
  process.exit(1);
}
if (!fs.existsSync(path.join(SERVER, '.env'))) {
  console.error('[setup] Thiếu server/.env — hãy copy từ .env.example và điền thông tin SQL Server.');
  process.exit(1);
}

/* Bảng có KHOÁ NGOẠI trỏ tới users/products nhưng KHÔNG nằm trong schema.sql.
   schema.sql chỉ DROP 5 bảng nền (order_items, orders, products, users, categories).
   Nếu 4 bảng dưới đây đang tồn tại thì DROP TABLE users/products sẽ THẤT BẠI vì
   vướng FK -> phải gỡ chúng TRƯỚC. Chỉ chạy ở chế độ --fresh. */
const DROP_DEPENDENTS_SQL = [
  "IF OBJECT_ID('dbo.cart_items','U')            IS NOT NULL DROP TABLE dbo.cart_items;",
  "IF OBJECT_ID('dbo.delivery_addresses','U')    IS NOT NULL DROP TABLE dbo.delivery_addresses;",
  "IF OBJECT_ID('dbo.payment_methods','U')       IS NOT NULL DROP TABLE dbo.payment_methods;",
  "IF OBJECT_ID('dbo.user_privacy_settings','U') IS NOT NULL DROP TABLE dbo.user_privacy_settings;",
  'GO',
].join('\n');

const TMP_SQL = '.tmp-drop-dependents.sql';

/* Thứ tự chạy. type: 'sql' -> qua db/run-sql.js ; 'node' -> chạy trực tiếp */
const STEPS = [
  // --- Gỡ bảng phụ thuộc để schema.sql DROP được (chỉ ở chế độ --fresh) ---
  { type: 'sql', file: TMP_SQL, destructive: true, generated: true,
    desc: 'Gỡ 4 bảng có FK tới users/products (cart_items, delivery_addresses, payment_methods, user_privacy_settings)' },

  // --- Nền: tạo bảng + dữ liệu mẫu (XOÁ dữ liệu cũ) ---
  { type: 'sql', file: 'db/schema.sql', destructive: true,
    desc: 'Tạo 5 bảng nền: categories, products, users, orders, order_items' },
  { type: 'sql', file: 'db/seed.sql', destructive: true,
    desc: 'Nạp 5 danh mục + 50 sản phẩm mẫu' },

  // --- Migration có đánh số ---
  { type: 'sql', file: 'db/migrations/001_cart_items.sql',
    desc: 'Bảng cart_items (giỏ hàng phía server)' },
  { type: 'sql', file: 'db/migrations/002_orders_status_check.sql',
    desc: 'CHECK constraint cho orders.status (5 trạng thái)' },
  { type: 'sql', file: 'db/migrations/003_remove_nhan.sql',
    desc: 'Dọn danh mục cũ không dùng' },
  { type: 'sql', file: 'db/migrations/004_rename_giay_giaydep.sql',
    desc: 'Đổi tên danh mục Giày -> Giày & Dép' },
  { type: 'sql', file: 'db/migrations/005_users_profile_fields.sql',
    desc: 'Thêm phone, dob, gender, country vào users' },
  { type: 'sql', file: 'db/migrations/006_delivery_addresses.sql',
    desc: 'Bảng delivery_addresses + chỉ mục duy nhất có điều kiện' },

  // --- Migration CHƯA đánh số (bắt buộc, không có bản đánh số tương ứng) ---
  { type: 'sql', file: 'db/migrations/payment_methods.sql',
    desc: 'Bảng payment_methods (KHÔNG lưu số thẻ đầy đủ / CVV)' },
  { type: 'sql', file: 'db/migrations/user_privacy_settings.sql',
    desc: 'Bảng user_privacy_settings' },
  { type: 'sql', file: 'db/migrations/users_avatar_url.sql',
    desc: 'Thêm cột users.avatar_url' },
  { type: 'sql', file: 'db/migrations/orders_user_nullable.sql',
    desc: 'Cho phép orders.user_id NULL (ẩn danh khi xoá tài khoản)' },
  { type: 'sql', file: 'db/migrations/remove_personalization.sql',
    desc: 'Gỡ cột cá nhân hoá đã bỏ' },

  // --- Cột thêm bằng script .js ---
  { type: 'node', file: 'scripts/add-voucher-columns.js',
    desc: 'Thêm orders.VoucherCode + orders.DiscountAmount' },
  { type: 'node', file: 'scripts/add-payment-method-column.js',
    desc: 'Thêm orders.PaymentMethod' },
  { type: 'node', file: 'scripts/add-blacklist-column.js',
    desc: 'Thêm users.IsBlacklisted (+ seed 1 lần duy nhất)' },
  { type: 'node', file: 'scripts/add-orders-indexes.js',
    desc: 'Chỉ mục IX_orders_status_created' },
];

if (FRESH) {
  fs.writeFileSync(path.join(SERVER, TMP_SQL), DROP_DEPENDENTS_SQL, 'utf8');
}
function cleanupTmp() {
  const p = path.join(SERVER, TMP_SQL);
  if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) { /* bỏ qua */ } }
}

console.log('='.repeat(70));
console.log(' DỰNG DATABASE BreezeShopDB');
console.log(' Chế độ:', FRESH
  ? 'DỰNG LẠI TỪ ĐẦU — XOÁ SẠCH dữ liệu cũ (--fresh)'
  : 'AN TOÀN — chỉ chạy migration, giữ nguyên dữ liệu');
console.log('='.repeat(70));

let done = 0, skipped = 0;

for (let idx = 0; idx < STEPS.length; idx++) {
  const step = STEPS[idx];
  const label = `[${String(idx + 1).padStart(2, '0')}/${STEPS.length}]`;
  const full = path.join(SERVER, step.file);

  if (step.destructive && !FRESH) {
    console.log(`${label} BỎ QUA (chế độ an toàn): ${step.file}`);
    skipped++;
    continue;
  }
  if (!step.generated && !fs.existsSync(full)) {
    console.error(`${label} KHÔNG THẤY FILE: ${step.file}`);
    cleanupTmp();
    process.exit(1);
  }

  console.log(`${label} ${step.file}`);
  console.log(`        ${step.desc}`);

  try {
    const args = step.type === 'sql'
      ? ['db/run-sql.js', step.file]
      : [step.file];
    execFileSync(process.execPath, args, { cwd: SERVER, stdio: 'pipe' });
    done++;
  } catch (err) {
    console.error(`\n[setup] LỖI ở bước ${idx + 1} — ${step.file}`);
    const out = (err.stdout || '').toString() + (err.stderr || '').toString();
    console.error(out.trim().split('\n').slice(-15).join('\n'));
    cleanupTmp();
    process.exit(1);
  }
}

cleanupTmp();

console.log('='.repeat(70));
console.log(`[setup] XONG: ${done} bước chạy, ${skipped} bước bỏ qua.`);
if (!FRESH) {
  console.log('[setup] (Đã chạy ở chế độ an toàn. Muốn dựng lại từ đầu: node server/scripts/setup-db.js --fresh)');
}
console.log('[setup] Kiểm tra lại:  cd server && node db/verify.js');
console.log('[setup] Cấp quyền admin: cd server && node db/set-role.js <email> admin');
console.log('='.repeat(70));
