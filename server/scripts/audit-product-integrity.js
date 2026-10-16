'use strict';

// Read-only audit for TASK 04.5. Never logs connection credentials or customer data.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { getPool } = require('../db');
const { createHash } = require('node:crypto');

async function main() {
  const pool = await getPool();
  const rows = await pool.request().query(`
    SELECT oi.id AS item_id, oi.product_id, oi.order_id, o.status,
           oi.product_name, oi.unit_price, oi.quantity
    FROM dbo.order_items oi
    JOIN dbo.orders o ON o.id = oi.order_id
    LEFT JOIN dbo.products p ON p.id = oi.product_id
    WHERE p.id IS NULL
    ORDER BY oi.product_id, oi.order_id, oi.id;`);
  const counts = await pool.request().query(`
    SELECT COUNT(*) AS products FROM dbo.products;`);
  const category = await pool.request().query(`
    SELECT id, slug, name_vi FROM dbo.categories ORDER BY id;`);
  const fk = await pool.request().query(`
    SELECT name, is_disabled, is_not_trusted, delete_referential_action_desc
    FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID('dbo.order_items')
      AND referenced_object_id = OBJECT_ID('dbo.products');`);
  const itemColumns = await pool.request().query(`
    SELECT name, is_nullable FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.order_items')
      AND name IN ('product_name','unit_price','quantity','line_total');`);
  const recovered = await pool.request().query(`
    SELECT p.id, p.slug, p.name_vi, p.stock, p.is_active, c.slug AS category_slug
    FROM dbo.products p JOIN dbo.categories c ON c.id = p.category_id
    WHERE p.id IN (51,52,53,54,55,56,57,59) ORDER BY p.id;`);
  const historicalCancellation = await pool.request().query(`
    SELECT COUNT(*) AS n FROM dbo.orders WHERE status = 'cancelled' AND cancelled_at IS NULL;`);
  const blankSnapshots = await pool.request().query(`
    SELECT COUNT(*) AS n FROM dbo.order_items WHERE LTRIM(RTRIM(product_name)) = N'';`);
  const affectedCancellable = await pool.request().query(`
    SELECT o.id, o.status,
           SUM(CASE WHEN p.id IS NULL THEN 1 ELSE 0 END) AS missing_product_items
    FROM dbo.orders o JOIN dbo.order_items oi ON oi.order_id = o.id
    LEFT JOIN dbo.products p ON p.id = oi.product_id
    WHERE o.id IN (57,58,71,74,78)
    GROUP BY o.id, o.status ORDER BY o.id;`);
  const businessTables = ['products', 'users', 'orders', 'order_items'];
  const businessRows = {};
  for (const table of businessTables) {
    const result = await pool.request().query(`SELECT * FROM dbo.${table} ORDER BY id;`);
    businessRows[table] = {
      count: result.recordset.length,
      sha256: createHash('sha256').update(JSON.stringify(result.recordset)).digest('hex'),
    };
  }
  console.log(JSON.stringify({
    orphan_count: rows.recordset.length,
    orphan_items: rows.recordset,
    product_count: counts.recordset[0].products,
    categories: category.recordset,
    product_fk: fk.recordset,
    item_snapshot_columns: itemColumns.recordset,
    recovered_products: recovered.recordset,
    historical_cancelled_without_time: historicalCancellation.recordset[0].n,
    blank_product_name_snapshots: blankSnapshots.recordset[0].n,
    formerly_affected_cancellable_orders: affectedCancellable.recordset,
    business_rows: businessRows,
  }, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[audit-product-integrity]', err.message);
  process.exit(1);
});
