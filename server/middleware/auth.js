// Middleware xác thực Firebase ID token.
//   - Đọc header "Authorization: Bearer <idToken>".
//   - Verify token qua Firebase Admin SDK.
//   - Upsert user vào bảng dbo.users (theo firebase_uid) + cập nhật last_login.
//   - Gắn req.user (row DB) và req.firebaseToken (payload đã decode) cho route sau.
const { getAuth } = require('../firebase');
const { getPool, sql } = require('../db');

// Email trong ADMIN_EMAILS (.env, phân tách bằng dấu phẩy) luôn được tự động gán
// role='admin' mỗi lần đăng nhập — không cần chạy SQL thủ công. Để trống nếu
// không dùng cơ chế này (chỉ set role qua SQL/set-role.js như trước).
function adminEmailSet() {
  const raw = (process.env.ADMIN_EMAILS || '').trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// Insert nếu chưa có, update nếu đã có; trả về row user hiện tại.
async function upsertUser(decoded) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('uid', sql.VarChar(128), decoded.uid)
    .input('email', sql.VarChar(255), decoded.email || null)
    .input('displayName', sql.NVarChar(150), decoded.name || null)
    .query(`
      MERGE dbo.users AS target
      USING (SELECT @uid AS firebase_uid) AS src
        ON target.firebase_uid = src.firebase_uid
      WHEN MATCHED THEN
        UPDATE SET email = @email,
                   display_name = @displayName,
                   last_login = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (firebase_uid, email, display_name, last_login)
        VALUES (@uid, @email, @displayName, SYSUTCDATETIME());

      SELECT id, firebase_uid, email, display_name, role, created_at, last_login
      FROM dbo.users
      WHERE firebase_uid = @uid;
    `);
  let user = result.recordset[0];

  // Tự động phong admin nếu email khớp ADMIN_EMAILS và chưa phải admin.
  const admins = adminEmailSet();
  if (user.email && admins.has(user.email.toLowerCase()) && user.role !== 'admin') {
    const upd = await pool
      .request()
      .input('uid', sql.VarChar(128), decoded.uid)
      .query(`
        UPDATE dbo.users SET role = 'admin' WHERE firebase_uid = @uid;
        SELECT id, firebase_uid, email, display_name, role, created_at, last_login
        FROM dbo.users WHERE firebase_uid = @uid;
      `);
    user = upd.recordset[0];
  }

  return user;
}

async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({
      status: 'error',
      message: 'Thiếu token. Gửi header: Authorization: Bearer <idToken>',
    });
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(match[1]);
  } catch (err) {
    console.error('[auth] verifyIdToken thất bại:', err.message);
    return res.status(401).json({
      status: 'error',
      message: 'Token không hợp lệ hoặc đã hết hạn',
    });
  }

  try {
    req.user = await upsertUser(decoded);
    req.firebaseToken = decoded;
    next();
  } catch (err) {
    console.error('[auth] upsertUser lỗi:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi đồng bộ người dùng' });
  }
}

module.exports = { verifyFirebaseToken };
