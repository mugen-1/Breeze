'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { getPool } = require('../db');
const { businessState } = require('./audit-order-shipping');

async function audit(pool) {
  const meta = await pool.request().query(`
    SELECT OBJECT_ID('dbo.reviews','U') AS reviews, OBJECT_ID('dbo.review_images','U') AS review_images;
    SELECT c.name, t.name AS type, c.max_length, c.is_nullable FROM sys.columns c
      JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID('dbo.reviews');
    SELECT name,is_disabled,is_not_trusted,delete_referential_action_desc FROM sys.foreign_keys
      WHERE parent_object_id IN (OBJECT_ID('dbo.reviews'),OBJECT_ID('dbo.review_images')) ORDER BY name;
    SELECT name,is_disabled,is_not_trusted FROM sys.check_constraints
      WHERE parent_object_id IN (OBJECT_ID('dbo.reviews'),OBJECT_ID('dbo.review_images')) ORDER BY name;
    SELECT name,is_unique,is_disabled,filter_definition FROM sys.indexes
      WHERE object_id IN (OBJECT_ID('dbo.reviews'),OBJECT_ID('dbo.review_images')) AND name IN ('UX_reviews_user_product','UQ_review_images_sort');`);
  assert.ok(meta.recordsets[0][0].reviews && meta.recordsets[0][0].review_images, 'Review tables missing');
  const columns = Object.fromEntries(meta.recordsets[1].map(c => [c.name,c]));
  for (const name of ['id','user_id','product_id','order_item_id','variant_id','size_snapshot','color_snapshot','rating','comment','is_hidden','created_at','updated_at']) assert.ok(columns[name], name);
  assert.equal(columns.comment.type, 'nvarchar'); assert.equal(columns.comment.max_length, 2000); assert.equal(columns.comment.is_nullable, true);
  assert.equal(columns.rating.type, 'tinyint'); assert.equal(columns.rating.is_nullable, false);
  assert.equal(columns.is_hidden.type, 'bit'); assert.equal(columns.is_hidden.is_nullable, false);
  assert.deepEqual(meta.recordsets[2].map(r => [r.name,r.is_disabled,r.is_not_trusted,r.delete_referential_action_desc]), [
    ['FK_review_images_review',false,false,'CASCADE'], ['FK_reviews_order_item',false,false,'SET_NULL'],
    ['FK_reviews_product',false,false,'NO_ACTION'], ['FK_reviews_user',false,false,'SET_NULL'],
    ['FK_reviews_variant_product',false,false,'NO_ACTION']
  ]);
  assert.deepEqual(meta.recordsets[3].map(r => [r.name,r.is_disabled,r.is_not_trusted]), [
    ['CK_review_images_path',false,false], ['CK_review_images_sort',false,false], ['CK_reviews_rating',false,false]
  ]);
  assert.equal(meta.recordsets[4].length, 2);
  for (const index of meta.recordsets[4]) { assert.equal(index.is_unique, true); assert.equal(index.is_disabled, false); }
  assert.match(meta.recordsets[4].find(i => i.name === 'UX_reviews_user_product').filter_definition, /user_id.*IS NOT NULL/i);
  const keys = (await pool.request().query(`SELECT i.name,c.name AS column_name
    FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
    JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
    WHERE i.object_id IN (OBJECT_ID('dbo.reviews'),OBJECT_ID('dbo.review_images'))
      AND i.name IN ('UX_reviews_user_product','UQ_review_images_sort') AND ic.key_ordinal>0
    ORDER BY i.name,ic.key_ordinal;`)).recordset;
  assert.deepEqual(keys.map(k => [k.name,k.column_name]), [
    ['UQ_review_images_sort','review_id'],['UQ_review_images_sort','sort_order'],
    ['UX_reviews_user_product','user_id'],['UX_reviews_user_product','product_id']
  ]);
  const counts = (await pool.request().query(`SELECT (SELECT COUNT(*) FROM dbo.reviews) AS reviews,
    (SELECT COUNT(*) FROM dbo.review_images) AS review_images;`)).recordset[0];
  return { ...counts, trusted_foreign_keys: 5, trusted_checks: 3, unique_indexes: 2 };
}
async function main() {
  const pool = await getPool();
  try {
    if (process.argv.includes('--migrate')) {
      const before = await businessState(pool);
      const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/019_reviews.sql'), 'utf8');
      await pool.request().batch(migration); await pool.request().batch(migration);
      assert.deepEqual(await businessState(pool), before, '019 must preserve every existing business row');
      console.log('019 migration twice: existing user/product/order/cart/inventory/payment data unchanged. PASS');
    }
    console.log(JSON.stringify(await audit(pool)));
  } finally { await pool.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
module.exports = { audit };
