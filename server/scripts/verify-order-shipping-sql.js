'use strict';

// Full HTTP checkout against a disposable SQL database, including real locks.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const express = require('express');
const dbName = `BreezeShippingTest_${process.pid}_${Date.now()}`;
if (!/^BreezeShippingTest_[0-9]+_[0-9]+$/.test(dbName)) throw new Error('Unsafe test database');
process.env.DB_NAME = dbName;
const { getPool, config, sql } = require('../db');
const { audit, businessState } = require('./audit-order-shipping');
const { cancelOrder } = require('../lib/cancel-order');
const input = require('../__tests__/helpers/shipping');
const serverDir = path.join(__dirname, '..');
let pool, server, created = false, base, configuredTestFee = null;
function adminSql(statement) {
  execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', statement], { stdio: 'pipe' });
}
async function request(user, body, url = '/api/orders', method = 'POST', admin = false) {
  const r = await fetch(base + url, { method,
    headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-test-admin': '1' } : {}), ...(user ? { 'x-test-user': String(user) } : {}) },
    ...(['POST','PUT','PATCH'].includes(method) ? { body: JSON.stringify({ ...input, paymentMethod: 'cod', ...body }) } : {}) });
  return { status: r.status, body: await r.json() };
}
async function fixture(stock) {
  const uid = (await pool.request().input('tag', sql.VarChar(128), `shipping-${Date.now()}-${Math.random()}`)
    .query('INSERT INTO dbo.users(firebase_uid) OUTPUT INSERTED.id VALUES (@tag);')).recordset[0].id;
  const p = (await pool.request().input('tag', sql.VarChar(160), `shipping-${uid}`)
    .input('stock', sql.Int, stock).query(`INSERT INTO dbo.products(slug,name_vi,price,category_id,stock)
      OUTPUT INSERTED.id VALUES(@tag,N'Shipping test',100000,1,@stock);`)).recordset[0].id;
  await pool.request().input('p', sql.Int, p).query(`
    INSERT INTO dbo.product_variants(product_id,sku,is_base,stock) VALUES(@p,CONCAT('BASE-',@p),1,0);
    INSERT INTO dbo.product_colors(product_id,color_key,label) VALUES(@p,'black',N'Black');`);
  const v = (await pool.request().input('p', sql.Int, p).input('stock', sql.Int, stock).query(`
    INSERT INTO dbo.product_variants(product_id,sku,is_base,size,color,stock)
    OUTPUT INSERTED.id VALUES(@p,CONCAT('BLACK-M-',@p),0,'M','black',@stock);`)).recordset[0].id;
  await pool.request().input('p', sql.Int, p).input('v', sql.Int, v).input('stock', sql.Int, stock).query(`
    INSERT INTO dbo.inventory_movements(product_id,variant_id,movement_type,quantity_delta,stock_before,stock_after)
    SELECT @p,id,'PRODUCT_CREATE',0,0,0 FROM dbo.product_variants WHERE product_id=@p AND is_base=1;
    INSERT INTO dbo.inventory_movements(product_id,variant_id,movement_type,quantity_delta,stock_before,stock_after)
    VALUES(@p,@v,'PRODUCT_CREATE',@stock,0,@stock);`);
  await cart(uid, p, v);
  return { uid, p, v };
}
async function cart(uid, p, v) {
  await pool.request().input('u', sql.Int, uid).input('p', sql.Int, p).input('v', sql.Int, v)
    .query('INSERT INTO dbo.cart_items(user_id,product_id,variant_id,quantity) VALUES(@u,@p,@v,1);');
}
async function main() {
  try {
    adminSql(`CREATE DATABASE [${dbName}];`); created = true;
    adminSql(`ALTER AUTHORIZATION ON DATABASE::[${dbName}] TO [${String(config.user).replace(/]/g, ']]')}];`);
    const setup = execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], {
      cwd: serverDir, env: process.env, encoding: 'utf8', maxBuffer: 2 ** 20 });
    for (const n of ['012','013','014','015','016','017']) assert.ok(setup.includes(`db/migrations/${n}_`));
    pool = await getPool();
    const before = await businessState(pool);
    await pool.request().batch(fs.readFileSync(path.join(serverDir, 'db/migrations/017_order_shipping_simulation.sql'), 'utf8'));
    assert.deepEqual(await businessState(pool), before);
    console.log('Fresh migration chain 012-017 + idempotence: PASS');

    // Auth seam is local to this test process, never mounted by server.js.
    require.cache[require.resolve('../middleware/auth')] = { exports: {
      verifyFirebaseToken(req, res, next) {
        const id = Number(req.headers['x-test-user']);
        if (!id) return res.status(401).json({ status: 'error' });
        req.user = { id, role: req.headers['x-test-admin'] === '1' ? 'admin' : 'customer' }; next();
      },
      requireAdmin(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ status: 'error' }); next(); },
    } };
    // Simulate a future fee change in this test process only; browser input is still ignored.
    const shipping = require('../config/shipping');
    require.cache[require.resolve('../config/shipping')].exports = { ...shipping,
      validateShipping(body) {
        const result = shipping.validateShipping(body);
        if (result.value && configuredTestFee != null) result.value.shipping_fee = configuredTestFee;
        return result;
      },
    };
    const app = express(); app.use(express.json()); app.use('/api/orders', require('../routes/orders')); app.use('/api/admin', require('../routes/admin'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await request(null, {})).status, 401);
    assert.equal((await request(null, {}, '/api/orders/shipping-methods', 'GET')).status, 401);
    const f = await fixture(2);
    const methods = await request(f.uid, {}, '/api/orders/shipping-methods', 'GET');
    assert.equal(methods.status, 200);
    assert.deepEqual(methods.body, shipping.METHODS);
    for (const bad of [{ shipping_name: '' }, { shipping_phone: [] }, { shipping_address: '' },
      { shipping_method: 'EXPRESS' }, { delivery_note: 'x'.repeat(501) }]) {
      assert.equal((await request(f.uid, bad)).status, 400);
    }
    const xss = '<img src=x onerror=alert(1)>';
    const r = await request(f.uid, { voucherCode: 'GIAMGIALANDAU', shipping_fee: -999999,
      total: 1, discountAmount: 999999, user_id: -1, shipping_name: xss,
      shipping_address: xss, delivery_note: xss });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const id = r.body.order.id;
    assert.equal(r.body.order.order_code, 1001);
    assert.equal(r.body.order.shipping_tracking_code, 'GHN-BR-1001');
    assert.equal(r.body.order.shipping_status, 'pending_pickup');
    assert.equal(r.body.order.total_amount, 105000);
    assert.equal(r.body.order.discount_amount, 15000);
    assert.equal(r.body.order.shipping_fee, 20000);
    const saved = (await request(f.uid, {}, `/api/orders/${id}`, 'GET')).body;
    assert.equal(saved.shipping_name, xss); assert.equal(saved.shipping_address, xss); assert.equal(saved.delivery_note, xss);
    assert.equal(saved.shipping_method, 'GHN_STANDARD'); assert.equal(saved.shipping_version, 2);
    assert.equal(saved.shipping_fee, 20000);
    assert.equal(saved.items[0].variant_id, f.v); assert.equal(saved.items[0].size_snapshot, 'M');
    assert.equal(saved.items[0].color_snapshot, 'Black');
    assert.equal((await request(f.uid + 999, {}, `/api/orders/${id}`, 'GET')).status, 404);
    const stock = (await pool.request().input('p', sql.Int, f.p).input('u', sql.Int, f.uid).query(`SELECT
      (SELECT stock FROM dbo.products WHERE id=@p) AS stock,
      (SELECT COUNT(*) FROM dbo.cart_items WHERE user_id=@u) AS cart,
      (SELECT COUNT(*) FROM dbo.inventory_movements WHERE product_id=@p AND movement_type='ORDER_CHECKOUT') AS movements;`)).recordset[0];
    assert.deepEqual(stock, { stock: 1, cart: 0, movements: 1 });
    await pool.request().input('u', sql.Int, f.uid).query(`UPDATE dbo.users SET display_name=N'Changed',phone='0999999999' WHERE id=@u;`);
    assert.deepEqual((await request(f.uid, {}, `/api/orders/${id}`, 'GET')).body, saved);
    configuredTestFee = 30000;
    assert.deepEqual((await request(f.uid, {}, `/api/orders/${id}`, 'GET')).body, saved);
    const nonzero = await fixture(2);
    const nonzeroOrder = await request(nonzero.uid, { shipping_fee: 0, voucherCode: 'GIAMGIALANDAU' });
    assert.equal(nonzeroOrder.status, 201);
    assert.equal(nonzeroOrder.body.order.order_code, 1002);
    assert.equal(nonzeroOrder.body.order.total_amount, 115000);
    assert.equal(nonzeroOrder.body.order.shipping_fee, 30000);
    configuredTestFee = 35000;
    const retained = await request(nonzero.uid, {}, `/api/orders/${nonzeroOrder.body.order.id}`, 'GET');
    assert.equal(retained.body.shipping_fee, 30000);
    assert.equal(retained.body.total_amount, 115000);
    configuredTestFee = null;
    console.log('Nonzero server configuration: 100000 - 15000 + 30000 = 115000; future fee change preserves old snapshot: PASS');
    await cancelOrder(pool, { orderId: id, ownerId: f.uid, reason: 'Test', actorUserId: f.uid });
    await assert.rejects(cancelOrder(pool, { orderId: id, ownerId: f.uid, reason: 'Test', actorUserId: f.uid }), e => e.status === 409);
    const cancelled = (await request(f.uid, {}, `/api/orders/${id}`, 'GET')).body;
    assert.equal(cancelled.shipping_status, 'cancelled');
    for (const key of ['shipping_name','shipping_phone','shipping_address','shipping_method','shipping_fee','delivery_note']) {
      assert.equal(cancelled[key], saved[key]);
    }
    assert.equal((await pool.request().input('v', sql.Int, f.v).query('SELECT stock FROM dbo.product_variants WHERE id=@v;')).recordset[0].stock, 2);
    console.log('HTTP validation, server totals/voucher, exact size/color stock, profile immutability, cancel once: PASS');

    const fail = await fixture(2);
    await pool.request().batch(`ALTER TABLE dbo.orders WITH CHECK ADD CONSTRAINT CK_shipping_test_failure
      CHECK(delivery_note IS NULL OR delivery_note <> N'FAIL_SHIPPING');`);
    const rollbackBefore = await businessState(pool);
    assert.equal((await request(fail.uid, { delivery_note: 'FAIL_SHIPPING' })).status, 500);
    assert.deepEqual(await businessState(pool), rollbackBefore);
    await pool.request().batch('ALTER TABLE dbo.orders DROP CONSTRAINT CK_shipping_test_failure;');
    console.log('Shipping persistence SQL failure rolls back entire checkout: PASS');

    const race = await fixture(1);
    const other = (await pool.request().query(`INSERT INTO dbo.users(firebase_uid) OUTPUT INSERTED.id VALUES('shipping-concurrent-other');`)).recordset[0].id;
    await cart(other, race.p, race.v);
    const raced = await Promise.all([request(race.uid, { shipping_name: 'First address' }), request(other, { shipping_name: 'Second address' })]);
    assert.deepEqual(raced.map(x => x.status).sort(), [201,409]);
    const end = (await pool.request().input('p', sql.Int, race.p).input('v', sql.Int, race.v).query(`SELECT
      (SELECT stock FROM dbo.product_variants WHERE id=@v) AS stock,
      (SELECT COUNT(*) FROM dbo.order_items WHERE variant_id=@v) AS items,
      (SELECT COUNT(*) FROM dbo.inventory_movements WHERE variant_id=@v AND movement_type='ORDER_CHECKOUT') AS movements,
      (SELECT COUNT(*) FROM dbo.orders o JOIN dbo.order_items i ON i.order_id=o.id WHERE i.variant_id=@v AND o.shipping_version=2) AS snapshots;`)).recordset[0];
    assert.deepEqual(end, { stock: 0, items: 1, movements: 1, snapshots: 1 });
    console.log('Concurrent actual checkout: 201 + 409; stock 0, one item/movement/snapshot: PASS');

    const legacy = (await pool.request().input('u', sql.Int, f.uid).query(`INSERT INTO dbo.orders(user_id,status,total_amount)
      OUTPUT INSERTED.id VALUES(@u,'pending',0);`)).recordset[0].id;
    const old = (await request(f.uid, {}, `/api/orders/${legacy}`, 'GET')).body;
    assert.equal(old.shipping_version, null); assert.equal(old.shipping_fee, null); assert.equal(old.shipping_name, null);
    console.log('Legacy order remains readable, no fabricated shipping:', JSON.stringify(await audit(pool)));
    const adminOrder = (path, body, method = 'PATCH') => request(f.uid, body, '/api/admin' + path, method, true);
    const orderStatus = (oid, status) => adminOrder('/orders/' + oid + '/status', { status }, 'PUT');
    const shippingStatus = (oid, shipping_status) => adminOrder('/orders/' + oid + '/shipping-status', { shipping_status });
    assert.equal((await request(null, {}, '/api/admin/orders/' + id + '/shipping-status', 'PATCH')).status, 401);
    assert.equal((await request(f.uid, { shipping_status: 'delivered', role: 'admin' }, '/api/admin/orders/' + id + '/shipping-status', 'PATCH')).status, 403);
    assert.equal((await shippingStatus(legacy, 'picked_up')).status, 409);
    assert.equal((await shippingStatus(id, 'picked_up')).status, 409); // cancelled
    const movingId = nonzeroOrder.body.order.id;
    assert.equal((await shippingStatus(movingId, 'picked_up')).status, 409); // pending
    assert.equal((await shippingStatus(movingId, 'fake')).status, 400);
    assert.equal((await orderStatus(movingId, 'confirmed')).status, 200);
    assert.equal((await orderStatus(movingId, 'processing')).status, 200);
    assert.equal((await shippingStatus(movingId, 'picked_up')).body.order.status, 'shipping');
    assert.equal((await shippingStatus(movingId, 'delivered')).status, 409); // skip forbidden
    assert.equal((await shippingStatus(movingId, 'in_transit')).status, 200);
    const concurrentStatus = await Promise.all([shippingStatus(movingId, 'out_for_delivery'), shippingStatus(movingId, 'out_for_delivery')]);
    assert.deepEqual(concurrentStatus.map(r => r.status).sort(), [200,409]);
    assert.equal((await shippingStatus(movingId, 'picked_up')).status, 409); // backwards
    assert.equal((await shippingStatus(movingId, 'delivered')).body.order.status, 'completed');
    assert.equal((await shippingStatus(movingId, 'in_transit')).status, 409); // terminal
    assert.equal((await orderStatus(movingId, 'cancelled')).status, 409);
    const finished = (await request(nonzero.uid, {}, '/api/orders/' + movingId, 'GET')).body;
    assert.equal(finished.shipping_tracking_code, nonzeroOrder.body.order.shipping_tracking_code);
    assert.equal(finished.shipping_fee, 30000);
    console.log('Admin auth, sequential shipping, duplicate/backward/skip rejection, completion and stable snapshot: PASS');

    const expressFixture = await fixture(2);
    const expressOrder = await request(expressFixture.uid, { shipping_method: 'BREEZE_EXPRESS', shipping_fee: 1, shipping_provider: 'Fake' });
    assert.equal(expressOrder.status, 201);
    assert.equal(expressOrder.body.order.shipping_fee, 35000);
    assert.equal(expressOrder.body.order.shipping_provider, 'BREEZE EXPRESS');
    assert.equal(expressOrder.body.order.total_amount, 135000);
    const expressId = expressOrder.body.order.id;
    for (const status of ['confirmed','processing','shipping','completed']) assert.equal((await orderStatus(expressId, status)).status, 200);
    assert.equal((await request(expressFixture.uid, {}, '/api/orders/' + expressId, 'GET')).body.shipping_status, 'delivered');
    const economyFixture = await fixture(2);
    const economy = await request(economyFixture.uid, { shipping_method: 'GHTK_ECONOMY', voucherCode: 'GIAMGIALANDAU', shipping_fee: -100 });
    assert.equal(economy.body.order.total_amount, 100000);
    assert.equal(economy.body.order.shipping_tracking_code, 'GHTK-BR-' + economy.body.order.order_code);
    const economyId = economy.body.order.id;
    assert.equal((await orderStatus(economyId, 'cancelled')).status, 200);
    assert.equal((await request(economyFixture.uid, {}, '/api/orders/' + economyId, 'GET')).body.shipping_status, 'cancelled');
    assert.equal((await pool.request().input('v', sql.Int, economyFixture.v).query('SELECT stock FROM dbo.product_variants WHERE id=@v;')).recordset[0].stock, 2);
    await assert.rejects(pool.request().input('id', sql.Int, economyId).query('UPDATE dbo.orders SET order_code=1001 WHERE id=@id;'), e => [2601,2627].includes(e.number));
    console.log('All three provider fees, voucher arithmetic, order-driven sync, Admin cancel restores exact variant, unique code index: PASS');

    // Distinct carts and products must still serialize code allocation.
    const concurrentFixtures = [];
    for (let i=0;i<5;i++) concurrentFixtures.push(await fixture(2));
    const previousCode = (await pool.request().query('SELECT last_code FROM dbo.order_code_counter WHERE id=1;')).recordset[0].last_code;
    const concurrentCodes = await Promise.all(concurrentFixtures.map(x => request(x.uid, {})));
    assert.ok(concurrentCodes.every(r => r.status === 201), JSON.stringify(concurrentCodes));
    assert.deepEqual(concurrentCodes.map(r => r.body.order.order_code).sort((a,b)=>a-b), [1,2,3,4,5].map(n=>previousCode+n));
    const highest = concurrentCodes.find(r => r.body.order.order_code === previousCode + 5).body.order;
    assert.equal((await adminOrder('/orders/' + highest.id, {}, 'DELETE')).status, 200);
    const bulk = await fixture(110);
    const next = await request(bulk.uid, {});
    assert.equal(next.body.order.order_code, previousCode + 6); // never reuse deleted code
    let last = next.body.order.order_code;
    while (last < 1099) {
      await cart(bulk.uid, bulk.p, bulk.v);
      const r = await request(bulk.uid, {});
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.order.order_code, ++last);
    }
    const boundary = [await fixture(2), await fixture(2)];
    const boundaryResults = await Promise.all(boundary.map(x => request(x.uid, { voucherCode: 'GIAMGIALANDAU' })));
    assert.deepEqual(boundaryResults.map(r => r.status).sort(), [201,409]);
    assert.equal(boundaryResults.find(r => r.status === 201).body.order.order_code, 1100);
    const loser = boundary[boundaryResults.findIndex(r => r.status === 409)];
    const beforeLimit = await businessState(pool);
    const limit = await request(loser.uid, { voucherCode: 'GIAMGIALANDAU' });
    assert.deepEqual(limit, { status: 409, body: { status: 'error', error: 'ORDER_CODE_LIMIT', message: 'lỗi lên đơn' } });
    assert.deepEqual(await businessState(pool), beforeLimit);
    const retainedStock = (await pool.request().input('u', sql.Int, loser.uid).input('p', sql.Int, loser.p).input('v', sql.Int, loser.v).query(
      'SELECT (SELECT stock FROM dbo.products WHERE id=@p) AS stock, (SELECT stock FROM dbo.product_variants WHERE id=@v) AS variant_stock, (SELECT COUNT(*) FROM dbo.cart_items WHERE user_id=@u) AS cart;')).recordset[0];
    assert.deepEqual(retainedStock, { stock: 2, variant_stock: 2, cart: 1 });
    console.log('1001–1100 sequential range, concurrent unique allocation, deleted code never reused, final-slot race, full limit rollback: PASS');

    const list = await adminOrder('/orders?q=1001', {}, 'GET');
    assert.equal(list.status, 200); assert.equal(list.body.orders[0].id, id);
    assert.equal((await adminOrder('/orders?order_id=' + movingId, {}, 'GET')).body.orders[0].id, movingId);
    const detail = await adminOrder('/users/' + nonzero.uid + '/detail', {}, 'GET');
    assert.equal(detail.status, 200); assert.equal(detail.body.orders[0].order_code, 1002);
    for (const endpoint of ['/stats','/stats/anchor','/stats/top-products','/stats/order-status','/statistics?range=30d','/blacklist','/products/' + f.p + '/inventory-movements']) {
      assert.equal((await adminOrder(endpoint, {}, 'GET')).status, 200, endpoint);
    }
    assert.equal((await pool.request().query("SELECT COLUMNPROPERTY(OBJECT_ID('dbo.orders'),'id','IsIdentity') AS identity_id;")).recordset[0].identity_id, 1);
    await audit(pool);
    console.log('Customer Detail, display-code search, internal-ID lookup, dashboard/statistics, movement references and audit: PASS');
    execFileSync(process.execPath, ['scripts/audit-inventory-movements.js'], { cwd: serverDir, env: process.env, stdio: 'pipe' });
    console.log('Inventory audit after shipping, cancellation and concurrency: PASS');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.close();
    if (created) {
      adminSql(`ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${dbName}];`);
      console.log('Removed disposable database:', dbName);
    }
  }
}
main().catch(e => { console.error(e.message, e.stdout ? String(e.stdout) : ''); process.exitCode = 1; });
