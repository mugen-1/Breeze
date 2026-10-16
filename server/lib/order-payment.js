'use strict';

const { sql } = require('../db');
const COLUMNS = 'id, order_id, transaction_code, payment_method, amount, status, created_at, paid_at';

async function createPayment(tx, orderId) {
  const result = await new sql.Request(tx).input('oid', sql.Int, orderId).query(`
    INSERT INTO dbo.payment_transactions(order_id, transaction_code, payment_method, amount)
    OUTPUT ${COLUMNS.split(', ').map(c => 'INSERTED.' + c).join(', ')}
    SELECT id, CONCAT('PAY-', order_code, '-001'), PaymentMethod, total_amount
    FROM dbo.orders WHERE id = @oid AND order_code IS NOT NULL;`);
  if (result.recordset.length !== 1) throw new Error('PAYMENT_CREATE_FAILED');
  return result.recordset[0];
}

async function fetchPayments(pool, orderIds) {
  if (!orderIds.length) return {};
  const request = pool.request();
  const names = orderIds.map((id, i) => { request.input('p' + i, sql.Int, id); return '@p' + i; });
  const result = await request.query(`SELECT ${COLUMNS} FROM dbo.payment_transactions
    WHERE order_id IN (${names.join(', ')});`);
  return Object.fromEntries(result.recordset.map(p => [p.order_id, p]));
}

// Callers hold the order lock and use the same SQL transaction as the order update.
async function completeCodPayment(tx, orderId) {
  await new sql.Request(tx).input('oid', sql.Int, orderId).query(`
    UPDATE dbo.payment_transactions SET status = 'paid', paid_at = SYSUTCDATETIME()
    WHERE order_id = @oid AND payment_method = 'cod' AND status = 'pending';`);
}
async function cancelPendingPayment(tx, orderId) {
  await new sql.Request(tx).input('oid', sql.Int, orderId).query(`
    UPDATE dbo.payment_transactions SET status = 'cancelled'
    WHERE order_id = @oid AND status = 'pending';`);
}

module.exports = { COLUMNS, createPayment, fetchPayments, completeCodPayment, cancelPendingPayment };
