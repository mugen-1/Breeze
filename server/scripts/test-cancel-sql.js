'use strict';

// Real SQL Server race test on disposable tables; never touches shop orders or products.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { getPool, sql } = require('../db');
const suffix = `${process.pid}_${Date.now()}`;
const orders = `[dbo].[__breeze_cancel_orders_${suffix}]`;
const products = `[dbo].[__breeze_cancel_products_${suffix}]`;
let pool, createdOrders = false, createdProducts = false;
const active = new Set();

async function cancel({ onLocked } = {}) {
  const tx = new sql.Transaction(pool);
  active.add(tx);
  try {
    await tx.begin();
    const current = await new sql.Request(tx).query(
      `SELECT status FROM ${orders} WITH (UPDLOCK, HOLDLOCK) WHERE id = 1;`);
    if (onLocked) await onLocked();
    if (current.recordset[0].status !== 'pending') {
      await tx.rollback(); active.delete(tx);
      return { status: 409, restored: 0 };
    }
    const restored = await new sql.Request(tx).query(
      `UPDATE ${products} SET stock = stock + 2 WHERE id = 1 AND stock <= 2147483645;`);
    assert.equal(restored.rowsAffected[0], 1);
    const changed = await new sql.Request(tx).query(
      `UPDATE ${orders} SET status = 'cancelled' WHERE id = 1 AND status = 'pending';`);
    assert.equal(changed.rowsAffected[0], 1);
    await tx.commit(); active.delete(tx);
    return { status: 200, restored: restored.rowsAffected[0] };
  } catch (error) {
    try { await tx.rollback(); } catch (_) { /* already rolled back */ }
    active.delete(tx);
    throw error;
  }
}

async function main() {
  try {
    pool = await getPool();
    const audit = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.orders WHERE status = 'cancelled' AND cancelled_at IS NULL) AS historical_cancelled,
        (SELECT COUNT(*) FROM dbo.order_items oi LEFT JOIN dbo.products p ON p.id = oi.product_id WHERE p.id IS NULL) AS missing_products,
        (SELECT COUNT(DISTINCT o.id) FROM dbo.orders o JOIN dbo.order_items oi ON oi.order_id = o.id
         LEFT JOIN dbo.products p ON p.id = oi.product_id
         WHERE o.status IN ('pending', 'confirmed', 'paid') AND p.id IS NULL) AS cancellable_orders_missing_product;`);
    console.log('Existing historical cancellations / orphan items / cancellable orders with orphan items:',
      audit.recordset[0].historical_cancelled, '/', audit.recordset[0].missing_products,
      '/', audit.recordset[0].cancellable_orders_missing_product);
    await pool.request().query(`CREATE TABLE ${orders} (id INT PRIMARY KEY, status VARCHAR(20) NOT NULL);`);
    createdOrders = true;
    await pool.request().query(`CREATE TABLE ${products} (id INT PRIMARY KEY, stock INT NOT NULL);`);
    createdProducts = true;
    await pool.request().query(`INSERT INTO ${orders} VALUES (1, 'pending'); INSERT INTO ${products} VALUES (1, 3);`);

    let releaseFirst;
    const held = new Promise(resolve => { releaseFirst = resolve; });
    let signalLocked;
    const firstLocked = new Promise(resolve => { signalLocked = resolve; });
    const first = cancel({ onLocked: async () => { signalLocked(); await held; } });
    await firstLocked;
    const second = cancel();
    await new Promise(resolve => setTimeout(resolve, 150));
    releaseFirst();
    const replies = await Promise.all([first, second]);
    const finalOrder = await pool.request().query(`SELECT status FROM ${orders} WHERE id = 1;`);
    const finalProduct = await pool.request().query(`SELECT stock FROM ${products} WHERE id = 1;`);
    assert.deepEqual(replies.map(x => x.status).sort(), [200, 409]);
    assert.equal(finalOrder.recordset[0].status, 'cancelled');
    assert.equal(finalProduct.recordset[0].stock, 5);
    console.log('SQL cancel race: one success, one conflict, stock=5 (not 7). PASS');
  } finally {
    for (const tx of active) try { await tx.rollback(); } catch (_) { /* ignore */ }
    let cleanupError;
    if (createdOrders) try { await pool.request().query(`DROP TABLE ${orders};`); } catch (error) { cleanupError = error; }
    if (createdProducts) try { await pool.request().query(`DROP TABLE ${products};`); } catch (error) { cleanupError ||= error; }
    if (pool) await pool.close();
    if (cleanupError) throw cleanupError;
  }
}
main().catch(error => { console.error('SQL cancel test FAILED:', error.message); process.exitCode = 1; });
