// Cart API (yêu cầu Firebase ID token — mọi route bọc verifyFirebaseToken).
//   GET    /api/cart               — giỏ hàng user hiện tại (join products lấy tên/giá/ảnh MỚI NHẤT).
//   POST   /api/cart               — thêm/cập nhật 1 item { product_id, quantity, mode }.
//                                    mode='set' (mặc định) => ghi đè qty; mode='add' => cộng dồn.
//   DELETE /api/cart/:productId    — xoá 1 item khỏi giỏ.
//
// Giá hiển thị = sale_price nếu có, ngược lại price (giống products.js). Giá KHÔNG lưu ở
// cart_items — luôn đọc mới từ products để đổi giá tức thời; snapshot giá chỉ xảy ra khi đặt đơn.
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');

const EFFECTIVE_PRICE =
  '(CASE WHEN p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END)';

// Bọc toàn bộ router bằng xác thực: không có token hợp lệ => 401.
router.use(verifyFirebaseToken);

// Parse cột images (JSON string) -> ảnh đầu tiên (hoặc null).
function firstImage(imagesJson) {
  if (!imagesJson) return null;
  try {
    const arr = JSON.parse(imagesJson);
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  } catch (e) {
    return null;
  }
}

// Đọc giỏ hàng của 1 user -> { items, total }. items có đủ thông tin để render client.
async function readCart(pool, userId) {
  const result = await pool
    .request()
    .input('uid', sql.Int, userId)
    .query(`
      SELECT ci.product_id, ci.quantity,
             p.name_vi, p.name_en, p.images, p.stock,
             p.price, p.sale_price,
             ${EFFECTIVE_PRICE} AS unit_price
      FROM dbo.cart_items ci
      JOIN dbo.products p ON p.id = ci.product_id
      WHERE ci.user_id = @uid
      ORDER BY ci.updated_at DESC, ci.id DESC;`);

  const items = result.recordset.map((r) => ({
    product_id: r.product_id,
    name_vi: r.name_vi,
    name_en: r.name_en,
    image: firstImage(r.images),
    price: r.price,
    sale_price: r.sale_price,
    unit_price: r.unit_price,
    stock: r.stock,
    quantity: r.quantity,
    line_total: r.unit_price * r.quantity,
  }));

  const total = items.reduce((s, it) => s + it.line_total, 0);
  return { items, total };
}

// Validate product_id. LƯU Ý: seed Phase 1 đánh id sản phẩm từ 0, nên id=0 hợp lệ.
// Chỉ loại số âm / không phải số nguyên. Trả { ok, value }.
function parseProductId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

// ---- GET /api/cart ----
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const cart = await readCart(pool, req.user.id);
    res.json(cart);
  } catch (err) {
    console.error('[cart] list error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được giỏ hàng' });
  }
});

// ---- POST /api/cart ----  body: { product_id, quantity, mode? }
router.post('/', async (req, res) => {
  const pid = parseProductId(req.body && req.body.product_id);
  if (!pid.ok) {
    return res.status(400).json({ status: 'error', message: 'product_id phải là số nguyên không âm' });
  }

  const qtyRaw = req.body && req.body.quantity;
  const qty = Number(qtyRaw);
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ status: 'error', message: 'quantity phải là số nguyên dương' });
  }

  const mode = (req.body && req.body.mode) === 'add' ? 'add' : 'set';

  try {
    const pool = await getPool();

    // Sản phẩm phải tồn tại + đang bán.
    const prod = await pool
      .request()
      .input('pid', sql.Int, pid.value)
      .query('SELECT id, is_active FROM dbo.products WHERE id = @pid;');
    if (prod.recordset.length === 0 || !prod.recordset[0].is_active) {
      return res.status(404).json({ status: 'error', message: 'Sản phẩm không tồn tại hoặc ngừng bán' });
    }

    // Upsert: MERGE theo (user_id, product_id). set = ghi đè, add = cộng dồn.
    // Dùng biểu thức CASE để 1 câu MERGE phục vụ cả 2 mode.
    await pool
      .request()
      .input('uid', sql.Int, req.user.id)
      .input('pid', sql.Int, pid.value)
      .input('qty', sql.Int, qty)
      .input('mode', sql.VarChar(8), mode)
      .query(`
        MERGE dbo.cart_items AS target
        USING (SELECT @uid AS user_id, @pid AS product_id) AS src
          ON target.user_id = src.user_id AND target.product_id = src.product_id
        WHEN MATCHED THEN
          UPDATE SET quantity = CASE WHEN @mode = 'add' THEN target.quantity + @qty ELSE @qty END,
                     updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (user_id, product_id, quantity)
          VALUES (@uid, @pid, @qty);`);

    const cart = await readCart(pool, req.user.id);
    res.json(cart);
  } catch (err) {
    console.error('[cart] upsert error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được giỏ hàng' });
  }
});

// ---- DELETE /api/cart/:productId ----
router.delete('/:productId', async (req, res) => {
  const pid = parseProductId(req.params.productId);
  if (!pid.ok) {
    return res.status(400).json({ status: 'error', message: 'productId phải là số nguyên không âm' });
  }

  try {
    const pool = await getPool();
    await pool
      .request()
      .input('uid', sql.Int, req.user.id)
      .input('pid', sql.Int, pid.value)
      .query('DELETE FROM dbo.cart_items WHERE user_id = @uid AND product_id = @pid;');

    const cart = await readCart(pool, req.user.id);
    res.json(cart);
  } catch (err) {
    console.error('[cart] delete error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không xoá được sản phẩm khỏi giỏ' });
  }
});

module.exports = router;
