'use strict';

// TASK 04.6: exercise the historical chain and 010 on a disposable database.
// The generated database name is checked before CREATE/DROP; BreezeShopDB is
// never an execution target for setup-db --fresh or migration 003 here.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const { sql, config } = require('../db');

const dbName = `BreezeMigrationTest_${process.pid}_${Date.now()}`;
if (!/^BreezeMigrationTest_[0-9]+_[0-9]+$/.test(dbName)) throw new Error('Unsafe test DB name');
const quotedName = `[${dbName}]`;
const serverDir = path.join(__dirname, '..');
const testEnv = { ...process.env, DB_NAME: dbName };
let testPool, created = false;
const movementTypes = ['OPENING_BALANCE', 'VARIANT_OPENING', 'ORDER_CHECKOUT',
  'ORDER_CANCEL', 'ADMIN_ADJUSTMENT', 'PRODUCT_CREATE',
  'VARIANT_TRANSFER_OUT', 'VARIANT_TRANSFER_IN'];

function adminSql(statement) {
  return execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', statement], {
    encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
}

function run(file, args = []) {
  return execFileSync(process.execPath, [file, ...args], {
    cwd: serverDir, env: testEnv, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
}

async function state() {
  const r = await testPool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.products) AS products,
      (SELECT COUNT(*) FROM dbo.order_items oi LEFT JOIN dbo.products p
       ON p.id = oi.product_id WHERE p.id IS NULL) AS orphans,
      (SELECT COUNT(*) FROM dbo.products WHERE id = 51 AND is_active = 0 AND stock = 0) AS archived51,
      (SELECT COUNT(*) FROM dbo.inventory_movements WHERE movement_type = 'OPENING_BALANCE') AS openings;
    SELECT is_disabled, is_not_trusted, delete_referential_action_desc
    FROM sys.foreign_keys WHERE name = 'FK_order_items_product'
      AND parent_object_id = OBJECT_ID('dbo.order_items');`);
  return { ...r.recordsets[0][0], fk: r.recordsets[1] };
}

async function movementConstraint() {
  const rows = (await testPool.request().query(`SELECT definition, is_disabled, is_not_trusted
    FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.inventory_movements')
      AND name = 'CK_inventory_movements_type';`)).recordset;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].is_disabled, false);
  assert.equal(rows[0].is_not_trusted, false);
  return rows[0].definition;
}

async function main() {
  try {
    assert.equal(execFileSync('git', ['hash-object', 'db/migrations/012_product_variants.sql'],
      { cwd: serverDir, encoding: 'utf8' }).trim(), 'bcf5df302ad1ed8f17e53324c3907fb5e66f5f61');
    adminSql(`CREATE DATABASE ${quotedName};`);
    created = true;
    const login = `[${String(config.user).replace(/]/g, ']]')}]`;
    adminSql(`ALTER AUTHORIZATION ON DATABASE::${quotedName} TO ${login};`);
    console.log('Created disposable database:', dbName);

    const setup = run('scripts/setup-db.js', ['--fresh', '--before-variants']);
    assert.match(setup, /db\/migrations\/003_remove_nhan\.sql/);
    assert.match(setup, /db\/migrations\/010_product_order_integrity\.sql/);
    assert.match(setup, /db\/migrations\/011_inventory_movements\.sql/);
    assert.doesNotMatch(setup, /db\/migrations\/012_product_variants\.sql/);
    assert.doesNotMatch(setup, /db\/migrations\/013_size_variants\.sql/);
    assert.doesNotMatch(setup, /db\/migrations\/014_inventory_transfer_types\.sql/);
    assert.doesNotMatch(setup, /db\/migrations\/015_color_variants\.sql/);
    assert.doesNotMatch(setup, /db\/migrations\/remove_nhan\.sql/);
    testPool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    let current = await state();
    assert.equal(current.products, 50);
    assert.equal(current.openings, 50);
    assert.equal(current.orphans, 0);
    assert.deepEqual(current.fk.map(x => [x.is_disabled, x.is_not_trusted, x.delete_referential_action_desc]),
      [[false, false, 'NO_ACTION']]);
    console.log('Fresh full setup: 50 products, 0 orphans, trusted FK. PASS');

    // Reproduce the old 003 outcome inside this disposable database only.
    const ringCategory = (await testPool.request().query(`
      INSERT INTO dbo.categories (slug, name_vi, name_en)
      OUTPUT INSERTED.id VALUES ('nhan', N'Nhẫn', N'Rings');`)).recordset[0].id;
    await testPool.request().input('cid', sql.Int, ringCategory).query(`
      SET IDENTITY_INSERT dbo.products ON;
      INSERT INTO dbo.products (id, slug, name_vi, price, category_id, stock, is_active)
      VALUES (51, 'nhan-vo-so', N'Nhẫn Vỏ Sò', 89000, @cid, 7, 1);
      SET IDENTITY_INSERT dbo.products OFF;`);
    const user = (await testPool.request().query(`
      INSERT INTO dbo.users (firebase_uid) OUTPUT INSERTED.id
      VALUES ('migration-chain-test-user');`)).recordset[0].id;
    const order = (await testPool.request().input('uid', sql.Int, user).query(`
      INSERT INTO dbo.orders (user_id, status, total_amount) OUTPUT INSERTED.id
      VALUES (@uid, 'pending', 178000);`)).recordset[0].id;
    await testPool.request().input('oid', sql.Int, order).query(`
      INSERT INTO dbo.order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
      VALUES (@oid, 51, N'Nhẫn Vỏ Sò', 89000, 2, 178000);`);

    run('db/run-sql.js', ['db/migrations/003_remove_nhan.sql']);
    current = await state();
    assert.equal(current.orphans, 1);
    assert.equal(current.fk.length, 0);
    console.log('Historical 003 in test DB: orphan reproduced, FK removed. PASS');

    run('db/run-sql.js', ['db/migrations/010_product_order_integrity.sql']);
    current = await state();
    assert.equal(current.products, 51);
    assert.equal(current.orphans, 0);
    assert.equal(current.archived51, 1);
    assert.deepEqual(current.fk.map(x => [x.is_disabled, x.is_not_trusted, x.delete_referential_action_desc]),
      [[false, false, 'NO_ACTION']]);
    const snapshot = await testPool.request().input('oid', sql.Int, order).query(`
      SELECT product_name, unit_price FROM dbo.order_items WHERE order_id = @oid;`);
    assert.deepEqual(snapshot.recordset.map(x => [x.product_name, x.unit_price]), [['Nhẫn Vỏ Sò', 89000]]);
    const active = await testPool.request().query(`
      SELECT COUNT(*) AS n FROM dbo.products WHERE id = 51 AND is_active = 1;`);
    assert.equal(active.recordset[0].n, 0);

    run('db/run-sql.js', ['db/migrations/010_product_order_integrity.sql']);
    const again = await state();
    assert.deepEqual(again, current);
    console.log('010 repair + rerun: ID 51 inactive/stock 0, snapshot preserved, trusted FK. PASS');

    run('db/run-sql.js', ['db/migrations/011_inventory_movements.sql']);
    current = await state();
    assert.equal(current.openings, 51);
    run('db/run-sql.js', ['db/migrations/011_inventory_movements.sql']);
    assert.deepEqual(await state(), current);
    console.log('011 opening balances: 50 fresh + recovered 51, rerun does not duplicate. PASS');

    await testPool.request().input('uid', sql.Int, user).query(`
      INSERT INTO dbo.cart_items (user_id, product_id, quantity) VALUES (@uid, 51, 3);`);
    const cartBefore = (await testPool.request().input('uid', sql.Int, user).query(`
      SELECT COUNT(*) AS rows, SUM(quantity) AS quantity FROM dbo.cart_items WHERE user_id = @uid;`)).recordset[0];

    run('db/run-sql.js', ['db/migrations/012_product_variants.sql']);
    const historicalConstraint = await movementConstraint();
    for (const type of movementTypes.slice(0, 6)) assert.ok(historicalConstraint.includes(type));
    for (const type of movementTypes.slice(6)) assert.ok(!historicalConstraint.includes(type));
    let variantState = (await testPool.request().query(`SELECT
      (SELECT COUNT(*) FROM dbo.product_variants WHERE is_base = 1) AS bases,
      (SELECT COUNT(*) FROM dbo.order_items WHERE variant_id IS NULL) AS unmapped_items,
      (SELECT COUNT(*) FROM dbo.inventory_movements WHERE movement_type = 'VARIANT_OPENING') AS transitions;`)).recordset[0];
    assert.deepEqual(variantState, { bases: 51, unmapped_items: 0, transitions: 51 });
    const variantCheck = (await testPool.request().query(`SELECT
      (SELECT COUNT(*) FROM dbo.products p JOIN dbo.product_variants v
       ON v.product_id = p.id AND v.is_base = 1 WHERE p.stock <> v.stock) AS stock_mismatch,
      (SELECT COUNT(*) FROM dbo.products p JOIN dbo.product_variants v
       ON v.product_id = p.id AND v.is_base = 1 WHERE p.is_active <> v.is_active) AS active_mismatch,
      (SELECT COUNT(*) FROM sys.key_constraints WHERE name = 'UQ_cart_items_user_variant') AS cart_variant_unique,
      (SELECT COUNT(*) FROM sys.key_constraints WHERE name = 'UQ_cart_items_user_product') AS old_cart_unique;`)).recordset[0];
    assert.deepEqual(variantCheck, { stock_mismatch: 0, active_mismatch: 0,
      cart_variant_unique: 1, old_cart_unique: 0 });
    const cartAfter = (await testPool.request().input('uid', sql.Int, user).query(`
      SELECT COUNT(*) AS rows, SUM(ci.quantity) AS quantity,
        SUM(CASE WHEN v.is_base = 1 AND v.product_id = ci.product_id THEN 1 ELSE 0 END) AS mapped
      FROM dbo.cart_items ci LEFT JOIN dbo.product_variants v ON v.id = ci.variant_id
      WHERE ci.user_id = @uid;`)).recordset[0];
    assert.deepEqual([cartAfter.rows, cartAfter.quantity, cartAfter.mapped],
      [cartBefore.rows, cartBefore.quantity, cartBefore.rows]);
    const identity = (await testPool.request().input('oid', sql.Int, order).query(`
      SELECT oi.product_name, oi.unit_price, oi.quantity, v.is_base, v.product_id
      FROM dbo.order_items oi JOIN dbo.product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id = @oid;`)).recordset[0];
    assert.deepEqual([identity.product_name, identity.unit_price, identity.quantity,
      identity.is_base, identity.product_id], ['Nhẫn Vỏ Sò', 89000, 2, true, 51]);
    await assert.rejects(testPool.request().query(`INSERT INTO dbo.product_variants
      (product_id, sku, stock, is_base) VALUES (-1, 'orphan-test', 0, 1);`),
    e => e.number === 547);
    await assert.rejects(testPool.request().input('uid', sql.Int, user).query(`
      INSERT INTO dbo.cart_items (user_id, product_id, variant_id, quantity)
      VALUES (@uid, 51, -1, 1);`), e => e.number === 547);
    const uniqueSku = (await testPool.request().query(`
      SELECT COUNT(*) AS all_variants, COUNT(DISTINCT sku) AS unique_skus FROM dbo.product_variants;`)).recordset[0];
    assert.equal(uniqueSku.all_variants, uniqueSku.unique_skus);
    await assert.rejects(testPool.request().query(`INSERT INTO dbo.product_variants
      (product_id, sku, stock, is_base) VALUES (51, 'BR-P51-BASE', 0, 0);`),
    e => [2601, 2627].includes(e.number));
    await assert.rejects(testPool.request().query(`INSERT INTO dbo.product_variants
      (product_id, sku, stock, is_base) VALUES (51, 'second-base-test', 0, 1);`),
    e => [2601, 2627].includes(e.number));
    run('db/run-sql.js', ['db/migrations/012_product_variants.sql']);
    assert.deepEqual((await testPool.request().query(`SELECT
      (SELECT COUNT(*) FROM dbo.product_variants WHERE is_base = 1) AS bases,
      (SELECT COUNT(*) FROM dbo.order_items WHERE variant_id IS NULL) AS unmapped_items,
      (SELECT COUNT(*) FROM dbo.inventory_movements WHERE movement_type = 'VARIANT_OPENING') AS transitions;`)).recordset[0], variantState);
    console.log('012 cutover: 51 bases/transitions, cart qty and order snapshots retained, trusted FKs and SKU, rerun idempotent. PASS');

    const beforeSizes = JSON.stringify((await testPool.request().query('SELECT id,stock FROM dbo.product_variants ORDER BY id;')).recordset);
    run('db/run-sql.js', ['db/migrations/013_size_variants.sql']);
    run('db/run-sql.js', ['db/migrations/013_size_variants.sql']);
    for (const type of movementTypes) assert.ok((await movementConstraint()).includes(type));
    assert.equal(JSON.stringify((await testPool.request().query('SELECT id,stock FROM dbo.product_variants ORDER BY id;')).recordset), beforeSizes);
    assert.equal((await testPool.request().query('SELECT COUNT(*) AS n FROM dbo.order_items WHERE size_snapshot IS NOT NULL;')).recordset[0].n, 0);
    console.log('013 rerun: no stock distribution, no variant creation, historical size snapshots NULL. PASS');

    run('db/run-sql.js', ['db/migrations/014_inventory_transfer_types.sql']);
    run('db/run-sql.js', ['db/migrations/014_inventory_transfer_types.sql']);
    for (const type of movementTypes) assert.ok((await movementConstraint()).includes(type));
    assert.equal(JSON.stringify((await testPool.request().query('SELECT id,stock FROM dbo.product_variants ORDER BY id;')).recordset), beforeSizes);
    console.log('014 forward constraint + rerun: all 8 movement types, trusted, stock unchanged. PASS');

    // Negative control on the disposable DB: 014 must repair a historical six-type CHECK.
    await testPool.request().query(`ALTER TABLE dbo.inventory_movements DROP CONSTRAINT CK_inventory_movements_type;
      ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT CK_inventory_movements_type CHECK
        (movement_type IN ('OPENING_BALANCE','VARIANT_OPENING','ORDER_CHECKOUT','ORDER_CANCEL',
                           'ADMIN_ADJUSTMENT','PRODUCT_CREATE'));`);
    run('db/run-sql.js', ['db/migrations/014_inventory_transfer_types.sql']);
    for (const type of movementTypes) assert.ok((await movementConstraint()).includes(type));
    assert.equal(JSON.stringify((await testPool.request().query('SELECT id,stock FROM dbo.product_variants ORDER BY id;')).recordset), beforeSizes);
    console.log('014 negative control: historical six-type CHECK repaired without stock changes. PASS');

    run('db/run-sql.js', ['db/migrations/015_color_variants.sql']);
    run('db/run-sql.js', ['db/migrations/015_color_variants.sql']);
    const colorSchema = (await testPool.request().query(`SELECT
      (SELECT COUNT(*) FROM dbo.product_colors) AS colors,
      (SELECT COUNT(*) FROM dbo.product_color_images) AS images,
      (SELECT COUNT(*) FROM dbo.product_variants WHERE color IS NOT NULL) AS color_variants,
      (SELECT COUNT(*) FROM dbo.order_items WHERE color_snapshot IS NOT NULL) AS color_snapshots,
      (SELECT COUNT(*) FROM sys.foreign_keys WHERE name IN
        ('FK_product_colors_product','FK_product_color_images_color','FK_product_variants_color')
        AND is_disabled = 0 AND is_not_trusted = 0) AS trusted_color_fks;`)).recordset[0];
    assert.deepEqual(colorSchema, { colors: 0, images: 0, color_variants: 0,
      color_snapshots: 0, trusted_color_fks: 3 });
    assert.equal(JSON.stringify((await testPool.request().query('SELECT id,stock FROM dbo.product_variants ORDER BY id;')).recordset), beforeSizes);
    console.log('015 rerun: color schema trusted, no invented rows/snapshots, stock unchanged. PASS');

    // Prove filtered unique indexes and NO ACTION references in the fresh schema.
    const colorId = (await testPool.request().query(`INSERT INTO dbo.product_colors
      (product_id,color_key,label) OUTPUT INSERTED.id VALUES (51,'black',N'Black');`)).recordset[0].id;
    await assert.rejects(testPool.request().query(`INSERT INTO dbo.product_colors
      (product_id,color_key,label) VALUES (51,'black',N'Duplicate');`),
    e => [2601,2627].includes(e.number));
    await testPool.request().query(`INSERT INTO dbo.product_variants (product_id,sku,color,stock)
      VALUES (51,'migration-black','black',0);`);
    await assert.rejects(testPool.request().query(`INSERT INTO dbo.product_variants (product_id,sku,color,stock)
      VALUES (51,'migration-black-duplicate','black',0);`), e => [2601,2627].includes(e.number));
    await testPool.request().query(`INSERT INTO dbo.product_variants (product_id,sku,size,color,stock)
      VALUES (51,'migration-black-m','M','black',0);`);
    await assert.rejects(testPool.request().query(`INSERT INTO dbo.product_variants (product_id,sku,size,color,stock)
      VALUES (51,'migration-black-m-duplicate','M','black',0);`), e => [2601,2627].includes(e.number));
    await assert.rejects(testPool.request().query(`INSERT INTO dbo.product_variants (product_id,sku,color,stock)
      VALUES (51,'migration-orphan-color','white',0);`), e => e.number === 547);
    await testPool.request().input('cid', sql.Int, colorId).query(`INSERT INTO dbo.product_color_images
      (color_id,image_path,is_primary) VALUES (@cid,'img/a.png',1);`);
    await assert.rejects(testPool.request().input('cid', sql.Int, colorId).query(`INSERT INTO dbo.product_color_images
      (color_id,image_path,is_primary) VALUES (@cid,'img/b.png',1);`), e => [2601,2627].includes(e.number));
    await assert.rejects(testPool.request().query(`DELETE FROM dbo.product_colors WHERE id=${colorId};`),
      e => e.number === 547);
    console.log('015 filtered uniqueness, color/image FK and NO ACTION negative controls: PASS');

    const beforeShipping = JSON.stringify((await testPool.request().query('SELECT * FROM dbo.orders ORDER BY id;')).recordset);
    run('db/run-sql.js', ['db/migrations/016_order_shipping.sql']);
    run('db/run-sql.js', ['db/migrations/016_order_shipping.sql']);
    const shippingRows = (await testPool.request().query('SELECT * FROM dbo.orders ORDER BY id;')).recordset;
    for (const row of shippingRows) {
      for (const key of ['shipping_version','shipping_ward','shipping_district','shipping_city','delivery_note','shipping_method','shipping_fee']) {
        assert.equal(row[key], null);
        delete row[key];
      }
    }
    assert.equal(JSON.stringify(shippingRows), beforeShipping);
    console.log('016 rerun: all historical shipping fields remain NULL, original orders unchanged. PASS');

    // A real v1 snapshot must survive the upgrade byte for byte.
    await testPool.request().input('u', sql.Int, user).query(`INSERT INTO dbo.orders(user_id,status,total_amount,
      shipping_version,shipping_name,shipping_phone,shipping_address,shipping_ward,shipping_district,shipping_city,shipping_method,shipping_fee)
      VALUES(@u,'pending',20000,1,N'Legacy','0901234567',N'Address',N'Ward',N'District',N'City','STANDARD',20000);`);
    const beforeSimulationState = await state();
    const beforeSimulation = (await testPool.request().query('SELECT * FROM dbo.orders ORDER BY id;')).recordset;
    run('db/run-sql.js', ['db/migrations/017_order_shipping_simulation.sql']);
    run('db/run-sql.js', ['db/migrations/017_order_shipping_simulation.sql']);
    const afterSimulation = (await testPool.request().query('SELECT * FROM dbo.orders ORDER BY id;')).recordset;
    for (const row of afterSimulation) for (const key of ['order_code','shipping_provider','shipping_service','shipping_eta','shipping_tracking_code','shipping_status']) {
      assert.equal(row[key], null); delete row[key];
    }
    assert.deepEqual(afterSimulation, beforeSimulation);
    assert.equal((await testPool.request().query('SELECT last_code FROM dbo.order_code_counter;')).recordset[0].last_code, 1000);
    assert.deepEqual(await state(), beforeSimulationState);
    console.log('017 upgrade twice preserves all legacy/v1 fields, IDs, inventory and FKs; counter starts at 1000: PASS');

    const beforePayments = await state();
    const originalOrders = (await testPool.request().query('SELECT * FROM dbo.orders ORDER BY id;')).recordset;
    run('db/run-sql.js', ['db/migrations/018_payment_transactions.sql']);
    run('db/run-sql.js', ['db/migrations/018_payment_transactions.sql']);
    assert.deepEqual(await state(), beforePayments);
    assert.deepEqual((await testPool.request().query('SELECT * FROM dbo.orders ORDER BY id;')).recordset, originalOrders);
    assert.equal((await testPool.request().query('SELECT COUNT(*) AS n FROM dbo.payment_transactions;')).recordset[0].n, 0);
    console.log('018 upgrade twice preserves legacy/v1 orders and inventory without fabricating payments: PASS');

    const beforeReviews = await state();
    run('db/run-sql.js', ['db/migrations/019_reviews.sql']);
    run('db/run-sql.js', ['db/migrations/019_reviews.sql']);
    assert.deepEqual(await state(), beforeReviews);
    assert.deepEqual((await testPool.request().query('SELECT * FROM dbo.orders ORDER BY id;')).recordset, originalOrders);
    assert.deepEqual((await testPool.request().query(`SELECT (SELECT COUNT(*) FROM dbo.reviews) AS reviews,
      (SELECT COUNT(*) FROM dbo.review_images) AS review_images;`)).recordset[0], { reviews: 0, review_images: 0 });
    run('scripts/audit-reviews.js');
    console.log('019 upgrade twice: no seeded reviews, business data preserved, trusted schema. PASS');

    const fullSetup = run('scripts/setup-db.js', ['--fresh']);
    assert.match(fullSetup, /db\/migrations\/012_product_variants\.sql/);
    assert.match(fullSetup, /db\/migrations\/013_size_variants\.sql/);
    assert.match(fullSetup, /db\/migrations\/014_inventory_transfer_types\.sql/);
    assert.match(fullSetup, /db\/migrations\/015_color_variants\.sql/);
    assert.match(fullSetup, /db\/migrations\/016_order_shipping\.sql/);
    assert.match(fullSetup, /db\/migrations\/018_payment_transactions\.sql/);
    assert.match(fullSetup, /db\/migrations\/019_reviews\.sql/);
    variantState = (await testPool.request().query(`SELECT
      (SELECT COUNT(*) FROM dbo.products) AS products,
      (SELECT COUNT(*) FROM dbo.product_variants WHERE is_base = 1) AS bases,
      (SELECT COUNT(*) FROM dbo.inventory_movements WHERE movement_type = 'VARIANT_OPENING') AS transitions;`)).recordset[0];
    assert.deepEqual(variantState, { products: 50, bases: 50, transitions: 50 });
    run('scripts/audit-inventory-movements.js');
    for (const type of movementTypes) assert.ok((await movementConstraint()).includes(type));
    run('scripts/audit-order-shipping.js');
    run('scripts/audit-order-payment.js');
    run('scripts/audit-reviews.js');
    console.log('Fresh full setup through 019 and read-only audits: PASS');
  } finally {
    if (testPool) await testPool.close();
    if (created) {
      // Only the checked, generated disposable name can reach DROP DATABASE.
      adminSql(`ALTER DATABASE ${quotedName} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${quotedName};`);
      console.log('Dropped disposable database:', dbName);
    }
  }
}

main().catch(e => { console.error('Migration chain verification FAILED:', e.message); process.exitCode = 1; });
