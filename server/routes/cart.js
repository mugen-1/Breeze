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
const { sellableVariant, SIZE_CONFIGURED_SQL, COLOR_CONFIGURED_SQL } = require('../lib/size-variants');

const EFFECTIVE_PRICE =
  '(CASE WHEN p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END)';

// Trần số lượng một dòng giỏ. Không có trần thì quantity=2147483647 lọt vào DB:
// line_total = giá × quantity thành con số vô nghĩa (giá từ ~4,2 triệu trở lên là vượt
// Number.MAX_SAFE_INTEGER, mất độ chính xác), còn mode 'add' cộng tiếp thì tràn INT.
const MAX_QTY = 99;

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
      SELECT ci.product_id, ci.variant_id, ci.quantity,
             p.name_vi, p.name_en, p.images, v.stock, v.size, v.color, v.is_base,
             pc.label AS color_label, pc.is_active AS color_active,
             (SELECT TOP (1) image_path FROM dbo.product_color_images
              WHERE color_id=pc.id ORDER BY is_primary DESC, sort_order, id) AS color_image,
             p.slug, p.is_active, v.is_active AS variant_active,
             (SELECT slug FROM dbo.categories WHERE id = p.category_id) AS category_slug,
             ${SIZE_CONFIGURED_SQL} AS size_configured,
             ${COLOR_CONFIGURED_SQL} AS color_configured,
             p.price, p.sale_price,
             ${EFFECTIVE_PRICE} AS unit_price
      FROM dbo.cart_items ci
      JOIN dbo.products p ON p.id = ci.product_id
      JOIN dbo.product_variants v ON v.id = ci.variant_id AND v.product_id = ci.product_id
      LEFT JOIN dbo.product_colors pc ON pc.product_id=v.product_id AND pc.color_key=v.color
      WHERE ci.user_id = @uid
      ORDER BY ci.updated_at DESC, ci.id DESC;`);

  const items = result.recordset.map((r) => ({
    product_id: r.product_id,
    variant_id: r.variant_id,
    size: r.size,
    color: r.color_label,
    color_key: r.color,
    available: sellableVariant(r, { ...r, is_active: r.variant_active }) && r.stock > 0,
    name_vi: r.name_vi,
    name_en: r.name_en,
    image: r.color_image || firstImage(r.images),
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
  // User bị blacklist (từng huỷ đơn, admin chưa gỡ): chặn thêm/sửa giỏ ở BACKEND —
  // không được chỉ ẩn nút frontend (bỏ qua bằng DevTools nếu chỉ chặn UI).
  if (req.user.is_blacklisted) {
    return res.status(403).json({
      status: 'error', error: 'BLACKLISTED', message: 'Không Thể Thực Hiện Hành Động',
    });
  }

  const pid = parseProductId(req.body && req.body.product_id);
  if (!pid.ok) {
    return res.status(400).json({ status: 'error', message: 'product_id phải là số nguyên không âm' });
  }

  const qtyRaw = req.body && req.body.quantity;
  const qty = Number(qtyRaw);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    return res.status(400).json({ status: 'error', message: 'quantity phải là số nguyên từ 1 đến ' + MAX_QTY });
  }

  const mode = (req.body && req.body.mode) === 'add' ? 'add' : 'set';

  let tx;
  try {
    const pool = await getPool();

    // BASE compatibility applies only until real size variants exist.
    const requestedVariant = req.body && req.body.variant_id;
    const variantId = requestedVariant == null ? null : Number(requestedVariant);
    if (variantId !== null && (!Number.isInteger(variantId) || variantId <= 0)) {
      return res.status(400).json({ status: 'error', message: 'variant_id phải là số nguyên dương' });
    }
    tx = new sql.Transaction(pool);
    await tx.begin();
    const cartRows = (await new sql.Request(tx).input('uid', sql.Int, req.user.id)
      .query(`SELECT variant_id, quantity FROM dbo.cart_items WITH (UPDLOCK, HOLDLOCK, INDEX(IX_cart_items_user))
        WHERE user_id = @uid;`)).recordset;
    const prod = await new sql.Request(tx)
      .input('pid', sql.Int, pid.value)
      .input('vid', sql.Int, variantId)
      .query(`SELECT p.id, p.is_active, p.slug, v.id AS variant_id, v.is_active AS variant_active,
                v.is_base, v.size, v.color, v.stock, pc.is_active AS color_active,
                (SELECT slug FROM dbo.categories WHERE id = p.category_id) AS category_slug,
                ${SIZE_CONFIGURED_SQL} AS size_configured,
                ${COLOR_CONFIGURED_SQL} AS color_configured
              FROM dbo.products p WITH (UPDLOCK, HOLDLOCK)
              JOIN dbo.product_variants v WITH (UPDLOCK, HOLDLOCK) ON v.product_id = p.id
              LEFT JOIN dbo.product_colors pc ON pc.product_id=v.product_id AND pc.color_key=v.color
              WHERE p.id = @pid AND v.id = COALESCE(@vid,
                (SELECT id FROM dbo.product_variants WHERE product_id = @pid AND is_base = 1));`);
    const row = prod.recordset[0];
    if (!row || !sellableVariant(row, { ...row, is_active: row.variant_active })) {
      await tx.rollback();
      return res.status(404).json({ status: 'error', message: 'Sản phẩm không tồn tại hoặc ngừng bán' });
    }
    const old = cartRows.find(it => it.variant_id === row.variant_id);
    const nextQty = mode === 'add' ? Math.min(MAX_QTY, (old ? old.quantity : 0) + qty) : qty;
    if (nextQty > row.stock) {
      await tx.rollback();
      return res.status(409).json({ status: 'error', error: 'INSUFFICIENT_STOCK', message: 'Size không đủ tồn kho' });
    }

    // The cart range and variant are locked; nextQty was checked against SQL stock.
    await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .input('pid', sql.Int, pid.value)
      .input('vid', sql.Int, prod.recordset[0].variant_id)
      .input('qty', sql.Int, nextQty)
      .query(`
        MERGE dbo.cart_items AS target
        USING (SELECT @uid AS user_id, @pid AS product_id, @vid AS variant_id) AS src
          ON target.user_id = src.user_id AND target.variant_id = src.variant_id
        WHEN MATCHED THEN
          UPDATE SET quantity = @qty,
                     updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (user_id, product_id, variant_id, quantity)
          VALUES (@uid, @pid, @vid, @qty);`);

    await tx.commit();
    const cart = await readCart(pool, req.user.id);
    res.json(cart);
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* already ended */ } }
    console.error('[cart] upsert error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được giỏ hàng' });
  }
});

// ---- DELETE /api/cart/:productId ----
router.delete('/variant/:variantId', async (req, res) => {
  const variantId = Number(req.params.variantId);
  if (!Number.isInteger(variantId) || variantId <= 0) {
    return res.status(400).json({ status: 'error', message: 'variantId phải là số nguyên dương' });
  }
  try {
    const pool = await getPool();
    await pool.request().input('uid', sql.Int, req.user.id).input('vid', sql.Int, variantId)
      .query('DELETE FROM dbo.cart_items WHERE user_id = @uid AND variant_id = @vid;');
    res.json(await readCart(pool, req.user.id));
  } catch (err) {
    console.error('[cart] delete variant error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không xoá được sản phẩm khỏi giỏ' });
  }
});

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
