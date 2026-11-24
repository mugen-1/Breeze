'use strict';
// Ảnh đánh giá xử lý nền (JOBS_MODE=async) trên SQL Server thật, bằng DB TẠM tự tạo/tự xoá và
// thư mục ảnh tạm. Route, middleware, transaction, hàng đợi, worker, handler và phần quét bù là code
// thật; chỉ thay xác minh token Firebase (danh tính giả) và limiter theo user.
// Chạy (trong server/, cần sqlcmd + Windows auth như các script verify-*-sql khác):
//   node scripts/verify-review-image-job-sql.js
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs/promises'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const realDb = process.env.DB_NAME;
const dbName = 'BreezeReviewImageJobTest_' + process.pid + '_' + Date.now();
if (!/^BreezeReviewImageJobTest_[0-9]+_[0-9]+$/.test(dbName) || dbName === realDb) throw Error('Unsafe test database');
process.env.DB_NAME = dbName;
delete process.env.JOBS_MODE;
const db = require('../db'), { sql, config } = db;
if (config.database !== dbName) throw Error('db.js không nhận DB tạm');
const quoted = '[' + dbName + ']', serverDir = path.join(__dirname, '..');

let pool, created = false, server, root, worker, checks = 0, fixture = 0;
const tokens = new Set(), wait = ms => new Promise(r => setTimeout(r, ms)), quiet = { log() {}, warn() {}, error() {} };
function check(name, value) { assert.ok(value, name); checks++; console.log('PASS: ' + name); }
function same(name, actual, expected) { assert.deepEqual(actual, expected, name); checks++; console.log('PASS: ' + name); }
function adminSql(query) { execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' }); }
const rows = async text => (await pool.request().query(text)).recordset;
const list = async dir => (await fs.readdir(dir).catch(() => [])).filter(n => !n.startsWith('.')).sort();
const hexOf = url => url.slice('/review-images/'.length, -'.webp'.length);
async function waitFor(fn, ms, label) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await wait(25); } throw Error('Hết thời gian chờ: ' + label); }

async function product(slug) {
  const pid = (await pool.request().input('slug', sql.VarChar(160), slug).query(`INSERT INTO dbo.products(slug,name_vi,price,category_id,stock)
    OUTPUT INSERTED.id VALUES(@slug,N'Sản phẩm thử ảnh nền',100,(SELECT TOP(1) id FROM dbo.categories ORDER BY id),0);`)).recordset[0].id;
  const vid = (await pool.request().input('pid', sql.Int, pid).query(`INSERT INTO dbo.product_variants(product_id,sku,size,stock,is_base)
    OUTPUT INSERTED.id VALUES(@pid,'IMGJOB-'+CONVERT(VARCHAR(11),@pid)+'-BASE',NULL,0,1);`)).recordset[0].id;
  return { pid, vid };
}
// Người mua mới (đơn completed năm 2020) cho mỗi lần tạo đánh giá: mỗi user chỉ một đánh giá/sản phẩm.
async function buyer(p, role = 'customer') {
  const token = 'review-image-job-' + (++fixture); tokens.add(token);
  const uid = (await pool.request().input('uid', sql.VarChar(128), token).input('role', sql.VarChar(20), role)
    .query('INSERT INTO dbo.users(firebase_uid, role) OUTPUT INSERTED.id VALUES(@uid, @role);')).recordset[0].id;
  const oid = (await pool.request().input('uid', sql.Int, uid).query(`INSERT INTO dbo.orders(user_id,status,total_amount,created_at)
    OUTPUT INSERTED.id VALUES(@uid,'completed',100,'2020-01-01T00:00:00');`)).recordset[0].id;
  await pool.request().input('oid', sql.Int, oid).input('pid', sql.Int, p.pid).input('vid', sql.Int, p.vid).query(`INSERT INTO dbo.order_items
    (order_id,product_id,variant_id,product_name,unit_price,quantity,line_total) VALUES(@oid,@pid,@vid,N'Ảnh nền',100,1,100);`);
  return { token, uid };
}

async function main() {
  try {
    adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
    console.log('Created disposable database:', dbName);
    execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'],
      { cwd: serverDir, env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
    pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    check('pool targets the disposable database', (await rows('SELECT DB_NAME() AS n;'))[0].n === dbName);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'breeze-review-image-job-sql-'));
    const finalDir = path.join(root, 'reviews'), pendingDir = path.join(root, 'reviews-pending');

    require.cache[require.resolve('../db')].exports = { ...db, getPool: async () => pool };
    require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ verifyIdToken: async token => {
      if (!tokens.has(token)) throw Error('Unknown test identity'); return { uid: token };
    } }) } };
    const security = require('../middleware/security');
    require.cache[require.resolve('../middleware/security')].exports = { ...security, buildUserActionLimiter: () => ((req, res, next) => next()) };
    const media = require('../lib/review-media'); media.storage = media.createStorage(finalDir, pendingDir);
    const queue = require('../lib/jobs/queue');
    const { startWorker } = require('../lib/jobs/worker');
    const { sweepFailedImages } = require('../lib/jobs/handlers/review-image');
    const express = require('express'), sharp = require('sharp');
    const app = express(); app.use(express.json());
    app.use('/api/products', require('../routes/products')); app.use('/api/admin', require('../routes/admin'));
    app.use(media.PUBLIC_PREFIX, express.static(finalDir, { dotfiles: 'deny' }));
    server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const png = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#2266aa' } }).png().toBuffer();
    const jpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#aa6622' } }).jpeg().toBuffer();
    const pngFile = { buffer: png, type: 'image/png', name: 'a.png' }, jpegFile = { buffer: jpeg, type: 'image/jpeg', name: 'b.jpg' };

    async function http(method, url, token, { body, files } = {}) {
      const headers = token ? { Authorization: 'Bearer ' + token } : {};
      let payload;
      if (files) {
        payload = new FormData();
        for (const [k, v] of Object.entries(body || {})) payload.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        for (const f of files) payload.append('images', new Blob([f.buffer], { type: f.type }), f.name);
      } else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      const r = await fetch(base + url, { method, headers, body: payload });
      return { status: r.status, body: await r.json() };
    }
    const create = (p, u, files) => http('POST', '/api/products/' + p.pid + '/reviews', u.token, { body: { rating: 5, variant_id: p.vid }, files });
    const publicList = (p, query = '') => http('GET', '/api/products/' + p.pid + '/reviews' + query);
    const owner = (p, u) => http('GET', '/api/products/' + p.pid + '/reviews/me', u.token);
    const imageRows = rid => rows('SELECT id, image_path, status FROM dbo.review_images WHERE review_id=' + rid + ' ORDER BY sort_order;');
    const jobsFor = ids => rows("SELECT id, status, attempts, payload, last_error FROM dbo.jobs WHERE type='review_image.process' AND "
      + 'TRY_CONVERT(INT, JSON_VALUE(payload, \'$.imageId\')) IN (' + ids.join(',') + ') ORDER BY id;');
    const p = await product('review-image-job-fixture');
    const admin = await buyer(p, 'admin');

    // --- Migration 027: dòng có sẵn thành 'ready', chạy lại không đổi dữ liệu -------------------------
    const legacy = await buyer(p);
    const legacyRid = (await pool.request().input('uid', sql.Int, legacy.uid).input('pid', sql.Int, p.pid).input('vid', sql.Int, p.vid)
      .query('INSERT INTO dbo.reviews(user_id,product_id,variant_id,rating) OUTPUT INSERTED.id VALUES(@uid,@pid,@vid,4);')).recordset[0].id;
    // Chỉ ở DB tạm: gỡ cột như trước 027, chèn ảnh "cũ" rồi chạy 027.
    await pool.request().batch(`ALTER TABLE dbo.review_images DROP CONSTRAINT CK_review_images_status;
      ALTER TABLE dbo.review_images DROP CONSTRAINT DF_review_images_status; ALTER TABLE dbo.review_images DROP COLUMN status;`);
    await pool.request().query(`INSERT INTO dbo.review_images(review_id,image_path,sort_order) VALUES
      (${legacyRid},'/review-images/${'1'.repeat(32)}.webp',0),(${legacyRid},'/review-images/${'2'.repeat(32)}.webp',1);`);
    const migrate = () => execFileSync(process.execPath, ['db/run-sql.js', 'db/migrations/027_review_image_status.sql'],
      { cwd: serverDir, env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe' });
    migrate();
    same("027 marks every existing image 'ready'", (await imageRows(legacyRid)).map(r => r.status), ['ready', 'ready']);
    const snapshot = await rows('SELECT * FROM dbo.review_images ORDER BY id;');
    migrate();
    same('rerunning 027 leaves rows unchanged', await rows('SELECT * FROM dbo.review_images ORDER BY id;'), snapshot);
    for (const bad of ['Ready', 'ready ', 'done']) {
      let error = null;
      try { await pool.request().input('s', sql.VarChar(10), bad).query(`UPDATE dbo.review_images SET status=@s WHERE review_id=${legacyRid};`); } catch (e) { error = e; }
      check('CHECK rejects status ' + JSON.stringify(bad), error && error.number === 547);
    }
    same('legacy images are public (ready)', (await publicList(p)).body.reviews.find(r => r.id === legacyRid).images.length, 2);
    await pool.request().query('DELETE FROM dbo.reviews WHERE id=' + legacyRid + ';');

    // --- Chế độ sync (JOBS_MODE không đặt): như cũ, ảnh 'ready', không job, không ảnh gốc --------------
    const syncUser = await buyer(p);
    const syncRes = await create(p, syncUser, [pngFile, jpegFile]);
    same('sync create returns 201 with ready images', [syncRes.status, syncRes.body.images.map(i => i.status)], [201, ['ready', 'ready']]);
    same('sync rows are ready', (await imageRows(syncRes.body.id)).map(r => r.status), ['ready', 'ready']);
    check('sync writes final WebP files immediately', (await list(finalDir)).length === 2);
    same('sync writes no original and queues no job', [await list(pendingDir), (await rows('SELECT COUNT(*) AS n FROM dbo.jobs;'))[0].n], [[], 0]);
    const syncImage = await fetch(base + syncRes.body.images[0].url);
    check('sync image is served as WebP', syncImage.status === 200 && (await sharp(Buffer.from(await syncImage.arrayBuffer())).metadata()).format === 'webp');

    // --- Chế độ async: kiểm tra đồng bộ vẫn chặn ngay -------------------------------------------------
    process.env.JOBS_MODE = 'async';
    const rejectUser = await buyer(p);
    const before = { reviews: (await rows('SELECT COUNT(*) AS n FROM dbo.reviews;'))[0].n, pending: await list(pendingDir) };
    const brokenHeader = { buffer: Buffer.concat([png.subarray(0, 16), Buffer.alloc(64)]), type: 'image/png', name: 'x.png' };
    const huge = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: '#000000' } }).png({ compressionLevel: 9 }).toBuffer();
    for (const [label, file, status] of [['broken header', brokenHeader, 415], ['over 4096×4096 pixels', { buffer: huge, type: 'image/png', name: 'h.png' }, 415],
      ['MIME/extension mismatch', { buffer: png, type: 'image/jpeg', name: 'a.png' }, 415], ['over 2MB', { buffer: Buffer.alloc(2 * 1024 * 1024 + 1), type: 'image/png', name: 'a.png' }, 413]]) {
      same('async rejects ' + label + ' synchronously', (await create(p, rejectUser, [file])).status, status);
    }
    same('rejected async uploads write no review, original or job',
      [(await rows('SELECT COUNT(*) AS n FROM dbo.reviews;'))[0].n, await list(pendingDir), (await rows('SELECT COUNT(*) AS n FROM dbo.jobs;'))[0].n],
      [before.reviews, before.pending, 0]);

    // --- Async: ảnh pending + ảnh gốc + job trong cùng transaction -------------------------------------
    const asyncUser = await buyer(p);
    const asyncRes = await create(p, asyncUser, [pngFile, jpegFile]);
    same('async create returns 201 with pending images', [asyncRes.status, asyncRes.body.images.map(i => i.status)], [201, ['pending', 'pending']]);
    const asyncImages = await imageRows(asyncRes.body.id);
    same('async rows are pending', asyncImages.map(r => r.status), ['pending', 'pending']);
    const hexes = asyncImages.map(r => hexOf(r.image_path));
    same('originals saved as <same 32 hex>.<type from content>', await list(pendingDir), [hexes[0] + '.png', hexes[1] + '.jpg'].sort());
    check('no final file yet for pending images', !(await list(finalDir)).some(n => hexes.includes(n.slice(0, 32))));
    const asyncJobs = await jobsFor(asyncImages.map(r => r.id));
    same('one queued job per image with id + original name only (no image bytes)', asyncJobs.map(j => [j.status, JSON.parse(j.payload)]),
      asyncImages.map((r, i) => ['queued', { imageId: r.id, source: hexes[i] + (i ? '.jpg' : '.png') }]));
    const listed = (await publicList(p)).body;
    same('public list hides pending images and does not count them',
      [listed.reviews.find(r => r.id === asyncRes.body.id).images, listed.summary.reviewsWithImages], [[], 1]);
    check('hasImages filter excludes review with only pending images',
      !(await publicList(p, '?hasImages=true')).body.reviews.some(r => r.id === asyncRes.body.id));
    same('owner sees every image with status', (await owner(p, asyncUser)).body.review.images.map(i => i.status), ['pending', 'pending']);
    same('admin detail shows only ready images', (await http('GET', '/api/admin/reviews/' + asyncRes.body.id, admin.token)).body.images, []);
    const blocked = await fetch(base + asyncRes.body.images[0].url);
    check('pending image URL is not served yet', blocked.status === 404);

    // --- Worker xử lý thành công ----------------------------------------------------------------------
    const auditBefore = (await rows('SELECT COUNT(*) AS n FROM dbo.audit_logs;'))[0].n;
    worker = startWorker(async () => pool, { workerId: 'verify-worker', intervalMs: 20, baseDelayMs: 50, maintenance: [], log: quiet });
    await waitFor(async () => (await jobsFor(asyncImages.map(r => r.id))).every(j => j.status === 'done'), 30000, 'image jobs done');
    same('worker marks images ready', (await imageRows(asyncRes.body.id)).map(r => r.status), ['ready', 'ready']);
    same('worker removes originals', (await list(pendingDir)).filter(n => hexes.includes(n.slice(0, 32))), []);
    for (const url of asyncRes.body.images.map(i => i.url)) {
      const res = await fetch(base + url), info = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      check('processed image is WebP within 1600px', res.status === 200 && info.format === 'webp' && info.width <= 1600 && info.height <= 1600);
    }
    same('public list now shows both images', (await publicList(p)).body.reviews.find(r => r.id === asyncRes.body.id).images.length, 2);
    check('hasImages filter now includes the review', (await publicList(p, '?hasImages=true')).body.reviews.some(r => r.id === asyncRes.body.id));
    same('admin detail now shows both images', (await http('GET', '/api/admin/reviews/' + asyncRes.body.id, admin.token)).body.images.length, 2);
    same('owner now sees ready', (await owner(p, asyncUser)).body.review.images.map(i => i.status), ['ready', 'ready']);
    same('worker writes no audit row', (await rows('SELECT COUNT(*) AS n FROM dbo.audit_logs;'))[0].n, auditBefore);
    await worker.stop(); worker = null;

    // --- PATCH async: ảnh mới pending, giới hạn 5 tính cả pending ---------------------------------------
    const patchRes = await http('PATCH', '/api/products/' + p.pid + '/reviews/' + asyncRes.body.id, asyncUser.token,
      { body: { rating: 4, variant_id: p.vid }, files: [jpegFile] });
    same('async PATCH adds a pending image and keeps ready ones', [patchRes.status, patchRes.body.images.map(i => i.status)], [200, ['ready', 'ready', 'pending']]);
    same('async PATCH queues a job for the new image', (await jobsFor([patchRes.body.images[2].id])).map(j => j.status), ['queued']);
    const fullUser = await buyer(p);
    const full = await create(p, fullUser, [pngFile, pngFile, pngFile, pngFile, pngFile]);
    same('five pending images accepted', full.body.images.map(i => i.status), Array(5).fill('pending'));
    same('a sixth image is refused while five are pending', (await http('PATCH', '/api/products/' + p.pid + '/reviews/' + full.body.id, fullUser.token,
      { body: { rating: 4, variant_id: p.vid }, files: [jpegFile] })).body.code, 'REVIEW_TOO_MANY_IMAGES');

    // --- Ảnh bị xoá trước khi xử lý: PATCH bỏ 1 ảnh pending, DELETE cả đánh giá ------------------------
    const removedImage = (await imageRows(full.body.id))[0].id, removedHex = hexOf(full.body.images[0].url);
    const removal = await http('PATCH', '/api/products/' + p.pid + '/reviews/' + full.body.id, fullUser.token,
      { body: { rating: 4, variant_id: p.vid, remove_image_ids: [removedImage] }, files: [] });
    same('PATCH removes only the listed pending image', [removal.status, removal.body.images.length], [200, 4]);
    check('its original is deleted right after commit', !(await list(pendingDir)).some(n => n.startsWith(removedHex)));
    const deletedUser = await buyer(p);
    const deleted = await create(p, deletedUser, [jpegFile]);
    const deletedHex = hexOf(deleted.body.images[0].url), deletedImage = (await imageRows(deleted.body.id))[0].id;
    same('owner deletes the whole review while its image is pending',
      (await http('DELETE', '/api/products/' + p.pid + '/reviews/' + deleted.body.id, deletedUser.token)).status, 200);
    worker = startWorker(async () => pool, { workerId: 'verify-worker', intervalMs: 20, baseDelayMs: 50, maintenance: [], log: quiet });
    await waitFor(async () => (await rows("SELECT COUNT(*) AS n FROM dbo.jobs WHERE status IN ('queued','running');"))[0].n === 0, 30000, 'all jobs settled');
    await worker.stop(); worker = null;
    same('jobs of removed images finish as done (not failed)', (await jobsFor([removedImage, deletedImage])).map(j => j.status), ['done', 'done']);
    check('no final file is left for removed images',
      !(await list(finalDir)).some(n => n.startsWith(removedHex) || n.startsWith(deletedHex)));
    same('remaining pending images of that review were processed', (await imageRows(full.body.id)).map(r => r.status), Array(4).fill('ready'));

    // --- Handler lỗi tới lần cuối -> ảnh failed, giữ đánh giá, xoá ảnh gốc -------------------------------
    const failUser = await buyer(p);
    const failing = await create(p, failUser, [pngFile]);
    const failImage = (await imageRows(failing.body.id))[0], failHex = hexOf(failImage.image_path);
    // Chỉ ở DB tạm: hỏng phần điểm ảnh của ảnh gốc (header vẫn đúng) và rút số lần thử để chạy nhanh.
    await fs.writeFile(path.join(pendingDir, failHex + '.png'), Buffer.concat([png.subarray(0, 64), Buffer.alloc(256)]));
    await pool.request().query('UPDATE dbo.jobs SET max_attempts = 2 WHERE TRY_CONVERT(INT, JSON_VALUE(payload, \'$.imageId\'))=' + failImage.id + ';');
    worker = startWorker(async () => pool, { workerId: 'verify-worker', intervalMs: 20, baseDelayMs: 50, maintenance: [], log: quiet });
    await waitFor(async () => (await jobsFor([failImage.id]))[0].status === 'failed', 30000, 'failing job exhausted');
    await worker.stop(); worker = null;
    const [failedJob] = await jobsFor([failImage.id]);
    same('job tried twice then failed with a recorded error', [failedJob.attempts, !!failedJob.last_error], [2, true]);
    same('image marked failed, review kept', [(await imageRows(failing.body.id)).map(r => r.status), (await rows('SELECT COUNT(*) AS n FROM dbo.reviews WHERE id=' + failing.body.id))[0].n], [['failed'], 1]);
    check('original removed after the final attempt', !(await list(pendingDir)).some(n => n.startsWith(failHex)));
    same('owner sees failed; public shows nothing', [(await owner(p, failUser)).body.review.images.map(i => i.status),
      (await publicList(p)).body.reviews.find(r => r.id === failing.body.id).images], [['failed'], []]);

    // --- Worker chết ở lần cuối: claim chuyển job failed (không qua handler) -> quét bù --------------------
    const deadUser = await buyer(p);
    const dead = await create(p, deadUser, [jpegFile]);
    const deadImage = (await imageRows(dead.body.id))[0], deadHex = hexOf(deadImage.image_path);
    // Chỉ ở DB tạm: dựng lại trạng thái "worker đang chạy lần thử cuối thì chết" (khoá đã hết hạn).
    await pool.request().query(`UPDATE dbo.jobs SET status='running', attempts=max_attempts, locked_by='dead-worker',
      locked_until=DATEADD(SECOND,-1,SYSUTCDATETIME()) WHERE TRY_CONVERT(INT, JSON_VALUE(payload, '$.imageId'))=${deadImage.id};`);
    same('another worker\'s claim fails the expired last attempt without running it', await queue.claim(pool, { workerId: 'other-worker' }), null);
    same('job is failed by claim but the image is still pending', [(await jobsFor([deadImage.id]))[0].status, (await imageRows(dead.body.id))[0].status], ['failed', 'pending']);

    // --- Quét bù không đụng ảnh có job queued/running ------------------------------------------------------
    const guardUser = await buyer(p);
    const guarded = await create(p, guardUser, [pngFile, jpegFile]);
    const [queuedImage, runningImage] = await imageRows(guarded.body.id);
    const running = await queue.claim(pool, { workerId: 'busy-worker', lockMs: 600000 });
    check('one guarded image job is running (lock still valid)', running && [queuedImage.id, runningImage.id].includes(running.payload.imageId));
    const runningId = running.payload.imageId, queuedId = runningId === queuedImage.id ? runningImage.id : queuedImage.id;
    // Chỉ ở DB tạm: thêm một job failed cũ cho CẢ HAI ảnh — quét bù vẫn phải bỏ qua vì còn job queued/running.
    for (const id of [queuedId, runningId]) {
      await pool.request().query(`INSERT INTO dbo.jobs(type,payload,status,attempts,max_attempts,finished_at)
        VALUES('review_image.process','{"imageId":${id},"source":"${'0'.repeat(32)}.png"}','failed',1,1,SYSUTCDATETIME());`);
    }
    const guardedFiles = await list(pendingDir);
    same('sweep marks exactly the dead-worker image failed', await sweepFailedImages(pool), 1);
    same('dead-worker image failed and its original removed', [(await imageRows(dead.body.id))[0].status,
      (await list(pendingDir)).some(n => n.startsWith(deadHex))], ['failed', false]);
    same('images with a queued or running job stay pending', (await rows(`SELECT status FROM dbo.review_images WHERE id IN (${queuedId},${runningId});`)).map(r => r.status), ['pending', 'pending']);
    same('their originals are untouched', (await list(pendingDir)).filter(n => !n.startsWith(deadHex)), guardedFiles.filter(n => !n.startsWith(deadHex)));
    same('sweep rerun changes nothing', await sweepFailedImages(pool), 0);
    await queue.complete(pool, running);

    delete process.env.JOBS_MODE;
    console.log('SQL REVIEW IMAGE JOB VERIFY:', checks, 'checks passed; all fixtures confined to disposable database.');
  } finally {
    delete process.env.JOBS_MODE;
    if (worker) await worker.stop().catch(() => {});
    if (server) await new Promise(r => server.close(r));
    if (pool) await Promise.race([pool.close().catch(() => {}), wait(10000)]);
    if (root) await fs.rm(root, { recursive: true, force: true });
    if (created) {
      adminSql('ALTER DATABASE ' + quoted + ' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + quoted + ';');
      console.log('Removed disposable database:', dbName);
    }
  }
}
main().catch(error => {
  console.error('Review image job SQL verification FAILED:', error.code === 'ERR_ASSERTION' ? error.message : (error.code || error.message));
  process.exitCode = 1;
});
