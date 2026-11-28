'use strict';
// Nhận hàng theo phiếu nhập chạy ĐỒNG THỜI trên SQL Server thật, bằng DB TẠM tự tạo và tự xoá (setup-db --fresh).
// Không ghi gì vào DB của .env: chỉ SELECT số dòng sổ kho + bộ đếm mã đơn trước / sau để chứng minh không đổi.
// Gọi API thật qua router /api/admin + /api/orders (đăng nhập giả đọc user từ DB tạm, như verify-audit-sql.js).
//   (a)  2 request nhận cùng 1 phiếu song song (ép khoá: 1 transaction giữ UPDLOCK dòng phiếu rồi mới nhả)
//        -> đúng 1 thành công, 1 bị 409, tồn chỉ cộng 1 lần.  (a2) lặp 10 vòng không ép khoá.
//   (b)  nhận hàng song song với checkout cùng sản phẩm (ép khoá: giữ UPDLOCK dòng sản phẩm) -> không deadlock,
//        tồn cuối = đầu + nhập − bán.  (b2) lặp 20 vòng không ép khoá, đếm deadlock (lỗi 1205) = 0.
//   (c)  sau tất cả: SUM(product_variants.stock) = products.stock của từng sản phẩm đã đụng.
// In bảng cố định: tên ca | kết quả | thời gian ms | tồn trước/sau | số dòng sổ kho | số dòng audit.
// Chạy (trong server/, cần sqlcmd + Windows auth như các script verify-*-sql khác):
//   node scripts/test-receipt-receive-sql.js
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const mainDb = process.env.DB_NAME;
const dbName = 'BreezeReceiveTest_' + process.pid + '_' + Date.now();
if (!/^BreezeReceiveTest_[0-9]+_[0-9]+$/.test(dbName) || dbName.toLowerCase() === String(mainDb).toLowerCase()) {
  throw new Error('Unsafe test database');
}
process.env.DB_NAME = dbName; // trước require('../db'): getPool() trỏ vào DB tạm
const { getPool, sql, config } = require('../db');
if (config.database !== dbName) throw new Error('Unsafe test database');
const quoted = '[' + dbName + ']', serverDir = path.join(__dirname, '..');

let pool, server, created = false, failures = 0;
const results = [];
function adminSql(statement) {
  return execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-h', '-1', '-Q',
    'SET NOCOUNT ON; ' + statement], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
async function mainSnapshot() { // chỉ đọc DB chính
  const main = await new sql.ConnectionPool({ ...config, database: mainDb }).connect();
  try {
    return (await main.request().query(`SELECT (SELECT COUNT(*) FROM dbo.inventory_movements) AS movements,
      (SELECT last_code FROM dbo.order_code_counter WHERE id = 1) AS order_code;`)).recordset[0];
  } finally { await main.close(); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const maxId = async table => (await pool.request().query(`SELECT ISNULL(MAX(id), 0) AS m FROM dbo.${table};`)).recordset[0].m;

// Chạy 1 ca: đo thời gian, đếm dòng sổ kho / audit mới, ghi 1 dòng vào bảng kết quả. fn trả { stock, detail? }.
async function runCase(name, fn) {
  const m0 = await maxId('inventory_movements'), a0 = await maxId('audit_logs');
  const t0 = process.hrtime.bigint();
  let out = {}, ok = true, error = '';
  try { out = await fn(); } catch (e) { ok = false; failures++; error = e.message; }
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  const counts = (await pool.request().input('m', sql.BigInt, m0).input('a', sql.BigInt, a0).query(`
    SELECT (SELECT COUNT(*) FROM dbo.inventory_movements WHERE id > @m) AS movements,
           (SELECT COUNT(*) FROM dbo.audit_logs WHERE id > @a) AS audit;`)).recordset[0];
  results.push({ name, result: ok ? 'PASS' + (out.detail ? ' (' + out.detail + ')' : '') : 'FAIL — ' + error, ms,
    stock: out.stock || '—', movements: counts.movements, audit: counts.audit });
  console.log(`${name}: ${ok ? 'PASS' : 'FAIL — ' + error}`);
}
function printTable() {
  const head = ['tên ca', 'kết quả', 'thời gian ms', 'tồn trước/sau', 'số dòng sổ kho', 'số dòng audit'];
  const rows = results.map(r => [r.name, r.result, String(r.ms), r.stock, String(r.movements), String(r.audit)]);
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = cells => '| ' + cells.map((c, i) => c.padEnd(width[i])).join(' | ') + ' |';
  console.log('\n' + line(head));
  console.log('|' + width.map(w => '-'.repeat(w + 2)).join('|') + '|');
  for (const r of rows) console.log(line(r));
}

async function main() {
  const mainBefore = await mainSnapshot();
  try {
    adminSql(`CREATE DATABASE ${quoted};`); created = true;
    adminSql(`ALTER AUTHORIZATION ON DATABASE::${quoted} TO [${String(config.user).replace(/]/g, ']]')}];`);
    console.log('Created disposable database:', dbName);
    execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], { cwd: serverDir, env: { ...process.env, DB_NAME: dbName },
      stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
    pool = await getPool();
    assert.equal((await pool.request().query('SELECT DB_NAME() AS d;')).recordset[0].d, dbName);

    // ---- router THẬT, đăng nhập giả: x-test-user = id trong dbo.users của DB tạm ----
    require.cache[require.resolve('../middleware/auth')] = { exports: {
      async verifyFirebaseToken(req, res, next) {
        const id = Number(req.headers['x-test-user']); if (!id) return res.status(401).json({ status: 'error' });
        req.user = (await pool.request().input('id', sql.Int, id).query('SELECT id, email, role, phone FROM dbo.users WHERE id=@id;')).recordset[0];
        if (!req.user) return res.status(401).json({ status: 'error' });
        next();
      },
    } };
    const express = require('express');
    const app = express(); app.use(express.json());
    app.use('/api/admin', require('../routes/admin'));
    app.use('/api/orders', require('../routes/orders'));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = async (who, method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(who) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: await r.json() };
    };
    const mkUser = async role => (await pool.request().input('tag', sql.VarChar(128), `receive-${role}-${process.pid}`)
      .input('email', sql.VarChar(255), `${role}.receive@example.test`).input('role', sql.VarChar(20), role)
      .query('INSERT INTO dbo.users(firebase_uid,email,role) OUTPUT INSERTED.id VALUES(@tag,@email,@role);')).recordset[0].id;
    const adminId = await mkUser('admin'), staffId = await mkUser('staff'), customerId = await mkUser('customer');

    // 2 sản phẩm chỉ có BASE (biến thể lá = BASE), đang bán. Tồn đầu chỉ cần đủ cho đơn đầu tiên: (a) / (a2) nhập trước,
    // mỗi vòng (b2) nhập nhiều hơn bán.
    const goods = (await pool.request().query(`SELECT TOP (2) p.id, v.id AS base FROM dbo.products p
      JOIN dbo.categories c ON c.id = p.category_id JOIN dbo.product_variants v ON v.product_id = p.id AND v.is_base = 1
      WHERE p.is_active = 1 AND v.is_active = 1 AND v.stock >= 5 AND c.slug NOT IN ('sanpham-ao','sanpham-quan','sanpham-giay')
        AND NOT EXISTS (SELECT 1 FROM dbo.product_colors pc WHERE pc.product_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM dbo.product_variants nv WHERE nv.product_id = p.id AND nv.is_base = 0)
      ORDER BY p.id;`)).recordset;
    assert.equal(goods.length, 2, 'cần 2 sản phẩm BASE có tồn >= 5 trong seed');
    const [g1, g2] = goods;
    const supplierId = (await call(adminId, 'POST', '/admin/suppliers', { code: 'NCC-RECV', name: 'NCC kiểm đồng thời' })).body.supplier.id;
    const shippingInput = require('../__tests__/helpers/shipping');

    const stockNow = async () => {
      const r = (await pool.request().input('a', sql.Int, g1.id).input('b', sql.Int, g2.id).query(`
        SELECT p.id, p.stock AS product, v.stock AS variant FROM dbo.products p
        JOIN dbo.product_variants v ON v.product_id = p.id AND v.is_base = 1 WHERE p.id IN (@a, @b);`)).recordset;
      return Object.fromEntries(r.map(x => [x.id, { product: x.product, variant: x.variant }]));
    };
    const stockText = (b, a) => [g1, g2].map(g => `sp${g.id}: ${b[g.id].variant}→${a[g.id].variant}`).join('; ');
    const approved = async (q1, q2) => {
      const c = await call(staffId, 'POST', '/admin/receipts', { supplier_id: supplierId, items: [
        { product_id: g1.id, variant_id: g1.base, quantity: q1, unit_cost: 50000 },
        { product_id: g2.id, variant_id: g2.base, quantity: q2, unit_cost: 70000 }] });
      assert.equal(c.status, 201, JSON.stringify(c.body));
      const id = c.body.receipt.id;
      assert.equal((await call(staffId, 'POST', `/admin/receipts/${id}/submit`)).status, 200);
      assert.equal((await call(adminId, 'POST', `/admin/receipts/${id}/approve`)).status, 200);
      return id;
    };
    const fillCart = async (q1, q2) => {
      await pool.request().input('u', sql.Int, customerId).query('DELETE FROM dbo.cart_items WHERE user_id=@u;');
      await pool.request().input('u', sql.Int, customerId).input('p1', sql.Int, g1.id).input('v1', sql.Int, g1.base)
        .input('p2', sql.Int, g2.id).input('v2', sql.Int, g2.base).input('q1', sql.Int, q1).input('q2', sql.Int, q2)
        .query('INSERT INTO dbo.cart_items(user_id,product_id,variant_id,quantity) VALUES(@u,@p1,@v1,@q1),(@u,@p2,@v2,@q2);');
    };
    const checkout = () => call(customerId, 'POST', '/orders', { ...shippingInput, paymentMethod: 'cod' });
    const receive = (who, id) => call(who, 'POST', `/admin/receipts/${id}/receive`);
    const receiveCount = async id => (await pool.request().input('id', sql.Int, id).query(`SELECT
      (SELECT COUNT(*) FROM dbo.inventory_movements WHERE receipt_id = @id) AS movements,
      (SELECT COUNT(*) FROM dbo.audit_logs WHERE entity_type = 'receipt' AND entity_id = CAST(@id AS VARCHAR(50)) AND action = 'RECEIPT_RECEIVE') AS audit,
      (SELECT status FROM dbo.purchase_receipts WHERE id = @id) AS status;`)).recordset[0];
    // Giữ khoá UPDLOCK trên 1 dòng trong transaction riêng, chạy các request, chờ chúng bị chặn rồi mới nhả.
    async function whileLocked(lockSql, bind, start) {
      const holder = new sql.Transaction(pool);
      await holder.begin();
      await bind(new sql.Request(holder)).query(lockSql);
      const settled = [];
      const runs = start().map((p, i) => p.then(v => { settled[i] = true; return v; }));
      await wait(300);
      const blocked = !settled.some(Boolean);
      await holder.rollback();
      return { outs: await Promise.all(runs), blocked };
    }
    // Đếm lỗi deadlock (1205) trong log lỗi của route trong lúc chạy.
    let deadlocks = 0;
    const realError = console.error;
    console.error = (...args) => { if (args.join(' ').match(/deadlock/i)) deadlocks++; };

    await runCase('(a) 2 request nhận cùng 1 phiếu song song (ép khoá)', async () => {
      const id = await approved(7, 5);
      const before = await stockNow();
      const { outs, blocked } = await whileLocked('SELECT id FROM dbo.purchase_receipts WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;',
        r => r.input('id', sql.Int, id), () => [receive(staffId, id), receive(adminId, id)]);
      assert.ok(blocked, '2 request phải cùng chờ khoá dòng phiếu');
      const statuses = outs.map(o => o.status).sort();
      assert.deepEqual(statuses, [200, 409], JSON.stringify(outs.map(o => o.body)));
      const lost = outs.find(o => o.status === 409).body;
      assert.deepEqual([lost.code, lost.current_status], ['RECEIPT_INVALID_STATE', 'received']);
      const after = await stockNow();
      for (const [g, q] of [[g1, 7], [g2, 5]]) {
        assert.equal(after[g.id].variant, before[g.id].variant + q, 'cộng đúng 1 lần');
        assert.equal(after[g.id].product, before[g.id].product + q);
      }
      assert.deepEqual(await receiveCount(id), { movements: 2, audit: 1, status: 'received' });
      return { stock: stockText(before, after), detail: '1×200, 1×409' };
    });

    await runCase('(a2) 10 vòng nhận trùng song song (không ép khoá)', async () => {
      const before = await stockNow();
      let wins = 0;
      for (let i = 0; i < 10; i++) {
        const id = await approved(1, 1);
        const outs = await Promise.all([receive(staffId, id), receive(adminId, id)]);
        assert.deepEqual(outs.map(o => o.status).sort(), [200, 409], 'vòng ' + i + ': ' + JSON.stringify(outs.map(o => o.body)));
        assert.deepEqual(await receiveCount(id), { movements: 2, audit: 1, status: 'received' });
        wins++;
      }
      const after = await stockNow();
      for (const g of [g1, g2]) assert.equal(after[g.id].variant, before[g.id].variant + 10);
      return { stock: stockText(before, after), detail: `${wins}/10 vòng đúng 1×200 + 1×409` };
    });

    await runCase('(b) nhận hàng song song checkout cùng sản phẩm (ép khoá)', async () => {
      const id = await approved(10, 4);
      await fillCart(2, 1);
      const before = await stockNow();
      const lockPid = Math.min(g1.id, g2.id);
      const { outs, blocked } = await whileLocked('SELECT id FROM dbo.products WITH (UPDLOCK, HOLDLOCK) WHERE id = @pid;',
        r => r.input('pid', sql.Int, lockPid), () => [receive(staffId, id), checkout()]);
      assert.ok(blocked, 'nhận hàng và checkout phải cùng chờ khoá dòng sản phẩm');
      assert.deepEqual(outs.map(o => o.status), [200, 201], JSON.stringify(outs.map(o => o.body)));
      const after = await stockNow();
      for (const [g, inQ, outQ] of [[g1, 10, 2], [g2, 4, 1]]) {
        assert.equal(after[g.id].variant, before[g.id].variant + inQ - outQ, `sp${g.id}: đầu + nhập − bán`);
        assert.equal(after[g.id].product, before[g.id].product + inQ - outQ);
      }
      assert.equal(deadlocks, 0, 'không deadlock');
      return { stock: stockText(before, after), detail: 'nhận 200, checkout 201, đầu + nhập − bán' };
    });

    await runCase('(b2) 20 vòng nhận hàng ‖ checkout (không ép khoá)', async () => {
      const before = await stockNow();
      let inSum = { [g1.id]: 0, [g2.id]: 0 }, outSum = { [g1.id]: 0, [g2.id]: 0 }, failed = 0;
      for (let i = 0; i < 20; i++) {
        const [q1, q2, c1, c2] = [3 + (i % 3), 2 + (i % 2), 1 + (i % 2), 1];
        const id = await approved(q1, q2);
        await fillCart(c1, c2);
        const [r, o] = await Promise.all([receive(staffId, id), checkout()]);
        if (r.status !== 200 || o.status !== 201) { failed++; continue; }
        inSum[g1.id] += q1; inSum[g2.id] += q2; outSum[g1.id] += c1; outSum[g2.id] += c2;
      }
      assert.equal(failed, 0, 'mọi vòng: nhận 200 + checkout 201');
      assert.equal(deadlocks, 0, 'không deadlock (1205)');
      const after = await stockNow();
      for (const g of [g1, g2]) {
        assert.equal(after[g.id].variant, before[g.id].variant + inSum[g.id] - outSum[g.id], `sp${g.id}: đầu + nhập − bán`);
        assert.equal(after[g.id].product, before[g.id].product + inSum[g.id] - outSum[g.id]);
      }
      return { stock: stockText(before, after), detail: `20/20 vòng, deadlock ${deadlocks}` };
    });

    console.error = realError;

    await runCase('(c) SUM(product_variants.stock) = products.stock', async () => {
      const r = (await pool.request().input('a', sql.Int, g1.id).input('b', sql.Int, g2.id).query(`SELECT p.id, p.stock,
        (SELECT SUM(CAST(v.stock AS BIGINT)) FROM dbo.product_variants v WHERE v.product_id = p.id) AS variant_sum
        FROM dbo.products p WHERE p.id IN (@a, @b) ORDER BY p.id;`)).recordset;
      for (const x of r) assert.equal(Number(x.variant_sum), x.stock, `sp${x.id}`);
      // Sổ kho khớp tồn: mỗi biến thể, dòng sổ kho mới nhất có stock_after = tồn hiện tại.
      const ledger = (await pool.request().input('a', sql.Int, g1.id).input('b', sql.Int, g2.id).query(`SELECT v.id, v.stock,
        (SELECT TOP (1) m.stock_after FROM dbo.inventory_movements m WHERE m.variant_id = v.id ORDER BY m.id DESC) AS last_after
        FROM dbo.product_variants v WHERE v.product_id IN (@a, @b);`)).recordset;
      for (const x of ledger) assert.equal(x.last_after, x.stock, `biến thể ${x.id}: sổ kho cuối ${x.last_after} ≠ tồn ${x.stock}`);
      return { stock: r.map(x => `sp${x.id}: Σbiến thể ${x.variant_sum} = ${x.stock}`).join('; '), detail: 'sổ kho cuối = tồn' };
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try { if (pool && pool.connected) await pool.close(); }
    finally {
      if (created) {
        adminSql(`ALTER DATABASE ${quoted} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${quoted};`);
        const left = adminSql(`SELECT COUNT(*) FROM sys.databases WHERE name = N'${dbName}';`).trim();
        console.log(`Removed disposable database: ${dbName} (còn lại: ${left})`);
        if (left !== '0') { failures++; console.log('DB tạm đã xoá: FAIL'); }
      }
    }
  }
  printTable();
  const mainAfter = await mainSnapshot();
  const same = JSON.stringify(mainAfter) === JSON.stringify(mainBefore);
  console.log(`\n${mainDb}: sổ kho ${mainBefore.movements} -> ${mainAfter.movements}, mã đơn ${mainBefore.order_code} -> ${mainAfter.order_code}, không đổi: ${same ? 'PASS' : 'FAIL'}`);
  if (!same) failures++;
  if (failures) throw new Error(failures + ' ca FAIL');
  console.log('Receipt receive concurrency SQL: PASS');
}

main().catch(err => { console.error('test-receipt-receive-sql FAILED:', err.message); process.exitCode = 1; });
