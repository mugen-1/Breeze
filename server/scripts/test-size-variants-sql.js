'use strict';

// Real HTTP + SQL Server. Only rows created by this process are cleaned up.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const express = require('express');
const { execFileSync } = require('node:child_process');
const { getPool, sql } = require('../db');
const { APPAREL, MEN_SHOES } = require('../lib/size-variants');
const tag = `size-test-${process.pid}-${Date.now()}`;
const users = [], products = [], actors = new Map();
let pool, server, base;
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { exports: { verifyFirebaseToken(req, res, next) {
  req.user = actors.get(Number(req.headers['x-test-actor']));
  if (!req.user) return res.sendStatus(401);
  next();
} } };
const app = express();
app.use(express.json());
for (const route of ['admin', 'cart', 'orders', 'products']) app.use('/api/' + route, require('../routes/' + route));
async function call(method, path, actor, body) {
  const r = await fetch(base + '/api/' + path, { method,
    headers: { 'Content-Type': 'application/json', 'x-test-actor': String(actor) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await r.json();
  return { status: r.status, body: data };
}
async function state(id) { return (await call('GET', `admin/products/${id}/sizes`, users[2])).body; }
function variant(s, size) { return s.variants.find(v => v.size === size); }
async function change(id, suffix, body, method = 'POST', actor = users[2]) {
  return call(method, `admin/products/${id}/${suffix}`, actor, body);
}
async function setStock(id, size, stock, active = true) {
  const v = variant(await state(id), size);
  const r = await change(id, 'sizes/' + v.id, { stock, expected_stock: v.stock, is_active: active, reason: 'Disposable SQL test' }, 'PUT');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return v.id;
}
async function makeProduct(category, slug) {
  const c = (await pool.request().input('slug', sql.VarChar(120), category)
    .query('SELECT id FROM dbo.categories WHERE slug = @slug;')).recordset[0];
  const r = await call('POST', 'admin/products', users[2], {
    slug: slug + '-' + products.length + '-' + tag, name_vi: tag, price: 100, stock: 10, category_id: c.id,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  products.push(r.body.product.id);
  return r.body.product.id;
}
async function cart(uid, pid, vid, quantity = 1) {
  return call('POST', 'cart', uid, { product_id: pid, variant_id: vid, quantity });
}
async function checkout(uid) { return call('POST', 'orders', uid, { paymentMethod: 'cod', size: 'FAKE', stock: 999 }); }
async function main() {
  pool = await getPool();
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const role of ['customer', 'customer', 'admin']) {
      const id = (await pool.request().input('uid', sql.VarChar(128), tag + '-' + users.length)
        .input('role', sql.VarChar(20), role)
        .query('INSERT INTO dbo.users (firebase_uid, role) OUTPUT INSERTED.id VALUES (@uid,@role);')).recordset[0].id;
      users.push(id); actors.set(id, { id, role, is_blacklisted: false });
    }
    const [u1, u2, admin] = users;
    const shirt = await makeProduct('sanpham-ao', 'ao-nam-test');
    const shoes = await makeProduct('sanpham-giay', 'giay-nam-test');
    const unknown = await makeProduct('sanpham-giay', 'unclassified');
    assert.equal((await change(shirt, 'sizes', { sizes: APPAREL }, 'POST', u1)).status, 403);
    assert.equal((await change(shirt, 'sizes', { sizes: ['XS'] })).status, 400);
    assert.equal((await change(shoes, 'sizes', { sizes: ['EU 40'] })).status, 400);
    assert.equal((await change(unknown, 'sizes', { sizes: ['40'] })).status, 400);
    assert.equal((await change(shirt, 'sizes', { sizes: ['M', 'M'] })).status, 409);
    actors.set(2147483000, { id: 2147483000, role: 'admin' });
    assert.equal((await change(shirt, 'sizes', { sizes: APPAREL }, 'POST', 2147483000)).status, 500);
    assert.equal((await state(shirt)).variants.length, 1, 'failed opening movement rolls back variants');
    assert.equal((await change(shirt, 'sizes', { sizes: APPAREL })).status, 200);
    assert.equal((await change(shoes, 'sizes', { sizes: MEN_SHOES })).status, 200);
    assert.equal((await change(shirt, 'sizes', { sizes: ['M'] })).status, 409);
    let s = await state(shirt);
    assert.deepEqual(s.variants.filter(v => !v.is_base).map(v => v.size), APPAREL);
    assert.deepEqual((await state(shoes)).variants.filter(v => !v.is_base).map(v => v.size), MEN_SHOES);
    assert.equal(s.product.stock, 10);
    assert.equal(variant(s, null).stock, 10);
    assert.ok(s.variants.filter(v => !v.is_base).every(v => v.stock === 0));
    const m = variant(s, 'M').id, l = variant(s, 'L').id, baseId = variant(s, null).id;
    await assert.rejects(pool.request().input('pid', sql.Int, shirt)
      .input('sku', sql.VarChar(80), tag + '-duplicate')
      .query("INSERT INTO dbo.product_variants (product_id,sku,size,stock) VALUES (@pid,@sku,'M',0);"),
      e => [2601,2627].includes(e.number), 'DB unique index rejects duplicate size');
    await assert.rejects(pool.request().input('pid', sql.Int, shirt)
      .input('sku', sql.VarChar(80), tag + '-invalid')
      .query("INSERT INTO dbo.product_variants (product_id,sku,size,stock) VALUES (@pid,@sku,'EU 40',0);"),
      e => e.number === 547, 'DB constraint rejects invalid size label');
    assert.equal((await cart(u1, shirt, undefined)).status, 404);
    assert.equal((await cart(u1, shirt, baseId)).status, 404);
    assert.equal((await cart(u1, shirt, m)).status, 409);
    assert.equal((await cart(u1, shoes, m)).status, 404);
    let publicProduct = (await call('GET', 'products/' + shirt, u1)).body;
    assert.equal(publicProduct.available, false);
    assert.equal(publicProduct.stock, 0, 'unallocated BASE is not sellable');
    assert.equal((await change(shirt, 'size-allocation', { allocations: [{ variant_id: m, quantity: 11 }] })).status, 409);
    assert.equal((await change(shirt, 'size-allocation', { allocations: [{ variant_id: m, quantity: 5 }] }, 'POST', 2147483000)).status, 500);
    assert.equal(variant(await state(shirt), null).stock, 10, 'failed transfer ledger rolls back BASE');
    assert.equal(variant(await state(shirt), 'M').stock, 0, 'failed transfer rolls back target');
    assert.equal((await change(shirt, 'size-allocation', { allocations: [{ variant_id: m, quantity: 5 }, { variant_id: l, quantity: 3 }] })).status, 200);
    s = await state(shirt);
    assert.deepEqual([variant(s, null).stock, variant(s, 'M').stock, variant(s, 'L').stock, s.product.stock], [2,5,3,10]);
    assert.equal(variant(s, null).is_active, true, 'BASE with unallocated stock remains active');
    assert.equal((await change(shirt, 'size-allocation', { allocations: [{ variant_id: l, quantity: 2 }] })).status, 200);
    assert.equal((await state(shirt)).product.stock, 10);
    assert.equal((await call('PUT', 'admin/products/' + shirt, admin, { stock: 50, stock_reason: 'bad path' })).status, 409);
    assert.equal((await cart(u1, shirt, m, 6)).status, 409);
    assert.equal((await cart(u1, shirt, m, 2)).status, 200);
    const twoLines = await cart(u1, shirt, l, 1);
    assert.equal(twoLines.status, 200);
    assert.equal(twoLines.body.items.length, 2);
    assert.deepEqual(twoLines.body.items.map(x => x.size).sort(), ['L','M']);
    assert.equal((await call('DELETE', 'cart/variant/' + l, u1)).status, 200);
    const order = await checkout(u1);
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal(variant(await state(shirt), 'M').stock, 3);
    const detail = (await call('GET', 'orders/' + order.body.order.id, u1)).body;
    const item = (detail.order || detail).items[0];
    assert.equal(item.variant_id, m); assert.equal(item.size_snapshot, 'M');
    const cancel = await Promise.all([1,2].map(() => call('POST', 'orders/' + order.body.order.id + '/cancel', u1, { reason: 'wrong_item' })));
    assert.deepEqual(cancel.map(x => x.status).sort(), [200,409]);
    assert.equal(variant(await state(shirt), 'M').stock, 5);
    console.log('Classification, whitelist, identity, zero stock, rollback, partial/full allocation, cart, size snapshot, double cancel: PASS');

    await setStock(shirt, 'M', 1); await setStock(shirt, 'L', 2);
    assert.equal((await cart(u1, shirt, m)).status, 200);
    assert.equal((await cart(u2, shirt, m)).status, 200);
    const race = await Promise.all([checkout(u1), checkout(u2)]);
    assert.deepEqual(race.map(x => x.status).sort(), [201,409]);
    s = await state(shirt);
    assert.deepEqual([variant(s,'M').stock, variant(s,'L').stock], [0,2]);
    const winner = race.findIndex(x => x.status === 201);
    assert.equal((await call('POST', 'orders/' + race[winner].body.order.id + '/cancel', users[winner], { reason: 'wrong_item' })).status, 200);
    assert.equal(variant(await state(shirt), 'M').stock, 1);
    await call('DELETE', 'cart/variant/' + m, u1); await call('DELETE', 'cart/variant/' + m, u2);
    await cart(u1, shirt, m); await cart(u2, shirt, l);
    const differentSizes = await Promise.all([checkout(u1), checkout(u2)]);
    assert.deepEqual(differentSizes.map(x => x.status), [201,201]);
    s = await state(shirt);
    assert.deepEqual([variant(s,'M').stock,variant(s,'L').stock], [0,1]);
    for (let i = 0; i < 2; i++) assert.equal((await call('POST', 'orders/' + differentSizes[i].body.order.id + '/cancel',
      users[i], { reason: 'wrong_item' })).status,200);
    await cart(u1, shirt, l);
    const adjustRace = await Promise.all([checkout(u1), change(shirt, 'sizes/' + l,
      { stock: 5, expected_stock: 2, reason: 'Concurrent test' }, 'PUT')]);
    assert.equal(adjustRace[0].status, 201);
    assert.ok([200,409].includes(adjustRace[1].status));
    await setStock(shirt, 'L', 5);
    const stale = await change(shirt, 'sizes/' + l, { stock: 9, expected_stock: 2, reason: 'stale' }, 'PUT');
    assert.equal(stale.status, 409); assert.equal(stale.body.error, 'STALE_STOCK');
    await setStock(shirt, 'M', 1, false);
    assert.equal((await cart(u1, shirt, m)).status, 404);
    publicProduct = (await call('GET', 'products/' + shirt, u1)).body;
    assert.ok(!publicProduct.variants.some(v => v.id === m));
    assert.equal((await state(shirt)).product.stock, 6, 'inactive physical stock included');
    const history = (await call('GET', `admin/products/${shirt}/inventory-movements?limit=100`, admin)).body.movements;
    assert.ok(history.some(x => x.variant_id === m && x.size === 'M' && x.movement_type === 'ORDER_CHECKOUT'));
    assert.equal(history.filter(x => x.movement_type.startsWith('VARIANT_TRANSFER')).reduce((sum,x) => sum+x.quantity_delta,0),0);
    console.log('SQL concurrency: same size 201+409, different sizes 201+201, cancel once, stale admin guarded, inactive aggregate and history: PASS');
    execFileSync(process.execPath, [require('path').join(__dirname, 'audit-inventory-movements.js')], { stdio: 'pipe' });
    console.log('Read-only variant/ledger audit with disposable size data: PASS');
  } finally {
    for (const uid of users) {
      await pool.request().input('uid', sql.Int, uid).query(`
        UPDATE dbo.inventory_movements SET order_id = NULL WHERE order_id IN (SELECT id FROM dbo.orders WHERE user_id = @uid);
        DELETE FROM dbo.order_items WHERE order_id IN (SELECT id FROM dbo.orders WHERE user_id = @uid);
        DELETE FROM dbo.orders WHERE user_id = @uid;
        DELETE FROM dbo.cart_items WHERE user_id = @uid;`);
    }
    for (const pid of products) await pool.request().input('pid', sql.Int, pid).query(`
      DELETE FROM dbo.inventory_movements WHERE product_id = @pid;
      DELETE FROM dbo.product_variants WHERE product_id = @pid;
      DELETE FROM dbo.products WHERE id = @pid;`);
    for (const uid of users) await pool.request().input('uid', sql.Int, uid).query('DELETE FROM dbo.users WHERE id = @uid;');
    await new Promise(resolve => server.close(resolve));
    await pool.close();
    console.log('Disposable products/users/cart/orders/variants/movements cleaned up.');
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
