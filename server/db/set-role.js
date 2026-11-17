// Đổi role của 1 user theo email — dùng khi cần tự cấp/thu hồi quyền admin/staff mà
// không phải mở SSMS. Dùng chung .env với server nên luôn đúng DB đang chạy.
//
// Usage: node db/set-role.js <email> <customer|staff|admin>
// Tạo tài khoản staff MỚI (chưa có trên Firebase) thì dùng db/create-staff.js.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool, sql } = require('../db');
const { ROLES: VALID_ROLES } = require('../lib/roles');
const { audit } = require('../lib/audit');
const { roleChange } = require('../lib/user-review-audit');

const USAGE = `Usage: node db/set-role.js <email> <${VALID_ROLES.join('|')}>`;

async function main() {
  const email = process.argv[2];
  const role = process.argv[3];

  if (!email || !role) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`Role không hợp lệ: "${role}". Chỉ chấp nhận: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const pool = await getPool();
  // Một transaction: UPDATE khoá các dòng, DELETED cho role cũ -> audit ROLE_CHANGE (actor 'cli') cho TỪNG user có
  // role thật sự đổi (email không unique nên có thể nhiều dòng). Lỗi bất kỳ (kể cả audit) -> rollback, role không đổi.
  const tx = new sql.Transaction(pool);
  let upd;
  try {
    await tx.begin();
    upd = await new sql.Request(tx)
      .input('email', sql.VarChar(255), email)
      .input('role', sql.VarChar(20), role)
      .query('UPDATE dbo.users SET role = @role OUTPUT INSERTED.id, INSERTED.email, DELETED.role AS old_role WHERE email = @email;');

    if (upd.rowsAffected[0] === 0) {
      await tx.rollback();
      console.error(`Không tìm thấy user với email "${email}".`);
      console.error('Lưu ý: user chỉ được tạo trong DB sau khi đăng nhập ít nhất 1 lần (qua /api/me hoặc bất kỳ trang nào gọi API có xác thực).');
      process.exit(1);
    }
    for (const row of upd.recordset) {
      const change = roleChange({ email: row.email, oldRole: row.old_role, newRole: role, source: 'set-role' });
      if (change) await audit(tx, null, { action: 'ROLE_CHANGE', entityType: 'user', entityId: row.id, actor: { role: 'cli' }, ...change });
    }
    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* chưa begin hoặc SQL đã tự rollback */ }
    throw err;
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
