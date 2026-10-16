'use strict';

const { sql } = require('../db');
const { recordInventoryMovement } = require('./inventory-movement');
const APPAREL = ['S', 'M', 'L', 'XL'];
const MEN_SHOES = ['39', '40', '40.5', '41', '42', '42.5', '43', '44', '44.5', '45', '45.5', '46'];

function sizeProfile(product) {
  if (['sanpham-ao', 'sanpham-quan'].includes(product.category_slug)) return { kind: 'apparel', sizes: APPAREL };
  if (product.category_slug === 'sanpham-giay' && /^giay-nam-/.test(product.slug || ''))
    return { kind: 'mens-shoes', sizes: MEN_SHOES };
  return { kind: 'base-only', sizes: [] };
}
// Inactive sizes still establish size mode. Deactivation must never reopen BASE sales.
const SIZE_CONFIGURED_SQL = `CASE WHEN EXISTS (SELECT 1 FROM dbo.product_variants sv
  WHERE sv.product_id = p.id AND sv.is_base = 0 AND sv.size IS NOT NULL) THEN 1 ELSE 0 END`;
const COLOR_CONFIGURED_SQL = `CASE WHEN EXISTS (SELECT 1 FROM dbo.product_colors pc
  WHERE pc.product_id = p.id) THEN 1 ELSE 0 END`;
function sellableVariant(product, variant) {
  return !!(product && product.is_active && variant && variant.is_active &&
    (product.color_configured
      ? !variant.is_base && variant.color != null && variant.color_active === true &&
        (product.size_configured ? sizeProfile(product).sizes.includes(variant.size) : variant.size == null)
      : (product.size_configured
        ? !variant.is_base && variant.color == null && sizeProfile(product).sizes.includes(variant.size)
        : variant.is_base)));
}
class SizeError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function reject(code, message, status = 400) { throw new SizeError(status, code, message); }
function sizeSku(productId, size) { return `BR-P${productId}-${size.replace('.', '-')}`; }
function validStock(value) { return Number.isInteger(value) && value >= 0 && value <= 2147483647; }

async function readSizes(pool, productId) {
  const product = (await pool.request().input('pid', sql.Int, productId).query(`
    SELECT p.id, p.slug, p.name_vi, p.name_en, p.stock, p.is_active, c.slug AS category_slug,
      ${SIZE_CONFIGURED_SQL} AS size_configured, ${COLOR_CONFIGURED_SQL} AS color_configured
    FROM dbo.products p JOIN dbo.categories c ON c.id = p.category_id WHERE p.id = @pid;`)).recordset[0];
  if (!product) reject('PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm', 404);
  const variants = (await pool.request().input('pid', sql.Int, productId).query(`
    SELECT id, sku, size, stock, is_active, is_base FROM dbo.product_variants
    WHERE product_id = @pid AND color IS NULL ORDER BY is_base DESC, id;`)).recordset;
  const profile = sizeProfile(product);
  variants.sort((a, b) => Number(b.is_base) - Number(a.is_base) || profile.sizes.indexOf(a.size) - profile.sizes.indexOf(b.size));
  return { product, kind: profile.kind, allowed_sizes: profile.sizes, variants };
}

// All mutations lock product before its variants, matching checkout/cancel/admin.
async function changeSizes(pool, productId, actorUserId, action, payload = {}) {
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const product = (await new sql.Request(tx).input('pid', sql.Int, productId).query(`
      SELECT p.id, p.slug, p.stock, p.is_active, c.slug AS category_slug
      FROM dbo.products p WITH (UPDLOCK, HOLDLOCK)
      JOIN dbo.categories c ON c.id = p.category_id WHERE p.id = @pid;`)).recordset[0];
    if (!product) reject('PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm', 404);
    const variants = (await new sql.Request(tx).input('pid', sql.Int, productId).query(`
      SELECT id, size, color, stock, is_active, is_base FROM dbo.product_variants WITH (UPDLOCK, HOLDLOCK)
      WHERE product_id = @pid ORDER BY id;`)).recordset;
    const base = variants.find(v => v.is_base);
    if (!base) reject('INVENTORY_INTEGRITY', 'Thiếu biến thể BASE', 409);
    const colorConfigured = variants.some(v => v.color != null);
    const profile = sizeProfile(product);
    if (action === 'configure') {
      if (colorConfigured) reject('COLOR_MODE', 'Sản phẩm đã có màu; thêm size trong Quản lý màu', 409);
      if (!product.is_active || !profile.sizes.length) reject('SIZE_NOT_SUPPORTED', 'Sản phẩm chưa đủ điều kiện cấu hình size');
      const sizes = payload.sizes;
      if (!Array.isArray(sizes) || !sizes.length || sizes.some(s => !profile.sizes.includes(s)))
        reject('INVALID_SIZE', 'Kích thước không hợp lệ');
      if (new Set(sizes).size !== sizes.length || sizes.some(s => variants.some(v => v.size === s)))
        reject('DUPLICATE_SIZE', 'Kích thước đã tồn tại', 409);
      for (const size of profile.sizes.filter(s => sizes.includes(s))) {
        const v = (await new sql.Request(tx).input('pid', sql.Int, productId)
          .input('sku', sql.VarChar(80), sizeSku(productId, size)).input('size', sql.NVarChar(40), size)
          .query(`INSERT INTO dbo.product_variants (product_id, sku, size, stock, is_active, is_base)
            OUTPUT INSERTED.id VALUES (@pid, @sku, @size, 0, 1, 0);`)).recordset[0];
        await recordInventoryMovement(tx, { productId, variantId: v.id, type: 'VARIANT_OPENING',
          delta: 0, before: 0, after: 0, actorUserId });
      }
    } else if (action === 'allocate') {
      const list = payload.allocations;
      if (!Array.isArray(list) || !list.length || new Set(list.map(x => x && x.variant_id)).size !== list.length)
        reject('INVALID_ALLOCATION', 'Phân bổ không hợp lệ');
      let total = 0;
      for (const item of list) {
        const v = item && variants.find(v => v.id === item.variant_id && !v.is_base && v.color == null);
        if (!v || !profile.sizes.includes(v.size) || !validStock(item.quantity) || item.quantity < 1 ||
            !validStock(v.stock + item.quantity)) reject('INVALID_ALLOCATION', 'Phân bổ không hợp lệ');
        total += item.quantity;
      }
      if (total > base.stock) reject('INSUFFICIENT_BASE_STOCK', 'Tổng phân bổ vượt tồn BASE', 409);
      const reason = 'Phân bổ tồn kho theo size';
      await writeStock(tx, productId, base, base.stock - total, 'VARIANT_TRANSFER_OUT', reason, actorUserId);
      for (const item of list.sort((a, b) => a.variant_id - b.variant_id)) {
        const v = variants.find(v => v.id === item.variant_id);
        await writeStock(tx, productId, v, v.stock + item.quantity, 'VARIANT_TRANSFER_IN', reason, actorUserId);
      }
      // Physical inventory is unchanged, so products.stock is intentionally untouched.
    } else if (action === 'adjust') {
      if (colorConfigured) reject('COLOR_MODE', 'Tồn size nguồn chỉ phân bổ qua Quản lý màu', 409);
      const v = variants.find(v => v.id === payload.variant_id && !v.is_base);
      if (!v) reject('VARIANT_NOT_FOUND', 'Không tìm thấy size của sản phẩm', 404);
      if (payload.stock === undefined && payload.is_active === undefined) reject('EMPTY_UPDATE', 'Chưa có thay đổi');
      if (payload.is_active !== undefined && typeof payload.is_active !== 'boolean') reject('INVALID_STATUS', 'Trạng thái không hợp lệ');
      if (payload.is_active === true && !product.is_active) reject('PRODUCT_INACTIVE', 'Sản phẩm đang ẩn', 409);
      if (payload.stock !== undefined) {
        if (!validStock(payload.stock) || !validStock(payload.expected_stock)) reject('INVALID_STOCK', 'Tồn kho không hợp lệ');
        if (v.stock !== payload.expected_stock) reject('STALE_STOCK', 'Tồn kho vừa thay đổi. Vui lòng tải lại.', 409);
        const delta = payload.stock - v.stock;
        if (!validStock(product.stock + delta)) reject('INVALID_STOCK', 'Tổng tồn kho vượt giới hạn');
        if (delta) {
          if (typeof payload.reason !== 'string' || !payload.reason.trim() || payload.reason.trim().length > 250)
            reject('STOCK_REASON_REQUIRED', 'Vui lòng nhập lý do điều chỉnh kho');
          await writeStock(tx, productId, v, payload.stock, 'ADMIN_ADJUSTMENT', payload.reason.trim(), actorUserId);
          await new sql.Request(tx).input('pid', sql.Int, productId).input('delta', sql.Int, delta)
            .query('UPDATE dbo.products SET stock = stock + @delta, updated_at = SYSUTCDATETIME() WHERE id = @pid;');
        }
      }
      if (payload.is_active !== undefined) await new sql.Request(tx).input('vid', sql.Int, v.id)
        .input('active', sql.Bit, payload.is_active)
        .query('UPDATE dbo.product_variants SET is_active = @active, updated_at = SYSUTCDATETIME() WHERE id = @vid;');
    } else reject('INVALID_ACTION', 'Thao tác không hợp lệ');
    await tx.commit();
    return readSizes(pool, productId);
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* SQL may have rolled back */ }
    throw err;
  }
}
async function writeStock(tx, productId, variant, stock, type, reason, actorUserId) {
  await new sql.Request(tx).input('vid', sql.Int, variant.id).input('stock', sql.Int, stock)
    .query('UPDATE dbo.product_variants SET stock = @stock, updated_at = SYSUTCDATETIME() WHERE id = @vid;');
  await recordInventoryMovement(tx, { productId, variantId: variant.id, type, reason, actorUserId,
    before: variant.stock, after: stock, delta: stock - variant.stock });
}
module.exports = { APPAREL, MEN_SHOES, sizeProfile, sizeSku, SIZE_CONFIGURED_SQL, COLOR_CONFIGURED_SQL, sellableVariant,
  SizeError, readSizes, changeSizes };
