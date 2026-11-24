'use strict';
/*
 * verify-stats-snapshot-sql.js — so khớp thống kê tính sẵn (migration 028, lib/stats-snapshot.js) với truy vấn
 * trực tiếp (lib/business-report.js) trên SQL Server thật.
 *
 * Mặc định: DB TẠM tự tạo/tự xoá, dữ liệu sinh sẵn có ca biên (ranh giới nửa đêm giờ VN, đủ 8 trạng thái,
 * voucher tỉ lệ lẻ / lớn hơn tiền hàng, dòng hàng 0đ, tên sản phẩm đổi theo thời gian và chỉ khác hoa/thường,
 * ngày trống). Chạy đủ: nạp lịch sử bằng scripts/stats-backfill.js, so từng ngày, so nguyên body 4 API giữa
 * JOBS_MODE=sync và async, 5 đường đổi đơn qua route thật, job lỗi ở lần cuối, worker chết ở lần cuối, đối soát.
 *
 * --on-copy <tên DB>: chạy trên một DB SAO CHÉP dữ liệu thật đã có migration 026–028. GHI vào DB đó (job +
 * snapshot), không sửa đơn hàng. Từ chối nếu tên là BreezeShopDB, hoặc DB_NAME không được đặt rõ ngay trong
 * lệnh (khác giá trị từ server/.env) và trùng tên đã cho. Ví dụ PowerShell:
 *   $env:DB_NAME = 'BreezeShopDB_AuditVerify'; node scripts/verify-stats-snapshot-sql.js --on-copy BreezeShopDB_AuditVerify
 * Chạy (trong server/, cần sqlcmd + Windows auth như các script verify-*-sql khác):
 *   node scripts/verify-stats-snapshot-sql.js
 */
const path = require('node:path');
const explicitDbName = process.env.DB_NAME; // đọc TRƯỚC dotenv: chỉ giá trị đặt rõ trong lệnh
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const copyFlag = process.argv.indexOf('--on-copy');
const onCopy = copyFlag > -1 ? (process.argv[copyFlag + 1] || '') : null;
if (onCopy !== null) {
  if (!/^[A-Za-z0-9_]{1,100}$/.test(onCopy) || /^breezeshopdb$/i.test(onCopy)) {
    console.error('Từ chối: --on-copy cần tên DB sao chép hợp lệ, KHÔNG được là BreezeShopDB.'); process.exit(1);
  }
  if (!explicitDbName || explicitDbName !== onCopy) {
    console.error('Từ chối: phải đặt rõ DB_NAME=' + onCopy + ' ngay trong lệnh (đang là: ' + (explicitDbName || 'không đặt') + ').'); process.exit(1);
  }
}
const realDb = process.env.DB_NAME;
const dbName = onCopy || ('BreezeStatsTest_' + process.pid + '_' + Date.now());
if (!onCopy && (!/^BreezeStatsTest_[0-9]+_[0-9]+$/.test(dbName) || dbName === realDb)) throw Error('Unsafe test database');
process.env.DB_NAME = dbName;
const db = require('../db'), { sql, config } = db;
if (config.database !== dbName) throw Error('db.js không nhận DB đích');
const quoted = '[' + dbName + ']', serverDir = path.join(__dirname, '..');

let pool, created = false, server, worker, checks = 0;
const tokens = new Set(), wait = ms => new Promise(r => setTimeout(r, ms)), quiet = { log() {}, warn() {}, error() {} };
function check(name, value) { assert.ok(value, name); checks++; console.log('PASS: ' + name); }
function same(name, actual, expected) { assert.deepEqual(actual, expected, name); checks++; console.log('PASS: ' + name); }
function adminSql(query) { execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' }); }
const rows = async text => (await pool.request().query(text)).recordset;
async function waitFor(fn, ms, label) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await wait(25); } throw Error('Hết thời gian chờ: ' + label); }
const VN = 7 * 3600000;
const dayOf = date => new Date(date.getTime() + VN).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const vnRange = (from, to) => ({ from, to, fromDate: new Date(from + 'T00:00:00Z'), toDate: new Date(to + 'T00:00:00Z'),
  start: new Date(Date.parse(from + 'T00:00:00Z') - VN), end: new Date(Date.parse(to + 'T00:00:00Z') + 86400000 - VN) });

// Dữ liệu sinh: 45 ngày tới hôm nay (giờ VN), có ngày trống, đủ trạng thái và voucher lẻ.
const SEED_SQL = `
  SET NOCOUNT ON;
  DECLARE @cat INT = (SELECT TOP (1) id FROM dbo.categories ORDER BY id);
  WITH n AS (SELECT TOP (6) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i FROM sys.all_objects)
  INSERT INTO dbo.products (slug, name_vi, price, category_id, stock, images)
  SELECT 'stats-product-' + CONVERT(VARCHAR(11), i), N'SP ' + CONVERT(NVARCHAR(11), i), CASE WHEN i = 5 THEN 0 ELSE 100000 + i * 7777 END,
    @cat, 50, CASE WHEN i % 2 = 0 THEN N'["img/stats-' + CONVERT(NVARCHAR(11), i) + N'.png"]' ELSE NULL END FROM n;
  INSERT INTO dbo.product_variants (product_id, sku, size, stock, is_base)
  SELECT id, 'STATS-' + CONVERT(VARCHAR(11), id) + '-BASE', NULL, 50, 1 FROM dbo.products WHERE slug LIKE 'stats-product-%';
  WITH n AS (SELECT TOP (30) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects)
  INSERT INTO dbo.users (firebase_uid) SELECT 'stats-customer-' + CONVERT(VARCHAR(11), i) FROM n;
  CREATE TABLE #u (rn INT PRIMARY KEY, id INT NOT NULL);
  INSERT INTO #u SELECT ROW_NUMBER() OVER (ORDER BY id) - 1, id FROM dbo.users WHERE firebase_uid LIKE 'stats-customer-%';
  CREATE TABLE #p (rn INT PRIMARY KEY, id INT NOT NULL, vid INT NOT NULL, price DECIMAL(12,2) NOT NULL);
  INSERT INTO #p SELECT ROW_NUMBER() OVER (ORDER BY p.id) - 1, p.id, v.id, p.price
    FROM dbo.products p JOIN dbo.product_variants v ON v.product_id = p.id AND v.is_base = 1 WHERE p.slug LIKE 'stats-product-%';
  DECLARE @before INT = ISNULL((SELECT MAX(id) FROM dbo.orders), 0);
  -- 600 đơn rải 45 ngày tới @now (không ở tương lai); bỏ trống các ngày (i*13 % 45) = 7 hoặc 19.
  WITH n AS (SELECT TOP (900) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b),
  t AS (SELECT i, DATEADD(SECOND, -((i * 7919) % (45 * 86400)), @now) AS at FROM n)
  INSERT INTO dbo.orders (user_id, status, total_amount, created_at)
  SELECT TOP (600) u.id,
    CASE t.i % 10 WHEN 4 THEN 'cancelled' WHEN 5 THEN 'pending' WHEN 6 THEN 'confirmed' WHEN 7 THEN 'processing'
      WHEN 8 THEN 'shipping' WHEN 9 THEN CASE WHEN t.i % 20 = 9 THEN 'paid' ELSE 'shipped' END ELSE 'completed' END,
    0, t.at
  FROM t JOIN #u u ON u.rn = (t.i * 7) % 30
  WHERE DATEDIFF(DAY, t.at, @now) NOT IN (7, 19)
  ORDER BY t.i;
  -- Ranh giới nửa đêm giờ VN: 16:59:59.999 UTC (còn ngày D) và 17:00:00.000 UTC (sang D+1).
  DECLARE @edgeOrders TABLE (id INT);
  INSERT INTO dbo.orders (user_id, status, total_amount, created_at) OUTPUT INSERTED.id INTO @edgeOrders VALUES
    ((SELECT id FROM #u WHERE rn = 1), 'completed', 0, DATEADD(MILLISECOND, -1, @edge)),
    ((SELECT id FROM #u WHERE rn = 2), 'completed', 0, @edge),
    ((SELECT id FROM #u WHERE rn = 3), 'cancelled', 0, @edge);
  WITH k AS (SELECT 0 AS k UNION ALL SELECT 1 UNION ALL SELECT 2)
  INSERT INTO dbo.order_items (order_id, product_id, variant_id, product_name, unit_price, quantity, line_total)
  SELECT o.id, p.id, p.vid,
    -- Tên đổi theo thời gian (" (mới)" ở đơn mới hơn) và khác hoa/thường giữa các đơn của sản phẩm 1.
    CASE WHEN p.rn = 1 AND o.id % 2 = 0 THEN N'sp 1' ELSE N'SP ' + CONVERT(NVARCHAR(11), p.rn) END
      + CASE WHEN o.created_at > DATEADD(DAY, -20, @now) THEN N' (mới)' ELSE N'' END,
    p.price, 1 + (o.id + k.k) % 3, p.price * (1 + (o.id + k.k) % 3)
  FROM dbo.orders o CROSS JOIN k JOIN #p p ON p.rn = (o.id * 5 + k.k * 2) % 6
  WHERE o.id > @before AND k.k <= o.id % 3;
  UPDATE o SET
    DiscountAmount = CASE WHEN o.id % 7 = 3 THEN 33333 WHEN o.id % 11 = 5 THEN s.sub + 1000 ELSE 0 END,
    total_amount = CASE WHEN o.id % 11 = 5 AND o.id % 7 <> 3 THEN 30000
                        ELSE s.sub - CASE WHEN o.id % 7 = 3 THEN CASE WHEN s.sub >= 33333 THEN 33333 ELSE s.sub END ELSE 0 END + 30000 END
  FROM dbo.orders o JOIN (SELECT order_id, SUM(line_total) AS sub FROM dbo.order_items GROUP BY order_id) s ON s.order_id = o.id
  WHERE o.id > @before;
  SELECT (SELECT COUNT(*) FROM dbo.orders WHERE id > @before) AS orders, (SELECT COUNT(*) FROM dbo.order_items) AS items;
  SELECT o.id, CONVERT(char(27), o.created_at, 126) AS at, CONVERT(char(10), CAST(DATEADD(MINUTE,420,o.created_at) AS DATE), 23) AS day
    FROM dbo.orders o JOIN @edgeOrders e ON e.id = o.id ORDER BY o.created_at, o.id;`;

async function main() {
  try {
    if (onCopy) {
      console.log('Chế độ --on-copy, DB đích:', dbName);
    } else {
      adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
      adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
      console.log('Created disposable database:', dbName);
      execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'],
        { cwd: serverDir, env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
    }
    pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    same('pool targets the intended database', (await rows('SELECT DB_NAME() AS n;'))[0].n, dbName);
    check('jobs + snapshot tables exist', (await rows("SELECT CASE WHEN OBJECT_ID('dbo.jobs','U') IS NOT NULL AND OBJECT_ID('dbo.stats_snapshots','U') IS NOT NULL AND OBJECT_ID('dbo.stats_snapshot_products','U') IS NOT NULL THEN 1 ELSE 0 END AS ok;"))[0].ok === 1);

    require.cache[require.resolve('../db')].exports = { ...db, getPool: async () => pool };
    require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ verifyIdToken: async token => {
      if (!tokens.has(token)) throw Error('Unknown test identity'); return { uid: token };
    } }) } };
    const report = require('../lib/business-report'), stats = require('../lib/stats-snapshot'), queue = require('../lib/jobs/queue');
    const { startWorker } = require('../lib/jobs/worker');
    const express = require('express');
    const app = express(); app.use(express.json());
    app.use('/api/admin', require('../routes/admin')); app.use('/api/orders', require('../routes/orders'));
    server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const adminToken = 'stats-verify-admin-' + process.pid; tokens.add(adminToken);
    await pool.request().input('uid', sql.VarChar(128), adminToken).query("INSERT INTO dbo.users(firebase_uid, role) VALUES(@uid, 'admin');");

    async function http(method, url, token = adminToken, body) {
      const r = await fetch(base + url, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json(), source: r.headers.get('x-stats-source'), updatedAt: r.headers.get('x-stats-updated-at') };
    }
    const statsJobsOpen = async () => (await rows("SELECT COUNT(*) AS n FROM dbo.jobs WHERE type='stats.recompute_day' AND status IN ('queued','running');"))[0].n;
    async function drain() {
      worker = startWorker(async () => pool, { workerId: 'stats-verify', intervalMs: 20, baseDelayMs: 50, maintenance: [], log: quiet });
      await waitFor(async () => (await statsJobsOpen()) === 0, 120000, 'stats jobs settled');
      await worker.stop(); worker = null;
    }
    // Cùng một URL ở hai chế độ: body phải y hệt; trả về kết quả của chế độ async để kiểm header.
    async function bothModes(label, url) {
      process.env.JOBS_MODE = 'sync'; const live = await http('GET', url);
      process.env.JOBS_MODE = 'async'; const snap = await http('GET', url);
      delete process.env.JOBS_MODE;
      same(label + ': HTTP 200 ở cả hai chế độ', [live.status, snap.status], [200, 200]);
      same(label + ': body async y hệt sync', snap.body, live.body);
      same(label + ': sync báo nguồn live', live.source, 'live');
      check(label + ': X-Stats-Updated-At là ISO 8601 UTC', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(snap.updatedAt) && /Z$/.test(live.updatedAt));
      return snap;
    }
    // Từng ngày: dòng snapshot = truy vấn trực tiếp của đúng ngày đó (tổng + từng sản phẩm, doanh thu làm tròn).
    async function compareDays(label, days) {
      let compared = 0;
      for (const day of days) {
        const rg = vnRange(day, day);
        const [snap] = await rows(`SELECT revenue, orders, completed, cancelled, products_sold FROM dbo.stats_snapshots WHERE day='${day}';`);
        assert.ok(snap, label + ': thiếu snapshot ngày ' + day);
        const live = await report.summary(pool, rg.start, rg.end);
        assert.deepEqual([Number(snap.revenue), snap.orders, snap.completed, snap.cancelled, Number(snap.products_sold)],
          [live.revenue, live.orders, live.completedOrders, live.cancelledOrders, live.productsSold], label + ': tổng ngày ' + day);
        const snapProducts = (await rows(`SELECT product_id AS id, product_name AS name, units_sold, CAST(ROUND(revenue,0) AS DECIMAL(38,0)) AS revenue
          FROM dbo.stats_snapshot_products WHERE day='${day}' ORDER BY product_id;`)).map(r => [r.id, r.name, Number(r.units_sold), Number(r.revenue)]);
        const liveProducts = (await report.products(pool, rg.start, rg.end, 2147483647, 'quantity')).sort((a, b) => a.id - b.id)
          .map(p => [p.id, p.name, p.unitsSold, p.revenue]);
        assert.deepEqual(snapProducts, liveProducts, label + ': sản phẩm ngày ' + day);
        compared++;
      }
      checks++; console.log('PASS: ' + label + ': ' + compared + ' ngày, snapshot = truy vấn trực tiếp (tổng + từng sản phẩm)');
    }
    async function compareApis(label, today, first) {
      const ranges = [[addDays(today, -6), today], [addDays(today, -29), today], [first, today], [addDays(today, -10), addDays(today, -10)],
        [addDays(today, -20), addDays(today, -8)]];
      // Mỗi phần tử: { from, source } — ngày trước đơn đầu tiên không có snapshot (đối soát chỉ phủ từ đơn đầu tiên).
      const sources = [];
      for (const [from, to] of ranges) {
        const q = '?from=' + from + '&to=' + to;
        // /stats đọc thêm kỳ trước (N ngày liền trước): ngày bắt đầu thực tế là ngày đầu kỳ trước.
        const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
        sources.push({ from: addDays(from, -span), source: (await bothModes(label + ' stats ' + from + '..' + to, '/api/admin/stats' + q)).source });
        sources.push({ from, source: (await bothModes(label + ' business-report ' + from + '..' + to, '/api/admin/stats/business-report' + q)).source });
        for (const limit of [5, 50]) sources.push({ from, source: (await bothModes(label + ' top-products(' + limit + ') ' + from + '..' + to, '/api/admin/stats/top-products' + q + '&limit=' + limit)).source });
      }
      for (const key of ['7d', '30d', 'month', 'year']) {
        const r = await bothModes(label + ' statistics ' + key, '/api/admin/statistics?range=' + key);
        sources.push({ from: r.body.from, source: r.source });
      }
      return sources;
    }

    let today, first;
    if (!onCopy) {
      const now = new Date();
      today = dayOf(now);
      const edge = new Date(Date.parse(addDays(today, -3) + 'T00:00:00Z') - VN); // nửa đêm VN ngày today-3
      const seedResult = (await pool.request().input('now', sql.DateTime2, now).input('edge', sql.DateTime2, edge).query(SEED_SQL)).recordsets;
      const seeded = seedResult[0][0], edgeOrders = seedResult[1];
      console.log('Seeded orders=' + seeded.orders + ', order_items=' + seeded.items + '; edge orders: ' + edgeOrders.map(o => o.at + '->' + o.day).join(', '));
      first = (await rows("SELECT CONVERT(char(10), CAST(DATEADD(MINUTE,420,MIN(created_at)) AS DATE), 23) AS d FROM dbo.orders;"))[0].d;
      same('edge orders straddle VN midnight (1 ms before -> previous day)', edgeOrders.map(o => o.day), [addDays(today, -4), addDays(today, -3), addDays(today, -3)]);
      const s1 = await rows('SELECT * FROM dbo.stats_snapshots;');
      execFileSync(process.execPath, ['db/run-sql.js', 'db/migrations/028_stats_snapshots.sql'], { cwd: serverDir, env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe' });
      same('rerunning 028 leaves data unchanged', await rows('SELECT * FROM dbo.stats_snapshots;'), s1);
      for (const r of (await compareApis('before backfill', today, first))) assert.equal(r.source, 'live');
      check('before backfill every async read is live (no snapshot yet)', true);
    } else {
      const info = (await rows("SELECT CONVERT(char(10), CAST(DATEADD(MINUTE,420,MIN(created_at)) AS DATE), 23) AS f, CONVERT(char(10), CAST(DATEADD(MINUTE,420,SYSUTCDATETIME()) AS DATE), 23) AS t FROM dbo.orders;"))[0];
      first = info.f; today = info.t;
      check('copy has orders', !!first);
    }

    // --- Nạp lịch sử bằng đúng script dành cho triển khai -------------------------------------------------
    const backfill = args => execFileSync(process.execPath, ['scripts/stats-backfill.js', ...args],
      { cwd: serverDir, env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe' }).toString();
    const jobsBefore = (await rows('SELECT COUNT(*) AS n FROM dbo.jobs;'))[0].n;
    const dry = backfill([]);
    check('backfill dry run prints the target DB', dry.includes('DB đích: ' + dbName) && dry.includes('chạy thử, không ghi'));
    same('backfill dry run writes no job', (await rows('SELECT COUNT(*) AS n FROM dbo.jobs;'))[0].n, jobsBefore);
    const expected = (await stats.reconcileStats(pool)).days;
    if (!onCopy) same('every day from first order to today needs a snapshot', expected.length, Math.round((Date.parse(today) - Date.parse(first)) / 86400000) + 1);
    check('dry run reports the same day count', dry.includes('Số ngày thiếu/lệch: ' + expected.length));
    // Ngày đã có job đang chờ (ví dụ do thao tác đổi đơn trước đó) thì khoá chống trùng bỏ qua: chỉ đưa phần còn lại.
    const alreadyQueued = expected.length ? (await rows(`SELECT COUNT(DISTINCT dedupe_key) AS n FROM dbo.jobs
      WHERE type = 'stats.recompute_day' AND status = 'queued' AND dedupe_key IN (${expected.map(d => "'stats:" + d + "'").join(',')});`))[0].n : 0;
    if (!onCopy) same('temporary DB has no queued stats job before backfill', alreadyQueued, 0);
    const real = backfill(['--confirm']);
    check('backfill --confirm enqueues one job per day not already queued (' + (expected.length - alreadyQueued) + ')',
      real.includes('Đã đưa vào hàng: ' + (expected.length - alreadyQueued)));
    same('a second --confirm enqueues nothing new while jobs are queued', backfill(['--confirm']).includes('Đã đưa vào hàng: 0'), true);
    await drain();
    same('after the worker, reconcile finds no missing or stale day', (await stats.reconcileStats(pool)).days, []);
    const allDays = []; for (let d = first; d <= today; d = addDays(d, 1)) allDays.push(d);
    await compareDays('after backfill', allDays);
    // Khoảng bắt đầu từ ngày có đơn đầu tiên trở đi: toàn snapshot. Khoảng chạm ngày trước đó: mixed.
    const expectSource = list => {
      const wrong = list.filter(r => r.source !== (r.from >= first ? 'snapshot' : 'mixed'));
      if (wrong.length) console.log('Nguồn không như kỳ vọng (first=' + first + '):', JSON.stringify(wrong));
      return !wrong.length;
    };
    const sources = await compareApis('after backfill', today, first);
    check('past ranges from the first order day read entirely from snapshot; earlier days read live (mixed)', expectSource(sources));
    const future = await bothModes('range into the future', '/api/admin/stats?from=' + addDays(today, -5) + '&to=' + addDays(today, 3));
    same('future days have no snapshot -> mixed', future.source, 'mixed');
    const newest = (await rows(`SELECT CONVERT(char(24), MAX(computed_at), 127) AS m FROM dbo.stats_snapshots WHERE day BETWEEN '${addDays(today, -5)}' AND '${today}';`))[0].m;
    same('X-Stats-Updated-At = newest computed_at among snapshot days used', future.updatedAt, new Date(newest.trim() + 'Z').toISOString());
    // top-products không đọc kỳ trước (khác /stats), nên khoảng toàn tương lai không dùng ngày snapshot nào.
    const allFuture = await bothModes('range entirely in the future', '/api/admin/stats/top-products?from=' + addDays(today, 1) + '&to=' + addDays(today, 2) + '&limit=5');
    same('no snapshot day used -> live', allFuture.source, 'live');

    if (onCopy) {
      delete process.env.JOBS_MODE;
      console.log('SQL STATS SNAPSHOT VERIFY (--on-copy ' + dbName + '):', checks, 'checks passed; snapshot/job rows left in the copy.');
      return;
    }

    // --- Ngày đang có job chờ: đọc trực tiếp, body vẫn y hệt -------------------------------------------------
    const dirtyDay = addDays(today, -12);
    const tx = new sql.Transaction(pool); await tx.begin();
    await queue.enqueue(tx, { type: 'stats.recompute_day', payload: { day: dirtyDay }, dedupeKey: 'stats:' + dirtyDay }); await tx.commit();
    same('a day with a queued stats job is read live -> mixed', (await bothModes('dirty day', '/api/admin/stats/top-products?from=' + addDays(today, -14) + '&to=' + addDays(today, -10) + '&limit=50')).source, 'mixed');
    await drain();

    // --- 5 đường đổi đơn qua route thật ------------------------------------------------------------------------
    const owner = (await rows("SELECT TOP (1) o.id, u.firebase_uid, o.created_at FROM dbo.orders o JOIN dbo.users u ON u.id = o.user_id WHERE o.status = 'pending' AND u.firebase_uid LIKE 'stats-customer-%' ORDER BY o.id;"))[0];
    tokens.add(owner.firebase_uid);
    const pick = async status => (await rows(`SELECT TOP (1) id, created_at FROM dbo.orders WHERE status = '${status}' AND id <> ${owner.id} ORDER BY id DESC;`))[0];
    const toConfirm = await pick('pending'), toCancel = await pick('confirmed');
    const toDelete = (await rows(`SELECT TOP (1) id, created_at FROM dbo.orders WHERE status = 'pending' AND id NOT IN (${owner.id}, ${toConfirm.id}) ORDER BY id;`))[0];
    const jobFor = async date => (await rows(`SELECT COUNT(*) AS n FROM dbo.jobs WHERE dedupe_key = 'stats:${dayOf(date)}' AND status = 'queued';`))[0].n;
    // Đặt đơn: giỏ hàng của một khách mới (đơn hôm nay, v2, COD).
    const buyerToken = 'stats-verify-buyer-' + process.pid; tokens.add(buyerToken);
    const buyerId = (await pool.request().input('uid', sql.VarChar(128), buyerToken).query('INSERT INTO dbo.users(firebase_uid) OUTPUT INSERTED.id VALUES(@uid);')).recordset[0].id;
    const cartProduct = (await rows("SELECT TOP (1) p.id, v.id AS vid FROM dbo.products p JOIN dbo.product_variants v ON v.product_id = p.id AND v.is_base = 1 WHERE p.slug = 'stats-product-2';"))[0];
    await pool.request().query(`INSERT INTO dbo.cart_items(user_id, product_id, variant_id, quantity) VALUES(${buyerId}, ${cartProduct.id}, ${cartProduct.vid}, 2);`);
    const placed = await http('POST', '/api/orders', buyerToken, { ...require('../__tests__/helpers/shipping'), paymentMethod: 'cod' });
    same('place order via route', placed.status, 201);
    const placedRow = (await rows('SELECT id, created_at FROM dbo.orders WHERE id = ' + placed.body.order.id + ';'))[0];
    same('place order queues the stats job of its day', await jobFor(placedRow.created_at), 1);
    same('status change via route', (await http('PUT', '/api/admin/orders/' + toConfirm.id + '/status', adminToken, { status: 'confirmed' })).status, 200);
    same('status change queues the job of the ORDER day', await jobFor(toConfirm.created_at), 1);
    same('admin cancel via route', (await http('PUT', '/api/admin/orders/' + toCancel.id + '/status', adminToken, { status: 'cancelled' })).status, 200);
    same('admin cancel queues the job of the order day', await jobFor(toCancel.created_at), 1);
    same('customer cancel via route', (await http('POST', '/api/orders/' + owner.id + '/cancel', owner.firebase_uid, { reason: 'wrong_item' })).status, 200);
    same('customer cancel queues the job of the order day', await jobFor(owner.created_at), 1);
    same('delete via route', (await http('DELETE', '/api/admin/orders/' + toDelete.id)).status, 200);
    same('delete queues the job of the order day', await jobFor(toDelete.created_at), 1);
    for (const status of ['confirmed', 'processing']) same('placed order -> ' + status, (await http('PUT', '/api/admin/orders/' + placedRow.id + '/status', adminToken, { status })).status, 200);
    for (const step of ['picked_up', 'in_transit', 'out_for_delivery', 'delivered']) {
      same('shipping -> ' + step + ' via route', (await http('PATCH', '/api/admin/orders/' + placedRow.id + '/shipping-status', adminToken, { shipping_status: step })).status, 200);
    }
    same('delivered makes the placed order completed (revenue moves)', (await rows('SELECT status FROM dbo.orders WHERE id = ' + placedRow.id))[0].status, 'completed');
    same('shipping change queues the job of the order day', await jobFor(placedRow.created_at), 1);
    const pending = await compareApis('while jobs are queued', today, first);
    check('changed days are read live while their job is queued (mixed)', pending.some(r => r.source === 'mixed' && r.from >= first));
    await drain();
    await compareDays('after mutations', allDays);
    check('after the worker every past range is snapshot again', expectSource(await compareApis('after mutations', today, first)));

    // --- Job lỗi ở lần thử cuối: snapshot của ngày bị xoá, lần đọc tự tính trực tiếp -----------------------------
    const failDay = addDays(today, -15);
    await pool.request().batch("CREATE TRIGGER dbo.test_stats_insert_failure ON dbo.stats_snapshots AFTER INSERT AS BEGIN THROW 51002,'Test-only snapshot failure',1; END;");
    const failTx = new sql.Transaction(pool); await failTx.begin();
    await queue.enqueue(failTx, { type: 'stats.recompute_day', payload: { day: failDay }, dedupeKey: 'stats:' + failDay, maxAttempts: 1 }); await failTx.commit();
    await drain();
    await pool.request().batch('DROP TRIGGER dbo.test_stats_insert_failure;');
    same('final failure marks the job failed', (await rows(`SELECT TOP (1) status FROM dbo.jobs WHERE dedupe_key='stats:${failDay}' ORDER BY id DESC;`))[0].status, 'failed');
    same('final failure deletes that day snapshot', (await rows(`SELECT COUNT(*) AS n FROM dbo.stats_snapshots WHERE day='${failDay}';`))[0].n, 0);
    same('the day is then read live, body still identical', (await bothModes('after final failure', '/api/admin/stats?from=' + addDays(failDay, -1) + '&to=' + addDays(failDay, 1))).source, 'mixed');

    // --- Worker chết ở lần thử cuối: claim chuyển failed (không qua handler) -> việc bảo trì xoá snapshot ------------
    const deadDay = addDays(today, -16), keptDay = addDays(today, -17);
    const deadTx = new sql.Transaction(pool); await deadTx.begin();
    await queue.enqueue(deadTx, { type: 'stats.recompute_day', payload: { day: deadDay }, dedupeKey: 'stats:' + deadDay }); await deadTx.commit();
    // Chỉ ở DB tạm: dựng trạng thái "đang chạy lần cuối thì chết" (khoá đã hết hạn).
    await pool.request().query(`UPDATE dbo.jobs SET status='running', attempts=max_attempts, locked_by='dead-worker', locked_until=DATEADD(SECOND,-1,SYSUTCDATETIME())
      WHERE dedupe_key='stats:${deadDay}' AND status='queued';`);
    same('claim fails the expired last attempt without running it', await queue.claim(pool, { workerId: 'other' }), null);
    check('snapshot of that day is still there (handler never ran)', (await rows(`SELECT COUNT(*) AS n FROM dbo.stats_snapshots WHERE day='${deadDay}';`))[0].n === 1);
    // keptDay: job failed CŨ nhưng đã có job mới hơn chạy xong -> không được xoá.
    await pool.request().query(`INSERT INTO dbo.jobs(type,payload,status,attempts,max_attempts,dedupe_key,finished_at)
      VALUES('stats.recompute_day','{"day":"${keptDay}"}','failed',1,1,'stats:${keptDay}',SYSUTCDATETIME());`);
    const keptTx = new sql.Transaction(pool); await keptTx.begin();
    await queue.enqueue(keptTx, { type: 'stats.recompute_day', payload: { day: keptDay }, dedupeKey: 'stats:' + keptDay }); await keptTx.commit();
    await drain();
    same('hourly cleanup clears the dead-worker day (the final-failure day was already cleared by its handler)', await stats.clearFailedDays(pool), 1);
    same('dead-worker day snapshot removed', (await rows(`SELECT COUNT(*) AS n FROM dbo.stats_snapshots WHERE day='${deadDay}';`))[0].n, 0);
    same('day with a newer successful job is untouched', (await rows(`SELECT COUNT(*) AS n FROM dbo.stats_snapshots WHERE day='${keptDay}';`))[0].n, 1);
    same('cleanup rerun changes nothing', await stats.clearFailedDays(pool), 0);

    // --- Đối soát đêm: phát hiện thay đổi ngoài 5 đường (SQL trực tiếp) và ngày đã bị xoá snapshot -----------------
    const outOfBand = (await rows(`SELECT TOP (1) id, created_at FROM dbo.orders WHERE status='completed' AND created_at < DATEADD(DAY,-25,SYSUTCDATETIME()) ORDER BY id;`))[0];
    // Đổi tên dòng hàng QUYẾT ĐỊNH tên của sản phẩm trong NGÀY đó (dòng mới nhất của ngày, cùng thứ tự với
    // report.products): đổi một dòng cũ hơn trong ngày thì kết quả trực tiếp không đổi, đối soát đúng là không lệch.
    let renamed = null;
    for (let back = 31; back <= 44 && !renamed; back++) {
      const rg = vnRange(addDays(today, -back), addDays(today, -back));
      renamed = (await pool.request().input('s', sql.DateTime2, rg.start).input('e', sql.DateTime2, rg.end).query(`
        SELECT TOP (1) oi.id, oi.product_name, o.created_at FROM dbo.order_items oi JOIN dbo.orders o ON o.id = oi.order_id
        WHERE o.status='completed' AND oi.product_id = (SELECT id FROM dbo.products WHERE slug = 'stats-product-3')
          AND o.created_at >= @s AND o.created_at < @e
        ORDER BY o.created_at DESC, oi.order_id DESC, oi.id DESC;`)).recordset[0] || null;
    }
    check('found the name-deciding line of product 3 on an old day', renamed && renamed.product_name === 'SP 3');
    // Chỉ ở DB tạm: sửa thẳng dữ liệu, không qua route (giống script/công cụ ngoài ứng dụng).
    await pool.request().query(`UPDATE dbo.orders SET total_amount = total_amount + 1 WHERE id = ${outOfBand.id};
      UPDATE dbo.order_items SET product_name = N'sp 3' WHERE id = ${renamed.id};`);
    const found = (await stats.reconcileStats(pool)).days;
    same('reconcile finds exactly: out-of-band amount, case-only rename, failed day, dead-worker day',
      found, [...new Set([dayOf(outOfBand.created_at), dayOf(renamed.created_at), failDay, deadDay])].sort());
    same('reconcile apply enqueues those days', (await stats.reconcileStats(pool, { apply: true })).enqueued, found.length);
    await drain();
    same('after the worker nothing is stale', (await stats.reconcileStats(pool)).days, []);
    await compareDays('final', allDays);
    check('final: every past range reads snapshot with identical body', expectSource(await compareApis('final', today, first)));

    delete process.env.JOBS_MODE;
    console.log('SQL STATS SNAPSHOT VERIFY:', checks, 'checks passed; all fixtures confined to disposable database.');
  } finally {
    delete process.env.JOBS_MODE;
    if (worker) await worker.stop().catch(() => {});
    if (server) await new Promise(r => server.close(r));
    if (pool) await Promise.race([pool.close().catch(() => {}), wait(10000)]);
    if (created) {
      adminSql('ALTER DATABASE ' + quoted + ' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + quoted + ';');
      console.log('Removed disposable database:', dbName);
    }
  }
}
main().catch(error => {
  console.error('Stats snapshot SQL verification FAILED:', error.code === 'ERR_ASSERTION' ? error.message : (error.code || error.message));
  process.exitCode = 1;
});
