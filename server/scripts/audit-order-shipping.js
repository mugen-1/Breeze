'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { getPool } = require('../db');
const NEW_COLUMNS = new Set(['order_code', 'shipping_provider', 'shipping_service', 'shipping_eta', 'shipping_tracking_code', 'shipping_status']);

async function businessState(pool, migration = false) {
  const state = {};
  for (const table of ['products', 'product_variants', 'inventory_movements', 'orders', 'order_items', 'users', 'cart_items']) {
    const rows = (await pool.request().query(`SELECT * FROM dbo.${table} ORDER BY id;`)).recordset;
    const original = rows.map(row => Object.fromEntries(Object.entries(row)
      .filter(([key]) => !migration || table !== 'orders' || !NEW_COLUMNS.has(key))));
    state[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(original)).digest('hex') };
    if (table === 'products' || table === 'product_variants') state[table].stock = rows.reduce((n, r) => n + r.stock, 0);
  }
  if (!migration) state.counter = (await pool.request().query('SELECT last_code FROM dbo.order_code_counter WHERE id=1;')).recordset;
  if ((await pool.request().query("SELECT OBJECT_ID('dbo.payment_transactions','U') AS found;")).recordset[0].found) {
    const payments = (await pool.request().query('SELECT * FROM dbo.payment_transactions ORDER BY id;')).recordset;
    state.payment_transactions = { count: payments.length, sha256: createHash('sha256').update(JSON.stringify(payments)).digest('hex') };
  }
  return state;
}
async function audit(pool) {
  const rows = (await pool.request().query(`SELECT o.id, o.shipping_version, o.shipping_name,
    o.shipping_phone, o.shipping_address, o.shipping_ward, o.shipping_district, o.shipping_city,
    o.shipping_method, o.shipping_fee, o.total_amount, o.DiscountAmount, o.order_code,
    o.shipping_provider, o.shipping_service, o.shipping_eta, o.shipping_tracking_code, o.shipping_status, o.status,
    (SELECT COALESCE(SUM(line_total),0) FROM dbo.order_items WHERE order_id=o.id) AS subtotal
    FROM dbo.orders o;`)).recordset;
  const issues = rows.filter(o => o.shipping_version != null && (
    ![1,2].includes(o.shipping_version) || (o.shipping_version === 1 && o.shipping_method !== 'STANDARD') ||
    (o.shipping_version === 2 && (!o.order_code || !o.shipping_provider || !o.shipping_service || !o.shipping_eta || !o.shipping_tracking_code ||
      !['pending_pickup','picked_up','in_transit','out_for_delivery','delivered','cancelled'].includes(o.shipping_status) ||
      (o.status === 'completed') !== (o.shipping_status === 'delivered') || (o.status === 'cancelled') !== (o.shipping_status === 'cancelled'))) || o.shipping_fee == null ||
    o.shipping_fee < 0 || !Number.isInteger(o.shipping_fee) ||
    ['shipping_name','shipping_phone','shipping_address','shipping_ward','shipping_district','shipping_city'].some(k => !o[k] || !o[k].trim()) ||
    o.total_amount !== Math.max(0, o.subtotal - Number(o.DiscountAmount || 0)) + o.shipping_fee
  )).map(o => o.id);
  const constraint = (await pool.request().query(`SELECT is_disabled,is_not_trusted FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID('dbo.orders') AND name='CK_orders_shipping';`)).recordset;
  assert.deepEqual(constraint, [{ is_disabled: false, is_not_trusted: false }]);
  assert.deepEqual(issues, [], 'shipping or total inconsistencies');
  return { orders: rows.length, legacy: rows.filter(o => o.shipping_version == null).length,
    snapshots: rows.filter(o => o.shipping_version != null).length,
    simulation: rows.filter(o => o.shipping_version === 2).length, issues, trusted_check: true };
}
async function main() {
  const pool = await getPool();
  try {
    if (process.argv.includes('--migrate')) {
      const before = await businessState(pool, true);
      const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/017_order_shipping_simulation.sql'), 'utf8');
      await pool.request().batch(migration);
      await pool.request().batch(migration);
      const after = await businessState(pool, true);
      assert.deepEqual(after, before, 'migration must preserve every existing business row');
      console.log(JSON.stringify({ before, after, unchanged: true, rerun: 'PASS' }, null, 2));
    }
    console.log(JSON.stringify(await audit(pool), null, 2));
  } finally { await pool.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { audit, businessState };
