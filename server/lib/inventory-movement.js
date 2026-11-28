'use strict';

const { sql } = require('../db');

// Variant alias must be v. Read committed transfer history, not current stock:
// sales, cancellations and manual adjustments must not replace the last transfer.
const LAST_ALLOCATION_SQL = `(SELECT TOP (1) m.quantity_delta
  FROM dbo.inventory_movements m
  WHERE m.product_id = v.product_id AND m.variant_id = v.id
    AND m.movement_type = 'VARIANT_TRANSFER_IN' AND m.quantity_delta > 0
  ORDER BY m.created_at DESC, m.id DESC)`;

// Call only inside the same transaction that changes variant stock and its product aggregate.
// data.receiptId: chỉ loại PURCHASE_RECEIPT (CK_inventory_movements_receipt, 029). Có receiptId mới đưa cột
// receipt_id vào câu INSERT; không có -> câu INSERT y như trước 029, để checkout / huỷ đơn / sửa tồn không phụ thuộc
// việc DB đã chạy migration 029 hay chưa.
async function recordInventoryMovement(tx, data) {
  const withReceipt = data.receiptId != null;
  const request = new sql.Request(tx)
    .input('pid', sql.Int, data.productId)
    .input('vid', sql.Int, data.variantId)
    .input('oid', sql.Int, data.orderId || null)
    .input('oref', sql.Int, data.orderId || null)
    .input('type', sql.VarChar(30), data.type)
    .input('delta', sql.Int, data.delta)
    .input('before', sql.Int, data.before)
    .input('after', sql.Int, data.after)
    .input('reason', sql.NVarChar(250), data.reason || null)
    .input('actor', sql.Int, data.actorUserId || null);
  if (withReceipt) request.input('rid', sql.Int, data.receiptId);
  return request.query(`INSERT INTO dbo.inventory_movements
      (product_id, variant_id, order_id, order_reference_id, ${withReceipt ? 'receipt_id, ' : ''}movement_type, quantity_delta,
       stock_before, stock_after, reason, actor_user_id)
      VALUES (@pid, @vid, @oid, @oref, ${withReceipt ? '@rid, ' : ''}@type, @delta, @before, @after, @reason, @actor);`);
}

module.exports = { recordInventoryMovement, LAST_ALLOCATION_SQL };
