'use strict';

// TASK 08: real HTTP + SQL Server on disposable rows; cleanup is restricted to rows created here.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const express = require('express');
const { execFileSync } = require('node:child_process');
const { getPool, sql } = require('../db');
const tag = `color-test-${process.pid}-${Date.now()}`;
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
  const response = await fetch(base + '/api/' + path, { method,
    headers: { 'Content-Type': 'application/json', 'x-test-actor': String(actor) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
async function admin(method, product, suffix, body) {
  return call(method, `admin/products/${product}/${suffix}`, users[2], body);
}
async function state(id) {
  const r = await admin('GET', id, 'colors');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
function variant(s, color, size = null) {
  return s.variants.find(v => v.color === color && v.size === size);
}
async function makeProduct(category, slug) {
  const c = (await pool.request().input('slug', sql.VarChar(120), category)
    .query('SELECT id FROM dbo.categories WHERE slug=@slug;')).recordset[0];
  const r = await call('POST', 'admin/products', users[2], {
    slug: `${slug}-${products.length}-${tag}`, name_vi: tag, price: 100, stock: 10, category_id: c.id,
    images: ['img/ao1.png'],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  products.push(r.body.product.id);
  return r.body.product.id;
}
async function cart(uid, pid, vid, quantity = 1) {
  return call('POST', 'cart', uid, { product_id: pid, variant_id: vid, quantity });
}
async function checkout(uid) { return call('POST', 'orders', uid, { paymentMethod: 'cod' }); }
async function cancel(uid, id) { return call('POST', `orders/${id}/cancel`, uid, { reason: 'wrong_item' }); }
async function dbReject(query, input, number, description) {
  await assert.rejects(pool.request().input('pid', sql.Int, input).query(query),
    e => number.includes(e.number), description);
}
async function main() {
  pool = await getPool();
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const role of ['customer', 'customer', 'admin']) {
      const id = (await pool.request().input('uid', sql.VarChar(128), `${tag}-${users.length}`)
        .input('role', sql.VarChar(20), role)
        .query('INSERT INTO dbo.users (firebase_uid,role) OUTPUT INSERTED.id VALUES (@uid,@role);')).recordset[0].id;
      users.push(id); actors.set(id, { id, role, is_blacklisted: false });
    }
    const [u1, u2] = users;
    const shirt = await makeProduct('sanpham-ao', 'ao-nam-test');
    const colorOnly = await makeProduct('handbags', 'tui-test');
    assert.equal((await admin('POST', shirt, 'sizes', { sizes: ['M'] })).status, 200);
    assert.equal((await admin('POST', shirt, 'size-allocation', { allocations: [{
      variant_id: (await state(shirt)).variants.find(v => v.size === 'M').id, quantity: 5,
    }] })).status, 200);
    assert.equal((await admin('POST', shirt, 'colors', { label: 'Đen', swatch_hex: '#000000' })).status, 200);
    assert.equal((await admin('POST', shirt, 'colors', { label: 'Trắng' })).status, 200);
    let s = await state(shirt);
    const black = s.colors.find(c => c.color_key === 'den');
    const white = s.colors.find(c => c.color_key === 'trang');
    assert.ok(black && white);
    assert.equal((await admin('POST', shirt, 'colors', { label: 'Đen' })).status, 409);
    assert.equal((await admin('POST', shirt, 'colors', { label: '<bad>' })).status, 400);
    assert.equal((await admin('POST', shirt, 'colors', { label: 'Xanh', swatch_hex: 'blue' })).status, 400);
    const blackM = variant(s, 'den', 'M').id, whiteM = variant(s, 'trang', 'M').id;
    const sourceM = variant(s, null, 'M').id;
    assert.equal((await admin('POST', shirt, 'size-allocation', {
      allocations: [{ variant_id: blackM, quantity: 1 }],
    })).status, 400, 'size endpoint cannot transfer BASE directly to a color target');
    await dbReject(`INSERT INTO dbo.product_variants (product_id,sku,size,color,stock)
      VALUES (@pid,'${tag}-dup-m','M','den',0);`, shirt, [2601,2627], 'duplicate size-color');
    await dbReject(`INSERT INTO dbo.product_variants (product_id,sku,size,color,stock)
      VALUES (@pid,'${tag}-orphan','M','purple',0);`, shirt, [547], 'orphan color variant');
    assert.equal((await admin('POST', shirt, `colors/${black.id}/images`, { image_path: 'img/ao1.png' })).status, 200);
    assert.equal((await admin('POST', shirt, `colors/${black.id}/images`, { image_path: '../bad.png' })).status, 400);
    s = await state(shirt);
    const image = s.colors.find(c => c.id === black.id).images[0];
    assert.equal(image.is_primary, true);
    assert.equal((await admin('POST', shirt, `colors/${black.id}/images`, {
      image_path: 'img/ao2.png', is_primary: true,
    })).status, 200);
    s = await state(shirt);
    const images = s.colors.find(c => c.id === black.id).images;
    assert.equal(images.length, 2);
    assert.equal(images.filter(i => i.is_primary).length, 1);
    assert.equal(images.find(i => i.is_primary).image_path, 'img/ao2.png');
    assert.equal((await admin('PUT', shirt, `colors/${black.id}/images/${image.id}`, {
      sort_order: 4, is_primary: true,
    })).status, 200);
    assert.equal((await state(shirt)).colors.find(c => c.id === black.id).images
      .find(i => i.id === image.id).is_primary, true);
    assert.equal((await admin('DELETE', shirt, `colors/${black.id}/images/${image.id}`)).status, 200);
    const remaining = (await state(shirt)).colors.find(c => c.id === black.id).images[0];
    assert.equal(remaining.is_primary, true);
    assert.equal((await admin('DELETE', shirt, `colors/${black.id}/images/${remaining.id}`)).status, 200);
    assert.equal((await state(shirt)).colors.find(c => c.id === black.id).images.length, 0);
    assert.equal((await admin('POST', shirt, 'color-allocation', { allocations: [
      { source_variant_id: sourceM, target_variant_id: blackM, quantity: 3, expected_source_stock: 5, expected_target_stock: 0 },
      { source_variant_id: sourceM, target_variant_id: whiteM, quantity: 2, expected_source_stock: 5, expected_target_stock: 0 },
    ] })).status, 200);
    s = await state(shirt);
    assert.deepEqual([variant(s, null, 'M').stock, variant(s,'den','M').stock,
      variant(s,'trang','M').stock, s.product.stock], [0,3,2,10]);
    assert.equal((await admin('POST', shirt, 'color-allocation', { allocations: [
      { source_variant_id: sourceM, target_variant_id: blackM, quantity: 1,
        expected_source_stock: 5, expected_target_stock: 0 },
    ] })).status, 409);
    assert.equal((await cart(u1, shirt, sourceM)).status, 404);
    assert.equal((await cart(u1, shirt, blackM, 4)).status, 409);
    assert.equal((await cart(u1, shirt, blackM)).status, 200);
    assert.equal((await cart(u1, shirt, whiteM)).status, 200);
    const lines = (await call('GET', 'cart', u1)).body.items;
    assert.equal(lines.length, 2);
    assert.deepEqual(new Set(lines.map(x => x.color)), new Set(['Đen','Trắng']));
    assert.equal((await call('DELETE', `cart/variant/${whiteM}`, u1)).status, 200);
    const order = await checkout(u1);
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const detail = (await call('GET', `orders/${order.body.order.id}`, u1)).body;
    assert.equal((detail.order || detail).items[0].color_snapshot, 'Đen');
    const cancelRace = await Promise.all([cancel(u1, order.body.order.id), cancel(u1, order.body.order.id)]);
    assert.deepEqual(cancelRace.map(x => x.status).sort(), [200,409]);
    assert.equal(variant(await state(shirt), 'den', 'M').stock, 3);
    const publicProduct = (await call('GET', `products/${shirt}`, u1)).body;
    assert.equal(publicProduct.stock, 5);
    assert.ok(publicProduct.variants.some(v => v.id === blackM));
    assert.ok(!publicProduct.variants.some(v => v.id === sourceM));

    assert.equal((await admin('POST', colorOnly, 'colors', { label: 'Black' })).status, 200);
    s = await state(colorOnly);
    const only = variant(s, 'black');
    assert.ok(only && only.size == null);
    await dbReject(`INSERT INTO dbo.product_variants (product_id,sku,color,stock)
      VALUES (@pid,'${tag}-dup-c','black',0);`, colorOnly, [2601,2627], 'duplicate color-only');
    assert.equal((await admin('POST', colorOnly, 'color-allocation', { allocations: [{
      source_variant_id: variant(s,null).id, target_variant_id: only.id, quantity: 1,
      expected_source_stock: 10, expected_target_stock: 0,
    }] })).status, 200);
    assert.equal((await cart(u1, colorOnly, only.id)).status, 200);
    assert.equal((await checkout(u1)).status, 201);
    assert.equal((await admin('POST', colorOnly, 'color-sizes', { size: 'M' })).status, 400);
    const history = (await admin('GET', shirt, 'inventory-movements?limit=100')).body.movements;
    assert.ok(history.some(x => x.variant_id === blackM && x.color === 'Đen' && x.movement_type === 'ORDER_CHECKOUT'));
    assert.equal(history.filter(x => x.movement_type.startsWith('VARIANT_TRANSFER'))
      .reduce((sum,x) => sum + x.quantity_delta, 0), 0);
    // Exact-color checkout race: one unit of Black M cannot be sold twice.
    assert.equal((await admin('PUT', shirt, `color-variants/${blackM}`, {
      stock: 1, expected_stock: 3, reason: 'Disposable concurrency test',
    })).status, 200);
    assert.equal((await cart(u1, shirt, blackM)).status, 200);
    assert.equal((await cart(u2, shirt, blackM)).status, 200);
    const race = await Promise.all([checkout(u1), checkout(u2)]);
    assert.deepEqual(race.map(x => x.status).sort(), [201,409]);
    assert.equal(variant(await state(shirt), 'den', 'M').stock, 0);
    assert.equal(variant(await state(shirt), 'trang', 'M').stock, 2);
    const winner = race.findIndex(x => x.status === 201);
    assert.equal((await cancel(users[winner], race[winner].body.order.id)).status, 200);
    assert.equal(variant(await state(shirt), 'den', 'M').stock, 1);
    await call('DELETE', `cart/variant/${blackM}`, users[1-winner]);

    // Failed ledger write must roll back both sides of a transfer.
    assert.equal((await admin('POST', shirt, 'color-sizes', { size: 'S' })).status, 200);
    s = await state(shirt);
    const sourceS = variant(s, null, 'S').id, blackS = variant(s, 'den', 'S').id;
    assert.equal((await admin('POST', shirt, 'size-allocation', { allocations: [
      { variant_id: sourceS, quantity: 2 },
    ] })).status, 200);
    actors.set(2147483000, { id: 2147483000, role: 'admin' });
    const transfer = { allocations: [{ source_variant_id: sourceS, target_variant_id: blackS,
      quantity: 1, expected_source_stock: 2, expected_target_stock: 0 }] };
    const failedTransfer = await call('POST', `admin/products/${shirt}/color-allocation`, 2147483000, transfer);
    assert.equal(failedTransfer.status, 500);
    s = await state(shirt);
    assert.deepEqual([variant(s,null,'S').stock,variant(s,'den','S').stock], [2,0]);
    assert.equal((await admin('POST', shirt, 'color-allocation', transfer)).status, 200);
    assert.equal((await cart(u2, shirt, blackS)).status, 200);
    const competingTransfer = { allocations: [{ source_variant_id: sourceS, target_variant_id: blackS,
      quantity: 1, expected_source_stock: 1, expected_target_stock: 1 }] };
    const concurrent = await Promise.all([checkout(u2), admin('POST', shirt, 'color-allocation', competingTransfer)]);
    assert.equal(concurrent[0].status, 201);
    assert.ok([200,409].includes(concurrent[1].status));
    s = await state(shirt);
    assert.ok(variant(s,null,'S').stock >= 0 && variant(s,'den','S').stock >= 0);
    assert.equal(s.variants.reduce((n,v) => n + v.stock, 0), s.product.stock);
    assert.equal((await cancel(u2, concurrent[0].body.order.id)).status, 200);
    assert.equal((await admin('PUT', shirt, `colors/${white.id}`, { is_active: false })).status, 200);
    const hidden = (await call('GET', `products/${shirt}`, u1)).body;
    assert.ok(!hidden.colors.some(c => c.key === 'trang'));
    assert.ok(!hidden.variants.some(v => v.id === whiteM));
    assert.equal((await cart(u1, shirt, whiteM)).status, 404);
    assert.equal((await admin('PUT', shirt, `colors/${white.id}`, { is_active: true })).status, 200);
    execFileSync(process.execPath, [require('node:path').join(__dirname, 'audit-inventory-movements.js')], { stdio: 'pipe' });
    console.log('Color-only, size×color, uniqueness/FK, images, allocation, cart, checkout, snapshot, cancel, ledger: PASS');
    console.log('Same-color checkout 201+409; transfer rollback and transfer/checkout race; inactive color: PASS');
    console.log('Read-only audit with disposable color data: PASS');
  } finally {
    for (const uid of users) await pool.request().input('uid', sql.Int, uid).query(`
      UPDATE dbo.inventory_movements SET order_id=NULL WHERE order_id IN (SELECT id FROM dbo.orders WHERE user_id=@uid);
      DELETE FROM dbo.order_items WHERE order_id IN (SELECT id FROM dbo.orders WHERE user_id=@uid);
      DELETE FROM dbo.orders WHERE user_id=@uid;
      DELETE FROM dbo.cart_items WHERE user_id=@uid;`);
    for (const pid of products) await pool.request().input('pid', sql.Int, pid).query(`
      DELETE FROM dbo.inventory_movements WHERE product_id=@pid;
      DELETE FROM dbo.product_variants WHERE product_id=@pid;
      DELETE FROM dbo.product_color_images WHERE color_id IN (SELECT id FROM dbo.product_colors WHERE product_id=@pid);
      DELETE FROM dbo.product_colors WHERE product_id=@pid;
      DELETE FROM dbo.products WHERE id=@pid;`);
    for (const uid of users) await pool.request().input('uid', sql.Int, uid)
      .query('DELETE FROM dbo.users WHERE id=@uid;');
    await new Promise(resolve => server.close(resolve));
    await pool.close();
    console.log('Disposable TASK 08 rows cleaned up.');
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
