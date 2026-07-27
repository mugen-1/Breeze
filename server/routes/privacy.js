// Tùy chọn quyền riêng tư — GET trả trạng thái hiện tại (mặc định TẮT nếu user chưa từng
// đặt, KHÔNG tạo row), PATCH cập nhật partial (chỉ field có trong body được ghi đè, upsert).
// uid luôn lấy từ token đã xác thực (verifyFirebaseToken), KHÔNG lấy từ body/param.
//   GET   /api/account/privacy-settings
//   PATCH /api/account/privacy-settings   body: { show_profile_public?, allow_marketing_email? }
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');

router.use(verifyFirebaseToken);

const FIELDS = ['show_profile_public', 'allow_marketing_email'];

// Row DB -> JSON trả client; chưa có row (user chưa từng đặt) -> mặc định TẮT cả 2.
function toDto(row) {
  if (!row) {
    return { show_profile_public: false, allow_marketing_email: false, updated_at: null };
  }
  return {
    show_profile_public: !!row.show_profile_public,
    allow_marketing_email: !!row.allow_marketing_email,
    updated_at: row.updated_at,
  };
}

// ---- GET /api/account/privacy-settings ----
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('uid', sql.Int, req.user.id)
      .query(`
        SELECT show_profile_public, allow_marketing_email, updated_at
        FROM dbo.user_privacy_settings WHERE user_id = @uid;`);
    res.json(toDto(result.recordset[0]));
  } catch (err) {
    console.error('[privacy] lấy tùy chọn lỗi:', err.message);
    res.status(500).json({ status: 'error', message: 'Không lấy được tùy chọn quyền riêng tư' });
  }
});

// ---- PATCH /api/account/privacy-settings ---- body: partial subset của FIELDS (boolean)
router.patch('/', async (req, res) => {
  const b = req.body || {};
  let hasField = false;
  for (const f of FIELDS) {
    if (b[f] === undefined) continue;
    if (typeof b[f] !== 'boolean') {
      return res.status(400).json({ status: 'error', message: `${f} phải là boolean` });
    }
    hasField = true;
  }
  if (!hasField) {
    return res.status(400).json({ status: 'error', message: 'Không có trường nào để cập nhật' });
  }

  try {
    const pool = await getPool();
    const request = pool.request().input('uid', sql.Int, req.user.id);
    for (const f of FIELDS) {
      request.input(f, sql.Bit, b[f] === undefined ? null : b[f]);
    }
    // MERGE: field có mặt trong body -> ghi đè; field vắng mặt (param NULL) -> COALESCE giữ
    // nguyên giá trị cũ (hoặc 0 nếu INSERT lần đầu). 1 row/user (UNIQUE user_id) nên upsert an toàn.
    const result = await request.query(`
      MERGE dbo.user_privacy_settings AS target
      USING (SELECT @uid AS user_id) AS src
        ON target.user_id = src.user_id
      WHEN MATCHED THEN
        UPDATE SET
          show_profile_public   = COALESCE(@show_profile_public, target.show_profile_public),
          allow_marketing_email = COALESCE(@allow_marketing_email, target.allow_marketing_email),
          updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (user_id, show_profile_public, allow_marketing_email, updated_at)
        VALUES (
          @uid,
          COALESCE(@show_profile_public, 0),
          COALESCE(@allow_marketing_email, 0),
          SYSUTCDATETIME()
        );

      SELECT show_profile_public, allow_marketing_email, updated_at
      FROM dbo.user_privacy_settings WHERE user_id = @uid;`);

    res.json(toDto(result.recordset[0]));
  } catch (err) {
    console.error('[privacy] cập nhật tùy chọn lỗi:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được tùy chọn quyền riêng tư' });
  }
});

module.exports = router;
