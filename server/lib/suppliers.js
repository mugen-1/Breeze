'use strict';
// Nhà cung cấp — hàm thuần (không chạm DB): chuẩn hoá + kiểm dữ liệu khớp CHECK của 029, kiểm query danh sách, DTO.
// Route: routes/admin-suppliers.js. Lỗi -> SupplierError(status, code, message, field) để route trả
// { status: 'error', code, message, field? }.
//   parseSupplierCreate(body) -> { values }            (code, name bắt buộc; tuỳ chọn trống -> null)
//   parseSupplierUpdate(body) -> { code, updates }      (sửa từng phần; code chỉ để so với mã hiện tại)
//   parseStatusInput(body)    -> boolean                (is_active phải là boolean thật)
//   parseListQuery(query)     -> { page, limit, status, q }
// Chuỗi như '<img src=x onerror=alert(1)>' lưu NGUYÊN VĂN — thoát ký tự là việc của giao diện.

class SupplierError extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.status = status; this.code = code;
    if (field) this.field = field;
  }
}
const invalid = (message, field) => new SupplierError(400, 'SUPPLIER_INVALID_INPUT', message, field);

// Cột nghiệp vụ theo thứ tự hiển thị. code không sửa được sau khi tạo.
const FIELDS = Object.freeze(['code', 'name', 'contact_name', 'phone', 'email', 'address', 'tax_code', 'note']);
const EDITABLE_FIELDS = Object.freeze(FIELDS.filter(f => f !== 'code'));
const LABELS = Object.freeze({ code: 'Mã nhà cung cấp', name: 'Tên nhà cung cấp', contact_name: 'Người liên hệ',
  phone: 'Số điện thoại', email: 'Email', address: 'Địa chỉ', tax_code: 'Mã số thuế', note: 'Ghi chú' });
const STATUS_HINT = 'Đổi trạng thái hợp tác dùng PATCH /api/admin/suppliers/:id/status';

const isBlank = raw => raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
const ASCII_VISIBLE = /^[\x21-\x7E]+$/;

// Mỗi validator nhận chuỗi đã trim, không rỗng; trả giá trị đã chuẩn hoá hoặc ném SupplierError.
const RULES = Object.freeze({
  // Kiểm ASCII trên chuỗi GỐC trước khi viết hoa: toUpperCase đổi vài ký tự ngoài ASCII thành ASCII
  // ('ı' -> 'I', 'ß' -> 'SS'), không kiểm trước thì 'ncc-ı' lọt thành 'NCC-I'.
  code: s => {
    const v = /^[A-Za-z0-9-]+$/.test(s) ? s.toUpperCase() : '';
    if (!/^[A-Z0-9-]{2,20}$/.test(v)) throw invalid('Mã nhà cung cấp gồm 2–20 ký tự chữ in hoa, số hoặc dấu gạch ngang', 'code');
    return v;
  },
  name: s => maxLen(s, 200, 'name'),
  contact_name: s => maxLen(s, 120, 'contact_name'),
  phone: s => {
    const v = s.replace(/ /g, '');
    if (!/^[0-9+]{8,20}$/.test(v)) throw invalid('Số điện thoại gồm 8–20 chữ số hoặc dấu +', 'phone');
    return v;
  },
  email: s => {
    maxLen(s, 255, 'email');
    if (!ASCII_VISIBLE.test(s) || !/^[^@]+@[^@]+\.[^@]+$/.test(s)) throw invalid('Email không đúng định dạng', 'email');
    return s;
  },
  address: s => maxLen(s, 300, 'address'),
  tax_code: s => {
    if (!/^[0-9-]{10,14}$/.test(s)) throw invalid('Mã số thuế gồm 10–14 chữ số hoặc dấu gạch ngang', 'tax_code');
    return s;
  },
  note: s => maxLen(s, 500, 'note'),
});
function maxLen(s, max, field) {
  if (s.length > max) throw invalid(`${LABELS[field]} tối đa ${max} ký tự`, field);
  return s;
}

const REQUIRED = new Set(['code', 'name']);
function field(name, raw) {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') throw invalid(`${LABELS[name]} phải là chuỗi`, name);
  if (isBlank(raw)) {
    if (REQUIRED.has(name)) throw invalid(`${LABELS[name]} không được để trống`, name);
    return null;
  }
  return RULES[name](raw.trim());
}

function bodyOf(body) {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) throw invalid('Dữ liệu gửi lên không hợp lệ');
  return body;
}
function rejectIsActive(b, message) {
  if (Object.hasOwn(b, 'is_active')) throw invalid(message, 'is_active');
}

function parseSupplierCreate(body) {
  const b = bodyOf(body);
  rejectIsActive(b, 'Nhà cung cấp mới luôn ở trạng thái đang hợp tác. ' + STATUS_HINT);
  const values = {};
  for (const f of FIELDS) values[f] = field(f, b[f]);
  return { values };
}

// Chỉ trường CÓ trong body mới cập nhật. code: undefined nếu không gửi; có gửi thì phải hợp lệ
// (route so với mã hiện tại -> khác thì SUPPLIER_CODE_IMMUTABLE). Không có trường sửa được -> updates rỗng.
function parseSupplierUpdate(body) {
  const b = bodyOf(body);
  rejectIsActive(b, STATUS_HINT);
  const code = Object.hasOwn(b, 'code') ? field('code', b.code) : undefined;
  const updates = {};
  for (const f of EDITABLE_FIELDS) if (Object.hasOwn(b, f)) updates[f] = field(f, b[f]);
  return { code, updates };
}

function parseStatusInput(body) {
  const b = bodyOf(body);
  if (typeof b.is_active !== 'boolean') throw invalid('is_active phải là true hoặc false', 'is_active');
  return b.is_active;
}

const MAX_INT = 2147483647;
const positiveInt = s => (typeof s === 'string' && /^[1-9]\d*$/.test(s) && Number(s) <= MAX_INT ? Number(s) : null);
function parseId(raw) {
  const id = positiveInt(raw);
  if (id === null) throw invalid('Mã nhà cung cấp không hợp lệ', 'id');
  return id;
}

const LIST_STATUSES = Object.freeze(['active', 'inactive', 'all']);
const DEFAULT_LIMIT = 20, MAX_LIMIT = 50, MAX_Q = 100;
function parseListQuery(query) {
  const q = query || {};
  const read = name => {
    const v = q[name];
    if (v === undefined || v === '') return null;
    if (typeof v !== 'string') throw invalid(name + ' không hợp lệ', name);
    return v;
  };
  const pageRaw = read('page'), limitRaw = read('limit'), statusRaw = read('status'), qRaw = read('q');
  const page = pageRaw === null ? 1 : positiveInt(pageRaw);
  if (page === null) throw invalid('page không hợp lệ', 'page');
  const limit = limitRaw === null ? DEFAULT_LIMIT : positiveInt(limitRaw);
  if (limit === null || limit > MAX_LIMIT) throw invalid(`limit phải từ 1 đến ${MAX_LIMIT}`, 'limit');
  const status = statusRaw === null ? 'all' : statusRaw;
  if (!LIST_STATUSES.includes(status)) throw invalid('status phải là active, inactive hoặc all', 'status');
  const text = qRaw === null ? '' : qRaw.trim();
  if (text.length > MAX_Q) throw invalid(`Từ khoá tối đa ${MAX_Q} ký tự`, 'q');
  return { page, limit, status, q: text || null };
}

// Mẫu LIKE "chứa": thoát % _ [ để khớp nguyên văn. Mẫu SĐT bỏ dấu cách (SĐT lưu không có dấu cách).
const escapeLike = s => s.replace(/[%_[]/g, ch => '[' + ch + ']');
function searchPatterns(q) {
  if (!q) return null;
  return { text: '%' + escapeLike(q) + '%', phone: '%' + escapeLike(q.replace(/ /g, '')) + '%' };
}

const COLUMNS = Object.freeze(['id', ...FIELDS, 'is_active', 'created_at', 'updated_at']);
const iso = v => (v == null ? null : new Date(v).toISOString());
function toSupplierDto(row) {
  const out = { id: row.id };
  for (const f of FIELDS) out[f] = row[f] == null ? null : row[f];
  out.is_active = !!row.is_active;
  out.created_at = iso(row.created_at);
  out.updated_at = iso(row.updated_at);
  return out;
}

module.exports = {
  SupplierError, FIELDS, EDITABLE_FIELDS, COLUMNS, LIST_STATUSES, DEFAULT_LIMIT, MAX_LIMIT, MAX_Q,
  parseSupplierCreate, parseSupplierUpdate, parseStatusInput, parseId, parseListQuery, escapeLike, searchPatterns, toSupplierDto,
};
