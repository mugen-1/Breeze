// Middleware xác thực Firebase ID token.
//   - Đọc header "Authorization: Bearer <idToken>".
//   - Verify token + trạng thái thu hồi/vô hiệu hoá qua Firebase Admin SDK.
//   - Upsert user vào bảng dbo.users (theo firebase_uid) + cập nhật last_login.
//   - Gắn req.user (row DB) và req.firebaseToken (payload đã decode) cho route sau.
const { getAuth } = require('../firebase');
const { getPool, sql } = require('../db');

// Email trong ADMIN_EMAILS (.env, phân tách bằng dấu phẩy) được tự động gán
// role='admin' khi đăng nhập, VỚI ĐIỀU KIỆN email đó đã xác minh trên Firebase
// (email_verified) — không cần chạy SQL thủ công. Để trống nếu
// không dùng cơ chế này (chỉ set role qua SQL/set-role.js như trước).
function adminEmailSet() {
  const raw = (process.env.ADMIN_EMAILS || '').trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// Chỉ gọi trong transaction đã khoá firebase_uid (xem upsertUser).
async function syncUser(tx, decoded) {
  const result = await new sql.Request(tx)
    .input('uid', sql.VarChar(128), decoded.uid)
    .input('email', sql.VarChar(255), decoded.email || null)
    .input('displayName', sql.NVarChar(150), decoded.name || null)
    .query(`
      MERGE dbo.users AS target
      USING (SELECT @uid AS firebase_uid) AS src
        ON target.firebase_uid = src.firebase_uid
      WHEN MATCHED THEN
        UPDATE SET email = COALESCE(@email, target.email),
                   display_name = COALESCE(@displayName, target.display_name),
                   last_login = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (firebase_uid, email, display_name, last_login)
        VALUES (@uid, @email, @displayName, SYSUTCDATETIME());

      SELECT id, firebase_uid, email, display_name, role, created_at, last_login,
             phone, dob, gender, country, avatar_url, IsBlacklisted AS is_blacklisted
      FROM dbo.users
      WHERE firebase_uid = @uid;
    `);
  let user = result.recordset[0];

  // Tự động phong admin nếu email khớp ADMIN_EMAILS và chưa phải admin.
  // BẮT BUỘC email_verified === true: Firebase cho đăng ký bằng email BẤT KỲ mà không
  // cần sở hữu hộp thư, nên thiếu điều kiện này thì ai biết email admin cũng tự phong
  // được. So bằng decoded.email (chính email mà cờ verified nói tới), không dùng
  // user.email trong DB — cột đó có thể là email cũ còn sót lại qua COALESCE.
  const admins = adminEmailSet();
  if (decoded.email_verified === true && decoded.email &&
      admins.has(decoded.email.toLowerCase()) && user.role !== 'admin') {
    const upd = await new sql.Request(tx)
      .input('uid', sql.VarChar(128), decoded.uid)
      .query(`
        UPDATE dbo.users SET role = 'admin' WHERE firebase_uid = @uid;
        SELECT id, firebase_uid, email, display_name, role, created_at, last_login,
               phone, dob, gender, country, avatar_url, IsBlacklisted AS is_blacklisted
        FROM dbo.users WHERE firebase_uid = @uid;
      `);
    user = upd.recordset[0];
  }

  return user;
}

class TokenRejected extends Error {}

async function verifyActiveToken(token) {
  try {
    // checkRevoked=true kiểm tra cả disabled và user đã bị xoá trên Firebase.
    return await getAuth().verifyIdToken(token, true);
  } catch (err) {
    // Không log message/token: lỗi SDK có thể chứa input hoặc thông tin credential.
    const code = typeof err.code === 'string' && /^auth\/[a-z0-9-]+$/.test(err.code)
      ? err.code : 'verification-failed';
    console.warn('[auth] token rejected:', code);
    throw new TokenRejected();
  }
}

async function upsertUser(decoded, token) {
  const tx = new sql.Transaction(await getPool());
  try {
    await tx.begin();
    // Giữ khoá dòng/khoảng khoá đến commit. DELETE account không thể xoá row
    // giữa SELECT và MERGE; hai request đăng nhập đầu tiên cũng không đua INSERT.
    const existing = await new sql.Request(tx)
      .input('uid', sql.VarChar(128), decoded.uid)
      .query('SELECT id FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE firebase_uid = @uid;');
    if (existing.recordset.length === 0) {
      // Có thể token đã verify trước khi DELETE account hoàn tất, rồi request
      // mới lấy được khoá SQL. Kiểm tra LẠI ngay trước khi tạo row còn thiếu.
      // Firebase luôn bị xoá trước SQL trong routes/account.js.
      decoded = await verifyActiveToken(token);
    }
    const user = await syncUser(tx, decoded);
    await tx.commit();
    return user;
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* chưa begin hoặc đã rollback */ }
    throw err;
  }
}

function rejectToken(res) {
  return res.status(401).json({
    status: 'error',
    message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại',
  });
}

async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = typeof authHeader === 'string' && authHeader.match(/^Bearer ([^\s]+)$/i);
  if (!match) {
    return res.status(401).json({
      status: 'error',
      message: 'Thiếu token. Gửi header: Authorization: Bearer <idToken>',
    });
  }

  let decoded;
  try {
    decoded = await verifyActiveToken(match[1]);
  } catch (err) {
    return rejectToken(res);
  }

  try {
    req.user = await upsertUser(decoded, match[1]);
    req.firebaseToken = decoded;
  } catch (err) {
    if (err instanceof TokenRejected) return rejectToken(res);
    console.error('[auth] upsertUser lỗi:', err.code || 'database-error');
    return res.status(500).json({ status: 'error', message: 'Lỗi đồng bộ người dùng' });
  }
  next();
}

module.exports = { verifyFirebaseToken };
