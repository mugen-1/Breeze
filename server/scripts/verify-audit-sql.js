'use strict';

// lib/audit.js với transaction THẬT trên DATABASE TẠM riêng (setup-db --fresh, gồm migration 025).
// Không ghi gì vào DB chính trong .env: chỉ SELECT order_code_counter trước/sau để chứng minh không đổi.
// DB tạm xoá trong finally. Mẫu giống test-inventory-movements-sql.js .
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const mainDb = process.env.DB_NAME;
const dbName = `BreezeAuditTest_${process.pid}_${Date.now()}`;
if (!/^BreezeAuditTest_[0-9]+_[0-9]+$/.test(dbName) || dbName.toLowerCase() === String(mainDb).toLowerCase()) {
  throw new Error('Unsafe test database');
}
process.env.DB_NAME = dbName; // trước require('../db'): getPool() trỏ vào DB tạm
const { getPool, sql, config } = require('../db');
if (config.database !== dbName) throw new Error('Unsafe test database');
const { audit } = require('../lib/audit');
// Hook onCommitting trên transaction thật.
const { cancelOrder } = require('../lib/cancel-order');
const { changeSizes, readSizes } = require('../lib/size-variants');
const { changeColors, readColors } = require('../lib/color-variants');
const { changeOwnerReview } = require('../lib/review-owner');
const { setReviewVisibility } = require('../lib/review-admin');

const quotedDb = `[${dbName}]`;
let pool, server, createdDb = false, failures = 0, reviewDir = null; // reviewDir: thư mục ảnh đánh giá tạm
function adminSql(statement) {
  return execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-h', '-1', '-Q',
    'SET NOCOUNT ON; ' + statement], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
async function mainCounter() { // chỉ đọc DB chính
  const main = await new sql.ConnectionPool({ ...config, database: mainDb }).connect();
  try { return (await main.request().query('SELECT last_code FROM dbo.order_code_counter WHERE id = 1;')).recordset[0].last_code; }
  finally { await main.close(); }
}
async function mainRoleCounts() { // chỉ đọc DB chính: số tài khoản theo từng role
  const main = await new sql.ConnectionPool({ ...config, database: mainDb }).connect();
  try { return (await main.request().query('SELECT role, COUNT(*) AS n FROM dbo.users GROUP BY role ORDER BY role;')).recordset; }
  finally { await main.close(); }
}
async function item(name, fn) {
  try { await fn(); console.log(`${name}: PASS`); }
  catch (err) { failures++; console.log(`${name}: FAIL — ${err.message}`); }
}
const reqOf = (role, id = 11) => ({ user: { id, email: `${role}@example.test`, role }, ip: '::ffff:203.0.113.5',
  socket: {}, headers: { 'user-agent': 'verify-audit-sql' } });
async function inTx(fn, commit = true) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try { const out = await fn(tx); if (commit) await tx.commit(); else await tx.rollback(); return out; }
  catch (err) { try { await tx.rollback(); } catch (_) { /* SQL đã tự rollback */ } throw err; }
}
const count = async () => (await pool.request().query('SELECT COUNT(*) AS n FROM dbo.audit_logs;')).recordset[0].n;
const rowOf = async id => (await pool.request().input('id', sql.BigInt, id).query(`SELECT *, ISJSON(before_json) AS before_ok,
  ISJSON(after_json) AS after_ok FROM dbo.audit_logs WHERE id = @id;`)).recordset;
function keysDeep(v, out = []) {
  if (Array.isArray(v)) v.forEach(x => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
}

async function main() {
  const counterBefore = await mainCounter();
  const rolesBefore = await mainRoleCounts();
  let firstId;
  try {
    adminSql(`CREATE DATABASE ${quotedDb};`); createdDb = true;
    adminSql(`ALTER AUTHORIZATION ON DATABASE::${quotedDb} TO [${String(config.user).replace(/]/g, ']]')}];`);
    console.log('Created disposable database:', dbName);
    execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], { cwd: path.join(__dirname, '..'),
      env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 2 * 1024 * 1024 });
    pool = await getPool();
    assert.equal(await count(), 0);

    await item('1. audit() + commit -> đúng 1 dòng, cột đúng, ISJSON = 1', async () => {
      firstId = await inTx(tx => audit(tx, reqOf('admin'), { action: 'PRODUCT_UPDATE', entityType: 'product', entityId: 5,
        before: { price: 100, name: 'Áo' }, after: { price: 120, name: 'Áo' } }));
      assert.equal(await count(), 1);
      const [r] = await rowOf(firstId);
      assert.ok(r && r.created_at instanceof Date);
      assert.deepEqual([r.actor_user_id, r.actor_email, r.actor_role, r.action, r.entity_type, r.entity_id],
        [11, 'admin@example.test', 'admin', 'PRODUCT_UPDATE', 'product', '5']);
      assert.deepEqual([r.before_json, r.after_json], ['{"price":100}', '{"price":120}']);
      assert.deepEqual([r.before_ok, r.after_ok], [1, 1]);
      assert.deepEqual([r.ip, r.user_agent], ['203.0.113.5', 'verify-audit-sql']);
      console.log(`   id trả về = ${JSON.stringify(firstId)} (${typeof firstId}), khớp dòng đã ghi`);
    });

    await item('2. audit() + rollback -> 0 dòng mới', async () => {
      const before = await count();
      const id = await inTx(tx => audit(tx, reqOf('staff'), { action: 'ORDER_STATUS_CHANGE', entityType: 'order',
        entityId: 9, before: { status: 'pending' }, after: { status: 'confirmed' } }), false);
      assert.equal(await count(), before);
      assert.equal((await rowOf(id)).length, 0);
    });

    await item('3. thao tác giả + audit() action sai -> throw, caller rollback, thao tác giả cũng mất', async () => {
      const product = (await pool.request().query('SELECT TOP (1) id, name_vi FROM dbo.products ORDER BY id;')).recordset[0];
      const logs = await count();
      await assert.rejects(inTx(async tx => {
        const upd = await new sql.Request(tx).input('id', sql.Int, product.id)
          .query("UPDATE dbo.products SET name_vi = N'AUDIT FAKE CHANGE' WHERE id = @id;");
        assert.equal(upd.rowsAffected[0], 1);
        await audit(tx, reqOf('admin'), { action: 'NOT_AN_ACTION', entityType: 'product', entityId: product.id,
          before: { name_vi: product.name_vi }, after: { name_vi: 'AUDIT FAKE CHANGE' } });
      }), /action không hợp lệ/);
      const now = (await pool.request().input('id', sql.Int, product.id)
        .query('SELECT name_vi FROM dbo.products WHERE id = @id;')).recordset[0].name_vi;
      assert.equal(now, product.name_vi);
      assert.equal(await count(), logs);
    });

    await item('4. log customer: actor_email NULL, JSON không còn address/phone/card*/token', async () => {
      const id = await inTx(tx => audit(tx, reqOf('customer', 21), { action: 'ORDER_PLACE', entityType: 'order', entityId: 77,
        before: null, after: { status: 'pending', total: 105000, shipping_address: '12 Test Street', shipping_phone: '0901234567',
          card_last4: '1111', idToken: 'secret-token', items: [{ qty: 1, phone: '0909', cardBrand: 'visa' }] } }));
      const [r] = await rowOf(id);
      assert.deepEqual([r.actor_role, r.actor_user_id, r.actor_email, r.before_json, r.after_ok], ['customer', 21, null, null, 1]);
      const keys = keysDeep(JSON.parse(r.after_json));
      assert.deepEqual(keys.filter(k => /address|phone|card|token/i.test(k)), []);
      assert.deepEqual(JSON.parse(r.after_json), { status: 'pending', total: 105000, items: [{ qty: 1 }] });
    });

    await item("5. log req = null + actor.role 'cli': ip, user_agent NULL", async () => {
      const id = await inTx(tx => audit(tx, null, { action: 'ROLE_CHANGE', entityType: 'user', entityId: 3,
        actor: { role: 'cli', email: 'ops@example.test' }, before: { role: 'customer' }, after: { role: 'staff' } }));
      const [r] = await rowOf(id);
      assert.deepEqual([r.actor_role, r.actor_user_id, r.actor_email, r.ip, r.user_agent],
        ['cli', null, 'ops@example.test', null, null]);
      assert.deepEqual([r.before_json, r.after_json], ['{"role":"customer"}', '{"role":"staff"}']);
    });

    await item('6. UPDATE / DELETE dòng audit() vừa ghi -> trigger chặn (51000), dòng còn nguyên', async () => {
      assert.ok(firstId != null, 'cần dòng của mục 1');
      const original = (await rowOf(firstId))[0];
      for (const q of ["UPDATE dbo.audit_logs SET action = 'ORDER_DELETE' WHERE id = @id;", 'DELETE FROM dbo.audit_logs WHERE id = @id;']) {
        await assert.rejects(pool.request().input('id', sql.BigInt, firstId).query(q),
          e => e.number === 51000 && e.message === 'audit_logs chỉ cho phép thêm, không được sửa hoặc xoá');
      }
      assert.deepEqual((await rowOf(firstId))[0], original);
    });

    // ---- hook onCommitting với transaction thật (hook giả ném lỗi -> rollback toàn bộ) ----
    const uid = (await pool.request().query("INSERT INTO dbo.users(firebase_uid) OUTPUT INSERTED.id VALUES('audit-hook-user');")).recordset[0].id;
    const pick = async where => (await pool.request().query(`SELECT TOP (1) p.id, v.id AS base FROM dbo.products p
      JOIN dbo.categories c ON c.id = p.category_id JOIN dbo.product_variants v ON v.product_id = p.id AND v.is_base = 1
      WHERE p.is_active = 1 AND ${where} ORDER BY p.id;`)).recordset[0];
    const apparel = await pick("c.slug = 'sanpham-ao'");
    const plain = await pick("c.slug NOT IN ('sanpham-ao','sanpham-quan','sanpham-giay')");
    const other = await pick(`p.id NOT IN (${apparel.id}, ${plain.id})`);
    const stateOf = async pid => {
      const r = await pool.request().input('pid', sql.Int, pid).query(`
        SELECT id, stock FROM dbo.products WHERE id = @pid;
        SELECT id, size, color, stock, is_active FROM dbo.product_variants WHERE product_id = @pid ORDER BY id;
        SELECT COUNT(*) AS n FROM dbo.inventory_movements WHERE product_id = @pid;`);
      return { product: r.recordsets[0], variants: r.recordsets[1], movements: r.recordsets[2][0].n };
    };
    const boom = () => Object.assign(new Error('hook giả lỗi'), { tag: 'hook' });
    const isBoom = e => e && e.tag === 'hook';

    await item('7. cancelOrder: hook ném lỗi -> đơn giữ trạng thái cũ, tồn kho cộng lại bị rollback', async () => {
      const oid = (await pool.request().input('uid', sql.Int, uid).query(`INSERT INTO dbo.orders(user_id,status,total_amount)
        OUTPUT INSERTED.id VALUES(@uid,'pending',200);`)).recordset[0].id;
      await pool.request().input('oid', sql.Int, oid).input('pid', sql.Int, other.id).input('vid', sql.Int, other.base)
        .query(`INSERT INTO dbo.order_items(order_id,product_id,variant_id,product_name,unit_price,quantity,line_total)
          VALUES(@oid,@pid,@vid,N'Hook fixture',100,2,200);`);
      const before = await stateOf(other.id);
      let seen;
      await assert.rejects(cancelOrder(pool, { orderId: oid, ownerId: uid, reason: 'Test', actorUserId: uid,
        onCommitting: async (tx, result, ctx) => {
          seen = { status: result.status, before: ctx.before, stock: (await new sql.Request(tx).input('vid', sql.Int, other.base)
            .query('SELECT stock FROM dbo.product_variants WHERE id = @vid;')).recordset[0].stock };
          throw boom();
        } }), isBoom);
      assert.deepEqual([seen.status, seen.before], ['cancelled', { status: 'pending', user_id: uid }]);
      assert.equal(seen.stock, before.variants.find(v => v.id === other.base).stock + 2, 'trong tx hook thấy kho đã cộng lại');
      assert.equal((await pool.request().input('oid', sql.Int, oid).query('SELECT status FROM dbo.orders WHERE id=@oid;')).recordset[0].status, 'pending');
      assert.deepEqual(await stateOf(other.id), before);
    });

    await item('8. changeSizes: hook ném lỗi -> size / tồn kho / ledger không đổi', async () => {
      await changeSizes(pool, apparel.id, uid, 'configure', { sizes: ['S', 'M'] });
      const before = await stateOf(apparel.id);
      const m = before.variants.find(v => v.size === 'M');
      await assert.rejects(changeSizes(pool, apparel.id, uid, 'adjust', { variant_id: m.id, stock: 5, expected_stock: m.stock,
        reason: 'Hook test' }, { onCommitting: async () => { throw boom(); } }), isBoom);
      await assert.rejects(changeSizes(pool, apparel.id, uid, 'configure', { sizes: ['L'] },
        { onCommitting: async () => { throw boom(); } }), isBoom);
      assert.deepEqual(await stateOf(apparel.id), before);
    });

    await item('9. changeSizes / changeColors: kết quả CÓ hook deepEqual kết quả KHÔNG hook (cùng kịch bản)', async () => {
      const m = (await stateOf(apparel.id)).variants.find(v => v.size === 'M');
      const adjust = (stock, expected, opts) => changeSizes(pool, apparel.id, uid, 'adjust',
        { variant_id: m.id, stock, expected_stock: expected, reason: 'Hook parity' }, opts);
      const noHook = await adjust(m.stock + 5, m.stock);
      await adjust(m.stock, m.stock + 5);                       // trả về đúng trạng thái ban đầu
      const calls = [];
      const withHook = await adjust(m.stock + 5, m.stock, { onCommitting: async (...a) => { calls.push(a); } });
      assert.deepEqual(withHook, noHook);
      assert.deepEqual(withHook, await readSizes(pool, apparel.id), 'khớp lần đọc lại qua pool sau commit');
      assert.equal(calls.length, 1); assert.equal(calls[0][1], withHook);
      assert.equal(calls[0][2].before.variants.find(v => v.id === m.id).stock, m.stock);

      await changeColors(pool, plain.id, uid, 'create', { label: 'Đen hook', swatch_hex: '#111111' });
      const cv = (await stateOf(plain.id)).variants.find(v => v.color != null);
      const cadjust = (stock, expected, opts) => changeColors(pool, plain.id, uid, 'adjust',
        { variant_id: cv.id, stock, expected_stock: expected, reason: 'Hook parity' }, opts);
      const cNoHook = await cadjust(3, 0);
      await cadjust(0, 3);
      const cWithHook = await cadjust(3, 0, { onCommitting: async () => {} });
      assert.deepEqual(cWithHook, cNoHook);
      assert.deepEqual(cWithHook, await readColors(pool, plain.id));
      const cBefore = await stateOf(plain.id);
      await assert.rejects(cadjust(9, 3, { onCommitting: async () => { throw boom(); } }), isBoom);
      assert.deepEqual(await stateOf(plain.id), cBefore, 'changeColors hook lỗi -> không đổi');
    });

    const rid = (await pool.request().input('uid', sql.Int, uid).input('pid', sql.Int, apparel.id).input('vid', sql.Int, apparel.base)
      .query(`INSERT INTO dbo.reviews(user_id,product_id,variant_id,rating,comment)
        OUTPUT INSERTED.id VALUES(@uid,@pid,@vid,4,N'Hook fixture');`)).recordset[0].id;
    const hiddenOf = async () => (await pool.request().input('rid', sql.Int, rid)
      .query('SELECT is_hidden FROM dbo.reviews WHERE id=@rid;')).recordset[0].is_hidden;

    await item('10. setReviewVisibility: hook lỗi -> không đổi; hook OK -> đổi, ctx.before đúng; đã đúng trạng thái -> không gọi hook', async () => {
      await assert.rejects(setReviewVisibility(pool, rid, true, { onCommitting: async () => { throw boom(); } }), isBoom);
      assert.equal(await hiddenOf(), false);
      const calls = [];
      const value = await setReviewVisibility(pool, rid, true, { onCommitting: async (...a) => { calls.push(a); } });
      assert.deepEqual(value, { id: rid, isHidden: true });
      assert.equal(await hiddenOf(), true);
      assert.equal(calls.length, 1); assert.equal(calls[0][1], value);
      assert.deepEqual(calls[0][2], { before: { isHidden: false }, product_id: apparel.id });
      const again = [];
      assert.deepEqual(await setReviewVisibility(pool, rid, true, { onCommitting: async (...a) => { again.push(a); } }), value);
      assert.equal(again.length, 0);
    });

    await item('11. changeOwnerReview (xoá): hook ném lỗi -> review vẫn còn', async () => {
      const storage = { removed: [], async remove(paths) { this.removed.push(...paths); } };
      await assert.rejects(changeOwnerReview(pool, { userId: uid, productId: apparel.id, reviewId: rid, storage, removeReview: true,
        onCommitting: async () => { throw boom(); } }), isBoom);
      assert.equal((await pool.request().input('rid', sql.Int, rid).query('SELECT COUNT(*) AS n FROM dbo.reviews WHERE id=@rid;')).recordset[0].n, 1);
      const calls = [];
      assert.equal(await changeOwnerReview(pool, { userId: uid, productId: apparel.id, reviewId: rid, storage, removeReview: true,
        onCommitting: async (...a) => { calls.push(a); } }), null);
      assert.deepEqual([calls.length, calls[0][1], calls[0][2].before.review.id], [1, null, rid]);
      assert.equal((await pool.request().input('rid', sql.Int, rid).query('SELECT COUNT(*) AS n FROM dbo.reviews WHERE id=@rid;')).recordset[0].n, 0);
    });

    // ---- log sản phẩm qua HTTP, router /api/admin THẬT, đăng nhập giả đọc id/email/role từ DB tạm ----
    require.cache[require.resolve('../middleware/auth')] = { exports: {
      async verifyFirebaseToken(req, res, next) {
        const id = Number(req.headers['x-test-user']); if (!id) return res.status(401).json({ status: 'error' });
        req.user = (await pool.request().input('id', sql.Int, id).query('SELECT id, email, role, phone FROM dbo.users WHERE id=@id;')).recordset[0];
        if (!req.user) return res.status(401).json({ status: 'error' });
        next();
      },
    } };   // requireBackOffice + requirePermission thật đọc req.user.role ở trên.
    const express = require('express');
    const app = express(); app.use(express.json()); app.use('/api/admin', require('../routes/admin'));
    app.use('/api/orders', require('../routes/orders')); // tạo đơn thật qua checkout của khách
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/admin`;
    const mkUser = async role => (await pool.request().input('tag', sql.VarChar(128), `audit-${role}-http`)
      .input('email', sql.VarChar(255), `${role}.http@example.test`).input('role', sql.VarChar(20), role)
      .query('INSERT INTO dbo.users(firebase_uid,email,role) OUTPUT INSERTED.id VALUES(@tag,@email,@role);')).recordset[0].id;
    const adminId = await mkUser('admin'), staffId = await mkUser('staff');
    const http = async (who, method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(who) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: await r.json() };
    };
    const maxId = async () => (await pool.request().query('SELECT ISNULL(MAX(id), 0) AS m FROM dbo.audit_logs;')).recordset[0].m;
    // Chạy fn, trả các dòng log MỚI do nó sinh ra (kèm ISJSON).
    const newLogs = async fn => {
      const from = await maxId(); const out = await fn();
      const rows = (await pool.request().input('from', sql.BigInt, from).query(`SELECT id, actor_user_id, actor_email, actor_role,
        action, entity_type, entity_id, before_json, after_json, ip, user_agent, ISJSON(before_json) AS before_ok, ISJSON(after_json) AS after_ok
        FROM dbo.audit_logs WHERE id > @from ORDER BY id;`)).recordset;
      return { out, rows };
    };
    const samples = {};
    const one = (rows, action, who, role, entityId) => {
      assert.equal(rows.length, 1, `đúng 1 dòng ${action}`);
      const r = rows[0];
      assert.deepEqual([r.actor_user_id, r.actor_role, r.actor_email, r.action, r.entity_type, r.entity_id, r.ip],
        [who, role, `${role}.http@example.test`, action, 'product', String(entityId), '127.0.0.1']);
      assert.ok(r.after_ok === 1 && (r.before_json === null || r.before_ok === 1));
      return r;
    };
    const keep = (label, r) => { samples[label] = { before: r.before_json, after: r.after_json }; };
    const catId = (await pool.request().input('pid', sql.Int, plain.id).query('SELECT category_id AS c FROM dbo.products WHERE id=@pid;')).recordset[0].c;
    const XSS = '<img src=x onerror=alert(1)>';
    let createdId;

    await item('12. POST /products -> 201, đúng 1 dòng PRODUCT_CREATE (admin), XSS tên lưu nguyên văn', async () => {
      const { out, rows } = await newLogs(() => http(adminId, 'POST', '/products', { slug: 'audit-http-product', name_vi: 'Áo ' + XSS,
        price: 150000, category_id: catId, stock: 5, images: ['img/ao1.png'] }));
      assert.equal(out.status, 201); createdId = out.body.product.id;
      const r = one(rows, 'PRODUCT_CREATE', adminId, 'admin', createdId); keep('PRODUCT_CREATE', r);
      assert.equal(r.before_json, null);
      const a = JSON.parse(r.after_json);
      assert.deepEqual([a.id, a.name_vi, a.price, a.stock, a.images_count, a.is_active], [createdId, 'Áo ' + XSS, 150000, 5, 1, true]);
      assert.ok(r.after_json.includes(XSS));
    });

    await item('13. PUT /products/:id (staff) -> 200, đúng 1 dòng PRODUCT_UPDATE chỉ cột đổi, actor staff có email', async () => {
      const { out, rows } = await newLogs(() => http(staffId, 'PUT', `/products/${createdId}`, { name_vi: 'Áo mới', price: 160000, currency: 'VND' }));
      assert.equal(out.status, 200); assert.equal(out.body.product.name_vi, 'Áo mới');
      const r = one(rows, 'PRODUCT_UPDATE', staffId, 'staff', createdId); keep('PRODUCT_UPDATE', r);
      assert.deepEqual([JSON.parse(r.before_json), JSON.parse(r.after_json)],
        [{ name_vi: 'Áo ' + XSS, price: 150000 }, { name_vi: 'Áo mới', price: 160000 }]);
    });

    await item('14. PUT với audit() lỗi -> 500 như cũ, sản phẩm không đổi, 0 dòng log mới', async () => {
      const before = (await pool.request().input('id', sql.Int, createdId).query('SELECT name_vi, price, updated_at FROM dbo.products WHERE id=@id;')).recordset[0];
      await pool.request().query("ALTER TABLE dbo.audit_logs WITH NOCHECK ADD CONSTRAINT CK_inject_audit CHECK (action <> 'PRODUCT_UPDATE');");
      const saved = console.error; console.error = () => {};
      let res;
      try { res = await newLogs(() => http(adminId, 'PUT', `/products/${createdId}`, { name_vi: 'Không được lưu' })); }
      finally { console.error = saved; await pool.request().query('ALTER TABLE dbo.audit_logs DROP CONSTRAINT CK_inject_audit;'); }
      assert.deepEqual(res.out, { status: 500, body: { status: 'error', message: 'Không cập nhật được sản phẩm' } });
      assert.equal(res.rows.length, 0);
      const now = (await pool.request().input('id', sql.Int, createdId).query('SELECT name_vi, price, updated_at FROM dbo.products WHERE id=@id;')).recordset[0];
      assert.deepEqual(now, before);
    });

    await item('15. DELETE /products/:id: staff -> 403, 0 dòng; admin -> 200, 1 dòng PRODUCT_HIDE; ẩn lại -> 200, 0 dòng', async () => {
      const denied = await newLogs(() => http(staffId, 'DELETE', `/products/${createdId}`));
      assert.equal(denied.out.status, 403); assert.equal(denied.out.body.code, 'FORBIDDEN'); assert.equal(denied.rows.length, 0);
      const ok = { status: 200, body: { status: 'ok', mode: 'soft', message: 'Đã ẩn sản phẩm', product_id: createdId } };
      const hide = await newLogs(() => http(adminId, 'DELETE', `/products/${createdId}`));
      assert.deepEqual(hide.out, ok);
      const r = one(hide.rows, 'PRODUCT_HIDE', adminId, 'admin', createdId); keep('PRODUCT_HIDE', r);
      assert.deepEqual([JSON.parse(r.before_json), JSON.parse(r.after_json)], [{ is_active: true }, { is_active: false }]);
      const again = await newLogs(() => http(adminId, 'DELETE', `/products/${createdId}`));
      assert.deepEqual(again.out, ok); assert.equal(again.rows.length, 0);
    });

    await item('16. route size: configure -> 1 dòng PRODUCT_VARIANT_CHANGE; adjust delta 0 -> 200, 0 dòng', async () => {
      const shirt = await pick(`c.slug = 'sanpham-ao' AND p.id <> ${apparel.id}`);
      const { out, rows } = await newLogs(() => http(staffId, 'POST', `/products/${shirt.id}/sizes`, { sizes: ['S'], note: 'bỏ qua' }));
      assert.equal(out.status, 200);
      const r = one(rows, 'PRODUCT_VARIANT_CHANGE', staffId, 'staff', shirt.id); keep('PRODUCT_VARIANT_CHANGE (size configure)', r);
      const a = JSON.parse(r.after_json);
      assert.deepEqual([JSON.parse(r.before_json), a.request, a.variants.map(v => [v.size, v.stock])], [{ action: 'configure' }, { sizes: ['S'] }, [['S', 0]]]);
      const s = out.body.variants.find(v => v.size === 'S');
      const zero = await newLogs(() => http(adminId, 'PUT', `/products/${shirt.id}/sizes/${s.id}`, { stock: 0, expected_stock: 0 }));
      assert.equal(zero.out.status, 200); assert.equal(zero.rows.length, 0);
    });

    await item('17. route màu: create, add-image, delete-image -> mỗi thao tác 1 dòng, chỉ phần bị đụng', async () => {
      const bag = await pick(`c.slug NOT IN ('sanpham-ao','sanpham-quan','sanpham-giay') AND p.id NOT IN (${plain.id}, ${other.id})`);
      const created = await newLogs(() => http(adminId, 'POST', `/products/${bag.id}/colors`, { label: 'Đỏ', swatch_hex: '#ff0000' }));
      assert.equal(created.out.status, 200);
      const rc = one(created.rows, 'PRODUCT_VARIANT_CHANGE', adminId, 'admin', bag.id); keep('PRODUCT_VARIANT_CHANGE (color create)', rc);
      const colorId = created.out.body.colors.find(c => c.label === 'Đỏ').id;
      const ac = JSON.parse(rc.after_json);
      assert.deepEqual([ac.action, ac.colors.map(c => c.label), ac.request], ['create', ['Đỏ'], { label: 'Đỏ', swatch_hex: '#ff0000' }]);
      const added = await newLogs(() => http(adminId, 'POST', `/products/${bag.id}/colors/${colorId}/images`, { image_path: 'img/ao1.png' }));
      assert.equal(added.out.status, 200);
      const ri = one(added.rows, 'PRODUCT_VARIANT_CHANGE', adminId, 'admin', bag.id); keep('PRODUCT_VARIANT_CHANGE (add-image)', ri);
      const imageId = JSON.parse(ri.after_json).images[0].id;
      const removed = await newLogs(() => http(adminId, 'DELETE', `/products/${bag.id}/colors/${colorId}/images/${imageId}`));
      assert.equal(removed.out.status, 200);
      const rd = one(removed.rows, 'PRODUCT_VARIANT_CHANGE', adminId, 'admin', bag.id); keep('PRODUCT_VARIANT_CHANGE (delete-image)', rd);
      assert.deepEqual(JSON.parse(rd.before_json), { action: 'delete-image', images: [{ id: imageId, color_id: colorId,
        image_path: 'img/ao1.png', sort_order: 0, is_primary: true }] });
      assert.deepEqual(JSON.parse(rd.after_json), { action: 'delete-image', request: { color_id: colorId, image_id: imageId } });
    });
    // ---- log đơn hàng phía quản trị qua HTTP (đơn tạo bằng checkout thật của khách) ----
    const customerId = await mkUser('customer');
    const shippingInput = require('../__tests__/helpers/shipping');
    const good = await pick(`c.slug NOT IN ('sanpham-ao','sanpham-quan','sanpham-giay')
      AND NOT EXISTS (SELECT 1 FROM dbo.product_colors pc WHERE pc.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM dbo.product_variants nv WHERE nv.product_id = p.id AND nv.is_base = 0)
      AND p.id NOT IN (${plain.id}, ${other.id}) AND v.stock >= 20`);
    const stockOf = async () => (await pool.request().input('pid', sql.Int, good.id).input('vid', sql.Int, good.base).query(`
      SELECT (SELECT stock FROM dbo.products WHERE id=@pid) AS product, (SELECT stock FROM dbo.product_variants WHERE id=@vid) AS variant;`)).recordset[0];
    const checkout = async () => {
      await pool.request().input('u', sql.Int, customerId).input('p', sql.Int, good.id).input('v', sql.Int, good.base)
        .query('INSERT INTO dbo.cart_items(user_id,product_id,variant_id,quantity) VALUES(@u,@p,@v,2);');
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/orders`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-user': String(customerId) },
        body: JSON.stringify({ ...shippingInput, paymentMethod: 'cod' }) });
      assert.equal(r.status, 201, 'checkout'); return (await r.json()).order;
    };
    const oneOrder = (rows, action, who, role, entityId) => {
      assert.equal(rows.length, 1, `đúng 1 dòng ${action}`);
      const r = rows[0];
      assert.deepEqual([r.actor_user_id, r.actor_role, r.actor_email, r.action, r.entity_type, r.entity_id, r.ip],
        [who, role, `${role}.http@example.test`, action, 'order', String(entityId), '127.0.0.1']);
      assert.ok(r.before_ok === 1 && (r.after_json === null || r.after_ok === 1));
      return r;
    };
    const orderExists = async id => (await pool.request().input('id', sql.Int, id).query(`SELECT
      (SELECT COUNT(*) FROM dbo.orders WHERE id=@id) AS o, (SELECT COUNT(*) FROM dbo.order_items WHERE order_id=@id) AS i,
      (SELECT COUNT(*) FROM dbo.payment_transactions WHERE order_id=@id) AS p;`)).recordset[0];
    const setStatus = (who, id, status) => http(who, 'PUT', `/orders/${id}/status`, { status });

    await item('18. PUT /orders/:id/status (staff) pending -> confirmed -> 200, 1 dòng ORDER_STATUS_CHANGE', async () => {
      const o = await checkout();
      const { out, rows } = await newLogs(() => setStatus(staffId, o.id, 'confirmed'));
      assert.equal(out.status, 200); assert.equal(out.body.order.status, 'confirmed'); assert.ok(!('order_code' in out.body.order));
      const r = oneOrder(rows, 'ORDER_STATUS_CHANGE', staffId, 'staff', o.id); keep('ORDER_STATUS_CHANGE (thường)', r);
      assert.deepEqual([JSON.parse(r.before_json), JSON.parse(r.after_json)], [
        { order: { order_code: o.order_code, status: 'pending', shipping_status: 'pending_pickup' } },
        { order: { order_code: o.order_code, status: 'confirmed', shipping_status: 'pending_pickup' } }]);
      const again = await newLogs(() => setStatus(staffId, o.id, 'confirmed'));
      assert.equal(again.out.status, 409); assert.equal(again.rows.length, 0);
    });

    await item('19. admin huỷ đơn (PUT cancelled) -> 1 dòng có cancel_reason + restored, tồn kho cộng lại đúng', async () => {
      const o = await checkout(); const before = await stockOf();
      const { out, rows } = await newLogs(() => setStatus(adminId, o.id, 'cancelled'));
      assert.equal(out.status, 200); assert.ok(!('order_code' in out.body.order), 'JSON không lộ order_code');
      const r = oneOrder(rows, 'ORDER_STATUS_CHANGE', adminId, 'admin', o.id); keep('ORDER_STATUS_CHANGE (admin huỷ)', r);
      assert.deepEqual([JSON.parse(r.before_json), JSON.parse(r.after_json)], [
        { order: { order_code: o.order_code, status: 'pending' } },
        { order: { order_code: o.order_code, status: 'cancelled', cancel_reason: null },
          restored: [{ product_id: good.id, variant_id: good.base, quantity: 2 }] }]);
      assert.deepEqual(await stockOf(), { product: before.product + 2, variant: before.variant + 2 });
    });

    await item('20. PATCH shipping-status (staff) picked_up -> 1 dòng ORDER_SHIPPING_CHANGE gộp status processing -> shipping', async () => {
      const o = await checkout();
      for (const s of ['confirmed', 'processing']) assert.equal((await setStatus(adminId, o.id, s)).status, 200);
      const { out, rows } = await newLogs(() => http(staffId, 'PATCH', `/orders/${o.id}/shipping-status`, { shipping_status: 'picked_up' }));
      assert.equal(out.status, 200); assert.equal(out.body.order.status, 'shipping');
      const r = oneOrder(rows, 'ORDER_SHIPPING_CHANGE', staffId, 'staff', o.id); keep('ORDER_SHIPPING_CHANGE', r);
      assert.deepEqual([JSON.parse(r.before_json), JSON.parse(r.after_json)], [
        { order: { order_code: o.order_code, status: 'processing', shipping_status: 'pending_pickup' } },
        { order: { order_code: o.order_code, status: 'shipping', shipping_status: 'picked_up' } }]);
    });

    await item('21. DELETE đơn pending -> 200, 1 dòng ORDER_DELETE (snapshot + restored), kho cộng lại, đơn/items/payments mất', async () => {
      const o = await checkout(); const before = await stockOf();
      const { out, rows } = await newLogs(() => http(adminId, 'DELETE', `/orders/${o.id}`));
      assert.deepEqual(out, { status: 200, body: { status: 'ok', deletedId: o.id, restoredStock: true } });
      const r = oneOrder(rows, 'ORDER_DELETE', adminId, 'admin', o.id); keep('ORDER_DELETE (pending, có cộng kho)', r);
      assert.equal(r.after_json, null);
      const b = JSON.parse(r.before_json);
      assert.deepEqual([b.order.order_code, b.order.status, b.items.length, b.payments.length, b.restored],
        [o.order_code, 'pending', 1, 1, [{ product_id: good.id, variant_id: good.base, quantity: 2 }]]);
      assert.equal(b.order.shipping_phone, shippingInput.shipping_phone, 'admin giữ sđt giao hàng');
      assert.doesNotMatch(r.before_json, /card|token/i);
      assert.deepEqual(await stockOf(), { product: before.product + 2, variant: before.variant + 2 });
      assert.deepEqual(await orderExists(o.id), { o: 0, i: 0, p: 0 });
    });

    await item('22. DELETE đơn completed -> 1 dòng ORDER_DELETE restored [], tồn kho KHÔNG đổi', async () => {
      const o = await checkout();
      for (const s of ['confirmed', 'processing', 'shipping', 'completed']) assert.equal((await setStatus(adminId, o.id, s)).status, 200);
      const before = await stockOf();
      const { out, rows } = await newLogs(() => http(adminId, 'DELETE', `/orders/${o.id}`));
      assert.deepEqual(out, { status: 200, body: { status: 'ok', deletedId: o.id, restoredStock: false } });
      const r = oneOrder(rows, 'ORDER_DELETE', adminId, 'admin', o.id); keep('ORDER_DELETE (completed, không cộng kho)', r);
      const b = JSON.parse(r.before_json);
      assert.deepEqual([b.order.status, b.restored, b.payments[0].status], ['completed', [], 'paid']);
      assert.deepEqual(await stockOf(), before);
    });

    await item('23. DELETE khi audit() lỗi -> 500 như cũ, đơn/items/payments còn, tồn không đổi, 0 dòng; staff DELETE -> 403, 0 dòng', async () => {
      const o = await checkout(); const before = await stockOf();
      await pool.request().query("ALTER TABLE dbo.audit_logs WITH NOCHECK ADD CONSTRAINT CK_inject_audit CHECK (action <> 'ORDER_DELETE');");
      const saved = console.error; console.error = () => {};
      let res;
      try { res = await newLogs(() => http(adminId, 'DELETE', `/orders/${o.id}`)); }
      finally { console.error = saved; await pool.request().query('ALTER TABLE dbo.audit_logs DROP CONSTRAINT CK_inject_audit;'); }
      assert.deepEqual(res.out, { status: 500, body: { status: 'error', message: 'Không xoá được đơn hàng' } });
      assert.equal(res.rows.length, 0);
      assert.deepEqual(await orderExists(o.id), { o: 1, i: 1, p: 1 });
      assert.deepEqual(await stockOf(), before);
      const denied = await newLogs(() => http(staffId, 'DELETE', `/orders/${o.id}`));
      assert.equal(denied.out.status, 403); assert.equal(denied.rows.length, 0);
      assert.deepEqual(await orderExists(o.id), { o: 1, i: 1, p: 1 });
    });
    // ---- log blacklist + ẩn/hiện đánh giá qua HTTP ----
    const oneOf = (rows, action, entityType, who, role, entityId) => {
      assert.equal(rows.length, 1, `đúng 1 dòng ${action}`);
      const r = rows[0];
      assert.deepEqual([r.actor_user_id, r.actor_role, r.actor_email, r.action, r.entity_type, r.entity_id, r.ip],
        [who, role, `${role}.http@example.test`, action, entityType, String(entityId), '127.0.0.1']);
      assert.ok(r.before_ok === 1 && r.after_ok === 1);
      return r;
    };
    const isBlacklisted = async () => (await pool.request().input('u', sql.Int, customerId)
      .query('SELECT IsBlacklisted AS b FROM dbo.users WHERE id=@u;')).recordset[0].b;
    const userJson = b => JSON.stringify({ user: { email: 'customer.http@example.test', is_blacklisted: b } });

    await item('24. blacklist: staff chặn -> 1 dòng; chặn lần 2 -> 200, 0 dòng; admin gỡ -> 1 dòng; staff gỡ -> 403, 0 dòng', async () => {
      const blocked = await newLogs(() => http(staffId, 'POST', `/users/${customerId}/blacklist`, {}));
      assert.deepEqual(blocked.out, { status: 200, body: { status: 'ok', user: { id: customerId, email: 'customer.http@example.test', is_blacklisted: true } } });
      const r = oneOf(blocked.rows, 'USER_BLACKLIST', 'user', staffId, 'staff', customerId); keep('USER_BLACKLIST', r);
      assert.deepEqual([r.before_json, r.after_json], [userJson(false), userJson(true)]);
      const again = await newLogs(() => http(staffId, 'POST', `/users/${customerId}/blacklist`, {}));
      assert.equal(again.out.status, 200); assert.equal(again.rows.length, 0);
      const denied = await newLogs(() => http(staffId, 'POST', `/blacklist/${customerId}/release`, {}));
      assert.equal(denied.out.status, 403); assert.equal(denied.rows.length, 0); assert.equal(await isBlacklisted(), true);
      const released = await newLogs(() => http(adminId, 'POST', `/blacklist/${customerId}/release`, {}));
      assert.equal(released.out.status, 200); assert.equal(released.out.body.user.is_blacklisted, false);
      const u = oneOf(released.rows, 'USER_UNBLACKLIST', 'user', adminId, 'admin', customerId); keep('USER_UNBLACKLIST', u);
      assert.deepEqual([u.before_json, u.after_json], [userJson(true), userJson(false)]);
    });

    await item('25. đánh giá: ẩn -> 1 dòng; ẩn lần 2 -> 200, 0 dòng; hiện lại -> 1 dòng (review{product_id, is_hidden})', async () => {
      const reviewId = (await pool.request().input('uid', sql.Int, customerId).input('pid', sql.Int, good.id).input('vid', sql.Int, good.base)
        .query(`INSERT INTO dbo.reviews(user_id,product_id,variant_id,rating,comment)
          OUTPUT INSERTED.id VALUES(@uid,@pid,@vid,5,N'Nội dung không được vào log');`)).recordset[0].id;
      const json = h => JSON.stringify({ review: { product_id: good.id, is_hidden: h } });
      const hide = await newLogs(() => http(staffId, 'PATCH', `/reviews/${reviewId}/visibility`, { isHidden: true }));
      assert.deepEqual(hide.out, { status: 200, body: { id: reviewId, isHidden: true } });
      const r = oneOf(hide.rows, 'REVIEW_VISIBILITY', 'review', staffId, 'staff', reviewId); keep('REVIEW_VISIBILITY (ẩn)', r);
      assert.deepEqual([r.before_json, r.after_json], [json(false), json(true)]);
      const again = await newLogs(() => http(staffId, 'PATCH', `/reviews/${reviewId}/visibility`, { isHidden: true }));
      assert.deepEqual(again.out, hide.out); assert.equal(again.rows.length, 0);
      const show = await newLogs(() => http(adminId, 'PATCH', `/reviews/${reviewId}/visibility`, { isHidden: false }));
      assert.deepEqual(show.out, { status: 200, body: { id: reviewId, isHidden: false } });
      const s = oneOf(show.rows, 'REVIEW_VISIBILITY', 'review', adminId, 'admin', reviewId); keep('REVIEW_VISIBILITY (hiện)', s);
      assert.deepEqual([s.before_json, s.after_json], [json(true), json(false)]);
    });

    await item('26. chặn khi audit() lỗi -> 500 như cũ, IsBlacklisted không đổi, 0 dòng log mới', async () => {
      await pool.request().query("ALTER TABLE dbo.audit_logs WITH NOCHECK ADD CONSTRAINT CK_inject_audit CHECK (action <> 'USER_BLACKLIST');");
      const saved = console.error; console.error = () => {};
      let res;
      try { res = await newLogs(() => http(staffId, 'POST', `/users/${customerId}/blacklist`, {})); }
      finally { console.error = saved; await pool.request().query('ALTER TABLE dbo.audit_logs DROP CONSTRAINT CK_inject_audit;'); }
      assert.deepEqual(res.out, { status: 500, body: { status: 'error', message: 'Không thêm được vào danh sách đen' } });
      assert.equal(res.rows.length, 0); assert.equal(await isBlacklisted(), false);
    });
    // ---- ROLE_CHANGE trong db/set-role.js (tiến trình con) và db/create-staff.js (Firebase giả) ----
    const serverDir = path.join(__dirname, '..');
    const childEnv = { ...process.env, DB_NAME: dbName }; // dotenv mặc định KHÔNG ghi đè biến đã có
    const dropDotenvTip = s => String(s).split(/\r?\n/).filter(l => !/inject(ed|ing) env/.test(l)).join('\n');
    const shape = r => ({ status: r.status, stdout: dropDotenvTip(r.stdout), stderr: dropDotenvTip(r.stderr) });
    let childSafe = false; // chỉ được chạy set-role khi đã chứng minh tiến trình con nối vào DB tạm
    const runNew = args => { assert.ok(childSafe, 'chưa chứng minh tiến trình con dùng DB tạm');
      return shape(spawnSync(process.execPath, ['db/set-role.js', ...args], { cwd: serverDir, env: childEnv, encoding: 'utf8' })); };
    const tag = `${process.pid}`;
    // Chuẩn hoá trước khi so: bỏ dòng gợi ý của dotenv, bỏ viền console.table (độ rộng cột đổi theo giá trị), cột id -> <id>,
    // pid / tên DB tạm / tên server -> chỗ giữ chỗ.
    const normCell = (c, i) => (i === 1 && /^\d+$/.test(c) ? '<id>' : c);
    const normText = t => dropDotenvTip(t).split('\n').filter(l => l !== '' && !'┌├└'.includes(l[0]))
      .map(l => (l[0] === '│' ? l.split('│').slice(1, -1).map(c => c.trim()).map(normCell).join(' | ') : l)).join('\n')
      .split(dbName).join('<DB>').split(String(config.server)).join('<server>').split(tag).join('<pid>');
    const normal = r => ({ status: r.status, stdout: normText(r.stdout), stderr: normText(r.stderr) });
    // Đầu ra THẬT của db/set-role.js và db/create-staff.js bản 7d547cb (trước khi có log), đã chuẩn hoá như trên, lấy MỘT LẦN
    // ngày 2026-11-16 trên đúng các kịch bản dưới đây. Script không dùng git khi chạy.
    const EXPECTED_OLD = {
      'customer->staff': { status: 0, stderr: '', stdout: ['[db] Connected to SQL Server "<server>" / DB "<DB>"', 'Đã cập nhật 1 dòng.',
        '(index) | id | email | role', "0 | <id> | 'role-marker-<pid>@example.test' | 'staff'"].join('\n') },
      'staff->customer': { status: 0, stderr: '', stdout: ['[db] Connected to SQL Server "<server>" / DB "<DB>"', 'Đã cập nhật 1 dòng.',
        '(index) | id | email | role', "0 | <id> | 'role-marker-<pid>@example.test' | 'customer'"].join('\n') },
      'same-role': { status: 0, stderr: '', stdout: ['[db] Connected to SQL Server "<server>" / DB "<DB>"', 'Đã cập nhật 1 dòng.',
        '(index) | id | email | role', "0 | <id> | 'role-marker-<pid>@example.test' | 'customer'"].join('\n') },
      'not-found': { status: 1, stdout: '[db] Connected to SQL Server "<server>" / DB "<DB>"', stderr: [
        'Không tìm thấy user với email "no-such-<pid>@example.test".',
        'Lưu ý: user chỉ được tạo trong DB sau khi đăng nhập ít nhất 1 lần (qua /api/me hoặc bất kỳ trang nào gọi API có xác thực).'].join('\n') },
      'bad-role': { status: 1, stdout: '', stderr: 'Role không hợp lệ: "boss". Chỉ chấp nhận: customer, staff, admin' },
      'one-arg': { status: 1, stdout: '', stderr: 'Usage: node db/set-role.js <email> <customer|staff|admin>' },
      'no-args': { status: 1, stdout: '', stderr: 'Usage: node db/set-role.js <email> <customer|staff|admin>' },
      'dup->staff': { status: 0, stderr: '', stdout: ['[db] Connected to SQL Server "<server>" / DB "<DB>"', 'Đã cập nhật 2 dòng.',
        '(index) | id | email | role', "0 | <id> | 'role-dup-<pid>@example.test' | 'staff'",
        "1 | <id> | 'role-dup-<pid>@example.test' | 'staff'"].join('\n') },
      'dup->admin': { status: 0, stderr: '', stdout: ['[db] Connected to SQL Server "<server>" / DB "<DB>"', 'Đã cập nhật 2 dòng.',
        '(index) | id | email | role', "0 | <id> | 'role-dup-<pid>@example.test' | 'admin'",
        "1 | <id> | 'role-dup-<pid>@example.test' | 'admin'"].join('\n') },
    };
    const EXPECTED_OLD_CS = { // create-staff: mật khẩu -> <MẬT KHẨU>, id -> <ID>, pid -> <pid>
      ok: { code: 0, err: [], out: ['', '✔ Đã tạo tài khoản nhân viên (role staff).',
        '  Email:         staff-new-<pid>@example.test', '  Tên hiển thị:  Nhân Viên Mới',
        '  Firebase UID:  fake-staff-new-<pid>@example.test', '  dbo.users.id: <ID>', '',
        '  Mật khẩu (CHỈ HIỆN 1 LẦN — lưu ngay vào trình quản lý mật khẩu, không gửi qua chat):', '    <MẬT KHẨU>', '',
        'Bước tiếp:', '  1. Đăng nhập ở login.html bằng email trên -> vào trang quản trị, thấy pill "Nhân viên".',
        '  2. Đổi mật khẩu: trang quản trị -> bấm user card đáy menu trái -> Hồ sơ -> Mật khẩu "Đổi".',
        '  3. Đổi mật khẩu staff TRƯỚC khi bật Cloudflare Tunnel (site public) — xem CHECKLIST-STAFF.md.'] },
      'customer.http@example.test': { code: 1, out: [],
        err: ['LỖI: Email đã có trong dbo.users (id <ID>, role customer). Đổi role tài khoản có sẵn bằng db/set-role.js.'] },
      'boss.http@example.test': { code: 1, out: [],
        err: ['LỖI: Email nằm trong ADMIN_EMAILS — tài khoản này sẽ tự lên admin khi đăng nhập. Không tạo staff.'] },
    };
    const markerEmail = `role-marker-${tag}@example.test`, dupEmail = `role-dup-${tag}@example.test`;
    const addUser = async (email, role, n) => (await pool.request().input('uid', sql.VarChar(128), `role-${n}-${tag}`)
      .input('email', sql.VarChar(255), email).input('role', sql.VarChar(20), role)
      .query('INSERT INTO dbo.users(firebase_uid,email,role) OUTPUT INSERTED.id VALUES(@uid,@email,@role);')).recordset[0].id;
    const marker = await addUser(markerEmail, 'customer', 'm'), dup1 = await addUser(dupEmail, 'customer', 'd1'), dup2 = await addUser(dupEmail, 'staff', 'd2');
    const setRoles = async map => { for (const [id, role] of Object.entries(map)) await pool.request().input('id', sql.Int, Number(id))
      .input('role', sql.VarChar(20), role).query('UPDATE dbo.users SET role=@role WHERE id=@id;'); };
    const roleOf = async id => (await pool.request().input('id', sql.Int, id).query('SELECT role FROM dbo.users WHERE id=@id;')).recordset[0].role;
    // Đặt trạng thái đầu, chạy bản hiện tại -> stdout / stderr / exit code (đã chuẩn hoá) phải giống hệt bản cũ đã ghi sẵn.
    const compareSetRole = async (args, start, expectedKey) => {
      await setRoles(start); const { out, rows } = await newLogs(async () => runNew(args));
      assert.deepEqual(normal(out), EXPECTED_OLD[expectedKey], 'bản mới phải in và thoát y như bản cũ (7d547cb): ' + expectedKey);
      return { out, rows };
    };
    const cliRow = (rows, entityId, oldRole, newRole, email = markerEmail) => {
      const r = rows.find(x => x.entity_id === String(entityId));
      assert.ok(r, 'có dòng ROLE_CHANGE cho user ' + entityId);
      assert.deepEqual([r.actor_role, r.actor_user_id, r.actor_email, r.ip, r.user_agent, r.action, r.entity_type],
        ['cli', null, null, null, null, 'ROLE_CHANGE', 'user']);
      assert.deepEqual([JSON.parse(r.before_json), JSON.parse(r.after_json)],
        [{ user: { email, role: oldRole } }, { user: { email, role: newRole }, source: 'set-role' }]);
      return r;
    };

    await item('27. tiến trình con nối vào ĐÚNG DB tạm (DB_NAME() trong con = DB tạm; email đánh dấu chỉ có ở DB tạm)', async () => {
      const probe = spawnSync(process.execPath, ['-e', `require('dotenv').config({ path: require('path').join(${JSON.stringify(path.join(serverDir, 'db'))}, '..', '.env') });
        require(${JSON.stringify(path.join(serverDir, 'db.js'))}).getPool().then(p => p.request().query('SELECT DB_NAME() AS d'))
          .then(r => { console.log('DBNAME=' + r.recordset[0].d); process.exit(0); }, e => { console.error(e.message); process.exit(1); });`],
      { cwd: serverDir, env: childEnv, encoding: 'utf8' });
      assert.equal(probe.status, 0, probe.stderr);
      assert.ok(probe.stdout.includes('DBNAME=' + dbName + '\n') || probe.stdout.trim().endsWith('DBNAME=' + dbName), probe.stdout);
      assert.notEqual(dbName.toLowerCase(), String(mainDb).toLowerCase());
      const main = await new sql.ConnectionPool({ ...config, database: mainDb }).connect(); // chỉ đọc
      try {
        const n = (await main.request().input('a', sql.VarChar(255), markerEmail).input('b', sql.VarChar(255), dupEmail)
          .query('SELECT COUNT(*) AS n FROM dbo.users WHERE email IN (@a, @b);')).recordset[0].n;
        assert.equal(n, 0, 'email đánh dấu không được có ở DB chính');
      } finally { await main.close(); }
      childSafe = true;
      console.log(`   tiến trình con: ${probe.stdout.trim().split(/\r?\n/).pop()}`);
    });

    await item('28. set-role customer -> staff: in/exit y như bản cũ, 1 dòng ROLE_CHANGE (cli, actor NULL), role đổi', async () => {
      const { out, rows } = await compareSetRole([markerEmail, 'staff'], { [marker]: 'customer' }, 'customer->staff');
      assert.equal(out.status, 0); assert.match(out.stdout, /Đã cập nhật 1 dòng\./);
      assert.equal(rows.length, 1); keep('ROLE_CHANGE (set-role)', cliRow(rows, marker, 'customer', 'staff'));
      assert.equal(await roleOf(marker), 'staff');
    });
    await item('29. set-role staff -> customer: y như bản cũ, 1 dòng', async () => {
      const { out, rows } = await compareSetRole([markerEmail, 'customer'], { [marker]: 'staff' }, 'staff->customer');
      assert.equal(out.status, 0); assert.equal(rows.length, 1); cliRow(rows, marker, 'staff', 'customer');
      assert.equal(await roleOf(marker), 'customer');
    });
    await item('30. set-role sang đúng role hiện tại: "Đã cập nhật 1 dòng." như cũ, exit 0, 0 dòng log', async () => {
      const { out, rows } = await compareSetRole([markerEmail, 'customer'], { [marker]: 'customer' }, 'same-role');
      assert.equal(out.status, 0); assert.match(out.stdout, /Đã cập nhật 1 dòng\./); assert.equal(rows.length, 0);
    });
    await item('31. set-role không thấy user / role sai / thiếu tham số: y như bản cũ, exit 1, 0 dòng', async () => {
      for (const [args, key] of [[[`no-such-${tag}@example.test`, 'staff'], 'not-found'], [[markerEmail, 'boss'], 'bad-role'],
        [[markerEmail], 'one-arg'], [[], 'no-args']]) {
        const { out, rows } = await compareSetRole(args, {}, key);
        assert.equal(out.status, 1, JSON.stringify(args)); assert.equal(rows.length, 0);
      }
    });
    await item('32. set-role 2 user trùng email: N=2 như cũ; chỉ user đổi role mới có dòng (1 rồi 2)', async () => {
      const mixed = await compareSetRole([dupEmail, 'staff'], { [dup1]: 'customer', [dup2]: 'staff' }, 'dup->staff');
      assert.match(mixed.out.stdout, /Đã cập nhật 2 dòng\./); assert.equal(mixed.rows.length, 1);
      cliRow(mixed.rows, dup1, 'customer', 'staff', dupEmail);
      const both = await compareSetRole([dupEmail, 'admin'], { [dup1]: 'customer', [dup2]: 'staff' }, 'dup->admin');
      assert.match(both.out.stdout, /Đã cập nhật 2 dòng\./); assert.equal(both.rows.length, 2);
      cliRow(both.rows, dup1, 'customer', 'admin', dupEmail); cliRow(both.rows, dup2, 'staff', 'admin', dupEmail);
      await setRoles({ [dup1]: 'customer', [dup2]: 'staff' });
    });
    await item('33. set-role khi audit() lỗi -> exit 1 "LỖI: ...", role KHÔNG đổi, 0 dòng log', async () => {
      await setRoles({ [marker]: 'customer' });
      await pool.request().query("ALTER TABLE dbo.audit_logs WITH NOCHECK ADD CONSTRAINT CK_inject_audit CHECK (action <> 'ROLE_CHANGE');");
      let res;
      try { res = await newLogs(async () => runNew([markerEmail, 'staff'])); }
      finally { await pool.request().query('ALTER TABLE dbo.audit_logs DROP CONSTRAINT CK_inject_audit;'); }
      assert.equal(res.out.status, 1); assert.match(res.out.stderr, /^LỖI: .*CK_inject_audit/);
      assert.doesNotMatch(res.out.stdout, /Đã cập nhật/); assert.equal(res.rows.length, 0); // stdout chỉ còn dòng "[db] Connected" của db.js
      assert.equal(await roleOf(marker), 'customer');
    });

    await item('34. create-staff (Firebase giả): y như bản cũ; thành công 1 dòng before null; trùng / admin -> 0 dòng; audit lỗi -> rollback + xoá Firebase', async () => {
      const { run } = require('../db/create-staff');
      const fb = { users: new Map(), deleted: [], passwords: [] };
      const auth = {
        async getUserByEmail(email) { if (fb.users.has(email)) return { uid: fb.users.get(email) }; throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); },
        async createUser(p) { fb.passwords.push(p.password); const uid = 'fake-' + p.email; fb.users.set(p.email, uid); return { uid }; },
        async deleteUser(uid) { fb.deleted.push(uid); for (const [k, v] of fb.users) if (v === uid) fb.users.delete(k); },
      };
      const deps = { auth, pool, sql, adminEmails: new Set(['boss.http@example.test']) };
      const go = async argv => {
        const lines = { out: [], err: [] };
        const code = await run(argv, deps, { interactive: false, out: l => lines.out.push(l), err: l => lines.err.push(l), warn: () => {} });
        const mask = s => fb.passwords.reduce((t, pw) => t.split(pw).join('<MẬT KHẨU>'), s).replace(/dbo\.users\.id:\s+\d+/, 'dbo.users.id: <ID>')
          .replace(/\(id \d+, role/, '(id <ID>, role').split(tag).join('<pid>');
        return { code, out: lines.out.map(mask), err: lines.err.map(mask) };
      };
      const email = `staff-new-${tag}@example.test`;
      const ok = await newLogs(() => go([email, 'Nhân Viên Mới']));
      assert.deepEqual(ok.out, EXPECTED_OLD_CS.ok, 'thông báo + exit code y như bản cũ 7d547cb (đã che mật khẩu / id / pid)');
      assert.equal(ok.out.code, 0); assert.equal(ok.rows.length, 1);
      const r = ok.rows[0]; keep('ROLE_CHANGE (create-staff)', r);
      const id = (await pool.request().input('e', sql.VarChar(255), email).query('SELECT id, role FROM dbo.users WHERE email=@e;')).recordset[0];
      assert.deepEqual([r.actor_role, r.actor_user_id, r.actor_email, r.ip, r.user_agent, r.entity_type, r.entity_id, r.before_json],
        ['cli', null, null, null, null, 'user', String(id.id), null]);
      assert.deepEqual(JSON.parse(r.after_json), { user: { email, role: 'staff' }, source: 'create-staff' });
      assert.ok(fb.passwords.every(pw => !r.after_json.includes(pw)), 'mật khẩu không vào after_json');
      for (const argv of [['customer.http@example.test', 'Trùng'], ['boss.http@example.test', 'Sếp']]) {
        const now = await newLogs(() => go(argv));
        assert.deepEqual(now.out, EXPECTED_OLD_CS[argv[0]], 'y như bản cũ 7d547cb: ' + argv[0]);
        assert.equal(now.out.code, 1); assert.equal(now.rows.length, 0);
      }
      const failEmail = `staff-fail-${tag}@example.test`;
      await pool.request().query("ALTER TABLE dbo.audit_logs WITH NOCHECK ADD CONSTRAINT CK_inject_audit CHECK (action <> 'ROLE_CHANGE');");
      let failed;
      try { failed = await newLogs(() => go([failEmail, 'NV Lỗi'])); }
      finally { await pool.request().query('ALTER TABLE dbo.audit_logs DROP CONSTRAINT CK_inject_audit;'); }
      assert.equal(failed.out.code, 1); assert.equal(failed.rows.length, 0);
      assert.match(failed.out.err[0], /^LỖI: Ghi dbo\.users thất bại \(lỗi SQL \(EREQUEST\)\)\. Đã xoá user Firebase vừa tạo/);
      assert.deepEqual([fb.deleted.at(-1), fb.users.has(failEmail)], ['fake-' + failEmail, false]);
      assert.equal((await pool.request().input('e', sql.VarChar(255), failEmail).query('SELECT COUNT(*) AS n FROM dbo.users WHERE email=@e;')).recordset[0].n, 0);
    });
    // ---- log phía khách — đặt đơn (COD / thẻ đã lưu / MoMo) và tự huỷ đơn, qua /api/orders thật ----
    const PERSONAL = { shipping_name: 'Nguyễn Riêng Tư', shipping_phone: '0987654321', shipping_address: '99 Đường Bí Mật',
      shipping_ward: 'Phường Kín', shipping_district: 'Quận Ẩn', shipping_city: 'Thành Phố Lạ', delivery_note: 'Giao giờ hành chính' };
    const CARD = { last4: '4242', holder: 'CHU THE THAT', month: 9, year: new Date().getUTCFullYear() + 4 };
    const MOMO = '0912345678';
    const buyer = (await pool.request().input('phone', sql.VarChar(30), MOMO).query(`INSERT INTO dbo.users(firebase_uid,email,role,phone)
      OUTPUT INSERTED.id VALUES('audit-buyer-http','buyer.http@example.test','customer',@phone);`)).recordset[0].id;
    await pool.request().input('uid', sql.Int, buyer).input('last4', sql.Char(4), CARD.last4).input('holder', sql.NVarChar(150), CARD.holder)
      .input('m', sql.TinyInt, CARD.month).input('y', sql.SmallInt, CARD.year)
      .query("INSERT INTO dbo.payment_methods(user_id,brand,last4,holder_name,exp_month,exp_year,is_default) VALUES(@uid,'visa',@last4,@holder,@m,@y,1);");
    const good2 = await pick(`c.slug NOT IN ('sanpham-ao','sanpham-quan','sanpham-giay')
      AND NOT EXISTS (SELECT 1 FROM dbo.product_colors pc WHERE pc.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM dbo.product_variants nv WHERE nv.product_id = p.id AND nv.is_base = 0)
      AND p.id NOT IN (${plain.id}, ${other.id}, ${good.id}) AND v.stock >= 20`);
    const stock2 = async () => (await pool.request().input('pid', sql.Int, good2.id).input('vid', sql.Int, good2.base).query(`
      SELECT (SELECT stock FROM dbo.products WHERE id=@pid) AS product, (SELECT stock FROM dbo.product_variants WHERE id=@vid) AS variant;`)).recordset[0];
    const shopUrl = `http://127.0.0.1:${server.address().port}/api/orders`;
    const shop = async (method, url, body) => {
      const r = await fetch(shopUrl + url, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(buyer) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: await r.json() };
    };
    const buy = async paymentMethod => {
      await pool.request().input('u', sql.Int, buyer).input('p', sql.Int, good2.id).input('v', sql.Int, good2.base)
        .query('INSERT INTO dbo.cart_items(user_id,product_id,variant_id,quantity) VALUES(@u,@p,@v,2);');
      return newLogs(() => shop('POST', '', { ...shippingInput, ...PERSONAL, paymentMethod }));
    };
    const customerRow = (rows, action, entityId) => {
      assert.equal(rows.length, 1, `đúng 1 dòng ${action}`);
      const r = rows[0];
      assert.deepEqual([r.actor_role, r.actor_email, r.actor_user_id, r.action, r.entity_type, r.entity_id],
        ['customer', null, buyer, action, 'order', String(entityId)]);
      const leaked = [...Object.values(PERSONAL), CARD.last4, CARD.holder, String(CARD.year), MOMO]
        .filter(v => (r.after_json + (r.before_json || '')).includes(v));
      assert.deepEqual(leaked, [], 'không lộ địa chỉ / sđt / tên / ghi chú / thẻ / số ví');
      return r;
    };
    const placeJson = (o, method) => JSON.stringify({ order: { order_code: o.order_code, total_amount: o.total_amount, payment_method: method, items_count: 1 } });

    for (const [n, method, label] of [[35, 'cod', 'COD'], [36, 'visa', 'thẻ Visa đã lưu'], [37, 'momo', 'MoMo']]) {
      await item(`${n}. khách đặt đơn ${label} -> 201, 1 dòng ORDER_PLACE (customer, email NULL), không lộ dữ liệu cá nhân / thẻ / ví`, async () => {
        const { out, rows } = await buy(method);
        assert.equal(out.status, 201, JSON.stringify(out.body));
        const r = customerRow(rows, 'ORDER_PLACE', out.body.order.id); keep(`ORDER_PLACE (${label})`, r);
        assert.equal(r.before_json, null); assert.equal(r.after_json, placeJson(out.body.order, method));
      });
    }

    await item('38. khách tự huỷ đơn -> 200, 1 dòng ORDER_CANCEL_BY_CUSTOMER có cancel_reason + restored, tồn kho cộng lại', async () => {
      const placedOrder = (await buy('cod')).out.body.order; const before = await stock2();
      const { out, rows } = await newLogs(() => shop('POST', `/${placedOrder.id}/cancel`, { reason: 'other', details: '<img src=x onerror=alert(1)>' }));
      assert.equal(out.status, 200); assert.equal(out.body.order.can_cancel, false); assert.ok(!('order_code' in out.body.order));
      const r = customerRow(rows, 'ORDER_CANCEL_BY_CUSTOMER', placedOrder.id); keep('ORDER_CANCEL_BY_CUSTOMER', r);
      assert.deepEqual([JSON.parse(r.before_json), JSON.parse(r.after_json)], [{ order: { order_code: placedOrder.order_code, status: 'pending' } },
        { order: { order_code: placedOrder.order_code, status: 'cancelled', cancel_reason: 'Khác: <img src=x onerror=alert(1)>' },
          restored: [{ product_id: good2.id, variant_id: good2.base, quantity: 2 }] }]);
      assert.deepEqual(await stock2(), { product: before.product + 2, variant: before.variant + 2 });
    });

    await item('39. đặt đơn khi audit() lỗi -> 500 như cũ, không đơn mới, tồn không đổi, giỏ còn, 0 dòng; bộ đếm mã đơn DB tạm không đổi', async () => {
      await pool.request().input('u', sql.Int, buyer).input('p', sql.Int, good2.id).input('v', sql.Int, good2.base)
        .query('INSERT INTO dbo.cart_items(user_id,product_id,variant_id,quantity) VALUES(@u,@p,@v,2);');
      const tempCounter = async () => (await pool.request().query('SELECT last_code FROM dbo.order_code_counter WHERE id=1;')).recordset[0].last_code;
      const ordersOf = async () => (await pool.request().input('u', sql.Int, buyer).query('SELECT COUNT(*) AS n FROM dbo.orders WHERE user_id=@u;')).recordset[0].n;
      const cartOf = async () => (await pool.request().input('u', sql.Int, buyer).query('SELECT COUNT(*) AS n FROM dbo.cart_items WHERE user_id=@u;')).recordset[0].n;
      const [c0, o0, s0] = [await tempCounter(), await ordersOf(), await stock2()];
      await pool.request().query("ALTER TABLE dbo.audit_logs WITH NOCHECK ADD CONSTRAINT CK_inject_audit CHECK (action <> 'ORDER_PLACE');");
      const saved = console.error; console.error = () => {};
      let res;
      try { res = await newLogs(() => shop('POST', '', { ...shippingInput, ...PERSONAL, paymentMethod: 'cod' })); }
      finally { console.error = saved; await pool.request().query('ALTER TABLE dbo.audit_logs DROP CONSTRAINT CK_inject_audit;'); }
      assert.deepEqual(res.out, { status: 500, body: { status: 'error', message: 'Không tạo được đơn hàng' } });
      const c1 = await tempCounter();
      assert.deepEqual([res.rows.length, await ordersOf(), await stock2(), await cartOf(), c1], [0, o0, s0, 1, c0]);
      console.log(`   order_code_counter của DB tạm trước/sau lần audit() lỗi: ${c0} -> ${c1} (không bị đốt mã)`);
    });
    // ---- log phía khách cho đánh giá qua /api/products/:id/reviews THẬT; ảnh lưu vào thư mục tạm ----
    const media = require('../lib/review-media');
    reviewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'breeze-audit-reviews-'));
    media.storage = media.createStorage(reviewDir); // PHẢI trước khi nạp route: route lấy `storage` lúc require
    const savedUrls = [], realSave = media.storage.save; // ghi nhận file đã lưu (route giữ cùng object storage này)
    media.storage.save = async buffer => { const url = await realSave.call(media.storage, buffer); savedUrls.push(url); return url; };
    app.use('/api/products', require('../routes/products'));
    const png = await require('sharp')({ create: { width: 3, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
    const WRITER = { uid: 'audit-reviewer-http', email: 'reviewer.http@example.test', name: 'Người Viết Riêng', phone: '0977888999' };
    const addBuyer = async ({ uid: tag, email, name, phone }) => { // khách + 1 đơn completed có good2 (đủ điều kiện đánh giá)
      const id = (await pool.request().input('uid', sql.VarChar(128), tag).input('email', sql.VarChar(255), email)
        .input('name', sql.NVarChar(150), name).input('phone', sql.VarChar(30), phone)
        .query("INSERT INTO dbo.users(firebase_uid,email,display_name,phone,role) OUTPUT INSERTED.id VALUES(@uid,@email,@name,@phone,'customer');")).recordset[0].id;
      const oid = (await pool.request().input('uid', sql.Int, id)
        .query("INSERT INTO dbo.orders(user_id,status,total_amount) OUTPUT INSERTED.id VALUES(@uid,'completed',100);")).recordset[0].id;
      await pool.request().input('oid', sql.Int, oid).input('pid', sql.Int, good2.id).input('vid', sql.Int, good2.base)
        .query(`INSERT INTO dbo.order_items(order_id,product_id,variant_id,product_name,unit_price,quantity,line_total)
          VALUES(@oid,@pid,@vid,N'Review fixture',100,1,100);`);
      return id;
    };
    const writer = await addBuyer(WRITER);
    const stranger = await addBuyer({ uid: 'audit-stranger-http', email: 'stranger.http@example.test', name: 'Khách Lạ', phone: '0966777888' });
    const reviewsUrl = `http://127.0.0.1:${server.address().port}/api/products/${good2.id}/reviews`;
    const rv = async (who, method, url, { body, files = 0 } = {}) => {
      const headers = { 'x-test-user': String(who) };
      let payload;
      if (files) {
        payload = new FormData();
        for (const [k, v] of Object.entries(body)) payload.append(k, String(v));
        for (let i = 0; i < files; i++) payload.append('images', new Blob([png], { type: 'image/png' }), 'anh.png');
      } else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      const r = await fetch(reviewsUrl + url, { method, headers, body: payload });
      return { status: r.status, body: await r.json() };
    };
    const reviewRow = (rows, action, entityId) => {
      assert.equal(rows.length, 1, `đúng 1 dòng ${action}`);
      const r = rows[0];
      assert.deepEqual([r.actor_role, r.actor_email, r.actor_user_id, r.action, r.entity_type, r.entity_id, r.ip],
        ['customer', null, writer, action, 'review', String(entityId), '127.0.0.1']);
      assert.ok((r.before_json === null || r.before_ok === 1) && (r.after_json === null || r.after_ok === 1), 'ISJSON = 1');
      const leaked = [WRITER.uid, WRITER.email, WRITER.name, WRITER.phone, 'user_id', 'firebase', reviewDir]
        .filter(v => ((r.before_json || '') + (r.after_json || '')).includes(v));
      assert.deepEqual(leaked, [], 'không lộ firebase_uid / email / tên / sđt người viết, không đường dẫn đĩa');
      return r;
    };
    const onDisk = () => fs.readdirSync(reviewDir).sort();
    const reviewOf = async id => (await pool.request().input('rid', sql.Int, id).query(`SELECT r.rating, r.comment, r.is_hidden, r.created_at,
      (SELECT COUNT(*) FROM dbo.review_images i WHERE i.review_id = r.id) AS images FROM dbo.reviews r WHERE r.id=@rid;`)).recordset[0];
    const reviewsBy = async uid => (await pool.request().input('uid', sql.Int, uid).query('SELECT COUNT(*) AS n FROM dbo.reviews WHERE user_id=@uid;')).recordset[0].n;
    const variant = { id: good2.base, size: null, color: null }; // snapshot của order_items (fixture không có size/màu)
    // JSON lỗi của bản 7d547cb (lấy một lần, như review-audit-routes.test.js) — route không đổi nhánh lỗi.
    const NOT_MINE = { status: 404, body: { status: 'error', code: 'REVIEW_NOT_FOUND', message: 'Không tìm thấy đánh giá của bạn' } };
    const SERVER_ERROR = { status: 500, body: { status: 'error', code: 'REVIEW_SERVER_ERROR', message: 'Không gửi được đánh giá. Vui lòng thử lại' } };
    let reviewId, imageUrl;

    await item('40. khách viết đánh giá (1 ảnh) -> 201, 1 dòng REVIEW_CREATE (customer, email NULL), after 3 khoá; ảnh nằm trong thư mục tạm', async () => {
      const { out, rows } = await newLogs(() => rv(writer, 'POST', '', { body: { rating: 5, variant_id: good2.base, comment: 'Đẹp' }, files: 1 }));
      assert.equal(out.status, 201, JSON.stringify(out.body));
      reviewId = out.body.id; imageUrl = out.body.images[0].url;
      const r = reviewRow(rows, 'REVIEW_CREATE', reviewId); keep('REVIEW_CREATE', r);
      assert.deepEqual([r.before_json, r.after_json], [null, JSON.stringify({ review: { product_id: good2.id, rating: 5, images_count: 1 } })]);
      const db = await reviewOf(reviewId);
      assert.deepEqual([db.rating, db.comment, db.is_hidden, db.images, onDisk()], [5, 'Đẹp', false, 1, [path.basename(imageUrl)]]);
    });

    await item('41. khách sửa sao + nội dung XSS -> 200, 1 dòng REVIEW_UPDATE (khoá con review 2 phía), content nguyên văn', async () => {
      const { out, rows } = await newLogs(() => rv(writer, 'PATCH', `/${reviewId}`, { body: { rating: 3, variant_id: good2.base, comment: XSS } }));
      assert.equal(out.status, 200, JSON.stringify(out.body)); assert.equal(out.body.comment, XSS);
      const r = reviewRow(rows, 'REVIEW_UPDATE', reviewId); keep('REVIEW_UPDATE', r);
      const side = (rating, content) => ({ review: { product_id: good2.id, rating, content, images_count: 1, variant } });
      assert.deepEqual([JSON.parse(r.before_json), JSON.parse(r.after_json)], [side(5, 'Đẹp'), side(3, XSS)]);
      assert.equal((await reviewOf(reviewId)).comment, XSS, 'DB lưu nguyên văn như cũ');
    });

    await item('42. khách khác sửa / xoá đánh giá không phải của mình -> 404 như cũ, 0 dòng, đánh giá + ảnh không đổi', async () => {
      const before = [await reviewOf(reviewId), onDisk()];
      for (const [method, opts] of [['PATCH', { body: { rating: 1, variant_id: good2.base, comment: 'chiếm' } }], ['DELETE', {}]]) {
        const { out, rows } = await newLogs(() => rv(stranger, method, `/${reviewId}`, opts));
        assert.deepEqual(out, NOT_MINE, method); assert.equal(rows.length, 0, method);
      }
      assert.deepEqual([await reviewOf(reviewId), onDisk()], before);
    });

    await item('43. viết khi audit() lỗi -> 500 như cũ, không có đánh giá mới, 0 dòng; ảnh vừa tải đã lưu rồi bị xoá khỏi đĩa', async () => {
      const files0 = onDisk(), saved0 = savedUrls.length;
      await pool.request().query("ALTER TABLE dbo.audit_logs WITH NOCHECK ADD CONSTRAINT CK_inject_audit CHECK (action <> 'REVIEW_CREATE');");
      const saved = console.error; console.error = () => {};
      let res;
      try { res = await newLogs(() => rv(stranger, 'POST', '', { body: { rating: 4, variant_id: good2.base, comment: 'Lỗi log' }, files: 1 })); }
      finally { console.error = saved; await pool.request().query('ALTER TABLE dbo.audit_logs DROP CONSTRAINT CK_inject_audit;'); }
      assert.deepEqual(res.out, SERVER_ERROR);
      const written = savedUrls.slice(saved0);
      assert.deepEqual([res.rows.length, await reviewsBy(stranger), written.length, onDisk()], [0, 0, 1, files0]);
      console.log(`   ảnh vừa tải khi audit() lỗi: đã ghi ${path.basename(written[0])} rồi bị xoá — thư mục tạm còn ${files0.length} file như trước, không có file mồ côi`);
    });

    await item('44. khách xoá đánh giá (đang bị ẩn) -> 200 như cũ, 1 dòng REVIEW_DELETE (snapshot is_hidden, created_at, media), after NULL; file xoá sau commit', async () => {
      await pool.request().input('rid', sql.Int, reviewId).query('UPDATE dbo.reviews SET is_hidden=1 WHERE id=@rid;');
      const createdAt = (await reviewOf(reviewId)).created_at;
      const { out, rows } = await newLogs(() => rv(writer, 'DELETE', `/${reviewId}`));
      assert.deepEqual(out, { status: 200, body: { status: 'success' } });
      const r = reviewRow(rows, 'REVIEW_DELETE', reviewId); keep('REVIEW_DELETE', r);
      assert.equal(r.after_json, null);
      assert.deepEqual(JSON.parse(r.before_json), { review: { product_id: good2.id, rating: 3, content: XSS, variant, is_hidden: true,
        created_at: createdAt.toISOString() }, media: [imageUrl] });
      assert.deepEqual([await reviewOf(reviewId), onDisk()], [undefined, []]);
    });
    // ---- GET /api/admin/audit-logs qua router /api/admin THẬT, đăng nhập giả admin / staff / khách ----
    // Dùng các dòng log mục 1–44 sinh ra + vài dòng INSERT thẳng (ngày giờ VN cố định, khách đã xoá tài khoản).
    const { permsFor } = require('../lib/permissions');
    const STAFF_PERMS = [...permsFor('staff')];
    const logsApi = (who, query = '') => http(who, 'GET', '/audit-logs' + query);
    const allPages = async (who, query = '') => { // gom mọi trang (50 dòng/trang) tới khi đủ total
      const out = []; let page = 1, total;
      do {
        const r = await logsApi(who, (query ? query + '&' : '?') + 'page=' + page);
        assert.equal(r.status, 200, JSON.stringify(r.body)); total = r.body.total; out.push(...r.body.logs); page++;
        if (!r.body.logs.length) break;
      } while (out.length < total);
      assert.equal(out.length, total, 'gom đủ total qua các trang');
      return out;
    };
    const dbIds = async (where, bind = rq => rq) => (await bind(pool.request()).query(`SELECT CAST(l.id AS VARCHAR(20)) AS id
      FROM dbo.audit_logs l LEFT JOIN dbo.users u ON u.id = l.actor_user_id WHERE ${where} ORDER BY l.created_at DESC, l.id DESC;`)).recordset.map(x => x.id);
    const ADMIN_EMAIL = 'admin.http@example.test';
    const tag12 = String(process.pid);
    const fixtureLog = async (role, userId, action, entityType, entityId, createdAt) => (await pool.request()
      .input('uid', sql.Int, userId).input('role', sql.VarChar(20), role).input('action', sql.VarChar(50), action)
      .input('et', sql.VarChar(30), entityType).input('eid', sql.VarChar(50), entityId).input('at', sql.DateTime2(3), createdAt)
      .query(`INSERT INTO dbo.audit_logs(created_at,actor_user_id,actor_role,action,entity_type,entity_id,after_json)
        OUTPUT INSERTED.id VALUES(ISNULL(@at, SYSUTCDATETIME()),@uid,@role,@action,@et,@eid,N'{"fixture":true}');`)).recordset[0].id;
    // Khách đã xoá tài khoản: user có dòng log rồi bị xoá hẳn khỏi dbo.users (như routes/account.js).
    const goneUser = (await pool.request().input('uid', sql.VarChar(128), `audit-gone-${tag12}`).input('email', sql.VarChar(255), `gone-${tag12}@example.test`)
      .query("INSERT INTO dbo.users(firebase_uid,email,role) OUTPUT INSERTED.id VALUES(@uid,@email,'customer');")).recordset[0].id;
    await fixtureLog('customer', goneUser, 'ORDER_PLACE', 'order', `gone-${tag12}`, null);
    await pool.request().input('id', sql.Int, goneUser).query('DELETE FROM dbo.users WHERE id=@id;');
    // Ngày giờ VN: 23:30 ngày 15/03/2020 VN = 16:30 UTC; 00:30 ngày 16/03/2020 VN = 17:30 UTC 15/03 (không log nào khác ở năm 2020).
    await fixtureLog('customer', writer, 'REVIEW_CREATE', 'review', `tz-in-${tag12}`, new Date('2020-03-15T16:30:00Z'));
    await fixtureLog('customer', writer, 'REVIEW_DELETE', 'review', `tz-out-${tag12}`, new Date('2020-03-15T17:30:00Z'));
    const apiSamples = {};
    const sampleOf = body => ({ ...body, logs: body.logs.slice(0, 2) });

    await item('45. admin GET /audit-logs: 200, total = mọi dòng, đủ 2 nhóm qua các trang, created_at DESC, có ip/user_agent; đọc không sinh dòng log', async () => {
      const before = await count();
      const r = await logsApi(adminId);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual([r.body.status, r.body.page, r.body.page_size, r.body.total, r.body.logs.length], ['ok', 1, 50, before, Math.min(50, before)]);
      assert.deepEqual(r.body.logs.map(l => l.id), (await dbIds('1=1')).slice(0, 50), 'đúng 50 dòng mới nhất, created_at DESC, id DESC');
      const all = await allPages(adminId);
      assert.deepEqual(all.map(l => l.id), await dbIds('1=1'));
      assert.deepEqual([...new Set(all.map(l => l.actor_role))].sort(), ['admin', 'cli', 'customer', 'staff']);
      assert.ok(all.every(l => 'ip' in l && 'user_agent' in l && typeof l.id === 'string' && /Z$/.test(l.created_at)));
      const p999 = await logsApi(adminId, '?page=999');
      assert.deepEqual([p999.status, p999.body.total, p999.body.logs], [200, before, []]);
      assert.equal(await count(), before, 'đọc log không ghi thêm dòng audit');
      apiSamples.admin = sampleOf(r.body);
      console.log(`   admin: total ${r.body.total}, ${Math.ceil(r.body.total / 50)} trang`);
    });

    await item('46. admin lọc từng tham số trên SQL thật (so với COUNT độc lập); entity_id khớp nguyên văn (dấu cách cuối / hoa-thường -> 0)', async () => {
      const same = async (query, where, bind) => {
        const got = (await allPages(adminId, query)).map(l => l.id), want = await dbIds(where, bind);
        assert.deepEqual(got, want, query); return got.length;
      };
      const n = {};
      n.groupAdmin = await same('?group=admin', "l.actor_role IN ('admin','staff','cli')");
      n.groupCustomer = await same('?group=customer', "l.actor_role = 'customer'");
      n.action = await same('?action=REVIEW_UPDATE', "l.action = 'REVIEW_UPDATE'");
      n.entity = await same(`?entity_type=review&entity_id=${reviewId}`, `l.entity_type = 'review' AND l.entity_id = '${reviewId}'`);
      n.actorUser = await same(`?actor_user_id=${writer}`, `l.actor_user_id = ${writer}`);
      n.adminEmail = await same(`?actor_email=${encodeURIComponent(' ' + ADMIN_EMAIL.toUpperCase() + ' ')}`,
        `l.actor_role <> 'customer' AND LOWER(l.actor_email) = '${ADMIN_EMAIL}'`);
      n.customerEmail = await same(`?actor_email=${encodeURIComponent(WRITER.email.toUpperCase())}`, `l.actor_role = 'customer' AND l.actor_user_id = ${writer}`);
      assert.ok(n.groupAdmin > 0 && n.groupCustomer > 0 && n.action > 0 && n.entity === 3 && n.actorUser > 0 && n.adminEmail > 0 && n.customerEmail > 0, JSON.stringify(n));
      for (const q of [`?entity_type=review&entity_id=${reviewId}%20`, `?entity_type=review&entity_id=TZ-IN-${tag12}`, `?entity_type=user&entity_id=tz-in-${tag12}`]) {
        const r = await logsApi(adminId, q);
        assert.deepEqual([r.status, r.body.total], [200, 0], q);
      }
      const naive = (await pool.request().input('a', sql.VarChar(50), `${reviewId} `).input('b', sql.VarChar(50), `TZ-IN-${tag12}`)
        .query("SELECT (SELECT COUNT(*) FROM dbo.audit_logs WHERE entity_type='review' AND entity_id=@a) AS a, (SELECT COUNT(*) FROM dbo.audit_logs WHERE entity_type='review' AND entity_id=@b) AS b;")).recordset[0];
      console.log(`   lọc: ${JSON.stringify(n)}; so '=' thường của SQL Server sẽ khớp nhầm ${naive.a} dòng ('${reviewId} ') + ${naive.b} dòng ('TZ-IN-…') — API trả 0`);
    });

    await item('47. staff: không tham số / group=customer / group=admin / group= -> CHỈ log khách, y hệt nhau; lọc email admin / action Quản trị -> 0; không khoá ip, user_agent', async () => {
      const customerIds = await dbIds("l.actor_role = 'customer'");
      const runs = [];
      for (const q of ['', '?group=customer', '?group=admin', '?group=']) {
        const r = await logsApi(staffId, q);
        assert.equal(r.status, 200, q + ' ' + JSON.stringify(r.body));
        assert.equal(r.body.total, customerIds.length, q);
        runs.push(JSON.stringify(r.body));
        if (q === '') apiSamples.staff = sampleOf(r.body);
      }
      assert.ok(runs.every(x => x === runs[0]), '4 cách gọi trả y hệt nhau');
      const all = await allPages(staffId, '?group=admin');
      assert.deepEqual(all.map(l => l.id), customerIds);
      assert.ok(all.every(l => l.actor_role === 'customer' && !('ip' in l) && !('user_agent' in l)), 'chỉ khách, không khoá ip/user_agent');
      for (const q of [`?actor_email=${ADMIN_EMAIL}`, '?action=PRODUCT_UPDATE', `?actor_user_id=${adminId}`, '?group=admin&action=ROLE_CHANGE']) {
        const r = await logsApi(staffId, q);
        assert.deepEqual([r.status, r.body.total, r.body.logs], [200, 0, []], q);
      }
    });

    const staffFull = async () => { // quyền staff vẫn đủ (mặc định) và staff vẫn gọi được API
      assert.deepEqual([...permsFor('staff')], STAFF_PERMS);
      assert.ok(STAFF_PERMS.includes('audit:read_customer') && STAFF_PERMS.length === 10);
      assert.equal((await logsApi(staffId, '?page=1')).status, 200);
    };
    // Staff KHÔNG có cả 2 quyền audit -> 403 + PERMISSION_DENIED trong dbo.SecurityEvents. Tiến trình cha chạy NODE_ENV=production
    // (.env) nên setPermissionsForTest bị guard chặn (giữ nguyên guard) -> chạy trong TIẾN TRÌNH CON, env dựng tường minh
    // (NODE_ENV=test, DB_NAME = DB tạm, chỉ các biến DB_*), con KHÔNG nạp dotenv. Con: SELECT DB_NAME() rồi chờ lệnh GO;
    // cha so khớp DB tạm, lệch -> kill + FAIL, không gọi API. securityLogger không có nhánh nào theo NODE_ENV.
    const CHILD_DENY = `
      const path = require('path'), S = ${JSON.stringify(serverDir)}, staff = Number(process.argv[1]);
      const send = o => new Promise(r => process.stdout.write(JSON.stringify(o) + '\\n', r)); // chờ ghi xong rồi mới exit
      (async () => {
        const db = require(path.join(S, 'db.js'));
        const pool = await db.getPool();
        const name = (await pool.request().query('SELECT DB_NAME() AS d')).recordset[0].d;
        await send({ step: 'db', db: name, config_db: db.config.database, env_db: process.env.DB_NAME, node_env: process.env.NODE_ENV });
        const go = await new Promise(resolve => { let buf = ''; process.stdin.on('data', c => { buf += c; if (buf.includes('\\n')) resolve(buf.trim()); }); });
        if (go !== 'GO') { await send({ step: 'abort' }); process.exit(3); }
        require.cache[require.resolve(path.join(S, 'firebase.js'))] = { exports: { getAuth() { throw new Error('không được gọi Firebase thật'); } } };
        require.cache[require.resolve(path.join(S, 'middleware', 'auth.js'))] = { exports: { async verifyFirebaseToken(req, res, next) {
          const id = Number(req.headers['x-test-user']); if (!id) return res.status(401).json({ status: 'error' });
          req.user = (await pool.request().input('id', db.sql.Int, id).query('SELECT id, email, role, phone FROM dbo.users WHERE id=@id;')).recordset[0];
          if (!req.user) return res.status(401).json({ status: 'error' });
          next();
        } } };
        const perms = require(path.join(S, 'lib', 'permissions.js'));
        perms.setPermissionsForTest({ admin: [...perms.permsFor('admin')], staff: [...perms.permsFor('staff')].filter(p => !p.startsWith('audit:')) });
        const staffPerms = [...perms.permsFor('staff')];
        const express = require('express');
        const app = express();
        app.use(require(path.join(S, 'middleware', 'securityLogger.js')).securityLogger);
        app.use(express.json());
        app.use('/api/admin', require(path.join(S, 'routes', 'admin.js')));
        const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
        const r = await fetch('http://127.0.0.1:' + server.address().port + '/api/admin/audit-logs', { headers: { 'x-test-user': String(staff) } });
        const body = await r.json();
        await new Promise(r => setTimeout(r, 300)); // securityLogger ghi fire-and-forget sau 'finish'
        perms.setPermissionsForTest();
        await new Promise(r => server.close(r)); await pool.close();
        await send({ step: 'done', status: r.status, body, staffPerms });
        process.exit(0);
      })().catch(async e => { await send({ step: 'error', message: e.message }); process.exit(1); });`;
    const childEnv12 = Object.fromEntries(Object.entries({ // KHÔNG ...process.env: chỉ đúng các biến cần
      DB_SERVER: process.env.DB_SERVER, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER, DB_PASSWORD: process.env.DB_PASSWORD,
      DB_ENCRYPT: process.env.DB_ENCRYPT, DB_TRUST_SERVER_CERTIFICATE: process.env.DB_TRUST_SERVER_CERTIFICATE,
      DB_NAME: dbName, NODE_ENV: 'test', SystemRoot: process.env.SystemRoot,
    }).filter(([, v]) => v !== undefined));
    const runDenyChild = async () => {
      const child = spawn(process.execPath, ['-e', CHILD_DENY, String(staffId)], { cwd: serverDir, env: childEnv12, stdio: ['pipe', 'pipe', 'pipe'] });
      const msgs = []; let waiting = null, out = '', err = '';
      child.stdout.on('data', c => { out += c; let i; while ((i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i); out = out.slice(i + 1); try { msgs.push(JSON.parse(line)); } catch (_) { /* dòng không phải JSON */ }
        if (waiting) waiting(); } });
      child.stderr.on('data', c => { err += c; });
      child.on('exit', () => { if (waiting) waiting(); });
      const next = async step => { // chờ đúng bước, tối đa 20 giây
        const deadline = Date.now() + 20000;
        for (;;) {
          const m = msgs.find(x => x.step === step || x.step === 'error' || x.step === 'abort');
          if (m) { if (m.step !== step) throw new Error('tiến trình con: ' + JSON.stringify(m) + ' ' + err.slice(0, 300)); return m; }
          if (child.exitCode !== null) throw new Error('tiến trình con thoát sớm (' + child.exitCode + '): ' + err.slice(0, 300));
          if (Date.now() > deadline) throw new Error('tiến trình con quá hạn ở bước ' + step);
          await new Promise(r => { waiting = r; setTimeout(r, 200); }); waiting = null;
        }
      };
      const hardKill = setTimeout(() => child.kill(), 30000); // timeout cứng
      try {
        const probe = await next('db');
        const safe = probe.db === dbName && probe.config_db === dbName && probe.env_db === dbName && probe.node_env === 'test'
          && dbName.toLowerCase() !== String(mainDb).toLowerCase();
        console.log(`   tiến trình con: DB_NAME()=${probe.db}, NODE_ENV=${probe.node_env} -> ${safe ? 'đúng DB tạm, gửi GO' : 'LỆCH, kill'}`);
        if (!safe) { child.kill(); throw new Error('tiến trình con KHÔNG nối DB tạm: ' + JSON.stringify(probe)); }
        child.stdin.write('GO\n');
        return { probe, done: await next('done') };
      } finally {
        clearTimeout(hardKill);
        if (child.exitCode === null && child.signalCode === null) child.kill();
      }
    };

    await item('48. khách -> 403 ở cổng chung, chưa đăng nhập -> 401; staff không có cả 2 quyền audit (tiến trình con) -> 403 + đúng 1 dòng PERMISSION_DENIED mới trong dbo.SecurityEvents DB tạm', async () => {
      const c = await logsApi(customerId);
      assert.deepEqual([c.status, c.body.message], [403, 'Chỉ tài khoản quản trị mới được phép thao tác này']);
      assert.equal((await logsApi(0)).status, 401);
      const nodeEnvAtStart = process.env.NODE_ENV;
      const secMax = async () => (await pool.request().query('SELECT ISNULL(MAX(id), 0) AS m FROM dbo.SecurityEvents;')).recordset[0].m;
      const from = await secMax();
      const { done } = await runDenyChild();
      assert.ok(!done.staffPerms.some(p => p.startsWith('audit:')), 'trong con staff đã mất 2 quyền audit');
      assert.equal(done.status, 403);
      assert.deepEqual(done.body, { status: 'error', code: 'FORBIDDEN', message: 'Tài khoản không có quyền thực hiện thao tác này' });
      const rows = (await pool.request().input('from', sql.BigInt, from).query(`SELECT event_type, severity, status_code, method, path
        FROM dbo.SecurityEvents WHERE id > @from ORDER BY id;`)).recordset;
      assert.deepEqual(rows, [{ event_type: 'PERMISSION_DENIED', severity: 'medium', status_code: 403, method: 'GET', path: '/api/admin/audit-logs' }],
        'đúng 1 dòng mới, PERMISSION_DENIED');
      // Tiến trình cha: NODE_ENV không đổi, guard vẫn chặn, quyền staff vẫn đủ.
      assert.equal(process.env.NODE_ENV, nodeEnvAtStart);
      if (nodeEnvAtStart === 'production') assert.throws(() => require('../lib/permissions').setPermissionsForTest(), /production/);
      await staffFull();
      console.log(`   tiến trình cha: NODE_ENV=${process.env.NODE_ENV} (không đổi), guard setPermissionsForTest vẫn chặn; staff ${permsFor('staff').size} quyền`);
    });

    await item('49. tài khoản đã xoá: khách -> actor_email null, actor_deleted true; cli -> false; khách còn tài khoản -> email hiện tại', async () => {
      await staffFull();
      const gone = await logsApi(adminId, `?entity_type=order&entity_id=gone-${tag12}`);
      assert.equal(gone.body.total, 1);
      const g = gone.body.logs[0];
      assert.deepEqual([g.actor_role, g.actor_user_id, g.actor_email, g.actor_deleted], ['customer', goneUser, null, true]);
      const gs = (await logsApi(staffId, `?entity_type=order&entity_id=gone-${tag12}`)).body.logs[0];
      assert.deepEqual([gs.actor_email, gs.actor_deleted, 'ip' in gs], [null, true, false]);
      const cli = (await allPages(adminId, '?action=ROLE_CHANGE')).filter(l => l.actor_role === 'cli');
      assert.ok(cli.length > 0 && cli.every(l => l.actor_user_id === null && l.actor_deleted === false),
        'cli: ' + JSON.stringify(cli.map(l => [l.actor_user_id, l.actor_deleted])));
      // group=customer: id của writer có thể trùng id giả reqOf(…, 11) mà mục 1–5 dùng cho log admin.
      const live = (await logsApi(adminId, `?actor_user_id=${writer}&group=customer`)).body.logs;
      assert.ok(live.length > 0 && live.every(l => l.actor_email === WRITER.email && l.actor_deleted === false),
        'khách còn tài khoản: ' + JSON.stringify(live.map(l => [l.actor_role, l.actor_email, l.actor_deleted])));
    });

    await item('49b. cùng actor_user_id = id writer: dòng admin ra actor_email ĐÃ LƯU trong audit_logs (khác email writer); dòng khách ra email writer (join users)', async () => {
      const stored = (await pool.request().input('uid', sql.Int, writer).query(`SELECT CAST(id AS VARCHAR(20)) AS id, actor_email
        FROM dbo.audit_logs WHERE actor_role = 'admin' AND actor_user_id = @uid ORDER BY id;`)).recordset;
      const writerEmail = (await pool.request().input('uid', sql.Int, writer).query('SELECT email FROM dbo.users WHERE id=@uid;')).recordset[0].email;
      assert.ok(stored.length > 0, 'cần ít nhất 1 dòng admin có actor_user_id = ' + writer);
      const api = await allPages(adminId, `?actor_user_id=${writer}`);
      for (const s of stored) {
        const l = api.find(x => x.id === s.id);
        assert.ok(l, 'API có dòng admin id ' + s.id);
        assert.equal(l.actor_role, 'admin');
        assert.equal(l.actor_email, s.actor_email, 'dòng admin: email đã lưu trong audit_logs');
        assert.notEqual(l.actor_email, writerEmail, 'dòng admin không lấy email của writer từ users');
      }
      const cust = api.filter(l => l.actor_role === 'customer');
      assert.ok(cust.length > 0 && cust.every(l => l.actor_email === writerEmail), 'dòng khách: email từ users = ' + writerEmail);
      console.log(`   id ${writer}: ${stored.length} dòng admin -> ${JSON.stringify(stored.map(s => s.actor_email))}; ${cust.length} dòng khách -> ${writerEmail}`);
    });

    await item('50. from/to theo giờ VN: log 23:30 ngày 15/03/2020 (16:30 UTC) nằm trong from=to=2020-03-15; log 00:30 ngày 16/03 thì không', async () => {
      await staffFull();
      for (const who of [adminId, staffId]) {
        const d15 = await logsApi(who, '?from=2020-03-15&to=2020-03-15');
        const d16 = await logsApi(who, '?from=2020-03-16&to=2020-03-16');
        assert.deepEqual([d15.body.logs.map(l => l.entity_id), d16.body.logs.map(l => l.entity_id)], [[`tz-in-${tag12}`], [`tz-out-${tag12}`]]);
        assert.deepEqual([d15.body.logs[0].created_at, d16.body.logs[0].created_at], ['2020-03-15T16:30:00.000Z', '2020-03-15T17:30:00.000Z']);
      }
      const both = await logsApi(adminId, '?from=2020-03-15&to=2020-03-16');
      assert.equal(both.body.total, 2);
    });
    for (const [who, body] of Object.entries(apiSamples)) console.log(`   response mẫu (${who}, cắt còn 2 dòng log):\n${JSON.stringify(body, null, 2)}`);
    for (const [label, s] of Object.entries(samples)) console.log(`   mẫu ${label}\n     before_json = ${s.before}\n     after_json  = ${s.after}`);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (reviewDir) { fs.rmSync(reviewDir, { recursive: true, force: true }); console.log(`Removed temp review images dir (còn: ${fs.existsSync(reviewDir)})`); }
    try { if (pool && pool.connected) await pool.close(); }
    finally {
      if (createdDb) {
        adminSql(`ALTER DATABASE ${quotedDb} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${quotedDb};`);
        const left = adminSql(`SELECT COUNT(*) FROM sys.databases WHERE name = N'${dbName}';`).trim();
        console.log(`Removed disposable database: ${dbName} (còn lại: ${left})`);
        if (left !== '0') { failures++; console.log('DB tạm đã xoá: FAIL'); }
      }
    }
  }
  const counterAfter = await mainCounter();
  if (counterAfter === counterBefore) console.log(`${mainDb}.order_code_counter ${counterBefore} -> ${counterAfter}, không đổi: PASS`);
  else { failures++; console.log(`${mainDb}.order_code_counter ${counterBefore} -> ${counterAfter}: FAIL`); }
  const rolesAfter = await mainRoleCounts();
  const roleText = r => r.map(x => `${x.role}=${x.n}`).join(', ');
  if (JSON.stringify(rolesAfter) === JSON.stringify(rolesBefore)) console.log(`${mainDb} số tài khoản theo role [${roleText(rolesBefore)}] -> [${roleText(rolesAfter)}], không đổi: PASS`);
  else { failures++; console.log(`${mainDb} số tài khoản theo role [${roleText(rolesBefore)}] -> [${roleText(rolesAfter)}]: FAIL`); }
  if (failures) throw new Error(failures + ' mục FAIL');
  console.log('Audit SQL integration: PASS');
}

main().catch(err => { console.error('verify-audit-sql FAILED:', err.message); process.exitCode = 1; });
