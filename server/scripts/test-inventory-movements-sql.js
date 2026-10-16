'use strict';

// TASK 05: real SQL Server + HTTP route test with disposable users/products/orders.
// All created rows are removed in finally, including audit rows for test products.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const express = require('express');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { getPool, sql } = require('../db');

const tag = `inventory-test-${process.pid}-${Date.now()}`;
const actors = new Map();
const users = [];
const products = [];
const orders = [];
let pool, server, base, setupTx;

// Only this disposable test process replaces auth. Production routes still use
// verifyFirebaseToken and requireAdmin normally.
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  verifyFirebaseToken(req, res, next) {
    const actor = actors.get(Number(req.headers['x-test-actor']));
    if (!actor) return res.status(401).json({ status: 'error' });
    req.user = actor;
    next();
  },
} };
const app = express();
app.use(express.json());
app.use('/api/orders', require('../routes/orders'));
app.use('/api/admin', require('../routes/admin'));
app.use('/api/cart', require('../routes/cart'));

async function call(method, path, actor, body) {
  const response = await fetch(base + path, { method, headers: {
    'Content-Type': 'application/json', 'x-test-actor': String(actor),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
async function productState(id) {
  const stock = (await pool.request().input('pid', sql.Int, id)
    .query(`SELECT p.stock, p.is_active, v.id AS variant_id, v.stock AS variant_stock,
                   v.is_active AS variant_active
            FROM dbo.products p JOIN dbo.product_variants v ON v.product_id = p.id AND v.is_base = 1
            WHERE p.id = @pid;`)).recordset[0];
  const movements = (await pool.request().input('pid', sql.Int, id)
    .query(`SELECT id, variant_id, order_id, order_reference_id, movement_type, quantity_delta,
                   stock_before, stock_after, reason, actor_user_id
            FROM dbo.inventory_movements WHERE product_id = @pid ORDER BY created_at, id;`)).recordset;
  return { stock, movements };
}
async function setup() {
  const cat = (await pool.request().query('SELECT TOP (1) id FROM dbo.categories ORDER BY id;')).recordset[0];
  assert.ok(cat, 'a category is required');
  setupTx = new sql.Transaction(pool);
  await setupTx.begin();
  try {
    for (const role of ['customer', 'customer', 'admin']) {
      const id = (await new sql.Request(setupTx)
        .input('uid', sql.VarChar(128), `${tag}-${users.length}`)
        .input('role', sql.VarChar(20), role)
        .query('INSERT INTO dbo.users (firebase_uid, role) OUTPUT INSERTED.id VALUES (@uid, @role);'))
        .recordset[0].id;
      users.push(id);
      actors.set(id, { id, role, is_blacklisted: false });
    }
    actors.set(2147483000, { id: 2147483000, role: 'admin' }); // FK failure injection only
    const productId = (await new sql.Request(setupTx)
      .input('slug', sql.VarChar(160), tag)
      .input('cid', sql.Int, cat.id)
      .query(`INSERT INTO dbo.products (slug, name_vi, price, category_id, stock)
        OUTPUT INSERTED.id VALUES (@slug, N'Inventory test product', 100, @cid, 1);`))
      .recordset[0].id;
    products.push(productId);
    const variantId = (await new sql.Request(setupTx).input('pid', sql.Int, productId)
      .input('sku', sql.VarChar(80), `BR-P${productId}-BASE`)
      .query(`INSERT INTO dbo.product_variants (product_id, sku, stock, is_base)
        OUTPUT INSERTED.id VALUES (@pid, @sku, 1, 1);`)).recordset[0].id;
    await new sql.Request(setupTx).input('pid', sql.Int, productId).input('vid', sql.Int, variantId)
      .query(`INSERT INTO dbo.inventory_movements
        (product_id, variant_id, movement_type, quantity_delta, stock_before, stock_after)
        VALUES (@pid, @vid, 'PRODUCT_CREATE', 1, 0, 1);`);
    for (const uid of users.slice(0, 2)) {
      await new sql.Request(setupTx).input('uid', sql.Int, uid).input('pid', sql.Int, productId)
        .input('vid', sql.Int, variantId)
        .query('INSERT INTO dbo.cart_items (user_id, product_id, variant_id, quantity) VALUES (@uid, @pid, @vid, 1);');
    }
    await setupTx.commit(); setupTx = null;
    return { productId, categoryId: cat.id };
  } catch (err) {
    await setupTx.rollback(); setupTx = null;
    throw err;
  }
}
async function cleanup() {
  if (setupTx) { try { await setupTx.rollback(); } catch (_) { /* ended */ } }
  if (!pool) return;
  const found = await pool.request().input('tag', sql.VarChar(160), tag + '%').query(`
    SELECT id, 'user' AS kind FROM dbo.users WHERE firebase_uid LIKE @tag
    UNION ALL SELECT id, 'product' AS kind FROM dbo.products WHERE slug LIKE @tag;`);
  for (const row of found.recordset) {
    const ids = row.kind === 'user' ? users : products;
    if (!ids.includes(row.id)) ids.push(row.id);
  }
  // Use exact generated IDs. If setup rolled back, these deletes affect zero rows.
  for (const uid of users) {
    await pool.request().input('uid', sql.Int, uid)
      .query('DELETE FROM dbo.cart_items WHERE user_id = @uid;');
  }
  for (const pid of products) {
    await pool.request().input('pid', sql.Int, pid)
      .query('DELETE FROM dbo.inventory_movements WHERE product_id = @pid;');
  }
  for (const uid of users) {
    await pool.request().input('uid', sql.Int, uid)
      .query('DELETE FROM dbo.orders WHERE user_id = @uid;');
  }
  for (const pid of products) {
    await pool.request().input('pid', sql.Int, pid)
      .query('DELETE FROM dbo.product_variants WHERE product_id = @pid;');
  }
  for (const pid of products) {
    await pool.request().input('pid', sql.Int, pid)
      .query('DELETE FROM dbo.products WHERE id = @pid;');
  }
  for (const uid of users) {
    await pool.request().input('uid', sql.Int, uid)
      .query('DELETE FROM dbo.users WHERE id = @uid;');
  }
  const residue = (await pool.request().input('tag', sql.VarChar(160), tag + '%')
    .query(`SELECT (SELECT COUNT(*) FROM dbo.users WHERE firebase_uid LIKE @tag) AS users,
                   (SELECT COUNT(*) FROM dbo.products WHERE slug LIKE @tag) AS products;`)).recordset[0];
  assert.deepEqual([residue.users, residue.products], [0, 0]);
  await pool.close();
  console.log('Disposable SQL rows removed. PASS');
}

async function main() {
  try {
    pool = await getPool();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const { productId, categoryId } = await setup();

    const checkout = () => call('POST', '/api/orders', users[0], { paymentMethod: 'cod' });
    const otherCheckout = () => call('POST', '/api/orders', users[1], { paymentMethod: 'cod' });
    const two = await Promise.all([checkout(), otherCheckout()]);
    assert.deepEqual(two.map(x => x.status).sort(), [201, 409]);
    const winner = two.find(x => x.status === 201);
    orders.push(winner.body.order.id);
    let state = await productState(productId);
    assert.equal(state.stock.stock, 0);
    assert.equal(state.stock.variant_stock, 0);
    assert.equal(state.movements.filter(x => x.movement_type === 'ORDER_CHECKOUT').length, 1);
    assert.ok(state.movements.every(x => x.variant_id === state.stock.variant_id));
    assert.deepEqual(state.movements.slice(-1).map(x => [x.quantity_delta, x.stock_before, x.stock_after]),
      [[-1, 1, 0]]);
    console.log('Two concurrent checkouts at stock=1: one 201, one 409, one movement. PASS');

    const winnerUser = two[0].status === 201 ? users[0] : users[1];
    const loserUser = two[0].status === 201 ? users[1] : users[0];
    const cancels = await Promise.all([0, 1].map(() =>
      call('POST', `/api/orders/${orders[0]}/cancel`, winnerUser, { reason: 'wrong_item' })));
    assert.deepEqual(cancels.map(x => x.status).sort(), [200, 409]);
    state = await productState(productId);
    assert.equal(state.stock.stock, 1);
    assert.equal(state.stock.variant_stock, 1);
    assert.equal(state.movements.filter(x => x.movement_type === 'ORDER_CANCEL').length, 1);
    console.log('Cancel once / double cancel: stock=1, one cancel movement. PASS');

    const admin = users[2];
    assert.equal((await call('PUT', `/api/admin/products/${productId}`, admin,
      { stock: 5, stock_reason: 'New stock received' })).status, 200);
    assert.equal((await call('PUT', `/api/admin/products/${productId}`, admin,
      { stock: 15, stock_reason: 'New stock received' })).status, 200);
    assert.equal((await call('PUT', `/api/admin/products/${productId}`, admin,
      { stock: 8, stock_reason: 'Count correction' })).status, 200);
    assert.equal((await call('PUT', `/api/admin/products/${productId}`, admin,
      { stock: 8 })).status, 200);
    assert.equal((await call('PUT', `/api/admin/products/${productId}`, admin,
      { stock: 9 })).status, 400);
    state = await productState(productId);
    assert.deepEqual(state.movements.filter(x => x.movement_type === 'ADMIN_ADJUSTMENT')
      .map(x => [x.quantity_delta, x.stock_before, x.stock_after]),
    [[4, 1, 5], [10, 5, 15], [-7, 15, 8]]);
    assert.equal((await call('PUT', `/api/admin/products/${productId}`, 2147483000,
      { stock: 9, stock_reason: 'Injected FK failure' })).status, 500);
    assert.equal((await productState(productId)).stock.stock, 8);
    assert.equal((await productState(productId)).stock.variant_stock, 8);
    console.log('Admin 1->5, 5->15, 15->8, unchanged, missing reason and rollback. PASS');

    assert.equal((await call('GET', `/api/admin/products/${productId}/inventory-movements`, loserUser)).status, 403);
    const history = await call('GET', `/api/admin/products/${productId}/inventory-movements`, admin);
    assert.equal(history.status, 200);
    assert.equal(history.body.movements.length, state.movements.length);
    const created = await call('POST', '/api/admin/products', admin,
      { slug: `${tag}-created`, name_vi: 'Inventory create test', price: 100,
        category_id: categoryId, stock: 20 });
    assert.equal(created.status, 201);
    products.push(created.body.product.id);
    const newProduct = await productState(created.body.product.id);
    assert.equal(newProduct.stock.variant_stock, 20);
    assert.deepEqual(newProduct.movements.map(x => [x.movement_type, x.quantity_delta,
      x.stock_before, x.stock_after]), [['PRODUCT_CREATE', 20, 0, 20]]);
    assert.equal((await call('POST', '/api/admin/products', 2147483000,
      { slug: `${tag}-create-fail`, name_vi: 'Rollback create', price: 100,
        category_id: categoryId, stock: 4 })).status, 500);
    const failedCreate = (await pool.request().input('slug', sql.VarChar(160), `${tag}-create-fail`)
      .query('SELECT COUNT(*) AS n FROM dbo.products WHERE slug = @slug;')).recordset[0].n;
    assert.equal(failedCreate, 0);
    const added = await call('POST', '/api/cart', users[0],
      { product_id: created.body.product.id, quantity: 2 });
    assert.equal(added.status, 200);
    assert.equal(added.body.items.find(x => x.product_id === created.body.product.id).variant_id,
      newProduct.stock.variant_id);
    assert.equal((await call('DELETE', `/api/cart/variant/${newProduct.stock.variant_id}`, users[0])).status, 200);
    assert.equal((await call('DELETE', `/api/admin/products/${created.body.product.id}`, admin)).status, 200);
    const archived = await productState(created.body.product.id);
    assert.equal(archived.stock.is_active, false);
    assert.equal(archived.stock.variant_active, false);
    assert.equal((await call('POST', '/api/cart', users[0],
      { product_id: created.body.product.id, quantity: 1 })).status, 404);
    console.log('Admin create, customer base cart, variant delete, inactive purchase block. PASS');

    const race = await Promise.all([
      call('PUT', `/api/admin/products/${productId}`, admin, { stock: 10, stock_reason: 'Count correction' }),
      call('POST', '/api/orders', loserUser, { paymentMethod: 'cod' }),
    ]);
    assert.deepEqual(race.map(x => x.status).sort(), [200, 201]);
    orders.push(race.find(x => x.status === 201).body.order.id);
    state = await productState(productId);
    for (let i = 1; i < state.movements.length; i++) {
      assert.equal(state.movements[i].stock_before, state.movements[i - 1].stock_after);
    }
    assert.equal(state.movements.at(-1).stock_after, state.stock.stock);
    assert.equal(state.stock.stock, state.stock.variant_stock);
    console.log('Concurrent admin absolute adjustment + checkout: ordered chain matches stock. PASS');

    assert.equal((await call('DELETE', `/api/admin/orders/${orders[0]}`, admin)).status, 200);
    state = await productState(productId);
    assert.ok(state.movements.some(x => x.order_id == null && x.order_reference_id === orders[0]));
    console.log('Hard-deleted order keeps movement reference snapshot. PASS');

    await assert.rejects(pool.request().input('pid', sql.Int, productId)
      .input('vid', sql.Int, state.stock.variant_id)
      .input('before', sql.Int, state.stock.variant_stock)
      .query(`INSERT INTO dbo.inventory_movements
        (product_id, variant_id, movement_type, quantity_delta, stock_before, stock_after, reason)
        VALUES (@pid, @vid, 'ADMIN_ADJUSTMENT', 1, @before, @before, N'Invalid equation test');`),
    err => err.number === 547);
    const broken = (await pool.request().input('pid', sql.Int, productId)
      .input('vid', sql.Int, state.stock.variant_id)
      .input('wrong', sql.Int, state.stock.variant_stock + 1)
      .query(`INSERT INTO dbo.inventory_movements
        (product_id, variant_id, movement_type, quantity_delta, stock_before, stock_after, reason)
        OUTPUT INSERTED.id
        VALUES (@pid, @vid, 'ADMIN_ADJUSTMENT', 0, @wrong, @wrong, N'Chain detector test');`))
      .recordset[0].id;
    const audit = spawnSync(process.execPath,
      [path.join(__dirname, 'audit-inventory-movements.js')], { encoding: 'utf8' });
    assert.equal(audit.status, 1, audit.stderr);
    const auditResult = JSON.parse(audit.stdout.slice(audit.stdout.indexOf('{')));
    assert.ok(auditResult.issues.broken_chain.includes(broken));
    assert.ok(auditResult.issues.latest_variant_stock.includes(state.stock.variant_id));
    console.log('DB equation constraint and read-only chain detector negative control. PASS');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await cleanup();
  }
}

main().catch(err => { console.error('Inventory movements SQL test FAILED:', err.message); process.exitCode = 1; });
