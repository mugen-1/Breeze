'use strict';
// Dựng before/after cho audit log nhóm sản phẩm. Hàm thuần, không chạm DB — routes/admin.js gọi
// rồi đưa vào audit(tx, req, ...). buildAuditRow (lib/audit.js) tự lọc còn khóa đổi, riêng 'action' luôn giữ.
//   productColumns(row)              -> các cột nghiệp vụ của dbo.products (images parse thành mảng).
//   createSnapshot(row)              -> after của PRODUCT_CREATE: cột vừa INSERT + images_count (không chép ảnh).
//   variantChange(kind, action, ctx, result, payload)
//                                    -> { before, after } của PRODUCT_VARIANT_CHANGE: CHỈ biến thể / màu / ảnh
//                                       bị đụng (so theo id) + product.stock nếu tồn tổng đổi; after.request =
//                                       trường nghiệp vụ của payload theo danh sách cho phép từng action.

const PRODUCT_COLUMNS = Object.freeze(['slug', 'name_vi', 'name_en', 'description_vi', 'description_en', 'price',
  'sale_price', 'currency', 'images', 'category_id', 'stock', 'is_active']);

function parseImages(raw) {
  if (raw == null) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch (_) { return null; }
}
function productColumns(row) {
  const out = {};
  for (const col of PRODUCT_COLUMNS) {
    const v = row[col];
    out[col] = col === 'images' ? parseImages(v) : col === 'is_active' ? !!v : (v === undefined ? null : v);
  }
  return out;
}
function createSnapshot(row) {
  const { images, ...rest } = productColumns(row);
  return { id: row.id, ...rest, images_count: images ? images.length : 0 };
}

// Danh sách trường payload được chép vào after.request, theo `${kind}:${action}`. Phần tử mảng allocations
// cũng chỉ giữ trường cho phép. Không có trong payload -> không ghi.
const REQUEST_FIELDS = Object.freeze({
  'size:configure': ['sizes'],
  'size:allocate': ['allocations'],
  'size:adjust': ['variant_id', 'stock', 'expected_stock', 'is_active', 'reason'],
  'color:create': ['label', 'swatch_hex'],
  'color:update': ['color_id', 'label', 'swatch_hex', 'is_active'],
  'color:add-size': ['size'],
  'color:allocate': ['allocations'],
  'color:adjust': ['variant_id', 'stock', 'expected_stock', 'is_active', 'reason'],
  'color:add-image': ['color_id', 'image_path', 'sort_order', 'is_primary'],
  'color:update-image': ['color_id', 'image_id', 'sort_order', 'is_primary'],
  'color:delete-image': ['color_id', 'image_id'],
});
const ALLOCATION_FIELDS = Object.freeze({
  size: ['variant_id', 'quantity'],
  color: ['source_variant_id', 'target_variant_id', 'quantity', 'expected_source_stock', 'expected_target_stock'],
});
function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj && Object.hasOwn(obj, f) && obj[f] !== undefined) out[f] = obj[f];
  return out;
}
function requestOf(kind, action, payload) {
  const fields = REQUEST_FIELDS[`${kind}:${action}`];
  if (!fields) throw new Error(`product-audit: không có danh sách request cho ${kind}:${action}`);
  const out = pick(payload, fields);
  if (Array.isArray(out.allocations)) out.allocations = out.allocations.map(a => pick(a, ALLOCATION_FIELDS[kind]));
  return out;
}

const variantView = v => ({ id: v.id, size: v.size == null ? null : v.size, color: v.color == null ? null : v.color,
  stock: v.stock, is_active: !!v.is_active });
const colorView = c => ({ id: c.id, label: c.label, swatch_hex: c.swatch_hex == null ? null : c.swatch_hex, is_active: !!c.is_active });
const imageView = i => ({ id: i.id, color_id: i.color_id, image_path: i.image_path, sort_order: i.sort_order, is_primary: !!i.is_primary });

// So 2 danh sách theo id: giữ phần tử mới, bị xoá, hoặc có trường khác nhau. allowRemoved=false: phần tử chỉ
// có ở trước (vd biến thể có màu không nằm trong readSizes) KHÔNG tính là bị xoá.
function touched(beforeList, afterList, view, allowRemoved) {
  const b = new Map(beforeList.map(x => [x.id, view(x)])), a = new Map(afterList.map(x => [x.id, view(x)]));
  const ids = [...new Set([...a.keys(), ...(allowRemoved ? b.keys() : [])])].sort((x, y) => x - y);
  const out = { before: [], after: [] };
  for (const id of ids) {
    const was = b.get(id), now = a.get(id);
    if (was && now && JSON.stringify(was) === JSON.stringify(now)) continue;
    if (was) out.before.push(was);
    if (now) out.after.push(now);
  }
  return out;
}

function variantChange(kind, action, ctx, result, payload) {
  if (kind !== 'size' && kind !== 'color') throw new Error('product-audit: kind phải là size hoặc color');
  const prev = (ctx && ctx.before) || {};
  const before = { action }, after = { action };
  const put = (key, pair) => { if (pair.before.length) before[key] = pair.before; if (pair.after.length) after[key] = pair.after; };
  if (prev.product && result.product && prev.product.stock !== result.product.stock) {
    before.product = { stock: prev.product.stock }; after.product = { stock: result.product.stock };
  }
  if (kind === 'color') put('colors', touched(prev.colors || [], (result.colors || []).map(({ variants, images, ...c }) => c), colorView, false));
  put('variants', touched(prev.variants || [], result.variants || [], variantView, false));
  if (kind === 'color' && prev.images) {
    const colorId = payload && payload.color_id;
    const now = (result.colors || []).flatMap(c => c.images || []).filter(i => i.color_id === colorId);
    put('images', touched(prev.images, now, imageView, true));
  }
  after.request = requestOf(kind, action, payload);
  return { before, after };
}

module.exports = { PRODUCT_COLUMNS, REQUEST_FIELDS, productColumns, createSnapshot, variantChange };
