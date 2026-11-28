'use strict';
// Phiếu nhập kho — hàm thuần (không chạm DB). Route: routes/admin-receipts.js. Bảng: migration 029.
//   canTransition(from, action) / nextStatus(from, action) — bảng chuyển trạng thái:
//       update  draft -> draft          submit  draft -> pending        approve pending -> approved
//       reject  pending -> draft        cancel  draft | pending | approved -> cancelled
//       receive approved -> received
//   cancelNeedsApprove(status) — huỷ phiếu đã duyệt cần receipt:approve (huỷ nháp / chờ duyệt chỉ cần receipt:create).
//   parseReceiptInput(body), parseReason(body), parseListQuery(query), parseId(raw), parseProductId(raw).
//   productMode(product), isLeafVariant(product, variant), checkItems(items, products, variants).
// "Biến thể lá" chỉ xét CẤU TRÚC theo chế độ sản phẩm (BASE / size trong profile / màu / size + màu), KHÔNG xét
// is_active của sản phẩm / biến thể / màu: hàng đang tắt vẫn nhập kho được (danh sách trả kèm cờ để giao diện cảnh báo).
const { sizeProfile } = require('./size-variants');
const { escapeLike } = require('./suppliers');

class ReceiptError extends Error {
  // extra: field, index, current_status, items — chỉ các khoá này được đưa ra response.
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status; this.code = code; this.extra = extra;
  }
}
const invalid = (message, field, index) => new ReceiptError(400, 'RECEIPT_INVALID_INPUT', message,
  { ...(field ? { field } : {}), ...(index === undefined ? {} : { index }) });

const STATUSES = Object.freeze(['draft', 'pending', 'approved', 'received', 'cancelled']);
const TRANSITIONS = Object.freeze({
  update: Object.freeze({ from: Object.freeze(['draft']), to: 'draft' }),
  submit: Object.freeze({ from: Object.freeze(['draft']), to: 'pending' }),
  approve: Object.freeze({ from: Object.freeze(['pending']), to: 'approved' }),
  reject: Object.freeze({ from: Object.freeze(['pending']), to: 'draft' }),
  cancel: Object.freeze({ from: Object.freeze(['draft', 'pending', 'approved']), to: 'cancelled' }),
  receive: Object.freeze({ from: Object.freeze(['approved']), to: 'received' }),
});
function canTransition(from, action) {
  return Object.hasOwn(TRANSITIONS, action) && TRANSITIONS[action].from.includes(from);
}
function nextStatus(from, action) {
  return canTransition(from, action) ? TRANSITIONS[action].to : null;
}
const cancelNeedsApprove = status => status === 'approved';

const MAX_INT = 2147483647;
const MAX_ITEMS = 200, MAX_QUANTITY = 100000, MAX_UNIT_COST = 1000000000;
const MAX_NOTE = 500, MAX_REASON = 250, MAX_Q = 100, DEFAULT_LIMIT = 20, MAX_LIMIT = 50;
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// Số nguyên kiểu JSON number trong [min, max]; chuỗi '5' không nhận.
const intIn = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const positiveIntString = s => (typeof s === 'string' && /^[1-9]\d*$/.test(s) && Number(s) <= MAX_INT ? Number(s) : null);
// products.id bắt đầu từ 0 (seed, cùng quy ước PUT /api/admin/products/:id nhận id >= 0); variant / supplier / phiếu từ 1.
const productIdString = s => (s === '0' ? 0 : positiveIntString(s));

function parseId(raw) {
  const id = positiveIntString(raw);
  if (id === null) throw invalid('Mã phiếu nhập không hợp lệ', 'id');
  return id;
}
function parseProductId(raw) {
  if (Array.isArray(raw)) throw invalid('product_id không hợp lệ', 'product_id');
  const id = productIdString(raw);
  if (id === null) throw invalid('product_id không hợp lệ', 'product_id');
  return id;
}

// 'YYYY-MM-DD' là ngày có thật trong phạm vi DATE của SQL Server (năm 0001 trở đi); không chặn ngày quá khứ.
function parseDate(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw invalid('expected_date phải có dạng YYYY-MM-DD', 'expected_date');
  const d = new Date(raw + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw || raw.slice(0, 4) === '0000') {
    throw invalid('expected_date không phải ngày hợp lệ', 'expected_date');
  }
  return raw;
}
function parseNote(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw invalid('Ghi chú phải là chuỗi', 'note');
  const s = raw.trim();
  if (s.length > MAX_NOTE) throw invalid(`Ghi chú tối đa ${MAX_NOTE} ký tự`, 'note');
  return s || null;
}

// Body của tạo và sửa (sửa = thay toàn bộ): { supplier_id, note?, expected_date?, items: [{ product_id, variant_id,
// quantity, unit_cost }] }. Tên / SKU / size / màu KHÔNG lấy từ client — route đọc từ DB lúc lưu.
function parseReceiptInput(body) {
  if (!isPlainObject(body)) throw invalid('Dữ liệu gửi lên không hợp lệ');
  if (!intIn(body.supplier_id, 1, MAX_INT)) throw invalid('supplier_id phải là số nguyên dương', 'supplier_id');
  const note = parseNote(body.note);
  const expectedDate = parseDate(body.expected_date);
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('Phiếu nhập cần ít nhất 1 dòng hàng', 'items');
  if (raw.length > MAX_ITEMS) throw invalid(`Phiếu nhập tối đa ${MAX_ITEMS} dòng hàng`, 'items');
  const seen = new Set();
  const items = raw.map((it, index) => {
    if (!isPlainObject(it)) throw invalid('Dòng hàng không hợp lệ', 'items', index);
    if (!intIn(it.product_id, 0, MAX_INT)) throw invalid('product_id phải là số nguyên >= 0', 'product_id', index);
    if (!intIn(it.variant_id, 1, MAX_INT)) throw invalid('variant_id phải là số nguyên dương', 'variant_id', index);
    if (!intIn(it.quantity, 1, MAX_QUANTITY)) throw invalid(`Số lượng phải là số nguyên từ 1 đến ${MAX_QUANTITY}`, 'quantity', index);
    if (!intIn(it.unit_cost, 0, MAX_UNIT_COST)) throw invalid(`Giá nhập phải là số nguyên từ 0 đến ${MAX_UNIT_COST}`, 'unit_cost', index);
    if (seen.has(it.variant_id)) throw invalid('Một biến thể chỉ được có 1 dòng trong phiếu', 'variant_id', index);
    seen.add(it.variant_id);
    return { product_id: it.product_id, variant_id: it.variant_id, quantity: it.quantity, unit_cost: it.unit_cost };
  });
  return { supplierId: body.supplier_id, note, expectedDate, items };
}

function parseReason(body) {
  const raw = isPlainObject(body) ? body.reason : undefined;
  if (typeof raw !== 'string' || raw.trim() === '') throw invalid('Bắt buộc nhập lý do', 'reason');
  const s = raw.trim();
  if (s.length > MAX_REASON) throw invalid(`Lý do tối đa ${MAX_REASON} ký tự`, 'reason');
  return s;
}

const LIST_STATUSES = Object.freeze([...STATUSES, 'all']);
function parseListQuery(query) {
  const q = query || {};
  const read = name => {
    const v = q[name];
    if (v === undefined || v === '') return null;
    if (typeof v !== 'string') throw invalid(name + ' không hợp lệ', name);
    return v;
  };
  const pageRaw = read('page'), limitRaw = read('limit'), statusRaw = read('status'), supplierRaw = read('supplier_id'), qRaw = read('q');
  const page = pageRaw === null ? 1 : positiveIntString(pageRaw);
  if (page === null) throw invalid('page không hợp lệ', 'page');
  const limit = limitRaw === null ? DEFAULT_LIMIT : positiveIntString(limitRaw);
  if (limit === null || limit > MAX_LIMIT) throw invalid(`limit phải từ 1 đến ${MAX_LIMIT}`, 'limit');
  const status = statusRaw === null ? 'all' : statusRaw;
  if (!LIST_STATUSES.includes(status)) throw invalid('status không hợp lệ', 'status');
  const supplierId = supplierRaw === null ? null : positiveIntString(supplierRaw);
  if (supplierRaw !== null && supplierId === null) throw invalid('supplier_id không hợp lệ', 'supplier_id');
  const text = qRaw === null ? '' : qRaw.trim();
  if (text.length > MAX_Q) throw invalid(`Từ khoá tối đa ${MAX_Q} ký tự`, 'q');
  return { page, limit, status, supplierId, q: text ? '%' + escapeLike(text) + '%' : null };
}

// ---- biến thể lá theo chế độ sản phẩm ----
// product: { slug, category_slug, size_configured, color_configured }.
// variant: { product_id, is_base, size, color, color_exists } — color_exists: màu (color_key) có trong product_colors.
function productMode(product) {
  if (product.color_configured) return product.size_configured ? 'size_color' : 'color';
  return product.size_configured ? 'size' : 'base';
}
function isLeafVariant(product, variant) {
  if (!product || !variant) return false;
  const sizes = sizeProfile(product).sizes;
  switch (productMode(product)) {
    case 'size_color': return !variant.is_base && variant.color != null && !!variant.color_exists && sizes.includes(variant.size);
    case 'color': return !variant.is_base && variant.color != null && !!variant.color_exists && variant.size == null;
    case 'size': return !variant.is_base && variant.color == null && sizes.includes(variant.size);
    default: return !!variant.is_base;
  }
}
// items: [{ product_id, variant_id }] theo thứ tự trong phiếu; products: Map<id, product>; variants: Map<id, variant>.
// -> [{ index, product_id, variant_id, reason }] với reason NOT_FOUND | PRODUCT_MISMATCH | NOT_LEAF; rỗng = hợp lệ.
function checkItems(items, products, variants) {
  const out = [];
  items.forEach((it, index) => {
    const v = variants.get(it.variant_id), p = products.get(it.product_id);
    const reason = !v || !p ? 'NOT_FOUND' : v.product_id !== it.product_id ? 'PRODUCT_MISMATCH' : !isLeafVariant(p, v) ? 'NOT_LEAF' : null;
    if (reason) out.push({ index, product_id: it.product_id, variant_id: it.variant_id, reason });
  });
  return out;
}
// Thứ tự hiển thị biến thể lá: theo size của profile, rồi theo id màu, rồi id biến thể.
function sortLeafVariants(product, variants) {
  const sizes = sizeProfile(product).sizes;
  const sizeRank = v => (v.size == null ? -1 : sizes.indexOf(v.size));
  return variants.slice().sort((a, b) => sizeRank(a) - sizeRank(b) || (a.color_id || 0) - (b.color_id || 0) || a.id - b.id);
}

// ---- DTO ----
// 6 mốc người thao tác: cột <mốc>_by / <mốc>_at của purchase_receipts; route JOIN users thành <mốc>_user (id còn tồn tại),
// <mốc>_name, <mốc>_email. created_by / ... không có FK: user đã xoá -> deleted true (giao diện hiện "Tài khoản đã xóa").
const ACTORS = Object.freeze(['created', 'submitted', 'approved', 'rejected', 'received', 'cancelled']);
const iso = v => (v == null ? null : new Date(v).toISOString());
const ymd = v => (v == null ? null : new Date(v).toISOString().slice(0, 10));
const num = v => (v == null ? 0 : Number(v)); // SUM BIGINT của mssql về dạng chuỗi
// canSeeEmail: chỉ người có user:view_admin_detail mới thấy email (staff không xem thông tin tài khoản admin).
function actorOf(row, key, { canSeeEmail }) {
  const id = row[key + '_by'];
  if (id == null) return null;
  const found = row[key + '_user'] != null;
  return { id, display_name: found && row[key + '_name'] != null ? row[key + '_name'] : null,
    email: found && canSeeEmail && row[key + '_email'] != null ? row[key + '_email'] : null,
    deleted: !found, at: iso(row[key + '_at']) };
}
const supplierOf = row => ({ id: row.supplier_id, code: row.supplier_code, name: row.supplier_name, is_active: !!row.supplier_active });
function toReceiptDetail(row, itemRows, opts) {
  const items = itemRows.map(i => ({ id: i.id, product_id: i.product_id, variant_id: i.variant_id, name: i.name_snapshot,
    sku: i.sku_snapshot, size: i.size_snapshot == null ? null : i.size_snapshot, color: i.color_snapshot == null ? null : i.color_snapshot,
    quantity: i.quantity, unit_cost: i.unit_cost, line_total: i.quantity * i.unit_cost }));
  const actors = {};
  for (const k of ACTORS) actors[k] = actorOf(row, k, opts);
  return { id: row.id, code: row.code, status: row.status, supplier: supplierOf(row), note: row.note == null ? null : row.note,
    expected_date: ymd(row.expected_date), reject_reason: row.reject_reason == null ? null : row.reject_reason,
    cancel_reason: row.cancel_reason == null ? null : row.cancel_reason, created_at: iso(row.created_at), updated_at: iso(row.updated_at),
    actors, items, item_count: items.length, total_quantity: items.reduce((s, i) => s + i.quantity, 0),
    total_cost: items.reduce((s, i) => s + i.line_total, 0) };
}
function toReceiptListRow(row, opts) {
  return { id: row.id, code: row.code, status: row.status, supplier: supplierOf(row), item_count: num(row.item_count),
    total_quantity: num(row.total_quantity), total_cost: num(row.total_cost), expected_date: ymd(row.expected_date),
    created_at: iso(row.created_at), updated_at: iso(row.updated_at), created_by: actorOf(row, 'created', opts) };
}
// 'YYYY-MM-DD' -> Date lúc 00:00 UTC cho tham số sql.Date (mssql dùng UTC); null giữ null.
const dateParam = s => (s == null ? null : new Date(s + 'T00:00:00Z'));

module.exports = {
  ReceiptError, STATUSES, LIST_STATUSES, TRANSITIONS, ACTORS, MAX_ITEMS, MAX_QUANTITY, MAX_UNIT_COST, MAX_REASON,
  canTransition, nextStatus, cancelNeedsApprove, parseId, parseProductId, parseReceiptInput, parseReason, parseListQuery,
  productMode, isLeafVariant, checkItems, sortLeafVariants, toReceiptDetail, toReceiptListRow, dateParam,
};
