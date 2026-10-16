// Admin API (Phase 5) — MỌI route bọc verifyFirebaseToken + requireAdmin.
//   POST   /api/admin/products            — tạo sản phẩm.
//   PUT    /api/admin/products/:id         — sửa sản phẩm (cập nhật từng phần).
//   DELETE /api/admin/products/:id         — ẩn sản phẩm (soft delete), giữ FK/lịch sử.
//   GET    /api/admin/orders               — mọi đơn của mọi user, phân trang ?page=&limit=.
//   PUT    /api/admin/orders/:id/status    — đổi trạng thái đơn (whitelist).
//   DELETE /api/admin/orders/:id           — xoá hẳn 1 đơn (order_items cascade theo).
//
// Nguyên tắc: TIN server, KHÔNG tin client. Mọi input validate + parameterized.
const express = require('express');
const { nextShippingStatuses, shippingForOrderStatus } = require('../lib/shipping-state');
const router = express.Router();
const { getPool, sql } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { ALL_STATUSES, nextStatuses, canTransition, isTargetStatus } = require('../lib/order-state');
const { cancelOrder, CancelError } = require('../lib/cancel-order');
const businessReport = require('../lib/business-report');
const { fetchPayments, completeCodPayment } = require('../lib/order-payment');
const { recordInventoryMovement } = require('../lib/inventory-movement');
const { readSizes, changeSizes, SizeError, SIZE_CONFIGURED_SQL, COLOR_CONFIGURED_SQL, sizeProfile } = require('../lib/size-variants');
const { readColors, changeColors, ColorError } = require('../lib/color-variants');

// Bọc toàn bộ router: chưa đăng nhập -> 401; đăng nhập nhưng không phải admin -> 403.
router.use(verifyFirebaseToken, requireAdmin);

// Bộ lọc gồm cả trạng thái legacy; mục tiêu chuyển trạng thái do order-state.js quản lý.
const ORDER_STATUSES = ALL_STATUSES;

// ---- Validators nhỏ, trả { ok, value } hoặc { ok:false, error } --------------
const okv = (value) => ({ ok: true, value });
const errv = (error) => ({ ok: false, error });

function reqText(raw, max, label) {
  if (typeof raw !== 'string') return errv(`${label} phải là chuỗi`);
  const s = raw.trim();
  if (!s) return errv(`${label} không được rỗng`);
  if (s.length > max) return errv(`${label} tối đa ${max} ký tự`);
  return okv(s);
}
function optText(raw, max, label) {
  if (raw === undefined || raw === null || raw === '') return okv(null);
  if (typeof raw !== 'string') return errv(`${label} phải là chuỗi`);
  const s = raw.trim();
  if (s.length > max) return errv(`${label} tối đa ${max} ký tự`);
  return okv(s || null);
}
function reqInt(raw, min, label) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) return errv(`${label} phải là số nguyên >= ${min}`);
  return okv(n);
}
function optInt(raw, min, label) {
  if (raw === undefined || raw === null || raw === '') return okv(null);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) return errv(`${label} phải là số nguyên >= ${min}`);
  return okv(n);
}
function vSlug(raw) {
  const r = reqText(raw, 160, 'slug');
  if (!r.ok) return r;
  if (!/^[A-Za-z0-9._-]+$/.test(r.value)) return errv('slug chỉ gồm chữ/số và . _ - (không khoảng trắng)');
  return r;
}
function vImages(raw) {
  if (raw === undefined || raw === null) return okv(null);
  if (!Array.isArray(raw)) return errv('images phải là mảng đường dẫn ảnh');
  for (const it of raw) {
    if (typeof it !== 'string' || !it.trim()) return errv('mỗi ảnh trong images phải là chuỗi không rỗng');
    if (it.length > 500) return errv('đường dẫn ảnh tối đa 500 ký tự');
  }
  return okv(JSON.stringify(raw.map((s) => s.trim())));
}
function vBool(raw) {
  if (raw === undefined || raw === null) return okv(null);
  if (typeof raw === 'boolean') return okv(raw ? 1 : 0);
  if (raw === 1 || raw === '1' || raw === 'true') return okv(1);
  if (raw === 0 || raw === '0' || raw === 'false') return okv(0);
  return errv('is_active phải là true/false');
}
function vCurrency(raw) {
  if (raw === undefined || raw === null || raw === '') return okv(null);
  if (typeof raw !== 'string') return errv('currency phải là chuỗi');
  const s = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) return errv('currency phải gồm 3 chữ cái (vd VND)');
  return okv(s);
}

// Kiểu SQL cho từng cột sản phẩm (dùng chung cho INSERT lẫn UPDATE động).
const PRODUCT_SQL_TYPE = {
  slug: sql.VarChar(160),
  name_vi: sql.NVarChar(200),
  name_en: sql.NVarChar(200),
  description_vi: sql.NVarChar(sql.MAX),
  description_en: sql.NVarChar(sql.MAX),
  price: sql.Int,
  sale_price: sql.Int,
  currency: sql.Char(3),
  images: sql.NVarChar(sql.MAX),
  category_id: sql.Int,
  stock: sql.Int,
  is_active: sql.Bit,
};

// Chuẩn hoá 1 row products -> object đầy đủ cho admin (kèm slug, is_active, stock...).
function mapProduct(row) {
  let images = [];
  if (row.images) {
    try {
      const parsed = JSON.parse(row.images);
      if (Array.isArray(parsed)) images = parsed;
    } catch (e) { images = []; }
  }
  return {
    id: row.id,
    slug: row.slug,
    category_id: row.category_id,
    category_slug: row.category_slug,
    name_vi: row.name_vi,
    name_en: row.name_en,
    description_vi: row.description_vi,
    description_en: row.description_en,
    price: row.price,
    sale_price: row.sale_price,
    currency: row.currency,
    images,
    stock: row.stock,
    size_configured: !!row.size_configured,
    color_configured: !!row.color_configured,
    size_kind: sizeProfile(row).kind,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const PRODUCT_SELECT = `
  SELECT p.id, p.slug, p.category_id, c.slug AS category_slug,
         p.name_vi, p.name_en, p.description_vi, p.description_en,
         p.price, p.sale_price, p.currency, p.images, p.stock, p.is_active,
         p.created_at, p.updated_at, ${SIZE_CONFIGURED_SQL} AS size_configured,
         ${COLOR_CONFIGURED_SQL} AS color_configured
  FROM dbo.products p
  JOIN dbo.categories c ON c.id = p.category_id`;

async function loadProduct(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`${PRODUCT_SELECT} WHERE p.id = @id;`);
  return r.recordset[0] || null;
}

async function categoryExists(pool, categoryId) {
  const r = await pool.request().input('cid', sql.Int, categoryId)
    .query('SELECT 1 FROM dbo.categories WHERE id = @cid;');
  return r.recordset.length > 0;
}

// Lỗi vi phạm UNIQUE (slug trùng) trong SQL Server: 2627 (constraint) / 2601 (index).
function isUniqueViolation(err) {
  return err && (err.number === 2627 || err.number === 2601);
}

// ---- GET /api/admin/products -------------------------------------------------
// Danh sách ĐẦY ĐỦ cho bảng quản trị: gồm cả sản phẩm is_active=0 (đã ẩn) và mọi
// cột cần để sửa (slug, category_id, stock...). Khác GET /api/products công khai
// (chỉ trả is_active=1, thiếu slug/category_id). Trả hết — data nhỏ (~vài chục SP).
router.get('/products', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`${PRODUCT_SELECT} ORDER BY p.created_at DESC, p.id DESC;`);
    res.json({ products: r.recordset.map(mapProduct) });
  } catch (err) {
    console.error('[admin] list products error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được danh sách sản phẩm' });
  }
});

// ---- GET /api/admin/products/:id/inventory-movements -----------------------
router.get('/products/:id/inventory-movements', async (req, res) => {
  const idc = reqInt(req.params.id, 1, 'id');
  if (!idc.ok) return res.status(400).json({ status: 'error', message: idc.error });
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      (page - 1) * limit > 2147483647) {
    return res.status(400).json({ status: 'error', message: 'page/limit không hợp lệ' });
  }
  try {
    const pool = await getPool();
    const product = await loadProduct(pool, idc.value);
    if (!product) return res.status(404).json({ status: 'error', message: 'Không tìm thấy sản phẩm' });
    const count = await pool.request().input('pid', sql.Int, idc.value)
      .query('SELECT COUNT(*) AS total FROM dbo.inventory_movements WHERE product_id = @pid;');
    const history = await pool.request()
      .input('pid', sql.Int, idc.value)
      .input('offset', sql.Int, (page - 1) * limit)
      .input('limit', sql.Int, limit)
      .query(`SELECT id, variant_id, (SELECT size FROM dbo.product_variants WHERE id = m.variant_id) AS size,
                     (SELECT c.label FROM dbo.product_variants v JOIN dbo.product_colors c
                      ON c.product_id=v.product_id AND c.color_key=v.color WHERE v.id=m.variant_id) AS color,
                     created_at, movement_type, quantity_delta, stock_before, stock_after,
                     order_id, order_reference_id, (SELECT order_code FROM dbo.orders WHERE id = m.order_id) AS order_code, reason, actor_user_id
              FROM dbo.inventory_movements m
              WHERE product_id = @pid
              ORDER BY created_at DESC, id DESC
              OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;`);
    res.json({ product: { id: product.id, name_vi: product.name_vi, name_en: product.name_en,
      stock: product.stock, is_active: !!product.is_active },
    page, limit, total: count.recordset[0].total,
    total_pages: Math.ceil(count.recordset[0].total / limit), movements: history.recordset });
  } catch (err) {
    console.error('[admin] inventory history error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được lịch sử kho' });
  }
});

// Size management reuses the product-level admin authorization above.
router.get('/products/:id/sizes', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 0) return res.status(400).json({ message: 'id không hợp lệ' });
  try { res.json(await readSizes(await getPool(), id)); }
  catch (err) { sizeResponseError(res, err); }
});
for (const [method, suffix, action] of [
  ['post', 'sizes', 'configure'], ['post', 'size-allocation', 'allocate'], ['put', 'sizes/:variantId', 'adjust'],
]) {
  router[method]('/products/:id/' + suffix, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 0) return res.status(400).json({ message: 'id không hợp lệ' });
    try {
      const payload = { ...(req.body || {}) };
      if (action === 'adjust') payload.variant_id = Number(req.params.variantId);
      res.json(await changeSizes(await getPool(), id, req.user.id, action, payload));
    } catch (err) { sizeResponseError(res, err); }
  });
}
function sizeResponseError(res, err) {
  if (err instanceof SizeError) return res.status(err.status).json({ status: 'error', error: err.code, message: err.message });
  if (isUniqueViolation(err)) return res.status(409).json({ status: 'error', message: 'Size hoặc SKU đã tồn tại' });
  console.error('[admin] size error:', err.message);
  res.status(500).json({ status: 'error', message: 'Không cập nhật được size' });
}

// Color, Size × Color stock and gallery share the product authorization above.
router.get('/products/:id/colors', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 0) return res.status(400).json({ message: 'id không hợp lệ' });
  try { res.json(await readColors(await getPool(), id)); }
  catch (err) { colorResponseError(res, err); }
});
for (const [method, route, action] of [
  ['post', 'colors', 'create'], ['put', 'colors/:colorId', 'update'],
  ['post', 'color-sizes', 'add-size'], ['post', 'color-allocation', 'allocate'],
  ['put', 'color-variants/:variantId', 'adjust'],
  ['post', 'colors/:colorId/images', 'add-image'],
  ['put', 'colors/:colorId/images/:imageId', 'update-image'],
  ['delete', 'colors/:colorId/images/:imageId', 'delete-image'],
]) {
  router[method]('/products/:id/' + route, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 0) return res.status(400).json({ message: 'id không hợp lệ' });
    const payload = { ...(req.body || {}) };
    if (req.params.colorId !== undefined) payload.color_id = Number(req.params.colorId);
    if (req.params.variantId !== undefined) payload.variant_id = Number(req.params.variantId);
    if (req.params.imageId !== undefined) payload.image_id = Number(req.params.imageId);
    try { res.json(await changeColors(await getPool(), id, req.user.id, action, payload)); }
    catch (err) { colorResponseError(res, err); }
  });
}
function colorResponseError(res, err) {
  if (err instanceof ColorError) return res.status(err.status).json({ status: 'error', error: err.code, message: err.message });
  if (isUniqueViolation(err)) return res.status(409).json({ status: 'error', error: 'DUPLICATE_COLOR', message: 'Màu, ảnh hoặc SKU đã tồn tại' });
  console.error('[admin] color error:', err.message);
  res.status(500).json({ status: 'error', message: 'Không cập nhật được màu' });
}

// ---- POST /api/admin/products ------------------------------------------------
router.post('/products', async (req, res) => {
  const b = req.body || {};

  // Bắt buộc: slug, name_vi, price, category_id. Còn lại tuỳ chọn (có default).
  const checks = {
    slug: vSlug(b.slug),
    name_vi: reqText(b.name_vi, 200, 'name_vi'),
    price: reqInt(b.price, 0, 'price'),
    category_id: reqInt(b.category_id, 0, 'category_id'), // seed đánh category từ 0 (giống products)
    name_en: optText(b.name_en, 200, 'name_en'),
    description_vi: optText(b.description_vi, 20000, 'description_vi'),
    description_en: optText(b.description_en, 20000, 'description_en'),
    sale_price: optInt(b.sale_price, 0, 'sale_price'),
    currency: vCurrency(b.currency),
    images: vImages(b.images),
    stock: optInt(b.stock, 0, 'stock'),
    is_active: vBool(b.is_active),
  };
  const errors = Object.values(checks).filter((c) => !c.ok).map((c) => c.error);
  if (errors.length) return res.status(400).json({ status: 'error', message: errors[0], errors });

  const v = Object.fromEntries(Object.entries(checks).map(([k, c]) => [k, c.value]));
  if (v.sale_price !== null && v.sale_price > v.price) {
    return res.status(400).json({ status: 'error', message: 'sale_price không được lớn hơn price' });
  }
  if (v.stock !== null && v.stock > 2147483647) {
    return res.status(400).json({ status: 'error', message: 'stock phải từ 0 đến 2147483647' });
  }

  let tx;
  try {
    const pool = await getPool();
    if (!(await categoryExists(pool, v.category_id))) {
      return res.status(400).json({ status: 'error', message: 'category_id không tồn tại' });
    }

    // Áp default cho cột không truyền: currency=VND, stock=0, is_active=1.
    const currency = v.currency || 'VND';
    const stock = v.stock === null ? 0 : v.stock;
    const isActive = v.is_active === null ? 1 : v.is_active;

    tx = new sql.Transaction(pool);
    await tx.begin();
    const ins = await new sql.Request(tx)
      .input('slug', PRODUCT_SQL_TYPE.slug, v.slug)
      .input('name_vi', PRODUCT_SQL_TYPE.name_vi, v.name_vi)
      .input('name_en', PRODUCT_SQL_TYPE.name_en, v.name_en)
      .input('description_vi', PRODUCT_SQL_TYPE.description_vi, v.description_vi)
      .input('description_en', PRODUCT_SQL_TYPE.description_en, v.description_en)
      .input('price', PRODUCT_SQL_TYPE.price, v.price)
      .input('sale_price', PRODUCT_SQL_TYPE.sale_price, v.sale_price)
      .input('currency', PRODUCT_SQL_TYPE.currency, currency)
      .input('images', PRODUCT_SQL_TYPE.images, v.images)
      .input('category_id', PRODUCT_SQL_TYPE.category_id, v.category_id)
      .input('stock', PRODUCT_SQL_TYPE.stock, stock)
      .input('is_active', PRODUCT_SQL_TYPE.is_active, isActive)
      .query(`
        INSERT INTO dbo.products
          (slug, name_vi, name_en, description_vi, description_en, price, sale_price,
           currency, images, category_id, stock, is_active)
        OUTPUT INSERTED.id
        VALUES
          (@slug, @name_vi, @name_en, @description_vi, @description_en, @price, @sale_price,
           @currency, @images, @category_id, @stock, @is_active);`);

    const newId = ins.recordset[0].id;
    const baseVariant = await new sql.Request(tx)
      .input('pid', sql.Int, newId)
      .input('sku', sql.VarChar(80), `BR-P${newId}-BASE`)
      .input('stock', sql.Int, stock)
      .input('active', sql.Bit, isActive)
      .query(`INSERT INTO dbo.product_variants (product_id, sku, stock, is_active, is_base)
              OUTPUT INSERTED.id VALUES (@pid, @sku, @stock, @active, 1);`);
    await recordInventoryMovement(tx, { productId: newId, variantId: baseVariant.recordset[0].id,
      type: 'PRODUCT_CREATE',
      delta: stock, before: 0, after: stock, actorUserId: req.user.id });
    await tx.commit();
    const row = await loadProduct(pool, newId);
    res.status(201).json({ status: 'ok', product: mapProduct(row) });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* already rolled back */ } }
    if (isUniqueViolation(err)) {
      return res.status(409).json({ status: 'error', message: 'slug đã tồn tại' });
    }
    console.error('[admin] create product error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tạo được sản phẩm' });
  }
});

// ---- PUT /api/admin/products/:id ---------------------------------------------
// Cập nhật TỪNG PHẦN: chỉ đụng tới cột có trong body. Cần ít nhất 1 cột hợp lệ.
const UPDATE_VALIDATORS = {
  slug: (v) => vSlug(v),
  name_vi: (v) => reqText(v, 200, 'name_vi'),
  name_en: (v) => optText(v, 200, 'name_en'),
  description_vi: (v) => optText(v, 20000, 'description_vi'),
  description_en: (v) => optText(v, 20000, 'description_en'),
  price: (v) => reqInt(v, 0, 'price'),
  sale_price: (v) => optInt(v, 0, 'sale_price'),
  currency: (v) => vCurrency(v),
  images: (v) => vImages(v),
  category_id: (v) => reqInt(v, 0, 'category_id'), // seed đánh category từ 0 (giống products)
  stock: (v) => optInt(v, 0, 'stock'),
  is_active: (v) => vBool(v),
};

router.put('/products/:id', async (req, res) => {
  const idc = reqInt(req.params.id, 0, 'id');
  if (!idc.ok) return res.status(400).json({ status: 'error', message: idc.error });
  const b = req.body || {};

  // Chỉ nhận key có mặt trong body VÀ nằm trong whitelist cột.
  const updates = {};
  const errors = [];
  for (const key of Object.keys(UPDATE_VALIDATORS)) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
    const c = UPDATE_VALIDATORS[key](b[key]);
    if (!c.ok) errors.push(c.error);
    else updates[key] = c.value;
  }
  if (errors.length) return res.status(400).json({ status: 'error', message: errors[0], errors });
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ status: 'error', message: 'Không có trường hợp lệ nào để cập nhật' });
  }

  if (updates.stock === null || (updates.stock !== undefined && updates.stock > 2147483647)) {
    return res.status(400).json({ status: 'error', message: 'stock phải là số nguyên từ 0 đến 2147483647' });
  }

  let tx;
  try {
    const pool = await getPool();
    const existing = await loadProduct(pool, idc.value);
    if (!existing) return res.status(404).json({ status: 'error', message: 'Không tìm thấy sản phẩm' });

    if (updates.category_id !== undefined && !(await categoryExists(pool, updates.category_id))) {
      return res.status(400).json({ status: 'error', message: 'category_id không tồn tại' });
    }

    tx = new sql.Transaction(pool);
    await tx.begin();
    const locked = await new sql.Request(tx).input('id', sql.Int, idc.value)
      .query(`SELECT stock, price, sale_price, ${SIZE_CONFIGURED_SQL} AS size_configured,
        ${COLOR_CONFIGURED_SQL} AS color_configured
        FROM dbo.products p WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;`);
    if (!locked.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy sản phẩm' });
    }
    const current = locked.recordset[0];
    if ((current.size_configured || current.color_configured) && (updates.stock !== undefined ||
        (updates.category_id !== undefined && updates.category_id !== existing.category_id) ||
        (updates.slug !== undefined && updates.slug !== existing.slug))) {
      await tx.rollback();
      return res.status(409).json({ status: 'error', error: 'SIZE_MANAGEMENT_REQUIRED',
        message: 'Sản phẩm đã cấu hình biến thể: quản lý tồn theo size/màu; giữ danh mục và slug hiện tại.' });
    }
    const baseVariant = await new sql.Request(tx).input('pid', sql.Int, idc.value)
      .query('SELECT id, stock FROM dbo.product_variants WITH (UPDLOCK, HOLDLOCK) WHERE product_id = @pid AND is_base = 1;');
    if (baseVariant.recordset.length !== 1) throw new Error('Missing base variant during admin update');
    const base = baseVariant.recordset[0];
    // Use the SQL value after lock, never a stock value cached by the browser.
    const stockChanged = updates.stock !== undefined && updates.stock !== base.stock;
    const reason = stockChanged ? reqText(b.stock_reason, 250, 'Lý do điều chỉnh kho') : null;
    if (reason && !reason.ok) {
      await tx.rollback();
      return res.status(400).json({ status: 'error', message: reason.error });
    }

    // sale_price <= price: so trên GIÁ TRỊ CUỐI (giá trị mới nếu có, ngược lại giá cũ).
    const finalPrice = updates.price !== undefined ? updates.price : current.price;
    const finalSale = updates.sale_price !== undefined ? updates.sale_price : current.sale_price;
    if (finalSale !== null && finalSale > finalPrice) {
      await tx.rollback();
      return res.status(400).json({ status: 'error', message: 'sale_price không được lớn hơn price' });
    }

    // Dựng câu UPDATE động: mỗi cột 1 param có kiểu đúng.
    const request = new sql.Request(tx).input('id', sql.Int, idc.value);
    const setParts = [];
    for (const [col, value] of Object.entries(updates)) {
      if (col === 'stock') continue;
      request.input(col, PRODUCT_SQL_TYPE[col], value);
      setParts.push(`${col} = @${col}`);
    }
    const delta = stockChanged ? updates.stock - base.stock : 0;
    if (stockChanged) {
      request.input('delta', sql.Int, delta);
      setParts.push('stock = stock + @delta');
    }
    setParts.push('updated_at = SYSUTCDATETIME()');

    const updated = await request.query(`UPDATE dbo.products SET ${setParts.join(', ')}
      OUTPUT INSERTED.stock AS stock_after WHERE id = @id
        AND CONVERT(BIGINT, stock) + ${stockChanged ? '@delta' : '0'} BETWEEN 0 AND 2147483647;`);
    if (updated.rowsAffected[0] !== 1) throw new Error('Product aggregate would overflow');
    if (stockChanged) {
      const variant = await new sql.Request(tx).input('vid', sql.Int, base.id)
        .input('stock', sql.Int, updates.stock)
        .query(`UPDATE dbo.product_variants SET stock = @stock, updated_at = SYSUTCDATETIME()
                OUTPUT DELETED.stock AS stock_before, INSERTED.stock AS stock_after WHERE id = @vid;`);
      if (variant.rowsAffected[0] !== 1) throw new Error('Base variant disappeared during admin update');
      await recordInventoryMovement(tx, { productId: idc.value, variantId: base.id,
        type: 'ADMIN_ADJUSTMENT', delta,
        before: variant.recordset[0].stock_before, after: variant.recordset[0].stock_after,
        reason: reason.value, actorUserId: req.user.id });
    }
    if (updates.is_active !== undefined) {
      await new sql.Request(tx).input('pid', sql.Int, idc.value)
        .input('active', sql.Bit, updates.is_active)
        .query(`UPDATE dbo.product_variants SET is_active = @active, updated_at = SYSUTCDATETIME()
                WHERE product_id = @pid AND (@active = 0 OR is_base = 1);`);
    }
    await tx.commit();

    const row = await loadProduct(pool, idc.value);
    res.json({ status: 'ok', product: mapProduct(row) });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* already rolled back */ } }
    if (isUniqueViolation(err)) {
      return res.status(409).json({ status: 'error', message: 'slug đã tồn tại' });
    }
    console.error('[admin] update product error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được sản phẩm' });
  }
});

// ---- DELETE /api/admin/products/:id ------------------------------------------
// Luôn soft-delete. Tránh race giữa kiểm tra tham chiếu và checkout tạo order_item.
router.delete('/products/:id', async (req, res) => {
  const idc = reqInt(req.params.id, 0, 'id');
  if (!idc.ok) return res.status(400).json({ status: 'error', message: idc.error });
  const id = idc.value;

  let tx;
  try {
    const pool = await getPool();
    const existing = await loadProduct(pool, id);
    if (!existing) return res.status(404).json({ status: 'error', message: 'Không tìm thấy sản phẩm' });

    tx = new sql.Transaction(pool);
    await tx.begin();
    await new sql.Request(tx).input('id', sql.Int, id)
      .query('UPDATE dbo.products SET is_active = 0, updated_at = SYSUTCDATETIME() WHERE id = @id;');
    await new sql.Request(tx).input('id', sql.Int, id)
      .query('UPDATE dbo.product_variants SET is_active = 0, updated_at = SYSUTCDATETIME() WHERE product_id = @id;');
    await tx.commit();
    res.json({ status: 'ok', mode: 'soft', message: 'Đã ẩn sản phẩm', product_id: id });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* already rolled back */ } }
    console.error('[admin] delete product error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không xoá được sản phẩm' });
  }
});

// Gắn items vào từng order (1 truy vấn cho nhiều order). Trả map orderId -> items[].
async function fetchItemsByOrderIds(pool, orderIds) {
  if (orderIds.length === 0) return {};
  const request = pool.request();
  const params = orderIds.map((id, i) => {
    request.input('o' + i, sql.Int, id);
    return '@o' + i;
  });
  const result = await request.query(`
    SELECT order_id, product_id, variant_id, product_name, size_snapshot, color_snapshot, unit_price, quantity, line_total
    FROM dbo.order_items
    WHERE order_id IN (${params.join(', ')})
    ORDER BY id;`);
  const map = {};
  for (const it of result.recordset) {
    (map[it.order_id] = map[it.order_id] || []).push({
      product_id: it.product_id,
      product_name: it.product_name,
      variant_id: it.variant_id,
      size_snapshot: it.size_snapshot,
      color_snapshot: it.color_snapshot,
      unit_price: it.unit_price,
      quantity: it.quantity,
      line_total: it.line_total,
    });
  }
  return map;
}

// ---- GET /api/admin/orders ---  mọi đơn của mọi user, phân trang -------------
// Lọc server-side (áp TRƯỚC phân trang nên đúng trên TOÀN BỘ đơn, không chỉ 1 trang):
//   ?status=<1 trong ORDER_STATUSES>   — lọc theo trạng thái (whitelist).
//   ?q=<chuỗi>                         — tìm theo mã đơn / email / tên khách (LIKE, có ESCAPE).
router.get('/orders', async (req, res) => {
  let page = Number(req.query.page);
  let limit = Number(req.query.limit);
  page = Number.isInteger(page) && page > 0 ? page : 1;
  limit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
  const offset = (page - 1) * limit;

  // Validate status theo whitelist (giống chỗ đổi trạng thái).
  const { status, q } = req.query;
  const internalId = req.query.order_id === undefined ? null : Number(req.query.order_id);
  if (internalId !== null && (!Number.isInteger(internalId) || internalId < 1 || internalId > 2147483647)) {
    return res.status(400).json({ status: 'error', message: 'order_id không hợp lệ' });
  }
  let statusVal = null;
  if (status !== undefined && status !== '') {
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'status không hợp lệ. Hợp lệ: ' + ORDER_STATUSES.join(', '),
      });
    }
    statusVal = status;
  }
  // Chuẩn hoá search:
  //  - q toàn CHỮ SỐ  -> coi là MÃ ĐƠN, khớp mã hiển thị (order_code, fallback id) (không tìm theo chuỗi con).
  //  - còn lại        -> tìm theo email / tên khách bằng LIKE (escape ký tự đặc biệt).
  let qId = null;
  let likeVal = null;
  if (q !== undefined && String(q).trim() !== '') {
    const raw = String(q).trim().slice(0, 100);
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      // id là INT: quá tầm -> gán -1 để chắc chắn không khớp (thay vì trả nhầm toàn bộ).
      qId = (Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) ? n : -1;
    } else {
      likeVal = '%' + raw.replace(/[\\%_[]/g, (c) => '\\' + c) + '%';
    }
  }

  // Gắn cùng bộ điều kiện WHERE + input cho cả câu COUNT lẫn câu SELECT.
  function applyFilters(request) {
    const clauses = [];
    if (internalId !== null) { request.input('orderId', sql.Int, internalId); clauses.push('o.id = @orderId'); }
    if (statusVal) { request.input('status', sql.VarChar(20), statusVal); clauses.push('o.status = @status'); }
    if (qId !== null) {
      request.input('qid', sql.Int, qId);
      clauses.push('COALESCE(o.order_code, o.id) = @qid');
    } else if (likeVal) {
      request.input('q', sql.NVarChar(120), likeVal);
      clauses.push("(u.email LIKE @q ESCAPE '\\' OR u.display_name LIKE @q ESCAPE '\\')");
    }
    return clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
  }

  try {
    const pool = await getPool();

    const countReq = pool.request();
    const whereCount = applyFilters(countReq);
    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total
      FROM dbo.orders o
      JOIN dbo.users u ON u.id = o.user_id
      ${whereCount};`);
    const total = countRes.recordset[0].total;

    const listReq = pool.request()
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit);
    const whereList = applyFilters(listReq);
    const ordersRes = await listReq.query(`
      SELECT o.id, o.order_code, o.user_id, u.email AS user_email, u.display_name AS user_name,
             o.status, o.total_amount, o.currency,
             o.VoucherCode AS voucher_code, o.DiscountAmount AS discount_amount,
             o.PaymentMethod AS payment_method,
             o.shipping_name, o.shipping_phone, o.shipping_address, o.created_at,
             o.cancel_reason, o.cancelled_at, o.shipping_version, o.shipping_ward, o.shipping_district,
             o.shipping_city, o.delivery_note, o.shipping_method, o.shipping_fee,
             o.shipping_provider, o.shipping_service, o.shipping_eta, o.shipping_tracking_code, o.shipping_status
      FROM dbo.orders o
      JOIN dbo.users u ON u.id = o.user_id
      ${whereList}
      ORDER BY o.created_at DESC, o.id DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;`);

    const orders = ordersRes.recordset;
    const itemsMap = await fetchItemsByOrderIds(pool, orders.map((o) => o.id));
    const payments = await fetchPayments(pool, orders.map(o => o.id));
    res.json({
      page, limit, total,
      total_pages: Math.ceil(total / limit),
      orders: orders.map((o) => ({ ...o, payment_transaction: payments[o.id] || null, allowed_next_statuses: nextStatuses(o.status), allowed_shipping_statuses: nextShippingStatuses(o), items: itemsMap[o.id] || [] })),
    });
  } catch (err) {
    console.error('[admin] list orders error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được danh sách đơn hàng' });
  }
});

// ---- PUT /api/admin/orders/:id/status ----------------------------------------
router.put('/orders/:id/status', async (req, res) => {
  const idc = reqInt(req.params.id, 1, 'id');
  if (!idc.ok) return res.status(400).json({ status: 'error', message: idc.error });

  const status = req.body && req.body.status;
  if (!isTargetStatus(status)) {
    return res.status(400).json({
      status: 'error',
      message: 'status không hợp lệ',
    });
  }

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('[admin] update order status pool error:', err.code || 'database-error');
    return res.status(500).json({ status: 'error', message: 'Không cập nhật được trạng thái đơn' });
  }
  if (status === 'cancelled') {
    try {
      const order = await cancelOrder(pool, { orderId: idc.value, actorUserId: req.user.id });
      return res.json({ status: 'ok', order: { ...order, allowed_next_statuses: nextStatuses(order.status) } });
    } catch (error) {
      if (error instanceof CancelError && error.status < 500) {
        return res.status(error.status).json({ status: 'error', message: error.message });
      }
      console.error('[admin] cancel order error:', error.code || error.message);
      return res.status(500).json({ status: 'error', message: 'Không cập nhật được trạng thái đơn' });
    }
  }
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    // Khoá row đến khi commit/rollback. Request B phải đọc status SAU khi A
    // hoàn tất; điều kiện UPDATE còn chặn trường hợp status đổi giữa hai lệnh.
    const current = await new sql.Request(tx)
      .input('id', sql.Int, idc.value)
      .query('SELECT status, shipping_version, shipping_status FROM dbo.orders WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;');
    if (current.recordset.length === 0) {
      await tx.rollback();
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
    }
    const previous = current.recordset[0].status;
    if (!canTransition(previous, status)) {
      await tx.rollback();
      return res.status(409).json({
        status: 'error', message: `Không thể chuyển trạng thái đơn hàng từ '${previous}' sang '${status}'.`,
      });
    }
    const upd = await new sql.Request(tx)
      .input('id', sql.Int, idc.value)
      .input('current', sql.VarChar(20), previous)
      .input('status', sql.VarChar(20), status)
      .input('shippingStatus', sql.VarChar(30), shippingForOrderStatus(current.recordset[0], status))
      .query(`
        UPDATE dbo.orders SET status = @status, shipping_status = @shippingStatus
        OUTPUT INSERTED.id, INSERTED.status, INSERTED.total_amount, INSERTED.created_at, INSERTED.user_id
        WHERE id = @id AND status = @current;`);

    if (upd.recordset.length === 0) {
      await tx.rollback();
      return res.status(409).json({ status: 'error', message: 'Trạng thái đơn hàng vừa thay đổi. Vui lòng tải lại.' });
    }
    const order = upd.recordset[0];

    if (status === 'completed') await completeCodPayment(tx, idc.value);
    await tx.commit();
    res.json({
      status: 'ok',
      order: { id: order.id, status: order.status, allowed_next_statuses: nextStatuses(order.status), total_amount: order.total_amount, created_at: order.created_at },
    });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* ignore */ }
    console.error('[admin] update order status error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được trạng thái đơn' });
  }
});

// Sequential shipping updates share the order lock with cancellation/status changes.
router.patch('/orders/:id/shipping-status', async (req, res) => {
  const id = Number(req.params.id);
  const target = req.body && req.body.shipping_status;
  if (!Number.isInteger(id) || id < 1 || id > 2147483647 || typeof target !== 'string' ||
      !['picked_up', 'in_transit', 'out_for_delivery', 'delivered'].includes(target)) {
    return res.status(400).json({ status: 'error', message: 'Trạng thái vận chuyển không hợp lệ' });
  }
  let tx;
  try {
    tx = new sql.Transaction(await getPool());
    await tx.begin();
    const current = (await new sql.Request(tx).input('id', sql.Int, id).query(`
      SELECT status, shipping_version, shipping_status FROM dbo.orders WITH (UPDLOCK, HOLDLOCK)
      WHERE id = @id;`)).recordset[0];
    if (!current) {
      await tx.rollback();
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
    }
    if (!nextShippingStatuses(current).includes(target)) {
      await tx.rollback();
      return res.status(409).json({ status: 'error', message: 'Không thể chuyển trạng thái vận chuyển. Đơn phải đang xử lý hoặc đang giao và chỉ được tiến một bước.' });
    }
    const orderStatus = target === 'delivered' ? 'completed' :
      (current.status === 'processing' ? 'shipping' : current.status);
    const updated = (await new sql.Request(tx).input('id', sql.Int, id)
      .input('status', sql.VarChar(20), orderStatus).input('shippingStatus', sql.VarChar(30), target)
      .query(`UPDATE dbo.orders SET status = @status, shipping_status = @shippingStatus
        OUTPUT INSERTED.id, INSERTED.order_code, INSERTED.status, INSERTED.shipping_version, INSERTED.shipping_status
        WHERE id = @id;`)).recordset[0];
    if (orderStatus === 'completed') await completeCodPayment(tx, id);
    await tx.commit();
    res.json({ status: 'ok', order: { ...updated, allowed_next_statuses: nextStatuses(updated.status),
      allowed_shipping_statuses: nextShippingStatuses(updated) } });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* already rolled back */ } }
    console.error('[admin] shipping status error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được vận chuyển' });
  }
});

// ---- DELETE /api/admin/orders/:id --- xoá hẳn 1 đơn (hard delete) ------------
// order_items có FK ON DELETE CASCADE -> tự xoá theo, không cần xoá tay.
router.delete('/orders/:id', async (req, res) => {
  const idc = reqInt(req.params.id, 1, 'id');
  if (!idc.ok) return res.status(400).json({ status: 'error', message: idc.error });

  try {
    const pool = await getPool();
    const del = await pool.request()
      .input('id', sql.Int, idc.value)
      .query(`
        DELETE FROM dbo.orders
        OUTPUT DELETED.id
        WHERE id = @id;`);

    if (del.recordset.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
    }
    res.json({ status: 'ok', deletedId: del.recordset[0].id });
  } catch (err) {
    console.error('[admin] delete order error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không xoá được đơn hàng' });
  }
});

// ---- GET /api/admin/blacklist --- đơn ĐÃ HUỶ của các user đang bị blacklist ------
// Hiển thị THEO ĐƠN (không gộp theo user): 1 user huỷ 3 đơn -> 3 dòng.
// IsBlacklisted là trạng thái ĐƯỢC LƯU (dbo.users), KHÔNG tính động ở đây.
// ?q= tìm theo mã đơn / khách hàng — cùng logic với GET /api/admin/orders:
//   toàn chữ số -> khớp CHÍNH XÁC o.id; còn lại -> LIKE email/tên khách (escape).
router.get('/blacklist', async (req, res) => {
  let page = Number(req.query.page);
  let limit = Number(req.query.limit);
  page = Number.isInteger(page) && page > 0 ? page : 1;
  limit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
  const offset = (page - 1) * limit;

  const { q } = req.query;
  let qId = null;
  let likeVal = null;
  if (q !== undefined && String(q).trim() !== '') {
    const raw = String(q).trim().slice(0, 100);
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      qId = (Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) ? n : -1;
    } else {
      likeVal = '%' + raw.replace(/[\\%_[]/g, (c) => '\\' + c) + '%';
    }
  }

  // LEFT JOIN từ users (không phải orders): user bị blacklist THỦ CÔNG (không qua
  // huỷ đơn) sẽ KHÔNG có đơn cancelled nào để join — nếu dùng INNER JOIN họ sẽ biến
  // mất khỏi trang này hoàn toàn và KHÔNG CÒN CÁCH NÀO gỡ (nút Gỡ chỉ nằm trên dòng ở
  // đây). LEFT JOIN đảm bảo họ vẫn có 1 dòng riêng (order_id = null) để admin gỡ được.
  function applyFilters(request) {
    const clauses = ['u.IsBlacklisted = 1'];
    if (qId !== null) {
      request.input('qid', sql.Int, qId);
      clauses.push('COALESCE(o.order_code, o.id) = @qid');
    } else if (likeVal) {
      request.input('q', sql.NVarChar(120), likeVal);
      clauses.push("(u.email LIKE @q ESCAPE '\\' OR u.display_name LIKE @q ESCAPE '\\')");
    }
    return 'WHERE ' + clauses.join(' AND ');
  }

  try {
    const pool = await getPool();

    const countReq = pool.request();
    const whereCount = applyFilters(countReq);
    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total
      FROM dbo.users u
      LEFT JOIN dbo.orders o ON o.user_id = u.id AND o.status = 'cancelled'
      ${whereCount};`);
    const total = countRes.recordset[0].total;

    const listReq = pool.request()
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit);
    const whereList = applyFilters(listReq);
    const listRes = await listReq.query(`
        SELECT o.id AS order_id, o.order_code, u.id AS user_id, u.email AS user_email, u.display_name AS user_name,
               o.status, o.total_amount, o.currency, o.PaymentMethod AS payment_method,
               o.shipping_name, o.shipping_phone, o.shipping_address, o.created_at
        FROM dbo.users u
        LEFT JOIN dbo.orders o ON o.user_id = u.id AND o.status = 'cancelled'
        ${whereList}
        ORDER BY o.created_at DESC, o.id DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;`);

    res.json({ page, limit, total, total_pages: Math.ceil(total / limit), orders: listRes.recordset });
  } catch (err) {
    console.error('[admin] list blacklist error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được danh sách đen' });
  }
});

// ---- POST /api/admin/blacklist/:userId/release --- gỡ 1 user khỏi danh sách đen --
router.post('/blacklist/:userId/release', async (req, res) => {
  const idc = reqInt(req.params.userId, 1, 'userId');
  if (!idc.ok) return res.status(400).json({ status: 'error', message: idc.error });

  try {
    const pool = await getPool();
    const upd = await pool.request()
      .input('uid', sql.Int, idc.value)
      .query(`
        UPDATE dbo.users SET IsBlacklisted = 0
        OUTPUT INSERTED.id, INSERTED.email, INSERTED.IsBlacklisted AS is_blacklisted
        WHERE id = @uid;`);

    if (upd.recordset.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
    }
    res.json({ status: 'ok', user: upd.recordset[0] });
  } catch (err) {
    console.error('[admin] release blacklist error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không gỡ được người dùng khỏi danh sách đen' });
  }
});

// ==== Helpers cho các route thống kê có filter thời gian ==========================
// Reporting only: doanh thu/sản phẩm/khách mua tính completed; số đơn gồm mọi trạng thái.
// Danh sách status là literal cố định (không phải input) nên nhúng thẳng an toàn;
// MỌI giá trị ngày do client truyền đều PARAMETERIZED (request.input) — chống SQL injection.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7 — quy ước "ngày" theo giờ VN cho khớp dashboard (browser VN).

// Parse 'YYYY-MM-DD' -> Date (UTC 00:00). Chặt: loại ngày không tồn tại (vd 2026-02-30 bị cuộn).
function parseYMD(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

// "Hôm nay" của phần thống kê KHÔNG lấy từ đồng hồ máy chủ mà neo vào đơn mới nhất
// có trong DB (MAX(created_at)). Lý do: dữ liệu hiện dừng ở 2026-07-30 trong khi đồng
// hồ thật đã sang tháng 8, nên mọi preset ngắn ('7 ngày qua', 'Tháng này') rơi trọn vào
// vùng trống và bảng hiện rỗng như thể mất dữ liệu. Neo theo dữ liệu thì preset luôn có
// số liệu, và khi có đơn mới THẬT thì mốc tự trôi về hiện tại — không phải sửa lại code.
// LƯU Ý: mốc này chỉ đổi CÁCH CHỌN KHOẢNG. Ngày giờ hiển thị trên UI (cột "Ngày đặt",
// hoá đơn, trục chart) vẫn là created_at thật của đơn, không bị dịch.
// CHỈ neo theo đơn completed, cùng định nghĩa doanh thu của Dashboard/Statistics/CSV.
// Đơn 'pending'/'cancelled' bị loại có chủ đích: chỉ cần MỘT đơn test đặt hôm nay là mốc
// nhảy về hiện tại, mọi preset ngắn lại rơi vào vùng trống và biểu đồ rỗng đúng như lỗi
// mà cách neo này sinh ra để tránh. Đơn test thường nằm ở 'pending' nên loại là đủ.
// Không có đơn doanh thu nào -> lùi về đơn bất kỳ; bảng rỗng hẳn -> giờ hệ thống.
async function getAnchorInstant(pool) {
  const r = await pool.request().query(`
    SELECT MAX(created_at) AS mx FROM dbo.orders
    WHERE status = 'completed';`);
  const mx = r.recordset[0] && r.recordset[0].mx;
  if (mx) return new Date(mx);

  const any = await pool.request().query('SELECT MAX(created_at) AS mx FROM dbo.orders;');
  const mxAny = any.recordset[0] && any.recordset[0].mx;
  return mxAny ? new Date(mxAny) : new Date();
}

// Chuẩn hoá khoảng ngày từ query. Không truyền from/to -> 30 ngày gần nhất tính từ mốc neo.
// Trả { ok, from, to, fromDate, toDate, start, end } hoặc { ok:false, error }.
function resolveDateRange(query, anchorInstant) {
  const fromRaw = query.from, toRaw = query.to;
  const hasFrom = fromRaw != null && fromRaw !== '';
  const hasTo = toRaw != null && toRaw !== '';
  let fromDate, toDate;
  if (!hasFrom && !hasTo) {
    // Ngày của mốc neo tính theo giờ VN (khớp quy ước với resolveStatisticsRange).
    const shifted = new Date((anchorInstant || new Date()).getTime() + VN_OFFSET_MS);
    toDate = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
    fromDate = new Date(toDate.getTime() - 29 * 86400000);
  } else {
    if (!hasFrom || !hasTo) return { ok: false, error: 'Phải truyền cả from và to (YYYY-MM-DD)' };
    fromDate = parseYMD(fromRaw);
    toDate = parseYMD(toRaw);
    if (!fromDate || !toDate) return { ok: false, error: 'from/to phải đúng định dạng YYYY-MM-DD' };
    if (fromDate.getTime() > toDate.getTime()) return { ok: false, error: 'from phải nhỏ hơn hoặc bằng to' };
    if ((toDate.getTime() - fromDate.getTime()) / 86400000 + 1 > 366) {
      return { ok: false, error: 'Khoảng thời gian tối đa 366 ngày' };
    }
  }
  const start = new Date(fromDate.getTime() - VN_OFFSET_MS);
  const end = new Date(toDate.getTime() + 86400000 - VN_OFFSET_MS);
  if (start < new Date('0001-01-01T00:00:00Z') || end > new Date('9999-12-31T23:59:59.999Z')) {
    return { ok: false, error: 'Ngày ngoài phạm vi SQL Server hỗ trợ' };
  }
  return {
    ok: true,
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    fromDate, toDate,
    start, end, // VN midnight; end EXCLUSIVE includes the full selected 'to' day.
  };
}

// Reuse one KPI definition for Dashboard and CSV.
async function rangeStats(pool, start, end) {
  return businessReport.summary(pool, start, end);
}

// ---- GET /api/admin/stats/anchor -------------------------------------------------
// Mốc "hôm nay" (YYYY-MM-DD, giờ VN) để client tính các preset của Dashboard.
// Dashboard tự tính from/to ở client rồi mới gửi lên, nên client phải biết mốc này —
// nếu vẫn dùng new Date() của máy thì preset ngắn sẽ rơi vào vùng chưa có đơn.
router.get('/stats/anchor', async (req, res) => {
  try {
    const pool = await getPool();
    res.json({ anchor: ymdVN(await getAnchorInstant(pool)) });
  } catch (err) {
    console.error('[admin] stats/anchor error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được mốc thời gian' });
  }
});

// ---- GET /api/admin/stats?from=&to= --- KPI kỳ hiện tại + kỳ trước + doanh thu/ngày --
// 'previous' = kỳ liền trước cùng độ dài N ngày. Frontend tự tính % delta.
router.get('/stats', async (req, res) => {
  try {
    const pool = await getPool();
    const rg = resolveDateRange(req.query, await getAnchorInstant(pool));
    if (!rg.ok) return res.status(400).json({ status: 'error', message: rg.error });

    // Kỳ trước: cùng số ngày N, ngay liền trước kỳ hiện tại.
    const N = Math.round((rg.toDate.getTime() - rg.fromDate.getTime()) / 86400000) + 1;
    const prevStart = new Date(rg.start.getTime() - N * 86400000);
    const prevEnd = rg.start; // exclusive = from

    const current = await rangeStats(pool, rg.start, rg.end);
    const previous = await rangeStats(pool, prevStart, prevEnd);

    const dailyRevenue = await businessReport.dailyRevenue(pool, rg);

    res.json({ range: { from: rg.from, to: rg.to }, current, previous, dailyRevenue });
  } catch (err) {
    console.error('[admin] stats error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được số liệu thống kê' });
  }
});

// Read-only export data. Uses the exact Dashboard range, KPI and daily grouping.
router.get('/stats/business-report', async (req, res) => {
  try {
    const pool = await getPool();
    const rg = resolveDateRange(req.query, await getAnchorInstant(pool));
    if (!rg.ok) return res.status(400).json({ status: 'error', message: rg.error });
    const summary = await businessReport.summary(pool, rg.start, rg.end);
    const dailyRevenue = await businessReport.dailyRevenue(pool, rg);
    const topProducts = await businessReport.products(pool, rg.start, rg.end, 10);
    res.json({ range: { from: rg.from, to: rg.to }, summary, dailyRevenue, topProducts });
  } catch (err) {
    console.error('[admin] business report error:', err.code || 'database-error');
    res.status(500).json({ status: 'error', message: 'Không tải được báo cáo kinh doanh' });
  }
});

// ---- GET /api/admin/stats/top-products?from=&to=&limit= --------------------------
// Top sản phẩm bán chạy (đơn hợp lệ) trong khoảng, giảm dần theo số lượng bán.
// imageUrl = phần tử đầu của cột images (JSON array), fallback placeholder nếu rỗng/lỗi.
router.get('/stats/top-products', async (req, res) => {
  let limit = Number(req.query.limit);
  limit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 5;

  try {
    const pool = await getPool();
    const rg = resolveDateRange(req.query, await getAnchorInstant(pool));
    if (!rg.ok) return res.status(400).json({ status: 'error', message: rg.error });

    const items = await businessReport.products(pool, rg.start, rg.end, limit);
    res.json(items);
  } catch (err) {
    console.error('[admin] top-products error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được sản phẩm bán chạy' });
  }
});

// ---- GET /api/admin/stats/order-status?from=&to= ---------------------------------
// Phân bố trạng thái đơn trong khoảng (GỒM mọi status để vẽ donut — không lọc theo doanh thu).
router.get('/stats/order-status', async (req, res) => {
  try {
    const pool = await getPool();
    const rg = resolveDateRange(req.query, await getAnchorInstant(pool));
    if (!rg.ok) return res.status(400).json({ status: 'error', message: rg.error });

    const r = await pool.request()
      .input('start', sql.DateTime2, rg.start)
      .input('end', sql.DateTime2, rg.end)
      .query(`
        SELECT status, COUNT(*) AS count
        FROM dbo.orders
        WHERE created_at >= @start AND created_at < @end
        GROUP BY status;`);
    res.json(r.recordset.map((x) => ({ status: x.status, count: Number(x.count) || 0 })));
  } catch (err) {
    console.error('[admin] order-status error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được trạng thái đơn' });
  }
});

// ---- GET /api/admin/statistics?range=7d|30d|month|year ---------------------------
// Thống kê sản phẩm bán được: gom theo SẢN PHẨM (không gộp theo đơn), doanh thu SAU
// khi phân bổ voucher (đơn không có DiscountAmount thì tỉ lệ = 0, ra đúng line_total).
// Cùng tập completed, snapshot và phân bổ voucher với Dashboard/CSV top products.
const STATISTICS_RANGE_KEYS = ['7d', '30d', 'month', 'year'];

// "Nửa đêm giờ VN của ngày y-m-d" quy đổi ra Date UTC thật (để so sánh với created_at lưu UTC).
function vnMidnightUTC(y, m, d) {
  return new Date(Date.UTC(y, m, d) - VN_OFFSET_MS);
}

// Date UTC thật -> chuỗi 'YYYY-MM-DD' theo giờ VN (chỉ để hiển thị, không dùng để so sánh).
function ymdVN(utcInstant) {
  const shifted = new Date(utcInstant.getTime() + VN_OFFSET_MS);
  const p2 = (n) => String(n).padStart(2, '0');
  return shifted.getUTCFullYear() + '-' + p2(shifted.getUTCMonth() + 1) + '-' + p2(shifted.getUTCDate());
}

// range whitelist -> { start, end, from, to } (start/end = mốc UTC thật; end EXCLUSIVE).
// Server tự tính hoàn toàn theo giờ VN — KHÔNG nhận from/to từ client. Mốc "hôm nay"
// là anchorInstant (đơn mới nhất trong DB), xem getAnchorInstant().
function resolveStatisticsRange(rangeKey, anchorInstant) {
  if (!STATISTICS_RANGE_KEYS.includes(rangeKey)) return null;

  const shiftedNow = new Date((anchorInstant || new Date()).getTime() + VN_OFFSET_MS);
  const y = shiftedNow.getUTCFullYear(), m = shiftedNow.getUTCMonth(), d = shiftedNow.getUTCDate();
  const todayStart = vnMidnightUTC(y, m, d);
  const end = new Date(todayStart.getTime() + 86400000); // hết ngày hôm nay (giờ VN)

  let start;
  if (rangeKey === '7d') start = new Date(todayStart.getTime() - 6 * 86400000);
  else if (rangeKey === '30d') start = new Date(todayStart.getTime() - 29 * 86400000);
  else if (rangeKey === 'month') start = vnMidnightUTC(y, m, 1);
  else start = vnMidnightUTC(y, 0, 1); // 'year'

  return { start, end, from: ymdVN(start), to: ymdVN(new Date(end.getTime() - 1)) };
}

router.get('/statistics', async (req, res) => {
  if (!STATISTICS_RANGE_KEYS.includes(req.query.range)) {
    return res.status(400).json({
      status: 'error',
      message: 'range không hợp lệ. Hợp lệ: ' + STATISTICS_RANGE_KEYS.join(', '),
    });
  }

  try {
    const pool = await getPool();
    const rg = resolveStatisticsRange(req.query.range, await getAnchorInstant(pool));
    const products = await businessReport.products(pool, rg.start, rg.end, 2147483647, 'revenue');
    const items = products.map(row => ({ productName: row.name, quantity: row.unitsSold, revenue: row.revenue }));
    const totalRevenue = items.reduce((sum, it) => sum + it.revenue, 0);

    res.json({ range: req.query.range, from: rg.from, to: rg.to, items, totalRevenue });
  } catch (err) {
    console.error('[admin] statistics error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được thống kê sản phẩm' });
  }
});

// ---- GET /api/admin/users --- danh sách người dùng, phân trang (chỉ xem) ------
// Giống /api/admin/orders: ?page=&limit= (mặc định 20, tối đa 100). Chỉ đọc.
router.get('/users', async (req, res) => {
  let page = Number(req.query.page);
  let limit = Number(req.query.limit);
  page = Number.isInteger(page) && page > 0 ? page : 1;
  limit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
  const offset = (page - 1) * limit;

  try {
    const pool = await getPool();
    const countRes = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.users;');
    const total = countRes.recordset[0].total;

    const usersRes = await pool.request()
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT id, email, display_name, role, created_at, last_login,
               IsBlacklisted AS is_blacklisted
        FROM dbo.users
        ORDER BY created_at DESC, id DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;`);

    res.json({
      page, limit, total,
      total_pages: Math.ceil(total / limit),
      users: usersRes.recordset,
    });
  } catch (err) {
    console.error('[admin] list users error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được danh sách người dùng' });
  }
});

// ---- GET /api/admin/users/:userId/detail --- hồ sơ và lịch sử mua hàng --------
router.get('/users/:userId/detail', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId < 1 || userId > 2147483647) {
    return res.status(400).json({ status: 'error', message: 'userId phải là số nguyên dương hợp lệ' });
  }
  let page = Number(req.query.page);
  let limit = Number(req.query.limit);
  page = Number.isSafeInteger(page) && page > 0 ? page : 1;
  limit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 10;

  try {
    const pool = await getPool();
    const userRes = await pool.request().input('uid', sql.Int, userId).query(`
      SELECT id, email, display_name, phone, dob, gender, country, role,
             created_at, last_login, IsBlacklisted AS is_blacklisted
      FROM dbo.users WHERE id = @uid;`);
    if (!userRes.recordset.length) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
    }

    // KPI tính trên toàn bộ đơn của khách, độc lập với trang lịch sử đang xem.
    const statsRes = await pool.request().input('uid', sql.Int, userId).query(`
      SELECT COUNT(*) AS total_orders,
             COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_orders,
             COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_orders,
             COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) AS total_spent
      FROM dbo.orders WHERE user_id = @uid;`);
    const statistics = statsRes.recordset[0];
    const total = statistics.total_orders;
    const totalPages = Math.ceil(total / limit);
    page = Math.min(page, totalPages || 1);
    const ordersRes = await pool.request()
      .input('uid', sql.Int, userId)
      .input('offset', sql.Int, (page - 1) * limit)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT id, order_code, created_at, total_amount, currency, PaymentMethod AS payment_method, status
        FROM dbo.orders WHERE user_id = @uid
        ORDER BY created_at DESC, id DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;`);
    res.json({ user: userRes.recordset[0], statistics, orders: ordersRes.recordset,
      page, limit, total, total_pages: totalPages });
  } catch (err) {
    console.error('[admin] customer detail error:', err.code || 'database-error');
    res.status(500).json({ status: 'error', message: 'Không tải được chi tiết khách hàng' });
  }
});

// ---- POST /api/admin/users/:userId/blacklist --- thêm THỦ CÔNG vào danh sách đen ---
// Blacklist là hành động quản trị riêng, KHÔNG tự phát sinh khi hủy đơn.
// Endpoint vẫn yêu cầu user có đơn cancelled, theo policy cũ. Idempotent;
// không cho đưa tài khoản admin vào blacklist.
router.post('/users/:userId/blacklist', async (req, res) => {
  const idc = reqInt(req.params.userId, 1, 'userId');
  if (!idc.ok) return res.status(400).json({ status: 'error', message: idc.error });

  try {
    const pool = await getPool();
    const target = await pool.request().input('uid', sql.Int, idc.value)
      .query('SELECT id, role FROM dbo.users WHERE id = @uid;');
    if (target.recordset.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
    }
    if (target.recordset[0].role === 'admin') {
      return res.status(400).json({ status: 'error', message: 'Không thể đưa tài khoản admin vào danh sách đen' });
    }

    const cancelled = await pool.request().input('uid', sql.Int, idc.value)
      .query("SELECT TOP 1 id FROM dbo.orders WHERE user_id = @uid AND status = 'cancelled';");
    if (cancelled.recordset.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Hành Động Không Thành Công' });
    }

    const upd = await pool.request().input('uid', sql.Int, idc.value)
      .query(`
        UPDATE dbo.users SET IsBlacklisted = 1
        OUTPUT INSERTED.id, INSERTED.email, INSERTED.IsBlacklisted AS is_blacklisted
        WHERE id = @uid;`);
    res.json({ status: 'ok', user: upd.recordset[0] });
  } catch (err) {
    console.error('[admin] add blacklist error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không thêm được vào danh sách đen' });
  }
});

module.exports = router;
