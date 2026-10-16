'use strict';

const { sql } = require('../db');
const fs = require('node:fs');
const path = require('node:path');
const { sizeProfile, SIZE_CONFIGURED_SQL, COLOR_CONFIGURED_SQL } = require('./size-variants');
const { recordInventoryMovement } = require('./inventory-movement');

class ColorError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function reject(status, code, message) { throw new ColorError(status, code, message); }
function colorName(raw) {
  if (typeof raw !== 'string') reject(400, 'INVALID_COLOR', 'Tên màu phải là chuỗi');
  const label = raw.trim().replace(/\s+/g, ' ');
  if (!label || label.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(label))
    reject(400, 'INVALID_COLOR', 'Tên màu không hợp lệ (tối đa 80 ký tự)');
  const key = label.toLowerCase().replace(/đ/g, 'd').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!key || key.length > 48) reject(400, 'INVALID_COLOR', 'Tên màu không tạo được mã ổn định');
  return { label, key };
}
function swatchHex(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw))
    reject(400, 'INVALID_SWATCH', 'Mã màu phải có dạng #RRGGBB');
  return raw.toUpperCase();
}
function imagePath(raw) {
  if (typeof raw !== 'string' || raw.length > 500 ||
      !/^img\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:png|jpg|jpeg|webp|avif)$/i.test(raw))
    reject(400, 'INVALID_IMAGE', 'Ảnh phải là đường dẫn img/... với đuôi png/jpg/webp/avif');
  if (!fs.existsSync(path.join(__dirname, '..', '..', 'client', raw)))
    reject(400, 'IMAGE_NOT_FOUND', 'Chưa có file ảnh trong client/img');
  return raw;
}
function nonnegative(raw, code) {
  if (!Number.isInteger(raw) || raw < 0 || raw > 2147483647) reject(400, code, 'Số lượng không hợp lệ');
  return raw;
}
function sku(productId, colorKey, size) {
  return `BR-P${productId}-${colorKey.toUpperCase()}${size == null ? '' : '-' + size.replace('.', '-')}`;
}
async function readColors(pool, productId) {
  const product = (await pool.request().input('pid', sql.Int, productId).query(`
    SELECT p.id, p.name_vi, p.slug, p.stock, p.is_active, c.slug AS category_slug,
      ${SIZE_CONFIGURED_SQL} AS size_configured, ${COLOR_CONFIGURED_SQL} AS color_configured
    FROM dbo.products p JOIN dbo.categories c ON c.id = p.category_id WHERE p.id = @pid;`)).recordset[0];
  if (!product) reject(404, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm');
  const colors = (await pool.request().input('pid', sql.Int, productId).query(`
    SELECT id, color_key, label, swatch_hex, is_active FROM dbo.product_colors
    WHERE product_id = @pid ORDER BY id;`)).recordset;
  const variants = (await pool.request().input('pid', sql.Int, productId).query(`
    SELECT id, sku, size, color, stock, is_active, is_base FROM dbo.product_variants
    WHERE product_id = @pid ORDER BY id;`)).recordset;
  const images = (await pool.request().input('pid', sql.Int, productId).query(`
    SELECT i.id, i.color_id, i.image_path, i.sort_order, i.is_primary
    FROM dbo.product_color_images i JOIN dbo.product_colors c ON c.id = i.color_id
    WHERE c.product_id = @pid ORDER BY i.color_id, i.is_primary DESC, i.sort_order, i.id;`)).recordset;
  return { product, allowed_sizes: sizeProfile(product).sizes, variants,
    colors: colors.map(c => ({ ...c, variants: variants.filter(v => v.color === c.color_key),
      images: images.filter(i => i.color_id === c.id) })) };
}
async function writeStock(tx, productId, variant, next, type, reason, actorUserId) {
  const changed = await new sql.Request(tx).input('vid', sql.Int, variant.id)
    .input('expected', sql.Int, variant.stock).input('next', sql.Int, next)
    .query(`UPDATE dbo.product_variants SET stock = @next, updated_at = SYSUTCDATETIME()
      WHERE id = @vid AND stock = @expected;`);
  if (changed.rowsAffected[0] !== 1) reject(409, 'STALE_STOCK', 'Tồn kho vừa thay đổi');
  await recordInventoryMovement(tx, { productId, variantId: variant.id, type,
    delta: next - variant.stock, before: variant.stock, after: next, reason, actorUserId });
  variant.stock = next;
}

// Product lock first, then its variants. Checkout/cancel use the same order.
async function changeColors(pool, productId, actorUserId, action, payload = {}) {
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const product = (await new sql.Request(tx).input('pid', sql.Int, productId).query(`
      SELECT p.id, p.slug, p.stock, p.is_active, c.slug AS category_slug
      FROM dbo.products p WITH (UPDLOCK, HOLDLOCK)
      JOIN dbo.categories c ON c.id = p.category_id WHERE p.id = @pid;`)).recordset[0];
    if (!product) reject(404, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm');
    const colors = (await new sql.Request(tx).input('pid', sql.Int, productId).query(`
      SELECT id, color_key, label, swatch_hex, is_active FROM dbo.product_colors WITH (UPDLOCK, HOLDLOCK)
      WHERE product_id = @pid ORDER BY id;`)).recordset;
    const variants = (await new sql.Request(tx).input('pid', sql.Int, productId).query(`
      SELECT id, size, color, stock, is_active, is_base FROM dbo.product_variants WITH (UPDLOCK, HOLDLOCK)
      WHERE product_id = @pid ORDER BY id;`)).recordset;
    const base = variants.find(v => v.is_base);
    if (!base) reject(409, 'INVENTORY_INTEGRITY', 'Thiếu biến thể BASE');
    const color = colors.find(c => c.id === payload.color_id);
    const profile = sizeProfile(product);
    if (action === 'create') {
      const named = colorName(payload.label);
      if (colors.some(c => colorName(c.label).key === named.key || c.color_key === named.key))
        reject(409, 'DUPLICATE_COLOR', 'Màu đã tồn tại');
      const swatch = swatchHex(payload.swatch_hex);
      const created = (await new sql.Request(tx).input('pid', sql.Int, productId)
        .input('key', sql.NVarChar(80), named.key).input('label', sql.NVarChar(80), named.label)
        .input('hex', sql.Char(7), swatch)
        .query(`INSERT INTO dbo.product_colors (product_id,color_key,label,swatch_hex)
          OUTPUT INSERTED.id VALUES (@pid,@key,@label,@hex);`)).recordset[0];
      const sourceSizes = variants.filter(v => !v.is_base && v.color == null && v.size != null);
      for (const source of (sourceSizes.length ? sourceSizes : [{ size: null, is_active: true }])) {
        const v = (await new sql.Request(tx).input('pid', sql.Int, productId)
          .input('key', sql.NVarChar(80), named.key).input('size', sql.NVarChar(40), source.size)
          .input('sku', sql.VarChar(80), sku(productId, named.key, source.size))
          .input('active', sql.Bit, source.is_active)
          .query(`INSERT INTO dbo.product_variants (product_id,sku,size,color,stock,is_active,is_base)
            OUTPUT INSERTED.id VALUES (@pid,@sku,@size,@key,0,@active,0);`)).recordset[0];
        await recordInventoryMovement(tx, { productId, variantId: v.id, type: 'VARIANT_OPENING',
          delta: 0, before: 0, after: 0, actorUserId });
      }
    } else if (action === 'update') {
      if (!color) reject(404, 'COLOR_NOT_FOUND', 'Không tìm thấy màu');
      if (payload.label === undefined && payload.swatch_hex === undefined && payload.is_active === undefined)
        reject(400, 'EMPTY_UPDATE', 'Chưa có thay đổi');
      const named = payload.label === undefined ? { label: color.label, key: colorName(color.label).key } : colorName(payload.label);
      if (colors.some(c => c.id !== color.id && colorName(c.label).key === named.key))
        reject(409, 'DUPLICATE_COLOR', 'Màu đã tồn tại');
      const hex = payload.swatch_hex === undefined ? color.swatch_hex : swatchHex(payload.swatch_hex);
      if (payload.is_active !== undefined && typeof payload.is_active !== 'boolean')
        reject(400, 'INVALID_STATUS', 'Trạng thái màu không hợp lệ');
      await new sql.Request(tx).input('cid', sql.Int, color.id)
        .input('label', sql.NVarChar(80), named.label).input('hex', sql.Char(7), hex)
        .input('active', sql.Bit, payload.is_active === undefined ? color.is_active : payload.is_active)
        .query('UPDATE dbo.product_colors SET label=@label, swatch_hex=@hex, is_active=@active WHERE id=@cid;');
    } else if (action === 'add-size') {
      const size = payload.size;
      if (!colors.length || !profile.sizes.includes(size)) reject(400, 'INVALID_SIZE', 'Size không hợp lệ');
      if (variants.some(v => v.color != null && v.size == null && v.stock > 0))
        reject(409, 'COLOR_ONLY_STOCK', 'Cần xử lý tồn kho color-only trước khi bật size');
      if (variants.some(v => v.size === size)) reject(409, 'DUPLICATE_SIZE', 'Size đã tồn tại');
      const entries = [{ color: null, sku: `BR-P${productId}-${size.replace('.', '-')}` },
        ...colors.map(c => ({ color: c.color_key, sku: sku(productId, c.color_key, size) }))];
      for (const entry of entries) {
        const v = (await new sql.Request(tx).input('pid', sql.Int, productId)
          .input('size', sql.NVarChar(40), size).input('key', sql.NVarChar(80), entry.color)
          .input('sku', sql.VarChar(80), entry.sku)
          .query(`INSERT INTO dbo.product_variants (product_id,sku,size,color,stock,is_base)
            OUTPUT INSERTED.id VALUES (@pid,@sku,@size,@key,0,0);`)).recordset[0];
        await recordInventoryMovement(tx, { productId, variantId: v.id, type: 'VARIANT_OPENING',
          delta: 0, before: 0, after: 0, actorUserId });
      }
    } else if (action === 'allocate') {
      const list = payload.allocations;
      if (!Array.isArray(list) || !list.length ||
          new Set(list.map(x => x && x.target_variant_id)).size !== list.length)
        reject(400, 'INVALID_ALLOCATION', 'Phân bổ không hợp lệ');
      const totals = new Map();
      for (const item of list) {
        const source = variants.find(v => v.id === item.source_variant_id);
        const target = variants.find(v => v.id === item.target_variant_id && v.color != null);
        if (!source || !target || source.color != null ||
            (source.is_base ? target.size != null : source.size == null || source.size !== target.size) ||
            !Number.isInteger(item.quantity) || item.quantity < 1 ||
            !Number.isInteger(item.expected_source_stock) || !Number.isInteger(item.expected_target_stock))
          reject(400, 'INVALID_ALLOCATION', 'Nguồn/đích phân bổ không hợp lệ');
        if (source.stock !== item.expected_source_stock || target.stock !== item.expected_target_stock)
          reject(409, 'STALE_STOCK', 'Tồn kho vừa thay đổi');
        totals.set(source.id, (totals.get(source.id) || 0) + item.quantity);
        if (!Number.isSafeInteger(totals.get(source.id)))
          reject(400, 'INVALID_ALLOCATION', 'Phân bổ không hợp lệ');
        nonnegative(target.stock + item.quantity, 'INVALID_ALLOCATION');
      }
      for (const [sourceId, total] of totals) {
        const source = variants.find(v => v.id === sourceId);
        if (total > source.stock) reject(409, 'INSUFFICIENT_SOURCE_STOCK', 'Tồn nguồn không đủ');
      }
      const reason = 'Phân bổ tồn kho theo màu';
      for (const [sourceId, total] of [...totals].sort((a, b) => a[0] - b[0])) {
        const source = variants.find(v => v.id === sourceId);
        await writeStock(tx, productId, source, source.stock - total, 'VARIANT_TRANSFER_OUT', reason, actorUserId);
      }
      for (const item of [...list].sort((a, b) => a.target_variant_id - b.target_variant_id)) {
        const target = variants.find(v => v.id === item.target_variant_id);
        await writeStock(tx, productId, target, target.stock + item.quantity,
          'VARIANT_TRANSFER_IN', reason, actorUserId);
      }
    } else if (action === 'adjust') {
      const target = variants.find(v => v.id === payload.variant_id && v.color != null);
      if (!target) reject(404, 'VARIANT_NOT_FOUND', 'Không tìm thấy biến thể màu');
      if (payload.stock === undefined && payload.is_active === undefined)
        reject(400, 'EMPTY_UPDATE', 'Chưa có thay đổi');
      if (payload.is_active !== undefined && typeof payload.is_active !== 'boolean')
        reject(400, 'INVALID_STATUS', 'Trạng thái không hợp lệ');
      if (payload.stock !== undefined) {
        nonnegative(payload.stock, 'INVALID_STOCK');
        nonnegative(payload.expected_stock, 'INVALID_STOCK');
        if (target.stock !== payload.expected_stock) reject(409, 'STALE_STOCK', 'Tồn kho vừa thay đổi');
        const delta = payload.stock - target.stock;
        if (delta) {
          if (typeof payload.reason !== 'string' || !payload.reason.trim() || payload.reason.trim().length > 250)
            reject(400, 'STOCK_REASON_REQUIRED', 'Vui lòng nhập lý do điều chỉnh');
          if (product.stock + delta < 0 || product.stock + delta > 2147483647)
            reject(409, 'STOCK_OVERFLOW', 'Tổng tồn kho không hợp lệ');
          await writeStock(tx, productId, target, payload.stock, 'ADMIN_ADJUSTMENT', payload.reason.trim(), actorUserId);
          await new sql.Request(tx).input('pid', sql.Int, productId).input('delta', sql.Int, delta)
            .query('UPDATE dbo.products SET stock=stock+@delta, updated_at=SYSUTCDATETIME() WHERE id=@pid;');
        }
      }
      if (payload.is_active !== undefined) await new sql.Request(tx).input('vid', sql.Int, target.id)
        .input('active', sql.Bit, payload.is_active)
        .query('UPDATE dbo.product_variants SET is_active=@active, updated_at=SYSUTCDATETIME() WHERE id=@vid;');
    } else if (['add-image', 'update-image', 'delete-image'].includes(action)) {
      if (!color) reject(404, 'COLOR_NOT_FOUND', 'Không tìm thấy màu');
      const images = (await new sql.Request(tx).input('cid', sql.Int, color.id).query(`
        SELECT id, sort_order, is_primary FROM dbo.product_color_images WITH (UPDLOCK, HOLDLOCK)
        WHERE color_id=@cid ORDER BY sort_order,id;`)).recordset;
      if (action === 'add-image') {
        const path = imagePath(payload.image_path);
        const order = payload.sort_order === undefined ? (images.length ? Math.max(...images.map(i => i.sort_order)) + 1 : 0)
          : nonnegative(payload.sort_order, 'INVALID_SORT');
        nonnegative(order, 'INVALID_SORT');
        const primary = payload.is_primary === true || !images.length;
        if (primary) await new sql.Request(tx).input('cid', sql.Int, color.id)
          .query('UPDATE dbo.product_color_images SET is_primary=0 WHERE color_id=@cid;');
        await new sql.Request(tx).input('cid', sql.Int, color.id).input('path', sql.NVarChar(500), path)
          .input('order', sql.Int, order).input('primary', sql.Bit, primary)
          .query(`INSERT INTO dbo.product_color_images (color_id,image_path,sort_order,is_primary)
            VALUES (@cid,@path,@order,@primary);`);
      } else {
        const image = images.find(i => i.id === payload.image_id);
        if (!image) reject(404, 'IMAGE_NOT_FOUND', 'Không tìm thấy ảnh');
        if (action === 'update-image') {
          const order = payload.sort_order === undefined ? image.sort_order : nonnegative(payload.sort_order, 'INVALID_SORT');
          if (payload.is_primary !== undefined && typeof payload.is_primary !== 'boolean')
            reject(400, 'INVALID_PRIMARY', 'Ảnh chính không hợp lệ');
          if (payload.is_primary === false && image.is_primary)
            reject(400, 'PRIMARY_REQUIRED', 'Hãy chọn ảnh chính khác trước');
          if (payload.is_primary === true) await new sql.Request(tx).input('cid', sql.Int, color.id)
            .query('UPDATE dbo.product_color_images SET is_primary=0 WHERE color_id=@cid;');
          await new sql.Request(tx).input('id', sql.Int, image.id).input('order', sql.Int, order)
            .input('primary', sql.Bit, payload.is_primary === undefined ? image.is_primary : payload.is_primary)
            .query('UPDATE dbo.product_color_images SET sort_order=@order,is_primary=@primary WHERE id=@id;');
        } else {
          await new sql.Request(tx).input('id', sql.Int, image.id)
            .query('DELETE FROM dbo.product_color_images WHERE id=@id;');
          if (image.is_primary && images.length > 1) await new sql.Request(tx)
            .input('id', sql.Int, images.find(i => i.id !== image.id).id)
            .query('UPDATE dbo.product_color_images SET is_primary=1 WHERE id=@id;');
        }
      }
    } else reject(400, 'INVALID_ACTION', 'Thao tác không hợp lệ');
    await tx.commit();
    return readColors(pool, productId);
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* transaction already ended */ }
    throw err;
  }
}

module.exports = { ColorError, colorName, swatchHex, imagePath, sku, readColors, changeColors };
