// /api/me — thông tin user hiện tại + cập nhật hồ sơ cá nhân.
//   GET /api/me            — trả hồ sơ (yêu cầu Firebase ID token hợp lệ).
//   PUT /api/me            — cập nhật { phone, dob, gender, country } cho user hiện tại.
const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth');
const { getPool, sql } = require('../db');

// Row DB -> JSON trả client (đồng nhất cho GET & PUT).
function toDto(u) {
  return {
    id: u.id,
    firebase_uid: u.firebase_uid,
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    created_at: u.created_at,
    last_login: u.last_login,
    phone: u.phone,
    dob: u.dob,
    gender: u.gender,
    country: u.country,
  };
}

// ---- GET /api/me ----
router.get('/', verifyFirebaseToken, (req, res) => {
  res.json(toDto(req.user));
});

// ---- Validation cho PUT (trả { ok, value } hoặc { ok:false, message }) ----
const GENDERS = ['male', 'female'];
const COUNTRIES = ['VN', 'US', 'JP', 'KR', 'SG'];
const PHONE_RE = /^[0-9+\-\s()]{6,20}$/;

function vPhone(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, value: null };
  const s = String(raw).trim();
  if (!PHONE_RE.test(s)) return { ok: false, message: 'Số điện thoại không hợp lệ' };
  return { ok: true, value: s };
}
function vGender(raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (GENDERS.indexOf(raw) < 0) return { ok: false, message: 'Giới tính không hợp lệ' };
  return { ok: true, value: raw };
}
function vCountry(raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (COUNTRIES.indexOf(raw) < 0) return { ok: false, message: 'Quốc gia không hợp lệ' };
  return { ok: true, value: raw };
}
function vDob(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
  if (!m) return { ok: false, message: 'Ngày sinh không hợp lệ (định dạng YYYY-MM-DD)' };
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Chặn ngày không tồn tại (vd 31/02) qua so khớp ngược.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { ok: false, message: 'Ngày sinh không tồn tại' };
  }
  if (y < 1900) return { ok: false, message: 'Ngày sinh không hợp lệ' };
  if (dt.getTime() > Date.now()) return { ok: false, message: 'Ngày sinh không thể ở tương lai' };
  return { ok: true, value: dt };
}

// ---- PUT /api/me ---- body: { phone?, dob?, gender?, country? }
router.put('/', verifyFirebaseToken, async (req, res) => {
  const b = req.body || {};
  const phone = vPhone(b.phone);
  const dob = vDob(b.dob);
  const gender = vGender(b.gender);
  const country = vCountry(b.country);

  for (const f of [phone, dob, gender, country]) {
    if (!f.ok) return res.status(400).json({ status: 'error', message: f.message });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('uid', sql.VarChar(128), req.user.firebase_uid)
      .input('phone', sql.VarChar(30), phone.value)
      .input('dob', sql.Date, dob.value)
      .input('gender', sql.VarChar(10), gender.value)
      .input('country', sql.VarChar(8), country.value)
      .query(`
        UPDATE dbo.users
           SET phone = @phone, dob = @dob, gender = @gender, country = @country
         WHERE firebase_uid = @uid;

        SELECT id, firebase_uid, email, display_name, role, created_at, last_login,
               phone, dob, gender, country
        FROM dbo.users WHERE firebase_uid = @uid;`);

    res.json(toDto(result.recordset[0]));
  } catch (err) {
    console.error('[me] cập nhật hồ sơ lỗi:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được hồ sơ' });
  }
});

module.exports = router;
