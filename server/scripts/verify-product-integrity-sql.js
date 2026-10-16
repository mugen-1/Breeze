'use strict';

// SQL Server integration check. Creates only disposable rows and removes them
// even if an assertion fails; never changes an existing shop order or product.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { getPool, sql } = require('../db');
const { cancelOrder, CancelError } = require('../lib/cancel-order');

async function main() {
  const pool = await getPool();
  const tag = `${process.pid}_${Date.now()}`;
  let userId, productId, variantId, orderId;
  try {
    const before = await pool.request().query(`
      SELECT COUNT(*) AS n FROM dbo.order_items oi
      LEFT JOIN dbo.products p ON p.id = oi.product_id WHERE p.id IS NULL;`);
    assert.equal(before.recordset[0].n, 0);
    const fk = await pool.request().query(`
      SELECT is_disabled, is_not_trusted, delete_referential_action_desc
      FROM sys.foreign_keys WHERE name = 'FK_order_items_product'
        AND parent_object_id = OBJECT_ID('dbo.order_items');`);
    assert.deepEqual(fk.recordset.map(x => [x.is_disabled, x.is_not_trusted, x.delete_referential_action_desc]),
      [[false, false, 'NO_ACTION']]);

    const category = await pool.request().query('SELECT TOP 1 id FROM dbo.categories ORDER BY id;');
    assert.ok(category.recordset.length, 'test needs one category');
    userId = (await pool.request()
      .input('uid', sql.VarChar(128), `integrity-test-${tag}`)
      .query(`INSERT INTO dbo.users (firebase_uid) OUTPUT INSERTED.id VALUES (@uid);`)).recordset[0].id;
    productId = (await pool.request()
      .input('slug', sql.VarChar(160), `integrity-test-${tag}`)
      .input('cid', sql.Int, category.recordset[0].id)
      .query(`INSERT INTO dbo.products (slug, name_vi, price, category_id, stock, is_active)
        OUTPUT INSERTED.id VALUES (@slug, N'Original test name', 100, @cid, 0, 0);`)).recordset[0].id;
    variantId = (await pool.request().input('pid', sql.Int, productId)
      .input('sku', sql.VarChar(80), `BR-P${productId}-BASE`)
      .query(`INSERT INTO dbo.product_variants (product_id, sku, stock, is_active, is_base)
        OUTPUT INSERTED.id VALUES (@pid, @sku, 0, 0, 1);`)).recordset[0].id;
    await pool.request().input('pid', sql.Int, productId).input('vid', sql.Int, variantId)
      .query(`INSERT INTO dbo.inventory_movements
        (product_id, variant_id, movement_type, quantity_delta, stock_before, stock_after)
        VALUES (@pid, @vid, 'PRODUCT_CREATE', 0, 0, 0);`);
    orderId = (await pool.request().input('uid', sql.Int, userId)
      .query(`INSERT INTO dbo.orders (user_id, status, total_amount)
        OUTPUT INSERTED.id VALUES (@uid, 'pending', 200);`)).recordset[0].id;
    await pool.request().input('oid', sql.Int, orderId).input('pid', sql.Int, productId)
      .input('vid', sql.Int, variantId)
      .query(`INSERT INTO dbo.order_items (order_id, product_id, variant_id, product_name, unit_price, quantity, line_total)
        VALUES (@oid, @pid, @vid, N'Original test name', 100, 2, 200);`);

    await assert.rejects(
      pool.request().input('pid', sql.Int, productId)
        .query('DELETE FROM dbo.products WHERE id = @pid;'),
      e => e.number === 547,
      'FK must reject hard delete of referenced product');
    await assert.rejects(
      pool.request().input('oid', sql.Int, orderId)
        .input('vid', sql.Int, variantId)
        .query(`INSERT INTO dbo.order_items (order_id, product_id, variant_id, product_name, unit_price, quantity, line_total)
          VALUES (@oid, -2147483648, @vid, N'Orphan', 1, 1, 1);`),
      e => e.number === 547,
      'FK must reject orphan insert');

    await pool.request().input('pid', sql.Int, productId)
      .query(`UPDATE dbo.products SET name_vi = N'Renamed test product', is_active = 0 WHERE id = @pid;`);
    const snapshot = await pool.request().input('oid', sql.Int, orderId).query(`
      SELECT oi.product_name, p.name_vi, p.is_active FROM dbo.order_items oi
      JOIN dbo.products p ON p.id = oi.product_id WHERE oi.order_id = @oid;`);
    assert.equal(snapshot.recordset[0].product_name, 'Original test name');
    assert.equal(snapshot.recordset[0].name_vi, 'Renamed test product');
    assert.equal(snapshot.recordset[0].is_active, false);

    const cancelled = await cancelOrder(pool, { orderId });
    assert.equal(cancelled.status, 'cancelled');
    await assert.rejects(cancelOrder(pool, { orderId }),
      e => e instanceof CancelError && e.status === 409);
    const restored = await pool.request().input('pid', sql.Int, productId)
      .query(`SELECT p.stock, p.is_active, v.stock AS variant_stock, v.is_active AS variant_active
        FROM dbo.products p JOIN dbo.product_variants v ON v.product_id = p.id AND v.is_base = 1
        WHERE p.id = @pid;`);
    assert.deepEqual(restored.recordset.map(x => [x.stock, x.is_active, x.variant_stock, x.variant_active]),
      [[2, false, 2, false]]);
    const movements = await pool.request().input('pid', sql.Int, productId)
      .query(`SELECT movement_type, quantity_delta, stock_before, stock_after
        FROM dbo.inventory_movements WHERE product_id = @pid ORDER BY created_at, id;`);
    assert.deepEqual(movements.recordset.map(x => [x.movement_type, x.quantity_delta,
      x.stock_before, x.stock_after]),
    [['PRODUCT_CREATE', 0, 0, 0], ['ORDER_CANCEL', 2, 0, 2]]);
    console.log('Product integrity: trusted FK, DELETE/INSERT rejected, snapshot stable, inactive restore once. PASS');
  } finally {
    // The order FK cascades its disposable item. Never touch real IDs.
    if (productId) await pool.request().input('id', sql.Int, productId)
      .query('DELETE FROM dbo.inventory_movements WHERE product_id = @id;');
    if (orderId) await pool.request().input('id', sql.Int, orderId)
      .query('DELETE FROM dbo.orders WHERE id = @id;');
    if (productId) await pool.request().input('id', sql.Int, productId)
      .query('DELETE FROM dbo.product_variants WHERE product_id = @id;');
    if (productId) await pool.request().input('id', sql.Int, productId)
      .query('DELETE FROM dbo.products WHERE id = @id;');
    if (userId) await pool.request().input('id', sql.Int, userId)
      .query('DELETE FROM dbo.users WHERE id = @id;');
    const after = await pool.request().query(`
      SELECT COUNT(*) AS n FROM dbo.order_items oi
      LEFT JOIN dbo.products p ON p.id = oi.product_id WHERE p.id IS NULL;`);
    assert.equal(after.recordset[0].n, 0);
    await pool.close();
  }
}

main().catch(e => { console.error('Product integrity SQL check FAILED:', e.message); process.exitCode = 1; });
