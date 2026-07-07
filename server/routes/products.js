// Product API (read-only).
//   GET /api/products            — danh sách, hỗ trợ ?category= &min= &max= &sort=
//   GET /api/products/:id        — chi tiết 1 sản phẩm
//
// Giá thực (effective price) = sale_price nếu có, ngược lại price. Dùng cho cả
// lọc khoảng giá lẫn sắp xếp theo giá. Mọi input đều parameterized (chống SQL injection);
// ORDER BY dùng whitelist cố định (không thể parameterize tên cột/hướng sắp xếp).
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');

const EFFECTIVE_PRICE = '(CASE WHEN p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END)';

const SORT_MAP = {
  newest: 'p.created_at DESC, p.id DESC',
  price_asc: 'effective_price ASC, p.id ASC',
  price_desc: 'effective_price DESC, p.id ASC',
};

const SELECT_COLS = `
  p.id, c.slug AS category_slug, p.name_vi, p.name_en,
  p.price, p.sale_price, p.stock, p.images,
  p.description_vi, p.description_en`;

// Chuẩn hoá 1 row DB -> object JSON gọn; parse cột images (JSON string) thành mảng.
function mapProduct(row) {
  let images = [];
  if (row.images) {
    try {
      const parsed = JSON.parse(row.images);
      if (Array.isArray(parsed)) images = parsed;
    } catch (e) {
      images = [];
    }
  }
  return {
    id: row.id,
    category_slug: row.category_slug,
    name_vi: row.name_vi,
    name_en: row.name_en,
    price: row.price,
    sale_price: row.sale_price,
    stock: row.stock,
    images,
    description_vi: row.description_vi,
    description_en: row.description_en,
  };
}

// Validate 1 tham số giá (số nguyên >= 0). Trả { ok, value } hoặc { ok:false }.
function parsePriceParam(raw) {
  if (raw === undefined || raw === '') return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

// ---- GET /api/products ----
router.get('/', async (req, res) => {
  const { category, min, max, sort } = req.query;

  const minParsed = parsePriceParam(min);
  if (!minParsed.ok) {
    return res.status(400).json({ status: 'error', message: 'min phải là số nguyên >= 0' });
  }
  const maxParsed = parsePriceParam(max);
  if (!maxParsed.ok) {
    return res.status(400).json({ status: 'error', message: 'max phải là số nguyên >= 0' });
  }
  if (minParsed.value !== null && maxParsed.value !== null && minParsed.value > maxParsed.value) {
    return res.status(400).json({ status: 'error', message: 'min không được lớn hơn max' });
  }

  let orderBy = SORT_MAP.newest;
  if (sort !== undefined && sort !== '') {
    if (!SORT_MAP[sort]) {
      return res.status(400).json({
        status: 'error',
        message: 'sort không hợp lệ (dùng newest | price_asc | price_desc)',
      });
    }
    orderBy = SORT_MAP[sort];
  }

  try {
    const pool = await getPool();
    const request = pool.request();

    let where = 'WHERE p.is_active = 1';
    if (category !== undefined && category !== '') {
      request.input('category', sql.VarChar(120), category);
      where += ' AND c.slug = @category';
    }
    if (minParsed.value !== null) {
      request.input('minv', sql.Int, minParsed.value);
      where += ` AND ${EFFECTIVE_PRICE} >= @minv`;
    }
    if (maxParsed.value !== null) {
      request.input('maxv', sql.Int, maxParsed.value);
      where += ` AND ${EFFECTIVE_PRICE} <= @maxv`;
    }

    const query = `
      SELECT ${SELECT_COLS}, ${EFFECTIVE_PRICE} AS effective_price
      FROM dbo.products p
      JOIN dbo.categories c ON c.id = p.category_id
      ${where}
      ORDER BY ${orderBy};`;

    const result = await request.query(query);
    res.json(result.recordset.map(mapProduct));
  } catch (err) {
    console.error('[products] list error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được danh sách sản phẩm' });
  }
});

// ---- GET /api/products/:id ----
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ status: 'error', message: 'id phải là số nguyên dương' });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        SELECT ${SELECT_COLS}
        FROM dbo.products p
        JOIN dbo.categories c ON c.id = p.category_id
        WHERE p.id = @id;`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy sản phẩm' });
    }
    res.json(mapProduct(result.recordset[0]));
  } catch (err) {
    console.error('[products] detail error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được sản phẩm' });
  }
});

module.exports = router;
