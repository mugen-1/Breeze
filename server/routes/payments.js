// Phương thức thanh toán API (yêu cầu Firebase ID token — mọi route bọc verifyFirebaseToken).
//   GET    /api/account/payment-methods           — danh sách thẻ của user hiện tại.
//   POST   /api/account/payment-methods           — thêm 1 thẻ.
//   PUT    /api/account/payment-methods/:id        — sửa 1 thẻ (KHÔNG đổi mặc định).
//   DELETE /api/account/payment-methods/:id        — xoá 1 thẻ (tự đôn thẻ khác lên mặc định nếu cần).
//   PATCH  /api/account/payment-methods/:id/default — đặt thẻ này làm mặc định.
//
// BẢO MẬT (bất biến): CHỈ lưu brand + last4 + holder_name + exp_month/exp_year.
// TUYỆT ĐỐI KHÔNG ghi DB / KHÔNG log full số thẻ (PAN) hay CVV. Số thẻ full chỉ đi vào
// parseCard() để suy brand + last4 rồi biến mất khỏi scope — không bao giờ rời hàm này.
//
// Bất biến khác (giống addresses): mỗi user tối đa 1 thẻ is_default=1 (transaction clear→set
// + filtered unique index UX_payment_methods_default); thẻ đầu tiên auto-default; chỉ chủ sở
// hữu thao tác được (thẻ người khác trả 404).
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');

router.use(verifyFirebaseToken);

// ---- Xử lý số thẻ (bảo mật) --------------------------------------------------
// Luhn checksum. Nhận chuỗi CHỈ gồm chữ số.
function luhnValid(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48; // '0' = 48
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Suy brand từ prefix (theo spec): 4 -> visa; 51-55/2221-2720 -> mastercard;
// 34/37 -> amex; 35 -> jcb; còn lại -> other.
function brandOf(digits) {
  if (digits[0] === '4') return 'visa';
  const p2 = Number(digits.slice(0, 2));
  const p4 = Number(digits.slice(0, 4));
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return 'mastercard';
  if (p2 === 34 || p2 === 37) return 'amex';
  if (p2 === 35) return 'jcb';
  return 'other';
}

// parseCard: nhận số thẻ full, trả { ok, brand, last4 } | { ok:false, message }.
// `digits` là biến cục bộ, KHÔNG log, KHÔNG lưu, biến mất khi hàm return.
function parseCard(raw) {
  const digits = String(raw == null ? '' : raw).replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return { ok: false, message: 'Số thẻ không hợp lệ' };
  if (digits.length < 13 || digits.length > 19) return { ok: false, message: 'Số thẻ không hợp lệ' };
  if (!luhnValid(digits)) return { ok: false, message: 'Số thẻ không hợp lệ' };
  return { ok: true, brand: brandOf(digits), last4: digits.slice(-4) };
}

// ---- Validation field --------------------------------------------------------
function vHolder(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return { ok: false, message: 'Tên chủ thẻ không được để trống' };
  if (s.length > 150) return { ok: false, message: 'Tên chủ thẻ tối đa 150 ký tự' };
  return { ok: true, value: s };
}

// exp_month 1..12; exp_year chấp nhận YY (->20YY) hoặc YYYY; không cho quá khứ.
function vExp(monthRaw, yearRaw) {
  const m = Number(monthRaw);
  if (!Number.isInteger(m) || m < 1 || m > 12) return { ok: false, message: 'Tháng hết hạn không hợp lệ (01–12)' };
  let y = Number(yearRaw);
  if (!Number.isInteger(y)) return { ok: false, message: 'Năm hết hạn không hợp lệ' };
  if (y >= 0 && y < 100) y += 2000; // chấp nhận YY -> 20YY
  if (y < 2000 || y > 2099) return { ok: false, message: 'Năm hết hạn không hợp lệ' };
  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth() + 1;
  if (y < curY || (y === curY && m < curM)) return { ok: false, message: 'Thẻ đã hết hạn' };
  return { ok: true, month: m, year: y };
}

// ---- DB helpers --------------------------------------------------------------
function toDto(r) {
  return {
    id: r.id,
    brand: r.brand,
    last4: r.last4,
    holder_name: r.holder_name,
    exp_month: r.exp_month,
    exp_year: r.exp_year,
    is_default: !!r.is_default,
  };
}

async function listCards(pool, userId) {
  const result = await pool
    .request()
    .input('uid', sql.Int, userId)
    .query(`
      SELECT id, user_id, brand, last4, holder_name, exp_month, exp_year, is_default, created_at, updated_at
      FROM dbo.payment_methods
      WHERE user_id = @uid
      ORDER BY is_default DESC, updated_at DESC, id DESC;`);
  return result.recordset.map(toDto);
}

function parseId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}

// ---- GET /api/account/payment-methods ----
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    res.json({ payment_methods: await listCards(pool, req.user.id) });
  } catch (err) {
    console.error('[payments] list error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được phương thức thanh toán' });
  }
});

// ---- POST /api/account/payment-methods ----
router.post('/', async (req, res) => {
  const b = req.body || {};
  const card = parseCard(b.card_number);
  if (!card.ok) return res.status(400).json({ status: 'error', message: card.message });
  const holder = vHolder(b.holder_name);
  if (!holder.ok) return res.status(400).json({ status: 'error', message: holder.message });
  const exp = vExp(b.exp_month, b.exp_year);
  if (!exp.ok) return res.status(400).json({ status: 'error', message: exp.message });
  const wantDefault = b.is_default === true || b.is_default === 'true' || b.is_default === 1;

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('[payments] pool error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi kết nối cơ sở dữ liệu' });
  }

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    // Thẻ đầu tiên của user LUÔN là mặc định.
    const cnt = await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .query('SELECT COUNT(*) AS n FROM dbo.payment_methods WHERE user_id = @uid;');
    const makeDefault = wantDefault || cnt.recordset[0].n === 0;

    if (makeDefault) {
      await new sql.Request(tx)
        .input('uid', sql.Int, req.user.id)
        .query('UPDATE dbo.payment_methods SET is_default = 0, updated_at = SYSUTCDATETIME() WHERE user_id = @uid AND is_default = 1;');
    }

    await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .input('brand', sql.VarChar(20), card.brand)
      .input('last4', sql.Char(4), card.last4)
      .input('holder', sql.NVarChar(150), holder.value)
      .input('month', sql.TinyInt, exp.month)
      .input('year', sql.SmallInt, exp.year)
      .input('isdef', sql.Bit, makeDefault ? 1 : 0)
      .query(`
        INSERT INTO dbo.payment_methods (user_id, brand, last4, holder_name, exp_month, exp_year, is_default)
        VALUES (@uid, @brand, @last4, @holder, @month, @year, @isdef);`);

    await tx.commit();
    res.status(201).json({ payment_methods: await listCards(pool, req.user.id) });
  } catch (err) {
    try { await tx.rollback(); } catch (e) { /* đã rollback hoặc chưa begin */ }
    console.error('[payments] create error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không thêm được thẻ' });
  }
});

// ---- PUT /api/account/payment-methods/:id ----  (thay field; KHÔNG đổi is_default)
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id.ok) return res.status(400).json({ status: 'error', message: 'id không hợp lệ' });

  const b = req.body || {};
  const holder = vHolder(b.holder_name);
  if (!holder.ok) return res.status(400).json({ status: 'error', message: holder.message });
  const exp = vExp(b.exp_month, b.exp_year);
  if (!exp.ok) return res.status(400).json({ status: 'error', message: exp.message });

  // card_number: chỉ khi người dùng gõ số mới (khác rỗng) mới parse lại brand+last4;
  // trống/không gửi => GIỮ NGUYÊN brand+last4 cũ.
  const rawCard = b.card_number == null ? '' : String(b.card_number).replace(/[\s-]/g, '');
  let newCard = null;
  if (rawCard !== '') {
    const parsed = parseCard(b.card_number);
    if (!parsed.ok) return res.status(400).json({ status: 'error', message: parsed.message });
    newCard = parsed;
  }

  try {
    const pool = await getPool();
    const request = pool
      .request()
      .input('id', sql.Int, id.value)
      .input('uid', sql.Int, req.user.id)
      .input('holder', sql.NVarChar(150), holder.value)
      .input('month', sql.TinyInt, exp.month)
      .input('year', sql.SmallInt, exp.year);

    let setCard = '';
    if (newCard) {
      request.input('brand', sql.VarChar(20), newCard.brand).input('last4', sql.Char(4), newCard.last4);
      setCard = 'brand = @brand, last4 = @last4, ';
    }

    // is_default cố ý KHÔNG cập nhật ở đây — đổi mặc định đi qua PATCH /:id/default.
    // rowsAffected=0 => không phải chủ sở hữu / không tồn tại => 404.
    const upd = await request.query(`
      UPDATE dbo.payment_methods
         SET ${setCard}holder_name = @holder, exp_month = @month, exp_year = @year, updated_at = SYSUTCDATETIME()
       WHERE id = @id AND user_id = @uid;`);

    if (!upd.rowsAffected[0]) return res.status(404).json({ status: 'error', message: 'Không tìm thấy thẻ' });
    res.json({ payment_methods: await listCards(pool, req.user.id) });
  } catch (err) {
    console.error('[payments] update error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được thẻ' });
  }
});

// ---- PATCH /api/account/payment-methods/:id/default ----  đặt làm mặc định
router.patch('/:id/default', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id.ok) return res.status(400).json({ status: 'error', message: 'id không hợp lệ' });

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('[payments] pool error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi kết nối cơ sở dữ liệu' });
  }

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const own = await new sql.Request(tx)
      .input('id', sql.Int, id.value)
      .input('uid', sql.Int, req.user.id)
      .query('SELECT id FROM dbo.payment_methods WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND user_id = @uid;');
    if (own.recordset.length === 0) {
      await tx.rollback();
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy thẻ' });
    }

    await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .query('UPDATE dbo.payment_methods SET is_default = 0, updated_at = SYSUTCDATETIME() WHERE user_id = @uid AND is_default = 1;');
    await new sql.Request(tx)
      .input('id', sql.Int, id.value)
      .input('uid', sql.Int, req.user.id)
      .query('UPDATE dbo.payment_methods SET is_default = 1, updated_at = SYSUTCDATETIME() WHERE id = @id AND user_id = @uid;');

    await tx.commit();
    res.json({ payment_methods: await listCards(pool, req.user.id) });
  } catch (err) {
    try { await tx.rollback(); } catch (e) { /* đã rollback hoặc chưa begin */ }
    console.error('[payments] set-default error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không đặt được mặc định' });
  }
});

// ---- DELETE /api/account/payment-methods/:id ----
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id.ok) return res.status(400).json({ status: 'error', message: 'id không hợp lệ' });

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('[payments] pool error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi kết nối cơ sở dữ liệu' });
  }

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const row = await new sql.Request(tx)
      .input('id', sql.Int, id.value)
      .input('uid', sql.Int, req.user.id)
      .query('SELECT id, is_default FROM dbo.payment_methods WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND user_id = @uid;');
    if (row.recordset.length === 0) {
      await tx.rollback();
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy thẻ' });
    }
    const wasDefault = !!row.recordset[0].is_default;

    await new sql.Request(tx)
      .input('id', sql.Int, id.value)
      .input('uid', sql.Int, req.user.id)
      .query('DELETE FROM dbo.payment_methods WHERE id = @id AND user_id = @uid;');

    // Xoá thẻ mặc định mà user còn thẻ khác -> đôn thẻ mới nhất lên mặc định.
    if (wasDefault) {
      await new sql.Request(tx)
        .input('uid', sql.Int, req.user.id)
        .query(`
          UPDATE dbo.payment_methods
             SET is_default = 1, updated_at = SYSUTCDATETIME()
           WHERE id = (
             SELECT TOP 1 id FROM dbo.payment_methods
             WHERE user_id = @uid
             ORDER BY updated_at DESC, id DESC
           );`);
    }

    await tx.commit();
    res.json({ payment_methods: await listCards(pool, req.user.id) });
  } catch (err) {
    try { await tx.rollback(); } catch (e) { /* đã rollback hoặc chưa begin */ }
    console.error('[payments] delete error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không xóa được thẻ' });
  }
});

module.exports = router;
// Xuất kèm parseCard để test đơn vị (không ảnh hưởng Express — router bỏ qua property thừa).
module.exports.parseCard = parseCard;
