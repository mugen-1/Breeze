'use strict';
// Dựng before/after cho audit log nhóm nhà cung cấp. Hàm thuần, không chạm DB — routes/admin-suppliers.js gọi
// rồi đưa vào audit(tx, req, ...). buildAuditRow (lib/audit.js) tự lọc còn khóa đổi.
//   supplierColumns(row) -> 9 cột nghiệp vụ của dbo.suppliers (is_active -> boolean); không có created_at / updated_at.
//   createSnapshot(row)  -> after của SUPPLIER_CREATE: id + 9 cột.
//   statusChange(was, now) -> { before, after } của SUPPLIER_STATUS: chỉ is_active.
// phone / address được giữ: lib/audit.js chỉ lọc 2 khoá này khi người thao tác là khách.

const SUPPLIER_COLUMNS = Object.freeze(['code', 'name', 'contact_name', 'phone', 'email', 'address', 'tax_code', 'note',
  'is_active']);

function supplierColumns(row) {
  const out = {};
  for (const col of SUPPLIER_COLUMNS) {
    const v = row[col];
    out[col] = col === 'is_active' ? !!v : (v === undefined ? null : v);
  }
  return out;
}
function createSnapshot(row) {
  return { id: row.id, ...supplierColumns(row) };
}
function statusChange(wasActive, isActive) {
  return { before: { is_active: !!wasActive }, after: { is_active: !!isActive } };
}

module.exports = { SUPPLIER_COLUMNS, supplierColumns, createSnapshot, statusChange };
