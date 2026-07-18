// Địa chỉ giao hàng API (yêu cầu Firebase ID token — mọi route bọc verifyFirebaseToken).
//   GET    /api/account/addresses          — danh sách địa chỉ của user hiện tại.
//   POST   /api/account/addresses          — thêm 1 địa chỉ.
//   PUT    /api/account/addresses/:id       — sửa 1 địa chỉ (thay toàn bộ field; KHÔNG đổi mặc định).
//   DELETE /api/account/addresses/:id       — xoá 1 địa chỉ (tự đôn địa chỉ khác lên mặc định nếu cần).
//   PATCH  /api/account/addresses/:id/default — đặt địa chỉ này làm mặc định.
//
// Bất biến: mỗi user có TỐI ĐA 1 địa chỉ is_default=1. Được đảm bảo bằng transaction
// (clear rồi set) + filtered unique index UX_delivery_addresses_default ở tầng DB.
// Địa chỉ đầu tiên của user luôn được đặt mặc định. Chỉ chủ sở hữu thao tác được (đơn
// người khác trả 404, không lộ tồn tại).
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');

router.use(verifyFirebaseToken);

// ---- Validation --------------------------------------------------------------
const COUNTRIES = ['VN', 'US', 'JP', 'KR', 'SG']; // khớp me.js
const PHONE_RE = /^[0-9+\-\s()]{6,20}$/;
const POSTAL_RE = /^[A-Za-z0-9\s-]{2,20}$/;

// Chuẩn hoá + kiểm 1 chuỗi. required=true => rỗng là lỗi. Trả { ok, value } | { ok:false, message }.
function vStr(raw, { field, max, required }) {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) {
    if (required) return { ok: false, message: `${field} không được để trống` };
    return { ok: true, value: null };
  }
  if (s.length > max) return { ok: false, message: `${field} tối đa ${max} ký tự` };
  return { ok: true, value: s };
}

// Kiểm toàn bộ body địa chỉ (dùng chung POST & PUT — semantics thay-toàn-bộ).
// Trả { ok, values } hoặc { ok:false, message }.
function validateAddress(body) {
  const b = body || {};

  const fields = [
    ['recipient_name', vStr(b.recipient_name, { field: 'Tên người nhận', max: 150, required: true })],
    ['line1', vStr(b.line1, { field: 'Địa chỉ', max: 200, required: true })],
    ['line2', vStr(b.line2, { field: 'Địa chỉ (dòng 2)', max: 200, required: false })],
    ['ward', vStr(b.ward, { field: 'Phường/Xã', max: 120, required: false })],
    ['district', vStr(b.district, { field: 'Quận/Huyện', max: 120, required: false })],
    ['city', vStr(b.city, { field: 'Tỉnh/Thành phố', max: 120, required: true })],
  ];
  for (const [, r] of fields) {
    if (!r.ok) return { ok: false, message: r.message };
  }

  // phone (bắt buộc — địa chỉ giao hàng cần liên hệ được).
  const phone = b.phone == null ? '' : String(b.phone).trim();
  if (!phone) return { ok: false, message: 'Số điện thoại không được để trống' };
  if (!PHONE_RE.test(phone)) return { ok: false, message: 'Số điện thoại không hợp lệ' };

  // postal_code (tuỳ chọn).
  const postalRaw = b.postal_code == null ? '' : String(b.postal_code).trim();
  let postal_code = null;
  if (postalRaw) {
    if (!POSTAL_RE.test(postalRaw)) return { ok: false, message: 'Mã bưu chính không hợp lệ' };
    postal_code = postalRaw;
  }

  // country (mặc định VN).
  let country = 'VN';
  if (b.country != null && String(b.country).trim() !== '') {
    const c = String(b.country).trim().toUpperCase();
    if (COUNTRIES.indexOf(c) < 0) return { ok: false, message: 'Quốc gia không hợp lệ' };
    country = c;
  }

  const is_default = b.is_default === true || b.is_default === 'true' || b.is_default === 1;

  const map = Object.fromEntries(fields.map(([k, r]) => [k, r.value]));
  return {
    ok: true,
    values: { ...map, phone, postal_code, country, is_default },
  };
}

// ---- DB helpers --------------------------------------------------------------
function toDto(r) {
  return {
    id: r.id,
    recipient_name: r.recipient_name,
    phone: r.phone,
    line1: r.line1,
    line2: r.line2,
    ward: r.ward,
    district: r.district,
    city: r.city,
    postal_code: r.postal_code,
    country: r.country,
    is_default: !!r.is_default,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// Danh sách địa chỉ của 1 user (mặc định lên đầu, mới nhất trước).
async function listAddresses(pool, userId) {
  const result = await pool
    .request()
    .input('uid', sql.Int, userId)
    .query(`
      SELECT id, user_id, recipient_name, phone, line1, line2, ward, district, city,
             postal_code, country, is_default, created_at, updated_at
      FROM dbo.delivery_addresses
      WHERE user_id = @uid
      ORDER BY is_default DESC, updated_at DESC, id DESC;`);
  return result.recordset.map(toDto);
}

// Gắn các input field địa chỉ (dùng chung INSERT & UPDATE).
function bindAddressInputs(request, a) {
  return request
    .input('rname', sql.NVarChar(150), a.recipient_name)
    .input('phone', sql.VarChar(30), a.phone)
    .input('line1', sql.NVarChar(200), a.line1)
    .input('line2', sql.NVarChar(200), a.line2)
    .input('ward', sql.NVarChar(120), a.ward)
    .input('district', sql.NVarChar(120), a.district)
    .input('city', sql.NVarChar(120), a.city)
    .input('postal', sql.VarChar(20), a.postal_code)
    .input('country', sql.VarChar(8), a.country);
}

function parseId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}

// ---- GET /api/account/addresses ----
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    res.json({ addresses: await listAddresses(pool, req.user.id) });
  } catch (err) {
    console.error('[addresses] list error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được địa chỉ' });
  }
});

// ---- POST /api/account/addresses ----
router.post('/', async (req, res) => {
  const v = validateAddress(req.body);
  if (!v.ok) return res.status(400).json({ status: 'error', message: v.message });
  const a = v.values;

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('[addresses] pool error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi kết nối cơ sở dữ liệu' });
  }

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    // Địa chỉ đầu tiên của user LUÔN là mặc định.
    const cnt = await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .query('SELECT COUNT(*) AS n FROM dbo.delivery_addresses WHERE user_id = @uid;');
    const makeDefault = a.is_default || cnt.recordset[0].n === 0;

    if (makeDefault) {
      // Gỡ mặc định cũ TRƯỚC khi insert cái mới (thoả filtered unique index).
      await new sql.Request(tx)
        .input('uid', sql.Int, req.user.id)
        .query('UPDATE dbo.delivery_addresses SET is_default = 0, updated_at = SYSUTCDATETIME() WHERE user_id = @uid AND is_default = 1;');
    }

    await bindAddressInputs(new sql.Request(tx), a)
      .input('uid', sql.Int, req.user.id)
      .input('isdef', sql.Bit, makeDefault ? 1 : 0)
      .query(`
        INSERT INTO dbo.delivery_addresses
          (user_id, recipient_name, phone, line1, line2, ward, district, city, postal_code, country, is_default)
        VALUES (@uid, @rname, @phone, @line1, @line2, @ward, @district, @city, @postal, @country, @isdef);`);

    await tx.commit();
    res.status(201).json({ addresses: await listAddresses(pool, req.user.id) });
  } catch (err) {
    try { await tx.rollback(); } catch (e) { /* đã rollback hoặc chưa begin */ }
    console.error('[addresses] create error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không thêm được địa chỉ' });
  }
});

// ---- PUT /api/account/addresses/:id ----  (thay toàn bộ field; KHÔNG đổi is_default)
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id.ok) return res.status(400).json({ status: 'error', message: 'id không hợp lệ' });

  const v = validateAddress(req.body);
  if (!v.ok) return res.status(400).json({ status: 'error', message: v.message });
  const a = v.values;

  try {
    const pool = await getPool();
    // is_default cố ý KHÔNG cập nhật ở đây — đổi mặc định đi qua PATCH /:id/default.
    // rowsAffected=0 => không phải chủ sở hữu / không tồn tại => 404.
    const upd = await bindAddressInputs(pool.request(), a)
      .input('id', sql.Int, id.value)
      .input('uid', sql.Int, req.user.id)
      .query(`
        UPDATE dbo.delivery_addresses
           SET recipient_name = @rname, phone = @phone, line1 = @line1, line2 = @line2,
               ward = @ward, district = @district, city = @city, postal_code = @postal,
               country = @country, updated_at = SYSUTCDATETIME()
         WHERE id = @id AND user_id = @uid;`);

    if (!upd.rowsAffected[0]) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy địa chỉ' });
    }
    res.json({ addresses: await listAddresses(pool, req.user.id) });
  } catch (err) {
    console.error('[addresses] update error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được địa chỉ' });
  }
});

// ---- PATCH /api/account/addresses/:id/default ----  đặt làm mặc định
router.patch('/:id/default', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id.ok) return res.status(400).json({ status: 'error', message: 'id không hợp lệ' });

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('[addresses] pool error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi kết nối cơ sở dữ liệu' });
  }

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    // Khoá dòng mục tiêu để tránh race với thao tác default khác của cùng user.
    const own = await new sql.Request(tx)
      .input('id', sql.Int, id.value)
      .input('uid', sql.Int, req.user.id)
      .query('SELECT id FROM dbo.delivery_addresses WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND user_id = @uid;');
    if (own.recordset.length === 0) {
      await tx.rollback();
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy địa chỉ' });
    }

    await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .query('UPDATE dbo.delivery_addresses SET is_default = 0, updated_at = SYSUTCDATETIME() WHERE user_id = @uid AND is_default = 1;');
    await new sql.Request(tx)
      .input('id', sql.Int, id.value)
      .input('uid', sql.Int, req.user.id)
      .query('UPDATE dbo.delivery_addresses SET is_default = 1, updated_at = SYSUTCDATETIME() WHERE id = @id AND user_id = @uid;');

    await tx.commit();
    res.json({ addresses: await listAddresses(pool, req.user.id) });
  } catch (err) {
    try { await tx.rollback(); } catch (e) { /* đã rollback hoặc chưa begin */ }
    console.error('[addresses] set-default error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không đặt được mặc định' });
  }
});

// ---- DELETE /api/account/addresses/:id ----
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id.ok) return res.status(400).json({ status: 'error', message: 'id không hợp lệ' });

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('[addresses] pool error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi kết nối cơ sở dữ liệu' });
  }

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const row = await new sql.Request(tx)
      .input('id', sql.Int, id.value)
      .input('uid', sql.Int, req.user.id)
      .query('SELECT id, is_default FROM dbo.delivery_addresses WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND user_id = @uid;');
    if (row.recordset.length === 0) {
      await tx.rollback();
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy địa chỉ' });
    }
    const wasDefault = !!row.recordset[0].is_default;

    await new sql.Request(tx)
      .input('id', sql.Int, id.value)
      .input('uid', sql.Int, req.user.id)
      .query('DELETE FROM dbo.delivery_addresses WHERE id = @id AND user_id = @uid;');

    // Xoá địa chỉ mặc định mà user vẫn còn địa chỉ khác -> đôn cái mới nhất lên mặc định.
    // (subquery không có dòng nào => WHERE id = NULL => no-op an toàn)
    if (wasDefault) {
      await new sql.Request(tx)
        .input('uid', sql.Int, req.user.id)
        .query(`
          UPDATE dbo.delivery_addresses
             SET is_default = 1, updated_at = SYSUTCDATETIME()
           WHERE id = (
             SELECT TOP 1 id FROM dbo.delivery_addresses
             WHERE user_id = @uid
             ORDER BY updated_at DESC, id DESC
           );`);
    }

    await tx.commit();
    res.json({ addresses: await listAddresses(pool, req.user.id) });
  } catch (err) {
    try { await tx.rollback(); } catch (e) { /* đã rollback hoặc chưa begin */ }
    console.error('[addresses] delete error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không xoá được địa chỉ' });
  }
});

module.exports = router;
