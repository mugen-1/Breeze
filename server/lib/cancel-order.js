'use strict';

const { cancelPendingPayment } = require('./order-payment');
const { sql } = require('../db');
const { canTransition, canCustomerCancel } = require('./order-state');
const { recordInventoryMovement } = require('./inventory-movement');

class CancelError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Both customer and admin cancellations use this one inventory transaction.
// ownerId is set only for customer requests. Reason is already validated by
// the caller; admin status changes store no reason.
async function cancelOrder(pool, { orderId, ownerId = null, reason = null, actorUserId = null }) {
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
        type: 'ORDER_CANCEL', delta: item.quantity,
        before: variant.recordset[0].stock_before, after: variant.recordset[0].stock_after,
        actorUserId: actorUserId === null ? ownerId : actorUserId });
    }

    const updated = await new sql.Request(tx)
      .input('id', sql.Int, orderId)
      .input('current', sql.VarChar(20), order.status)
      .input('reason', sql.NVarChar(250), reason)
      .query(`UPDATE dbo.orders
        SET status = 'cancelled',
        shipping_status = CASE WHEN shipping_version = 2 THEN 'cancelled' ELSE shipping_status END, cancel_reason = @reason, cancelled_at = SYSUTCDATETIME()
        OUTPUT INSERTED.id, INSERTED.status, INSERTED.total_amount,
               INSERTED.created_at, INSERTED.cancel_reason, INSERTED.cancelled_at
        WHERE id = @id AND status = @current;`);
    if (updated.recordset.length !== 1) {
      throw new CancelError(409, 'ORDER_STATUS_CHANGED', 'Trạng thái đơn hàng vừa thay đổi. Vui lòng tải lại.');
    }
    await cancelPendingPayment(tx, orderId);
    await tx.commit();
    return updated.recordset[0];
  } catch (error) {
    try { await tx.rollback(); } catch (_) { /* SQL may already have rolled back */ }
    throw error;
  }
}

module.exports = { cancelOrder, CancelError };
