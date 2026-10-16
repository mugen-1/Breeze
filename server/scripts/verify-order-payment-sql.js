'use strict';

// Disposable database only. Exercises real SQL persistence, constraints, locks
// and checkout rollback through the production HTTP routers.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { execFileSync } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const express = require('express');
const dbName = `BreezePaymentTest_${process.pid}_${Date.now()}`;
if (!/^BreezePaymentTest_[0-9]+_[0-9]+$/.test(dbName)) throw new Error('Unsafe test database');
process.env.DB_NAME = dbName;
const { getPool, config, sql } = require('../db');
const { businessState, audit } = require('./audit-order-shipping');
const shipping = require('../__tests__/helpers/shipping');
let pool, server, created = false, base;
function adminSql(statement) {
  execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', statement], { stdio: 'pipe' });
}
async function request(uid, url, method = 'GET', body, admin = false) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json',
    ...(uid ? { 'x-test-user': String(uid) } : {}), ...(admin ? { 'x-test-admin': '1' } : {}) },
    ...(body == null ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
}
async function fixture(method = 'cod') {
  const uid = (await pool.request().input('tag', sql.VarChar(128), `payment-${Date.now()}-${Math.random()}`)
    .query('INSERT INTO dbo.users(firebase_uid) OUTPUT INSERTED.id VALUES(@tag);')).recordset[0].id;
  const pid = (await pool.request().input('tag', sql.VarChar(160), `payment-product-${uid}`).query(`
    INSERT INTO dbo.products(slug,name_vi,price,category_id,stock) OUTPUT INSERTED.id
    VALUES(@tag,N'Payment fixture',100000,1,5);`)).recordset[0].id;
  const vid = (await pool.request().input('pid', sql.Int, pid).query(`
    INSERT INTO dbo.product_variants(product_id,sku,is_base,stock) OUTPUT INSERTED.id
    VALUES(@pid,CONCAT('BASE-',@pid),1,5);`)).recordset[0].id;
  await pool.request().input('pid', sql.Int, pid).input('vid', sql.Int, vid).input('uid', sql.Int, uid).query(`
    INSERT INTO dbo.inventory_movements(product_id,variant_id,movement_type,quantity_delta,stock_before,stock_after)
    VALUES(@pid,@vid,'PRODUCT_CREATE',5,0,5);
    INSERT INTO dbo.cart_items(user_id,product_id,variant_id,quantity) VALUES(@uid,@pid,@vid,1);`);
  return { uid, pid, vid, method };
}
async function checkout(f, body = {}) {
  return request(f.uid, '/api/orders', 'POST', { ...shipping, paymentMethod: f.method, ...body });
}
async function complete(uid, id, byShipping) {
  for (const status of ['confirmed', 'processing', 'shipping']) {
    const r = await request(uid, `/api/admin/orders/${id}/status`, 'PUT', { status }, true);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  if (byShipping) {
    for (const status of ['in_transit', 'out_for_delivery', 'delivered']) {
      const r = await request(uid, `/api/admin/orders/${id}/shipping-status`, 'PATCH', { shipping_status: status }, true);
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
  } else assert.equal((await request(uid, `/api/admin/orders/${id}/status`, 'PUT', { status: 'completed' }, true)).status, 200);
}
async function main() {
  try {
    adminSql(`CREATE DATABASE [${dbName}];`); created = true;
    adminSql(`ALTER AUTHORIZATION ON DATABASE::[${dbName}] TO [${String(config.user).replace(/]/g, ']]')}];`);
    const setup = execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], {
      cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8', maxBuffer: 2 ** 20 });
    assert.ok(setup.includes('db/migrations/018_payment_transactions.sql'));
    pool = await getPool();
    const before = await businessState(pool);
    const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/018_payment_transactions.sql'), 'utf8');
    await pool.request().batch(migration); await pool.request().batch(migration);
    assert.deepEqual(await businessState(pool), before);
    const fk = (await pool.request().query(`SELECT OBJECT_NAME(referenced_object_id) AS target,
      COL_NAME(parent_object_id,parent_column_id) AS source_column, COL_NAME(referenced_object_id,referenced_column_id) AS target_column
      FROM sys.foreign_key_columns WHERE parent_object_id=OBJECT_ID('dbo.payment_transactions');`)).recordset;
    assert.deepEqual(fk, [{ target: 'orders', source_column: 'order_id', target_column: 'id' }]);
    assert.equal((await pool.request().query('SELECT COUNT(*) AS n FROM dbo.payment_transactions;')).recordset[0].n, 0);
    console.log('018 fresh setup, rerun idempotence, internal-ID FK, no legacy payment backfill: PASS');
    require.cache[require.resolve('../middleware/auth')] = { exports: {
      verifyFirebaseToken(req, res, next) {
        const id = Number(req.headers['x-test-user']); if (!id) return res.status(401).json({ status: 'error' });
        req.user = { id, role: req.headers['x-test-admin'] ? 'admin' : 'customer' }; next();
      },
      requireAdmin(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ status: 'error' }); next(); }
    } };
    const app = express(); app.use(express.json()); app.use('/api/orders', require('../routes/orders')); app.use('/api/admin', require('../routes/admin'));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await request(null, '/api/orders/1/payment-simulation', 'POST', { outcome: 'success' })).status, 401);

    const orders = [];
    for (const method of ['cod', 'visa', 'mastercard', 'momo']) {
      const f = await fixture(method), r = await checkout(f, { voucherCode: 'GIAMGIALANDAU', amount: 1, status: 'paid', transaction_code: 'FORGED' });
      assert.equal(r.status, 201, JSON.stringify(r.body)); const o = r.body.order; orders.push({ ...f, order: o });
      const saved = (await request(f.uid, `/api/orders/${o.id}`)).body;
      assert.deepEqual(saved.payment_transaction, o.payment_transaction);
      assert.equal(o.payment_transaction.order_id, o.id); assert.notEqual(o.id, o.order_code);
      assert.equal(o.payment_transaction.transaction_code, `PAY-${o.order_code}-001`);
      assert.equal(o.payment_transaction.amount, o.total_amount); assert.equal(o.total_amount, 105000);
      assert.equal(o.payment_transaction.status, 'pending'); assert.equal(o.payment_transaction.paid_at, null);
      assert.doesNotMatch(JSON.stringify(o.payment_transaction), /"(?:card_number|cvv|cvc|otp|pin|password)"/);
      assert.equal((await request(f.uid + 10000, `/api/orders/${o.id}`)).status, 404);
      assert.equal((await request(f.uid + 10000, `/api/orders/${o.id}/payment-simulation`, 'POST', { outcome: 'success' })).status, 404);
      for (const body of [{ status: 'paid' }, { outcome: 'success', amount: 1 }, { outcome: 'success', status: 'paid' }]) {
        assert.equal((await request(f.uid, `/api/orders/${o.id}/payment-simulation`, 'POST', body)).status, 400);
      }
      const sim = await request(f.uid, `/api/orders/${o.id}/payment-simulation`, 'POST', { outcome: 'success' });
      assert.equal(sim.status, method === 'cod' ? 409 : 200);
      if (method !== 'cod') {
        assert.equal(sim.body.payment_transaction.status, 'paid'); assert.ok(sim.body.payment_transaction.paid_at);
        assert.equal((await request(f.uid, `/api/orders/${o.id}/payment-simulation`, 'POST', { outcome: 'failure' })).status, 409);
      }
      const admin = await request(f.uid, `/api/admin/orders?order_id=${o.id}`, 'GET', null, true);
      assert.equal(admin.status, 200); assert.equal(admin.body.orders[0].payment_transaction.order_id, o.id);
      assert.equal((await request(f.uid, '/api/admin/orders')).status, 403);
    }
    assert.equal(new Set(orders.map(f => f.order.payment_transaction.transaction_code)).size, 4);
    const sample = orders[0].order.payment_transaction;
    const legacyId = (await pool.request().input('uid', sql.Int, orders[0].uid).query(`
      INSERT INTO dbo.orders(user_id,status,total_amount,PaymentMethod) OUTPUT INSERTED.id
      VALUES(@uid,'pending',20000,'cod');`)).recordset[0].id;
    assert.equal((await request(orders[0].uid, `/api/orders/${legacyId}`)).body.payment_transaction, null);
    assert.equal((await request(orders[0].uid, `/api/orders/${legacyId}/payment-simulation`, 'POST', { outcome: 'success' })).status, 409);
    for (const [orderId, code, status, paidAt, constraint] of [
      [sample.order_id, 'DUPLICATE-ORDER', 'pending', null, 'UQ_payment_transactions_order'],
      [-1, 'INVALID-FK', 'pending', null, 'FK_payment_transactions_order'],
      [legacyId, sample.transaction_code, 'pending', null, 'UQ_payment_transactions_code'],
      [legacyId, 'INVALID-PAID-TIME', 'paid', null, 'CK_payment_transactions_paid_at'],
      [legacyId, 'INVALID-PENDING-TIME', 'pending', new Date(), 'CK_payment_transactions_paid_at']
    ]) {
      await assert.rejects(pool.request().input('oid', sql.Int, orderId).input('code', sql.VarChar(40), code)
        .input('status', sql.VarChar(20), status).input('paid', sql.DateTime2, paidAt).query(`
          INSERT INTO dbo.payment_transactions(order_id,transaction_code,payment_method,amount,status,paid_at)
          VALUES(@oid,@code,'cod',20000,@status,@paid);`), error => error.message.includes(constraint));
    }
    console.log('COD pending, all online success, authoritative amount/voucher, safe metadata, owner/Admin permissions: PASS');

    for (const f of [orders[0], { ...await fixture('cod') }]) {
      const o = f.order || (await checkout(f)).body.order;
      await complete(f.uid, o.id, !!f.order);
      const p = (await request(f.uid, `/api/orders/${o.id}`)).body.payment_transaction;
      assert.equal(p.status, 'paid'); assert.ok(p.paid_at);
    }
    for (const method of ['visa', 'mastercard', 'momo']) {
      const f = await fixture(method), o = (await checkout(f)).body.order;
      const r = await request(f.uid, `/api/orders/${o.id}/payment-simulation`, 'POST', { outcome: 'failure' });
      assert.equal(r.status, 200); assert.equal(r.body.payment_transaction.status, 'failed'); assert.equal(r.body.payment_transaction.paid_at, null);
      assert.equal((await request(f.uid, `/api/orders/${o.id}/cancel`, 'POST', { reason: 'wrong_item' })).status, 200);
      assert.equal((await request(f.uid, `/api/orders/${o.id}`)).body.payment_transaction.status, 'failed');
    }
    for (const paid of [false, true]) {
      const f = await fixture('visa'), o = (await checkout(f)).body.order;
      if (paid) assert.equal((await request(f.uid, `/api/orders/${o.id}/payment-simulation`, 'POST', { outcome: 'success' })).status, 200);
      assert.equal((await request(f.uid, `/api/orders/${o.id}/cancel`, 'POST', { reason: 'wrong_item' })).status, 200);
      const p = (await request(f.uid, `/api/orders/${o.id}`)).body.payment_transaction;
      assert.equal(p.status, paid ? 'paid' : 'cancelled'); assert.equal(p.paid_at != null, paid);
      assert.equal((await request(f.uid, `/api/orders/${o.id}/payment-simulation`, 'POST', { outcome: 'success' })).status, 409);
    }
    console.log('COD paid on completion/delivery, online failure and paid_at, cancellation pending vs paid: PASS');

    const failure = await fixture('momo');
    await pool.request().query("ALTER TABLE dbo.payment_transactions WITH NOCHECK ADD CONSTRAINT CK_inject_payment CHECK(payment_method <> 'momo');");
    const stable = await businessState(pool);
    assert.equal((await checkout(failure, { voucherCode: 'GIAMGIALANDAU' })).status, 500);
    assert.deepEqual(await businessState(pool), stable, 'payment insertion failure must roll back all business data');
    await pool.request().query('ALTER TABLE dbo.payment_transactions DROP CONSTRAINT CK_inject_payment;');
    assert.equal((await checkout(failure)).status, 201);

    const concurrent = await fixture('visa'), co = (await checkout(concurrent)).body.order;
    const results = await Promise.all(['success', 'failure'].map(outcome => request(concurrent.uid,
      `/api/orders/${co.id}/payment-simulation`, 'POST', { outcome })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const cancelled = await fixture('visa'), ca = (await checkout(cancelled)).body.order;
    const race = await Promise.all([
      request(cancelled.uid, `/api/orders/${ca.id}/payment-simulation`, 'POST', { outcome: 'success' }),
      request(cancelled.uid, `/api/orders/${ca.id}/cancel`, 'POST', { reason: 'wrong_item' })
    ]);
    assert.equal(race[1].status, 200); assert.ok([200, 409].includes(race[0].status));
    const final = (await request(cancelled.uid, `/api/orders/${ca.id}`)).body;
    assert.equal(final.status, 'cancelled'); assert.ok(['paid','cancelled'].includes(final.payment_transaction.status));
    const limit = await fixture(); await pool.request().query('UPDATE dbo.order_code_counter SET last_code=1100 WHERE id=1;');
    const beforeLimit = await businessState(pool), rejected = await checkout(limit);
    assert.equal(rejected.status, 409); assert.equal(rejected.body.error, 'ORDER_CODE_LIMIT'); assert.equal(rejected.body.message, 'lỗi lên đơn');
    assert.deepEqual(await businessState(pool), beforeLimit);
    console.log('Real payment DB failure rollback, concurrent simulation/cancel locks and ORDER_CODE_LIMIT preserve payment/cart/stock/code: PASS');
    const duplicates = (await pool.request().query(`SELECT transaction_code FROM dbo.payment_transactions GROUP BY transaction_code HAVING COUNT(*)>1;
      SELECT p.id FROM dbo.payment_transactions p JOIN dbo.orders o ON o.id=p.order_id WHERE p.amount<>o.total_amount;`)).recordsets;
    assert.ok(duplicates.every(rows => !rows.length));
    console.log('Shipping/total audit:', JSON.stringify(await audit(pool)));
    console.log('Payment SQL integration: PASS');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.close();
    if (created) adminSql(`ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${dbName}];`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
