'use strict';
// Dựng before/after cho audit log nhóm phiếu nhập. Hàm thuần, không chạm DB — routes/admin-receipts.js gọi rồi
// đưa vào audit(tx, req, ...). buildAuditRow (lib/audit.js) tự lọc còn khóa đổi ('items' đổi -> log cả mảng 2 phía).
//   itemsView(rows)                 -> [{ product_id, variant_id, sku, quantity, unit_cost }] theo thứ tự dòng trong phiếu.
//   createSnapshot(receipt, items)  -> after của RECEIPT_CREATE.
//   updateSnapshot(receipt, items)  -> before / after của RECEIPT_UPDATE (không có id / code / status).
//   statusChange(from, to, extra)   -> { before: { status }, after: { status, ...extra } } cho SUBMIT / APPROVE / REJECT / CANCEL.
// receipt: { id, code, supplier_id, status, note, expected_date } — expected_date là 'YYYY-MM-DD' / Date / null.

const ymd = v => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
function itemsView(rows) {
  return rows.map(r => ({ product_id: r.product_id, variant_id: r.variant_id, sku: r.sku != null ? r.sku : r.sku_snapshot,
    quantity: r.quantity, unit_cost: r.unit_cost }));
}
function updateSnapshot(receipt, items) {
  return { supplier_id: receipt.supplier_id, note: receipt.note == null ? null : receipt.note,
    expected_date: ymd(receipt.expected_date), items: itemsView(items) };
}
function createSnapshot(receipt, items) {
  const { supplier_id, note, expected_date, items: list } = updateSnapshot(receipt, items);
  return { id: receipt.id, code: receipt.code, supplier_id, status: receipt.status, note, expected_date, items: list };
}
function statusChange(from, to, extra = {}) {
  return { before: { status: from }, after: { status: to, ...extra } };
}

module.exports = { itemsView, createSnapshot, updateSnapshot, statusChange };
