'use strict';

// Read-only business-data snapshot around migration 012. No customer rows are printed.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { getPool } = require('../db');
const { createHash } = require('node:crypto');

async function main() {
  const pool = await getPool();
  const counts = (await pool.request().query(`
    SELECT (SELECT COUNT(*) FROM dbo.products) AS products,
      (SELECT COUNT(*) FROM dbo.users) AS users,
      (SELECT COUNT(*) FROM dbo.orders) AS orders,
      (SELECT COUNT(*) FROM dbo.order_items) AS order_items,
      (SELECT COUNT(*) FROM dbo.cart_items) AS cart_items,
      (SELECT COALESCE(SUM(quantity), 0) FROM dbo.cart_items) AS cart_quantity,
      (SELECT COALESCE(SUM(CONVERT(BIGINT, stock)), 0) FROM dbo.products) AS product_stock_total,
      (SELECT COUNT(*) FROM dbo.products WHERE is_active = 0) AS inactive_products,
      (SELECT COUNT(*) FROM dbo.inventory_movements) AS movements;`)).recordset[0];
  const tables = ['products', 'users', 'orders', 'order_items', 'cart_items', 'inventory_movements'];
  const hashes = {};
  for (const table of tables) {
    const rows = (await pool.request().query(`SELECT * FROM dbo.${table} ORDER BY id;`)).recordset;
    hashes[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    if (table === 'order_items' && rows.length && Object.hasOwn(rows[0], 'color_snapshot')) {
      const before015 = rows.map(({ color_snapshot, ...oldColumns }) => oldColumns);
      hashes.order_items_pre015 = createHash('sha256').update(JSON.stringify(before015)).digest('hex');
    }
  }
  const stock = (await pool.request().query('SELECT id, stock FROM dbo.products ORDER BY id;')).recordset;
  hashes.product_stock = createHash('sha256').update(JSON.stringify(stock)).digest('hex');
  const businessQueries = {
    order_items_business: 'SELECT id, order_id, product_id, product_name, unit_price, quantity, line_total FROM dbo.order_items ORDER BY id;',
    cart_business: 'SELECT id, user_id, product_id, quantity, created_at, updated_at FROM dbo.cart_items ORDER BY id;',
    movements_business: `SELECT id, product_id, order_id, order_reference_id, movement_type, quantity_delta,
      stock_before, stock_after, reason, actor_user_id, created_at FROM dbo.inventory_movements ORDER BY id;`,
  };
  for (const [name, query] of Object.entries(businessQueries)) {
    const rows = (await pool.request().query(query)).recordset;
    hashes[name] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  const legacyMovements = (await pool.request().query(`SELECT id, product_id, order_id,
    order_reference_id, movement_type, quantity_delta, stock_before, stock_after,
    reason, actor_user_id, created_at FROM dbo.inventory_movements
    WHERE variant_id IS NULL ORDER BY id;`)).recordset;
  hashes.legacy_movements_business = createHash('sha256')
    .update(JSON.stringify(legacyMovements)).digest('hex');
  console.log(JSON.stringify({ ...counts, hashes }, null, 2));
  await pool.close();
}

main().catch(err => { console.error('[snapshot-task06]', err.message); process.exitCode = 1; });
