'use strict';

// Isolated integration check: two real SQL Server transactions contend for the
// final unit. Creates and drops a uniquely named test table; no shop data used.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { getPool, sql } = require('../db');

const table = `dbo.__breeze_inventory_test_${process.pid}_${Date.now()}`;
const qualified = `[dbo].[${table.slice(4)}]`;
let pool, first, second, multi, created = false;

async function main() {
  try {
    pool = await getPool();
    const schema = await pool.request().query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN ('products', 'cart_items', 'orders', 'order_items')
      ORDER BY TABLE_NAME, ORDINAL_POSITION;`);
    const columns = new Set(schema.recordset.map(r => r.TABLE_NAME + '.' + r.COLUMN_NAME));
    for (const name of ['products.stock', 'products.is_active', 'products.price',
      'cart_items.quantity', 'orders.status', 'order_items.unit_price']) {
      assert.ok(columns.has(name), 'Expected SQL column: ' + name);
    }
    const cartIndex = await pool.request().query(`
      SELECT COUNT(*) AS found FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.cart_items') AND name = 'IX_cart_items_user';`);
    assert.equal(cartIndex.recordset[0].found, 1, 'checkout cart-range lock index must exist');
    await pool.request().query(`
      SELECT TOP (0) ci.product_id, ci.quantity FROM dbo.cart_items ci
      WITH (UPDLOCK, HOLDLOCK, INDEX(IX_cart_items_user))
      WHERE ci.user_id = -1 ORDER BY ci.product_id;`);
    const stockAudit = await pool.request().query(`
      SELECT COUNT(*) AS total_products,
             SUM(CASE WHEN stock < 0 THEN 1 ELSE 0 END) AS negative_stock
      FROM dbo.products;`);
    console.log('Schema checked; existing negative-stock products:', stockAudit.recordset[0].negative_stock);

    await pool.request().query(`CREATE TABLE ${qualified} (id INT PRIMARY KEY, stock INT NOT NULL);`);
    created = true;
    await pool.request().query(`INSERT INTO ${qualified} (id, stock) VALUES (1, 1);`);
    first = new sql.Transaction(pool);
    second = new sql.Transaction(pool);
    await first.begin();
    await second.begin();
    const update = `UPDATE ${qualified} SET stock = stock - 1 WHERE id = 1 AND stock >= 1;`;
    const a = await new sql.Request(first).query(update);
    const waitingB = new sql.Request(second).query(update);
    await new Promise(resolve => setTimeout(resolve, 150));
    await first.commit(); first = null;
    const b = await waitingB;
    await second.commit(); second = null;
    const final = await pool.request().query(`SELECT stock FROM ${qualified} WHERE id = 1;`);
    assert.deepEqual([a.rowsAffected[0], b.rowsAffected[0], final.recordset[0].stock], [1, 0, 0]);
    console.log('Concurrent SQL transactions: affected rows A=1, B=0; final stock=0. PASS');

    // One insufficient item must undo an earlier successful decrement.
    await pool.request().query(`INSERT INTO ${qualified} (id, stock) VALUES (2, 5), (3, 0);`);
    multi = new sql.Transaction(pool);
    await multi.begin();
    const firstItem = await new sql.Request(multi).query(
      `UPDATE ${qualified} SET stock = stock - 2 WHERE id = 2 AND stock >= 2;`);
    const lastItem = await new sql.Request(multi).query(
      `UPDATE ${qualified} SET stock = stock - 1 WHERE id = 3 AND stock >= 1;`);
    assert.deepEqual([firstItem.rowsAffected[0], lastItem.rowsAffected[0]], [1, 0]);
    await multi.rollback(); multi = null;
    const restored = await pool.request().query(`SELECT id, stock FROM ${qualified} WHERE id IN (2, 3) ORDER BY id;`);
    assert.deepEqual(restored.recordset.map(x => x.stock), [5, 0]);
    console.log('Multi-item SQL rollback: stock restored to [5, 0]. PASS');
  } finally {
    if (first) try { await first.rollback(); } catch (_) { /* already ended */ }
    if (second) try { await second.rollback(); } catch (_) { /* already ended */ }
    if (multi) try { await multi.rollback(); } catch (_) { /* already ended */ }
    if (created) await pool.request().query(`DROP TABLE ${qualified};`);
    if (pool) await pool.close();
  }
}
main().catch(err => { console.error('Inventory SQL test FAILED:', err.message); process.exitCode = 1; });
