// Admin API (Phase 5) — MỌI route bọc verifyFirebaseToken + requireAdmin.
//   POST   /api/admin/products            — tạo sản phẩm.
//   PUT    /api/admin/products/:id         — sửa sản phẩm (cập nhật từng phần).
//   DELETE /api/admin/products/:id         — xoá: SOFT (is_active=0) nếu đã có đơn
//                                            tham chiếu; HARD nếu chưa (tránh vỡ order_items).
//   GET    /api/admin/orders               — mọi đơn của mọi user, phân trang ?page=&limit=.
//   PUT    /api/admin/orders/:id/status    — đổi trạng thái đơn (whitelist).
//
// Nguyên tắc: TIN server, KHÔNG tin client. Mọi input validate + parameterized.
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

// Bọc toàn bộ router: chưa đăng nhập -> 401; đăng nhập nhưng không phải admin -> 403.
router.use(verifyFirebaseToken, requireAdmin);

// Trạng thái đơn hợp lệ (không có CHECK constraint ở DB nên whitelist ở app).
const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'completed', 'cancelled'];

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
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const PRODUCT_SELECT = `
  SELECT p.id, p.slug, p.category_id, c.slug AS category_slug,
         p.name_vi, p.name_en, p.description_vi, p.description_en,
         p.price, p.sale_price, p.currency, p.images, p.stock, p.is_active,
         p.created_at, p.updated_at
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

  try {
    const pool = await getPool();
    if (!(await categoryExists(pool, v.category_id))) {
      return res.status(400).json({ status: 'error', message: 'category_id không tồn tại' });
    }

    // Áp default cho cột không truyền: currency=VND, stock=0, is_active=1.
    const currency = v.currency || 'VND';
    const stock = v.stock === null ? 0 : v.stock;
    const isActive = v.is_active === null ? 1 : v.is_active;

    const ins = await pool.request()
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
    const row = await loadProduct(pool, newId);
    res.status(201).json({ status: 'ok', product: mapProduct(row) });
  } catch (err) {
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

  try {
    const pool = await getPool();
    const existing = await loadProduct(pool, idc.value);
    if (!existing) return res.status(404).json({ status: 'error', message: 'Không tìm thấy sản phẩm' });

    if (updates.category_id !== undefined && !(await categoryExists(pool, updates.category_id))) {
      return res.status(400).json({ status: 'error', message: 'category_id không tồn tại' });
    }

    // sale_price <= price: so trên GIÁ TRỊ CUỐI (giá trị mới nếu có, ngược lại giá cũ).
    const finalPrice = updates.price !== undefined ? updates.price : existing.price;
    const finalSale = updates.sale_price !== undefined ? updates.sale_price : existing.sale_price;
    if (finalSale !== null && finalSale > finalPrice) {
      return res.status(400).json({ status: 'error', message: 'sale_price không được lớn hơn price' });
    }

    // Dựng câu UPDATE động: mỗi cột 1 param có kiểu đúng.
    const request = pool.request().input('id', sql.Int, idc.value);
    const setParts = [];
    for (const [col, value] of Object.entries(updates)) {
      request.input(col, PRODUCT_SQL_TYPE[col], value);
      setParts.push(`${col} = @${col}`);
    }
    setParts.push('updated_at = SYSUTCDATETIME()');

    await request.query(`UPDATE dbo.products SET ${setParts.join(', ')} WHERE id = @id;`);

    const row = await loadProduct(pool, idc.value);
    res.json({ status: 'ok', product: mapProduct(row) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ status: 'error', message: 'slug đã tồn tại' });
    }
    console.error('[admin] update product error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được sản phẩm' });
  }
});

// ---- DELETE /api/admin/products/:id ------------------------------------------
// Có đơn tham chiếu (order_items) => SOFT delete (is_active=0), giữ lịch sử đơn.
// Chưa có đơn nào => HARD delete; xoá luôn cart_items tạm để không vỡ FK.
router.delete('/products/:id', async (req, res) => {
  const idc = reqInt(req.params.id, 0, 'id');
  if (!idc.ok) return res.status(400).json({ status: 'error', message: idc.error });
  const id = idc.value;

  try {
    const pool = await getPool();
    const existing = await loadProduct(pool, id);
    if (!existing) return res.status(404).json({ status: 'error', message: 'Không tìm thấy sản phẩm' });

    const ref = await pool.request().input('id', sql.Int, id)
      .query('SELECT TOP 1 1 AS x FROM dbo.order_items WHERE product_id = @id;');
    const referenced = ref.recordset.length > 0;

    if (referenced) {
      await pool.request().input('id', sql.Int, id)
        .query('UPDATE dbo.products SET is_active = 0, updated_at = SYSUTCDATETIME() WHERE id = @id;');
      return res.json({
        status: 'ok', mode: 'soft',
        message: 'Sản phẩm đã có trong đơn hàng — ẩn (soft delete) để giữ lịch sử đơn',
        product_id: id,
      });
    }

    // Hard delete trong transaction: dọn cart_items (tạm, FK) trước rồi xoá product.
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).input('id', sql.Int, id)
        .query('DELETE FROM dbo.cart_items WHERE product_id = @id;');
      await new sql.Request(tx).input('id', sql.Int, id)
        .query('DELETE FROM dbo.products WHERE id = @id;');
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ignore */ }
      throw e;
    }
    res.json({ status: 'ok', mode: 'hard', message: 'Đã xoá sản phẩm', product_id: id });
  } catch (err) {
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
    SELECT order_id, product_id, product_name, unit_price, quantity, line_total
    FROM dbo.order_items
    WHERE order_id IN (${params.join(', ')})
    ORDER BY id;`);
  const map = {};
  for (const it of result.recordset) {
    (map[it.order_id] = map[it.order_id] || []).push({
      product_id: it.product_id,
      product_name: it.product_name,
      unit_price: it.unit_price,
      quantity: it.quantity,
      line_total: it.line_total,
    });
  }
  return map;
}

// ---- GET /api/admin/orders ---  mọi đơn của mọi user, phân trang -------------
router.get('/orders', async (req, res) => {
  let page = Number(req.query.page);
  let limit = Number(req.query.limit);
  page = Number.isInteger(page) && page > 0 ? page : 1;
  limit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
  const offset = (page - 1) * limit;

  try {
    const pool = await getPool();
    const countRes = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.orders;');
    const total = countRes.recordset[0].total;

    const ordersRes = await pool.request()
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT o.id, o.user_id, u.email AS user_email, u.display_name AS user_name,
               o.status, o.total_amount, o.currency,
               o.shipping_name, o.shipping_phone, o.shipping_address, o.created_at
        FROM dbo.orders o
        JOIN dbo.users u ON u.id = o.user_id
        ORDER BY o.created_at DESC, o.id DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;`);

    const orders = ordersRes.recordset;
    const itemsMap = await fetchItemsByOrderIds(pool, orders.map((o) => o.id));
    res.json({
      page, limit, total,
      total_pages: Math.ceil(total / limit),
      orders: orders.map((o) => ({ ...o, items: itemsMap[o.id] || [] })),
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
  if (typeof status !== 'string' || !ORDER_STATUSES.includes(status)) {
    return res.status(400).json({
      status: 'error',
      message: 'status không hợp lệ. Hợp lệ: ' + ORDER_STATUSES.join(', '),
    });
  }

  try {
    const pool = await getPool();
    const upd = await pool.request()
      .input('id', sql.Int, idc.value)
      .input('status', sql.VarChar(20), status)
      .query(`
        UPDATE dbo.orders SET status = @status
        OUTPUT INSERTED.id, INSERTED.status, INSERTED.total_amount, INSERTED.created_at
        WHERE id = @id;`);

    if (upd.recordset.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
    }
    res.json({ status: 'ok', order: upd.recordset[0] });
  } catch (err) {
    console.error('[admin] update order status error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được trạng thái đơn' });
  }
});

module.exports = router;
