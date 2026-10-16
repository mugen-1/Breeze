'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { getPool } = require('../db');
const { businessState } = require('./audit-order-shipping');
async function main() {
  const pool = await getPool();
  try {
    if (process.argv.includes('--migrate')) {
      const before = await businessState(pool);
      const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/018_payment_transactions.sql'), 'utf8');
      await pool.request().batch(migration); await pool.request().batch(migration);
      const after = await businessState(pool);
      if (!before.payment_transactions) delete after.payment_transactions;
      assert.deepEqual(after, before, '018 must preserve all existing orders, inventory, cart and payment rows');
      console.log('018 migration twice: existing business data unchanged. PASS');
    }
    const issues = (await pool.request().query(`SELECT p.id FROM dbo.payment_transactions p
      LEFT JOIN dbo.orders o ON o.id=p.order_id WHERE o.id IS NULL OR p.amount<>o.total_amount
      OR p.payment_method<>o.PaymentMethod OR (p.status='paid' AND p.paid_at IS NULL)
      OR (p.status<>'paid' AND p.paid_at IS NOT NULL);`)).recordset;
    assert.deepEqual(issues, []);
    const counts = (await pool.request().query(`SELECT COUNT(*) AS transactions,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid FROM dbo.payment_transactions;`)).recordset[0];
    console.log(JSON.stringify({ ...counts, issues }));
  } finally { await pool.close(); }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
