// Đổi role của 1 user theo email — dùng khi cần tự cấp/thu hồi quyền admin mà
// không phải mở SSMS. Dùng chung .env với server nên luôn đúng DB đang chạy.
//
// Usage: node db/set-role.js <email> <admin|customer>
require('dotenv').config();
const { getPool, sql } = require('../db');

const VALID_ROLES = ['admin', 'customer'];

async function main() {
  const email = process.argv[2];
  const role = process.argv[3];

  if (!email || !role) {
    console.error('Usage: node db/set-role.js <email> <admin|customer>');
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`Role không hợp lệ: "${role}". Chỉ chấp nhận: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const pool = await getPool();
  const upd = await pool.request()
    .input('email', sql.VarChar(255), email)
    .input('role', sql.VarChar(20), role)
    .query('UPDATE dbo.users SET role = @role WHERE email = @email;');

  if (upd.rowsAffected[0] === 0) {
    console.error(`Không tìm thấy user với email "${email}".`);
    console.error('Lưu ý: user chỉ được tạo trong DB sau khi đăng nhập ít nhất 1 lần (qua /api/me hoặc bất kỳ trang nào gọi API có xác thực).');
    process.exit(1);
  }

  const check = await pool.request()
    .input('email', sql.VarChar(255), email)
    .query('SELECT id, email, role FROM dbo.users WHERE email = @email;');

  console.log(`Đã cập nhật ${upd.rowsAffected[0]} dòng.`);
  console.table(check.recordset);
  process.exit(0);
}

main().catch((err) => {
  console.error('LỖI:', err.message);
  process.exit(1);
});
