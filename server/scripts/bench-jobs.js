'use strict';
/*
 * bench-jobs.js — đo thời gian phản hồi của 2 nhóm API trên DB TẠM (tự tạo, tự xoá):
 *   1. POST /api/products/:id/reviews kèm 1 ảnh và 5 ảnh (~4000×3000 JPEG, gần 2MB mỗi ảnh).
 *   2. Các API Dashboard admin trên N đơn giả (mặc định 50.000), khoảng 30 ngày và cả năm.
 *
 * Không đụng DB của .env: DB_NAME bị ghi đè sang DB tạm TRƯỚC khi nạp db.js, và pool được
 * thay bằng pool nối thẳng tới DB tạm. Ảnh ghi vào thư mục tạm của hệ điều hành.
 * Router, middleware xác thực, SQL và transaction là code thật; chỉ thay phần xác minh
 * token Firebase (danh tính giả, chỉ tồn tại trong process này) và bỏ limiter theo user
 * (mỗi lượt đo dùng một user riêng nên limiter chỉ làm sai số đo).
 *
 * Sau khi sinh đơn giả, thống kê của orders/order_items được cập nhật FULLSCAN rồi mới đo:
 * nếu để SQL Server tự cập nhật giữa chừng, kế hoạch thực thi đổi giữa các lượt và số đo
 * dao động theo thời điểm chứ không theo code.
 *
 * Chạy (trong server/, cần sqlcmd + Windows auth như các script verify-*-sql; mất ~3–4 phút):
 *   node scripts/bench-jobs.js [--iterations 50] [--warmup 3] [--orders 50000]
 *                              [--only reviews|dashboard] [--label <tên lần đo>] [--out <file.json>]
 * Biến môi trường bắt đầu bằng JOBS_ được in ra và ghi vào kết quả để biết lần đo chạy chế độ nào,
 * ví dụ PowerShell:  $env:JOBS_MODE = 'sync'; node scripts/bench-jobs.js --label sync --out sync.json
 * JOBS_MODE=async: worker thật chạy trong process này khi đo POST đánh giá (tham số mặc định như production,
 * tắt việc bảo trì để đối soát đêm không chen job thống kê vào giữa lượt đo) và ghi thêm thời gian từ lúc gửi
 * tới lúc mọi ảnh ready; phần Dashboard nạp snapshot bằng scripts/stats-backfill.js --confirm + worker thật
 * trước khi cập nhật thống kê FULLSCAN và đo. Mỗi request thống kê ghi lại header X-Stats-Source.
 * Tên file cố ý không theo mẫu *-sql.js: lệnh chạy hàng loạt các script verify/test SQL không
 * kéo theo bench này. Không nằm trong npm test.
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const fs = require('node:fs/promises'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}
function intArg(name, def, min, max) {
  const value = Number(arg(name, String(def)));
  if (!Number.isInteger(value) || value < min || value > max) throw Error('--' + name + ' phải là số nguyên ' + min + '..' + max);
  return value;
}
const ITERATIONS = intArg('iterations', 50, 1, 1000);
const WARMUP = intArg('warmup', 3, 0, 100);
const ORDERS = intArg('orders', 50000, 1, 1000000);
const ONLY = arg('only', 'all');
if (!['all', 'reviews', 'dashboard'].includes(ONLY)) throw Error('--only phải là reviews hoặc dashboard');
const LABEL = arg('label', '');
const OUT = arg('out', '');
const PRODUCTS = 40, CUSTOMERS = 5000;
// Mốc cuối của dữ liệu giả (UTC). 16:00 UTC = 23:00 giờ VN, nên "ngày neo" là 2026-11-20.
const DATA_END_UTC = '2026-11-20T16:00:00';
const IMAGE_WIDTH = 4000, IMAGE_HEIGHT = 3000;
const IMAGE_MIN_BYTES = 1900000, IMAGE_MAX_BYTES = 2050000; // dưới giới hạn 2 MiB của upload

// --- Chặn chạy nhầm vào DB thật ------------------------------------------------
const realDb = process.env.DB_NAME;
const dbName = 'BreezeJobsBench_' + process.pid + '_' + Date.now();
if (!/^BreezeJobsBench_[0-9]+_[0-9]+$/.test(dbName) || dbName === realDb) throw Error('Unsafe benchmark database');
process.env.DB_NAME = dbName;
const db = require('../db'), { sql, config } = db;
if (config.database !== dbName) throw Error('db.js không nhận DB tạm, dừng để không đụng DB thật');
const jobsModeInfo = require('../lib/jobs/mode').parseJobsMode(process.env.JOBS_MODE);
if (!jobsModeInfo.valid) throw Error('JOBS_MODE không hợp lệ: ' + jobsModeInfo.value);
const MODE = jobsModeInfo.mode;
const quoted = '[' + dbName + ']', serverDir = path.join(__dirname, '..');

function adminSql(query) {
  execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' });
}

// --- Thống kê ---------------------------------------------------------------------
function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
const r1 = x => (x === null ? null : Math.round(x * 10) / 10);
function stat(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50_ms: r1(pct(sorted, 50)), p95_ms: r1(pct(sorted, 95)),
    mean_ms: sorted.length ? r1(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
    min_ms: r1(sorted.length ? sorted[0] : null), max_ms: r1(sorted.length ? sorted[sorted.length - 1] : null) };
}
function summarize(name, samples) {
  const ok = samples.filter(s => s.ok);
  const row = { name, n: samples.length, ok: ok.length, errors: samples.filter(s => !s.ok).map(s => s.status).slice(0, 5), ...stat(ok.map(s => s.ms)) };
  // Header X-Stats-Source của các lượt đo (chỉ API thống kê có header này).
  const sources = {};
  for (const s of ok) if (s.source) sources[s.source] = (sources[s.source] || 0) + 1;
  if (Object.keys(sources).length) row.sources = sources;
  // Từ lúc gửi tới lúc mọi ảnh ready (chỉ POST đánh giá ở JOBS_MODE=async).
  const ready = ok.filter(s => typeof s.readyMs === 'number').map(s => s.readyMs);
  if (ready.length) row.ready = stat(ready);
  return row;
}
function printTable(rows) {
  const cols = ['name', 'n', 'ok', 'p50_ms', 'p95_ms', 'mean_ms', 'min_ms', 'max_ms'];
  const width = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c]).length)));
  const line = values => values.map((v, i) => (i === 0 ? String(v).padEnd(width[i]) : String(v).padStart(width[i]))).join('  ');
  console.log(line(cols));
  for (const row of rows) {
    console.log(line(cols.map(c => row[c])));
    if (row.errors.length) console.log('  lỗi (tối đa 5):', row.errors.join(', '));
    if (row.sources) console.log('  X-Stats-Source:', JSON.stringify(row.sources));
    if (row.ready) console.log('  tới lúc ảnh ready: p50 ' + row.ready.p50_ms + ' | p95 ' + row.ready.p95_ms + ' | max ' + row.ready.max_ms + ' ms');
  }
}

// --- Ảnh đầu vào -----------------------------------------------------------------
// Nền gradient + nhiễu giả ngẫu nhiên có hạt giống cố định: JPEG ra cùng kích thước ở mọi
// lần chạy. Tìm nhị phân biên độ nhiễu để file rơi vào khoảng gần 2MB.
async function makeJpeg(sharp) {
  const raw = Buffer.alloc(IMAGE_WIDTH * IMAGE_HEIGHT * 3);
  const noise = new Uint8Array(raw.length);
  let seed = 0x9e3779b9;
  for (let i = 0; i < noise.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    noise[i] = seed & 0xff;
  }
  async function encode(amplitude) {
    for (let y = 0, i = 0; y < IMAGE_HEIGHT; y++) {
      for (let x = 0; x < IMAGE_WIDTH; x++, i += 3) {
        const n0 = (noise[i] - 128) * amplitude / 128, n1 = (noise[i + 1] - 128) * amplitude / 128, n2 = (noise[i + 2] - 128) * amplitude / 128;
        raw[i] = Math.max(0, Math.min(255, (x * 255 / IMAGE_WIDTH) + n0));
        raw[i + 1] = Math.max(0, Math.min(255, (y * 255 / IMAGE_HEIGHT) + n1));
        raw[i + 2] = Math.max(0, Math.min(255, 128 + n2));
      }
    }
    return sharp(raw, { raw: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
  }
  let low = 0, high = 64, best = null;
  for (let step = 0; step < 12; step++) {
    const amplitude = (low + high) / 2, jpeg = await encode(amplitude);
    if (jpeg.length > IMAGE_MAX_BYTES) high = amplitude;
    else { best = jpeg; low = amplitude; if (jpeg.length >= IMAGE_MIN_BYTES) break; }
  }
  if (!best || best.length < IMAGE_MIN_BYTES) throw Error('Không tạo được ảnh JPEG trong khoảng ' + IMAGE_MIN_BYTES + '..' + IMAGE_MAX_BYTES + ' byte');
  return best;
}

// --- Dữ liệu giả cho Dashboard ---------------------------------------------------------
// Sinh theo tập hợp trong SQL (nhanh hơn chèn từng dòng). Phân bố: 60% completed, 10% mỗi
// trạng thái cancelled/pending/shipping/processing; 1–3 dòng hàng mỗi đơn; 10% đơn có voucher
// giảm 10%; phí ship 30.000; created_at rải đều 365 ngày, kết thúc ở DATA_END_UTC.
const SEED_SQL = `
SET NOCOUNT ON;
DECLARE @cat INT = (SELECT TOP (1) id FROM dbo.categories ORDER BY id);
WITH n AS (SELECT TOP (@products) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects)
INSERT INTO dbo.products (slug, name_vi, price, category_id, stock)
SELECT 'bench-product-' + CONVERT(VARCHAR(11), i), N'Sản phẩm đo tải ' + CONVERT(NVARCHAR(11), i), 100000 + i * 5000, @cat, 0 FROM n;
INSERT INTO dbo.product_variants (product_id, sku, size, stock, is_base)
SELECT id, 'BENCH-' + CONVERT(VARCHAR(11), id) + '-BASE', NULL, 0, 1 FROM dbo.products WHERE slug LIKE 'bench-product-%';
WITH n AS (SELECT TOP (@customers) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b)
INSERT INTO dbo.users (firebase_uid) SELECT 'bench-customer-' + CONVERT(VARCHAR(11), i) FROM n;

CREATE TABLE #u (rn INT PRIMARY KEY, id INT NOT NULL);
INSERT INTO #u SELECT ROW_NUMBER() OVER (ORDER BY id) - 1, id FROM dbo.users WHERE firebase_uid LIKE 'bench-customer-%';
CREATE TABLE #p (rn INT PRIMARY KEY, id INT NOT NULL, vid INT NOT NULL, price DECIMAL(12,2) NOT NULL, name NVARCHAR(200) NOT NULL);
INSERT INTO #p SELECT ROW_NUMBER() OVER (ORDER BY p.id) - 1, p.id, v.id, p.price, p.name_vi
  FROM dbo.products p JOIN dbo.product_variants v ON v.product_id = p.id AND v.is_base = 1
  WHERE p.slug LIKE 'bench-product-%';

DECLARE @before INT = ISNULL((SELECT MAX(id) FROM dbo.orders), 0);
WITH n AS (SELECT TOP (@orders) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b)
INSERT INTO dbo.orders (user_id, status, total_amount, created_at)
SELECT u.id,
  CASE n.i % 10 WHEN 6 THEN 'cancelled' WHEN 7 THEN 'pending' WHEN 8 THEN 'shipping' WHEN 9 THEN 'processing' ELSE 'completed' END,
  0, DATEADD(SECOND, -CAST((CAST(n.i AS BIGINT) * 7919) % 31536000 AS INT), CAST(@end AS DATETIME2))
FROM n JOIN #u u ON u.rn = (n.i * 31) % @customers;

WITH k AS (SELECT 0 AS k UNION ALL SELECT 1 UNION ALL SELECT 2)
INSERT INTO dbo.order_items (order_id, product_id, variant_id, product_name, unit_price, quantity, line_total)
SELECT o.id, p.id, p.vid, p.name, p.price, 1 + (o.id + k.k) % 3, p.price * (1 + (o.id + k.k) % 3)
FROM dbo.orders o CROSS JOIN k JOIN #p p ON p.rn = (o.id * 7 + k.k * 13) % @products
WHERE o.id > @before AND k.k <= o.id % 3;

UPDATE o SET
  DiscountAmount = CASE WHEN o.id % 10 = 3 THEN ROUND(s.sub * 0.1, 0) ELSE 0 END,
  total_amount = s.sub - CASE WHEN o.id % 10 = 3 THEN ROUND(s.sub * 0.1, 0) ELSE 0 END + 30000
FROM dbo.orders o JOIN (SELECT order_id, SUM(line_total) AS sub FROM dbo.order_items GROUP BY order_id) s ON s.order_id = o.id
WHERE o.id > @before;

SELECT (SELECT COUNT(*) FROM dbo.orders WHERE id > @before) AS orders,
  (SELECT COUNT(*) FROM dbo.order_items oi JOIN dbo.orders o ON o.id = oi.order_id WHERE o.id > @before) AS items;`;

// --- Chạy ----------------------------------------------------------------------------
let pool, created = false, server, directory;
const tokens = new Set();

async function main() {
  const startedAt = new Date().toISOString();
  const jobsEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^JOBS_/.test(k)));
  console.log('Lần đo:', LABEL || '(không đặt tên)', '| biến JOBS_*:', JSON.stringify(jobsEnv), '| chế độ:', MODE);
  try {
    adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
    console.log('Đã tạo DB tạm:', dbName);
    execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'],
      { cwd: serverDir, env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
    pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    const check = (await pool.request().query('SELECT DB_NAME() AS name;')).recordset[0].name;
    if (check !== dbName) throw Error('Pool không trỏ vào DB tạm');
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'breeze-bench-jobs-'));

    // Thay các phụ thuộc ngoài TRƯỚC khi nạp router (router destructure lúc require).
    require.cache[require.resolve('../db')].exports = { ...db, getPool: async () => pool };
    require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ verifyIdToken: async token => {
      if (!tokens.has(token)) throw Error('Unknown benchmark identity');
      return { uid: token };
    } }) } };
    const security = require('../middleware/security');
    require.cache[require.resolve('../middleware/security')].exports = { ...security, buildUserActionLimiter: () => ((req, res, next) => next()) };
    const media = require('../lib/review-media'); media.storage = media.createStorage(directory);
    const express = require('express'), sharp = require('sharp');
    const app = express(); app.use(express.json({ limit: '100kb' }));
    app.use('/api/products', require('../routes/products'));
    app.use('/api/admin', require('../routes/admin'));
    server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const base = 'http://127.0.0.1:' + server.address().port;

    async function timed(method, url, { token, body, json = false } = {}) {
      const headers = token ? { Authorization: 'Bearer ' + token } : {};
      const t0 = performance.now();
      try {
        const res = await fetch(base + url, { method, headers, body });
        const raw = await res.arrayBuffer();
        const ms = performance.now() - t0;
        return { ms, t0, status: res.status, ok: res.status >= 200 && res.status < 300, source: res.headers.get('x-stats-source'),
          body: json ? JSON.parse(Buffer.from(raw).toString('utf8')) : undefined };
      } catch (error) {
        return { ms: performance.now() - t0, status: 'ERR:' + (error.cause && error.cause.code || error.name), ok: false };
      }
    }
    const { startWorker } = require('../lib/jobs/worker');
    const startBenchWorker = () => startWorker(async () => pool, { workerId: 'bench-worker', maintenance: [], log: { log() {}, warn() {}, error: console.error } });
    async function repeat(fn) {
      for (let i = 0; i < WARMUP; i++) await fn(i, true);
      const samples = [];
      for (let i = 0; i < ITERATIONS; i++) samples.push(await fn(WARMUP + i, false));
      return samples;
    }
    const results = [];

    const adminToken = 'bench-admin'; tokens.add(adminToken);
    await pool.request().input('uid', sql.VarChar(128), adminToken)
      .query("INSERT INTO dbo.users(firebase_uid, role) VALUES(@uid, 'admin');");

    if (ONLY !== 'dashboard') {
      console.log('Đang tạo ảnh JPEG ' + IMAGE_WIDTH + '×' + IMAGE_HEIGHT + '...');
      const jpeg = await makeJpeg(sharp);
      console.log('Ảnh đầu vào:', jpeg.length, 'byte');
      // Một sản phẩm chỉ có biến thể gốc; mỗi lượt đo là một user đã mua (đơn completed năm
      // 2020, nằm ngoài mọi khoảng ngày của Dashboard) và chưa đánh giá.
      const product = (await pool.request().query(`
        DECLARE @p TABLE(id INT);
        INSERT INTO dbo.products(slug, name_vi, price, category_id, stock) OUTPUT INSERTED.id INTO @p
          VALUES('bench-review-product', N'Sản phẩm đo đánh giá', 100000, (SELECT TOP (1) id FROM dbo.categories ORDER BY id), 0);
        DECLARE @pid INT = (SELECT id FROM @p);
        INSERT INTO dbo.product_variants(product_id, sku, size, stock, is_base) VALUES(@pid, 'BENCH-REVIEW-BASE', NULL, 0, 1);
        SELECT @pid AS pid, (SELECT id FROM dbo.product_variants WHERE product_id = @pid) AS vid;`)).recordset[0];
      const reviewers = 2 * (WARMUP + ITERATIONS);
      await pool.request().input('pid', sql.Int, product.pid).input('vid', sql.Int, product.vid).input('n', sql.Int, reviewers).query(`
        SET NOCOUNT ON;
        WITH n AS (SELECT TOP (@n) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects)
        INSERT INTO dbo.users(firebase_uid) SELECT 'bench-reviewer-' + CONVERT(VARCHAR(11), i) FROM n;
        INSERT INTO dbo.orders(user_id, status, total_amount, created_at)
          SELECT id, 'completed', 100000, '2020-01-01T00:00:00' FROM dbo.users WHERE firebase_uid LIKE 'bench-reviewer-%' ORDER BY id;
        INSERT INTO dbo.order_items(order_id, product_id, variant_id, product_name, unit_price, quantity, line_total)
          SELECT o.id, @pid, @vid, N'Sản phẩm đo đánh giá', 100000, 1, 100000
          FROM dbo.orders o JOIN dbo.users u ON u.id = o.user_id WHERE u.firebase_uid LIKE 'bench-reviewer-%';`);
      let next = 0;
      // Ảnh chạy nền: chờ tới khi mọi ảnh của đánh giá vừa tạo là 'ready' (failed tính là lỗi).
      async function waitReady(reviewId, t0) {
        const end = Date.now() + 120000;
        while (Date.now() < end) {
          const r = (await pool.request().input('rid', sql.Int, reviewId).query(`SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
            FROM dbo.review_images WHERE review_id = @rid;`)).recordset[0];
          if (r.failed) return null;
          if (r.total > 0 && r.ready === r.total) return performance.now() - t0;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        return null;
      }
      const reviewWorker = MODE === 'async' ? startBenchWorker() : null;
      for (const count of [1, 5]) {
        const samples = await repeat(async () => {
          const token = 'bench-reviewer-' + (++next); tokens.add(token);
          const form = new FormData();
          form.append('rating', '5'); form.append('variant_id', String(product.vid)); form.append('comment', 'Đánh giá đo tải');
          for (let i = 0; i < count; i++) form.append('images', new Blob([jpeg], { type: 'image/jpeg' }), 'bench-' + i + '.jpg');
          const sample = await timed('POST', '/api/products/' + product.pid + '/reviews', { token, body: form, json: true });
          if (sample.ok && sample.status !== 201) sample.ok = false;
          if (sample.ok && MODE === 'async') {
            sample.readyMs = await waitReady(sample.body.id, sample.t0);
            if (sample.readyMs === null) { sample.ok = false; sample.status = 'IMAGE_NOT_READY'; }
          }
          return sample;
        });
        results.push(summarize('review POST ' + count + ' ảnh', samples));
      }
      if (reviewWorker) await reviewWorker.stop();
      const stored = (await pool.request().query('SELECT (SELECT COUNT(*) FROM dbo.reviews) AS reviews, (SELECT COUNT(*) FROM dbo.review_images) AS images;')).recordset[0];
      const files = (await fs.readdir(directory)).length;
      console.log('Sau phần đánh giá: reviews=' + stored.reviews + ', review_images=' + stored.images + ', file trên đĩa=' + files);
    }

    if (ONLY !== 'reviews') {
      console.log('Đang sinh ' + ORDERS + ' đơn giả...');
      const t0 = performance.now();
      const seeded = (await pool.request().input('products', sql.Int, PRODUCTS).input('customers', sql.Int, CUSTOMERS)
        .input('orders', sql.Int, ORDERS).input('end', sql.VarChar(19), DATA_END_UTC).query(SEED_SQL)).recordset[0];
      console.log('Đã sinh orders=' + seeded.orders + ', order_items=' + seeded.items + ' trong ' + Math.round(performance.now() - t0) + ' ms');
      if (MODE === 'async') {
        // Nạp snapshot bằng đúng đường triển khai: script backfill (--confirm) rồi worker thật xử lý hết job.
        const tb = performance.now();
        const out = execFileSync(process.execPath, ['scripts/stats-backfill.js', '--confirm'],
          { cwd: serverDir, env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe' }).toString();
        if (!out.includes('DB đích: ' + dbName)) throw Error('stats-backfill không chạy trên DB tạm');
        console.log(out.trim().split('\n').map(l => '  ' + l).join('\n'));
        const statsWorker = startBenchWorker();
        for (;;) {
          const open = (await pool.request().query("SELECT COUNT(*) AS n FROM dbo.jobs WHERE type = 'stats.recompute_day' AND status IN ('queued','running');")).recordset[0].n;
          const failedJobs = (await pool.request().query("SELECT COUNT(*) AS n FROM dbo.jobs WHERE type = 'stats.recompute_day' AND status = 'failed';")).recordset[0].n;
          if (failedJobs) throw Error('Có job thống kê failed khi nạp snapshot');
          if (!open) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        await statsWorker.stop();
        const left = await require('../lib/stats-snapshot').reconcileStats(pool);
        if (left.days.length) throw Error('Snapshot chưa khớp sau backfill: ' + left.days.length + ' ngày');
        const days = (await pool.request().query('SELECT COUNT(*) AS n FROM dbo.stats_snapshots;')).recordset[0].n;
        console.log('Đã nạp snapshot ' + days + ' ngày (backfill + worker) trong ' + Math.round(performance.now() - tb) + ' ms; đối soát: 0 ngày lệch');
      }
      const t1 = performance.now();
      await pool.request().batch('UPDATE STATISTICS dbo.orders WITH FULLSCAN; UPDATE STATISTICS dbo.order_items WITH FULLSCAN;');
      console.log('Đã cập nhật thống kê orders/order_items (FULLSCAN) trong ' + Math.round(performance.now() - t1) + ' ms');

      const anchorRes = await fetch(base + '/api/admin/stats/anchor', { headers: { Authorization: 'Bearer ' + adminToken } });
      const { anchor } = await anchorRes.json();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor || '')) throw Error('Không lấy được ngày neo');
      const anchorDate = new Date(anchor + 'T00:00:00Z');
      const ymd = d => d.toISOString().slice(0, 10);
      const ranges = {
        '30 ngày': { from: ymd(new Date(anchorDate.getTime() - 29 * 86400000)), to: anchor },
        'năm nay': { from: anchor.slice(0, 4) + '-01-01', to: anchor },
      };
      console.log('Ngày neo:', anchor, '| khoảng:', JSON.stringify(ranges));
      const get = url => () => timed('GET', url, { token: adminToken });
      results.push(summarize('GET stats/anchor', await repeat(get('/api/admin/stats/anchor'))));
      for (const [label, rg] of Object.entries(ranges)) {
        const q = '?from=' + rg.from + '&to=' + rg.to;
        results.push(summarize('GET stats [' + label + ']', await repeat(get('/api/admin/stats' + q))));
        results.push(summarize('GET stats/order-status [' + label + ']', await repeat(get('/api/admin/stats/order-status' + q))));
        results.push(summarize('GET stats/top-products [' + label + ']', await repeat(get('/api/admin/stats/top-products' + q + '&limit=5'))));
        results.push(summarize('GET stats/business-report [' + label + ']', await repeat(get('/api/admin/stats/business-report' + q))));
        // Cùng chuỗi request trang admin gửi khi mở Dashboard: anchor, rồi song song
        // stats + order-status + top-products + 5 đơn mới nhất. Đo tổng thời gian chờ.
        results.push(summarize('Dashboard tải trang [' + label + ']', await repeat(async () => {
          const t1 = performance.now();
          const first = await timed('GET', '/api/admin/stats/anchor', { token: adminToken });
          const rest = await Promise.all([
            timed('GET', '/api/admin/stats' + q, { token: adminToken }),
            timed('GET', '/api/admin/stats/order-status' + q, { token: adminToken }),
            timed('GET', '/api/admin/stats/top-products' + q + '&limit=5', { token: adminToken }),
            timed('GET', '/api/admin/orders?page=1&limit=5', { token: adminToken }),
          ]);
          const all = [first, ...rest], bad = all.find(s => !s.ok);
          // Nguồn của cả lượt tải trang: giống nhau ở mọi request có header thì lấy giá trị đó, khác nhau thì ghép lại.
          const seen = [...new Set(all.map(s => s.source).filter(Boolean))];
          return { ms: performance.now() - t1, ok: !bad, status: bad ? bad.status : 200, source: seen.join('+') || null };
        })));
      }
      for (const key of ['30d', 'year']) {
        results.push(summarize('GET statistics?range=' + key, await repeat(get('/api/admin/statistics?range=' + key))));
      }
    }

    console.log('\nKết quả (ms; ' + WARMUP + ' lượt khởi động không tính, ' + ITERATIONS + ' lượt đo, tuần tự):');
    printTable(results);
    const failed = results.filter(r => r.ok !== r.n);
    if (OUT) {
      const cpus = os.cpus();
      await fs.writeFile(OUT, JSON.stringify({
        label: LABEL, mode: MODE, startedAt, finishedAt: new Date().toISOString(), jobsEnv,
        settings: { iterations: ITERATIONS, warmup: WARMUP, orders: ORDERS, customers: CUSTOMERS, products: PRODUCTS, dataEndUtc: DATA_END_UTC,
          image: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT } },
        machine: { node: process.version, platform: process.platform, cpu: cpus[0] && cpus[0].model, cores: cpus.length,
          memGB: Math.round(os.totalmem() / 1073741824) },
        results,
      }, null, 2));
      console.log('Đã ghi kết quả:', OUT);
    }
    if (failed.length) { console.error('Có request lỗi ở:', failed.map(r => r.name).join(' | ')); process.exitCode = 1; }
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (pool) await pool.close();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    if (created) {
      adminSql('ALTER DATABASE ' + quoted + ' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + quoted + ';');
      console.log('Đã xoá DB tạm:', dbName);
    }
  }
}
main().catch(error => { console.error('Bench FAILED:', error.code || error.message); process.exitCode = 1; });
