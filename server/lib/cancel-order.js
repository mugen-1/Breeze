'use strict';

const { cancelPendingPayment } = require('./order-payment');
const { sql } = require('../db');
const { canTransition, canCustomerCancel } = require('./order-state');
const { recordInventoryMovement } = require('./inventory-movement');
const { commitHook } = require('./commit-hook');

class CancelError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Cộng lại tồn kho cho mọi item của 1 đơn, trong transaction `tx` của caller (caller đã khoá
// dòng đơn WITH (UPDLOCK, HOLDLOCK)). Dùng chung: huỷ đơn (type 'ORDER_CANCEL') và admin xoá
// đơn chưa rời kho (type 'ORDER_DELETE'). Ghi ledger qua recordInventoryMovement — phải gọi
// TRƯỚC khi DELETE đơn (inventory_movements.order_id có FK tới orders). Lỗi -> ném, caller rollback.
async function restoreOrderStock(tx, { orderId, type, actorUserId = null }) {
  const itemsResult = await new sql.Request(tx)
    .input('id', sql.Int, orderId)
    .query('SELECT product_id, variant_id, quantity FROM dbo.order_items WHERE order_id = @id ORDER BY product_id, variant_id ASC;');
  const items = itemsResult.recordset.sort((a, b) => a.product_id - b.product_id || a.variant_id - b.variant_id);
  if (!items.length) throw new CancelError(500, 'INVENTORY_INTEGRITY', 'Đơn hàng không có sản phẩm để hoàn kho');

  // UPDATE acquires an exclusive row lock. Same product order as checkout;
  // inactive products are intentionally eligible for stock restoration.
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new CancelError(500, 'INVENTORY_INTEGRITY', 'Số lượng sản phẩm trong đơn không hợp lệ');
    }
    const restored = await new sql.Request(tx)
      .input('vid', sql.Int, item.variant_id)
      .input('pid', sql.Int, item.product_id)
      .input('qty', sql.Int, item.quantity)
      .query(`UPDATE dbo.products
        SET stock = stock + @qty, updated_at = SYSUTCDATETIME()
        WHERE id = @pid AND stock <= 2147483647 - @qty;`);
    if (restored.rowsAffected[0] !== 1) {
      throw new CancelError(500, 'INVENTORY_INTEGRITY', 'Không thể hoàn kho cho sản phẩm trong đơn');
    }
    const variant = await new sql.Request(tx)
      .input('vid', sql.Int, item.variant_id)
      .input('pid', sql.Int, item.product_id)
      .input('qty', sql.Int, item.quantity)
      .query(`UPDATE dbo.product_variants SET stock = stock + @qty, updated_at = SYSUTCDATETIME()
        OUTPUT DELETED.stock AS stock_before, INSERTED.stock AS stock_after
        WHERE id = @vid AND product_id = @pid AND stock <= 2147483647 - @qty;`);
    if (variant.rowsAffected[0] !== 1) {
      throw new CancelError(500, 'INVENTORY_INTEGRITY', 'Không thể hoàn kho cho biến thể sản phẩm trong đơn');
    }
    await recordInventoryMovement(tx, { productId: item.product_id, variantId: item.variant_id, orderId,
      type, delta: item.quantity,
      before: variant.recordset[0].stock_before, after: variant.recordset[0].stock_after,
      actorUserId });
  }
  // Danh sách đã cộng lại kho (audit log ORDER_STATUS_CHANGE / ORDER_DELETE dùng, không truy vấn thêm).
  return items.map(item => ({ product_id: item.product_id, variant_id: item.variant_id, quantity: item.quantity }));
}

// Both customer and admin cancellations use this one inventory transaction.
// ownerId is set only for customer requests. Reason is already validated by
// the caller; admin status changes store no reason.
// onCommitting (lib/commit-hook.js): gọi sau khi cộng lại kho + đổi trạng thái + huỷ payment pending,
// ngay trước commit; ctx = { before: { status, user_id }, order_code, restored: [{ product_id, variant_id,
// quantity }] }. order_code lấy từ OUTPUT nhưng KHÔNG nằm trong giá trị trả về (JSON route giữ nguyên).
async function cancelOrder(pool, { orderId, ownerId = null, reason = null, actorUserId = null, onCommitting }) {
  const hook = commitHook({ onCommitting });
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const select = new sql.Request(tx).input('id', sql.Int, orderId);
    if (ownerId !== null) select.input('uid', sql.Int, ownerId);
    const orderResult = await select.query(`
      SELECT id, user_id, status FROM dbo.orders WITH (UPDLOCK, HOLDLOCK)
      WHERE id = @id${ownerId === null ? '' : ' AND user_id = @uid'};`);
    const order = orderResult.recordset[0];
    if (!order) throw new CancelError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng');
    const allowed = ownerId === null
      ? canTransition(order.status, 'cancelled')
      : canCustomerCancel(order.status);
    if (!allowed) throw new CancelError(409, 'ORDER_NOT_CANCELLABLE', 'Đơn hàng không còn có thể hủy');

    const restored = await restoreOrderStock(tx, { orderId, type: 'ORDER_CANCEL',
      actorUserId: actorUserId === null ? ownerId : actorUserId });

    const updated = await new sql.Request(tx)
      .input('id', sql.Int, orderId)
      .input('current', sql.VarChar(20), order.status)
      .input('reason', sql.NVarChar(250), reason)
      .query(`UPDATE dbo.orders
        SET status = 'cancelled',
        shipping_status = CASE WHEN shipping_version = 2 THEN 'cancelled' ELSE shipping_status END, cancel_reason = @reason, cancelled_at = SYSUTCDATETIME()
        OUTPUT INSERTED.id, INSERTED.status, INSERTED.total_amount,
               INSERTED.created_at, INSERTED.cancel_reason, INSERTED.cancelled_at, INSERTED.order_code
        WHERE id = @id AND status = @current;`);
    if (updated.recordset.length !== 1) {
      throw new CancelError(409, 'ORDER_STATUS_CHANGED', 'Trạng thái đơn hàng vừa thay đổi. Vui lòng tải lại.');
    }
    const { order_code: orderCode, ...result } = updated.recordset[0];
    await cancelPendingPayment(tx, orderId);
    if (hook) await hook(tx, result, { before: { status: order.status, user_id: order.user_id }, order_code: orderCode, restored });
    await tx.commit();
    return result;
  } catch (error) {
    try { await tx.rollback(); } catch (_) { /* SQL may already have rolled back */ }
    throw error;
  }
}

module.exports = { cancelOrder, restoreOrderStock, CancelError };
