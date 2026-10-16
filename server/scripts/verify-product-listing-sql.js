'use strict';

// Real Product API queries on a disposable database; never edit the shop catalog.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const express = require('express');
const shopDatabase = process.env.DB_NAME;
const dbName = 'BreezeProductListingTest_' + process.pid + '_' + Date.now();
if (!/^BreezeProductListingTest_[0-9]+_[0-9]+$/.test(dbName) || dbName === shopDatabase) throw Error('Unsafe test database');
process.env.DB_NAME = dbName;
const { sql, config, getPool } = require('../db');
const { readCatalog, checkListings } = require('../tools/product-listing-check');
const quoted = '[' + dbName + ']';
let pool, server, base, created = false, checks = 0;
function adminSql(query) {
  execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' });
}
function same(label, actual, expected) {
  assert.deepEqual(actual, expected, label); checks++; console.log('PASS: ' + label);
}
async function product(slug, category, active = true, sale = null) {
  const id = (await pool.request().input('slug', sql.VarChar(160), slug)
    .input('category', sql.VarChar(120), category).input('active', sql.Bit, active).input('sale', sql.Int, sale)
    .query(`INSERT INTO dbo.products(slug, name_vi, price, sale_price, category_id, stock, is_active)
      OUTPUT INSERTED.id VALUES(@slug, N'Áo kiểm thử', 1000, @sale,
        (SELECT id FROM dbo.categories WHERE slug=@category), 10, @active);`)).recordset[0].id;
  await pool.request().input('pid', sql.Int, id).query(`
    INSERT INTO dbo.product_variants(product_id, sku, stock, is_base)
    VALUES(@pid, 'LIST-' + CONVERT(VARCHAR(11), @pid) + '-BASE', 10, 1);`);
  return id;
}
async function response(query = '') {
  const r = await fetch(base + '/api/products' + query);
  return { status: r.status, body: await r.text() };
}
async function verify(expectedIds, count) {
  const responses = { all: await response(), category: await response('?category=sanpham-ao&onsale=0'), sale: await response('?onsale=1') };
  same('category HTTP 200', responses.category.status, 200);
  const actual = JSON.parse(responses.category.body);
  same('Expected: ' + count + ' / Actual: ' + actual.length, actual.length, count);
  same('eligible shirt IDs only, without duplicates', actual.map(p => p.id).sort((a, b) => a - b), expectedIds.slice().sort((a, b) => a - b));
  const result = checkListings(await readCatalog(), responses);
  same('regression ID comparison against SQL: ' + result.detail, result.ok, true);
}
async function main() {
  try {
    adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
    console.log('Created disposable database:', dbName);
    execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 1024 * 1024,
    });
    pool = await getPool();
    same('fixture writes are restricted to the generated database', (await pool.request().query('SELECT DB_NAME() AS name;')).recordset[0].name, dbName);
    await pool.request().query('UPDATE dbo.products SET is_active=0;');
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await product('listing-shirt-' + i, 'sanpham-ao'));
    await product('listing-sale', 'sanpham-ao', true, 500);
    await product('listing-other', 'sanpham-quan');
    await product('listing-inactive', 'sanpham-ao', false);
    // Several variants must still produce one card, including when sellable stock is zero.
    await pool.request().input('pid', sql.Int, ids[0]).query(`
      INSERT INTO dbo.product_variants(product_id, sku, size, stock, is_base)
      VALUES(@pid, 'LIST-S', N'S', 0, 0), (@pid, 'LIST-M', N'M', 0, 0),
            (@pid, 'LIST-L', N'L', 0, 0), (@pid, 'LIST-XL', N'XL', 0, 0);`);
    const app = express(); app.use('/api/products', require('../routes/products'));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    await verify(ids, 6);
    const added = await product('listing-seventh', 'sanpham-ao'); ids.push(added);
    await verify(ids, 7);
    await pool.request().input('pid', sql.Int, added).query('UPDATE dbo.products SET is_active=0 WHERE id=@pid;');
    ids.pop(); await verify(ids, 6);
    same('unknown category is an empty list', JSON.parse((await response('?category=listing-missing')).body), []);
    console.log('SQL PRODUCT LISTING VERIFY:', checks, 'checks passed.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.close();
    if (created) {
      adminSql('ALTER DATABASE ' + quoted + ' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + quoted + ';');
      console.log('Dropped disposable database:', dbName);
    }
  }
}
main().catch(error => { console.error('Product listing verification FAILED:', error.code || error.message); process.exitCode = 1; });
