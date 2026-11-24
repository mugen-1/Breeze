'use strict';

// Ảnh đánh giá chạy nền: lib/review-media.js (inspectImages, nơi lưu ảnh gốc/ảnh cuối) và handler
// lib/jobs/handlers/review-image.js với SQL giả + thư mục tạm thật. Luồng đầy đủ qua route, hàng đợi,
// worker và SQL Server thật: scripts/verify-review-image-job-sql.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const realSql = require('mssql'), sharp = require('sharp');

let state;
const rs = (recordset = [], affected = recordset.length) => ({ recordset, recordsets: [recordset], rowsAffected: [affected] });
class Request {
  constructor() { this.p = {}; }
  input(k, type, v) { this.p[k] = v; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.p;
    state.queries.push(q);
    if (q === 'SELECT id, image_path, status FROM dbo.review_images WHERE id = @id;') {
      if (state.beforeRead) { const hook = state.beforeRead; state.beforeRead = null; hook(); }
      const row = state.images.find(i => i.id === p.id);
      return rs(row ? [{ ...row }] : []);
    }
    const update = /^UPDATE dbo\.review_images SET status = '(ready|failed)' WHERE id = @id AND status = 'pending';$/.exec(q);
    if (update) {
      if (update[1] === 'ready' && state.beforeReady) { const hook = state.beforeReady; state.beforeReady = null; hook(); }
      const row = state.images.find(i => i.id === p.id && i.status === 'pending');
      if (row) row.status = update[1];
      return rs([], row ? 1 : 0);
    }
    if (q.includes('UPDATE i SET status = \'failed\' OUTPUT INSERTED.id, INSERTED.image_path INTO @swept')) return rs(state.swept);
    throw new Error('Unexpected test SQL ' + q);
  }
}
const pool = { request: () => new Request() };
require.cache[require.resolve('../db')] = { exports: { sql: { ...realSql, Request }, getPool: async () => pool } };
const media = require('../lib/review-media');
const { processReviewImage, sweepFailedImages, SWEEP_SQL } = require('../lib/jobs/handlers/review-image');

let root, finalDir, pendingDir, png, jpeg;
const HEX = 'ab'.repeat(16), URL_ = '/review-images/' + HEX + '.webp', SOURCE = HEX + '.png';
const list = async dir => (await fs.readdir(dir).catch(() => [])).filter(n => !n.startsWith('.')).sort();
const job = (attempts = 1, payload = { imageId: 7, source: SOURCE }) => ({ id: 1, type: 'review_image.process', payload, attempts, maxAttempts: 5 });
async function putOriginal(buffer = png, name = SOURCE) { await fs.mkdir(pendingDir, { recursive: true }); await fs.writeFile(path.join(pendingDir, name), buffer); }

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'breeze-review-image-job-'));
  finalDir = path.join(root, 'reviews'); pendingDir = path.join(root, 'reviews-pending');
  media.storage = media.createStorage(finalDir, pendingDir);
  png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#336699' } }).png().toBuffer();
  jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#996633' } }).jpeg().toBuffer();
});
after(async () => { await fs.rm(root, { recursive: true, force: true }); });
beforeEach(async () => {
  await fs.rm(finalDir, { recursive: true, force: true }); await fs.rm(pendingDir, { recursive: true, force: true });
  state = { queries: [], images: [{ id: 7, image_path: URL_, status: 'pending' }], swept: [] };
});

test('thành công: ghi WebP cuối (≤1600px) theo đúng 32 hex, ảnh ready, xoá ảnh gốc', async () => {
  await putOriginal();
  await processReviewImage(job(), { pool });
  assert.equal(state.images[0].status, 'ready');
  assert.deepEqual(await list(finalDir), [HEX + '.webp']);
  assert.deepEqual(await list(pendingDir), []);
  const info = await sharp(await fs.readFile(path.join(finalDir, HEX + '.webp'))).metadata();
  assert.equal(info.format, 'webp');
  assert.ok(info.width <= 1600 && info.height <= 1600);
});

test('thử lại ghi đè cùng tên file cuối (file dở của lần trước bị thay)', async () => {
  await putOriginal();
  await fs.mkdir(finalDir, { recursive: true }); await fs.writeFile(path.join(finalDir, HEX + '.webp'), 'nửa chừng');
  await processReviewImage(job(2), { pool });
  assert.equal((await sharp(await fs.readFile(path.join(finalDir, HEX + '.webp'))).metadata()).format, 'webp');
  assert.deepEqual(await list(finalDir), [HEX + '.webp']);
});

test('chạy lại sau khi đã ready: không ghi lại, giữ file cuối, chỉ dọn ảnh gốc còn sót', async () => {
  state.images[0].status = 'ready';
  await fs.mkdir(finalDir, { recursive: true }); await fs.writeFile(path.join(finalDir, HEX + '.webp'), 'đã có');
  await putOriginal();
  await processReviewImage(job(2), { pool });
  assert.equal(await fs.readFile(path.join(finalDir, HEX + '.webp'), 'utf8'), 'đã có');
  assert.deepEqual(await list(pendingDir), []);
  assert.ok(!state.queries.some(q => q.startsWith('UPDATE')));
});

test('ảnh/đánh giá đã bị xoá trước khi xử lý: dọn ảnh gốc, không ghi file cuối, job xong', async () => {
  state.images = []; await putOriginal();
  await processReviewImage(job(), { pool });
  assert.deepEqual(await list(finalDir), []);
  assert.deepEqual(await list(pendingDir), []);
});

test('bị xoá TRONG lúc xử lý (UPDATE 0 dòng): xoá file vừa ghi + ảnh gốc, job xong', async () => {
  await putOriginal();
  state.beforeReady = () => { state.images = []; };
  await processReviewImage(job(), { pool });
  assert.deepEqual(await list(finalDir), []);
  assert.deepEqual(await list(pendingDir), []);
});

test('ảnh gốc đã mất (do sửa/xoá đánh giá) mà dòng đã mất: job xong, không lỗi', async () => {
  state.images = [];
  await processReviewImage(job(), { pool });
  assert.deepEqual(await list(finalDir), []);
});

test('ảnh gốc mất nhưng dòng vẫn pending: ảnh failed, job xong (không ném lỗi, không thử lại)', async () => {
  await processReviewImage(job(1), { pool });
  assert.equal(state.images[0].status, 'failed');
  assert.deepEqual(await list(finalDir), []);
});

test('lỗi xử lý chưa phải lần cuối: ném lỗi để thử lại, ảnh vẫn pending, ảnh gốc giữ nguyên', async () => {
  await putOriginal(Buffer.concat([png.subarray(0, 64), Buffer.alloc(64)]));
  await assert.rejects(processReviewImage(job(4), { pool }));
  assert.equal(state.images[0].status, 'pending');
  assert.deepEqual(await list(pendingDir), [SOURCE]);
});

test('lỗi ở lần thử cuối: ảnh failed, xoá ảnh gốc (và file cuối nếu có), vẫn ném lỗi để job failed', async () => {
  await putOriginal(Buffer.concat([png.subarray(0, 64), Buffer.alloc(64)]));
  await assert.rejects(processReviewImage(job(5), { pool }));
  assert.equal(state.images[0].status, 'failed');
  assert.deepEqual(await list(pendingDir), []);
  assert.deepEqual(await list(finalDir), []);
});

test('payload không hợp lệ (đường dẫn lạ, id sai) bị từ chối trước khi chạm SQL hay đĩa', async () => {
  for (const payload of [{ imageId: 7, source: '../' + SOURCE }, { imageId: 7, source: HEX + '.gif' }, { imageId: 7, source: HEX.toUpperCase() + '.png' },
    { imageId: 0, source: SOURCE }, { imageId: '7', source: SOURCE }, { imageId: 7 }, null]) {
    await assert.rejects(processReviewImage(job(5, payload), { pool }), /Payload job ảnh không hợp lệ/);
  }
  assert.equal(state.queries.length, 0);
});

test('payload không khớp image_path của dòng -> lỗi, không ghi gì', async () => {
  state.images[0].image_path = '/review-images/' + 'cd'.repeat(16) + '.webp'; await putOriginal();
  await assert.rejects(processReviewImage(job(), { pool }), /không khớp/);
  assert.equal(state.images[0].status, 'pending');
  assert.deepEqual(await list(finalDir), []);
});

test('quét bù: chỉ ảnh pending có job failed và KHÔNG còn job queued/running; dọn ảnh gốc + file cuối', async () => {
  const q = SWEEP_SQL.replace(/\s+/g, ' ');
  assert.match(q, /WHERE i\.status = 'pending'/);
  assert.match(q, /AND EXISTS \(SELECT 1 FROM dbo\.jobs j WHERE j\.type = 'review_image\.process' AND j\.status = 'failed' AND TRY_CONVERT\(INT, JSON_VALUE\(j\.payload, '\$\.imageId'\)\) = i\.id\)/);
  assert.match(q, /AND NOT EXISTS \(SELECT 1 FROM dbo\.jobs j WHERE j\.type = 'review_image\.process' AND j\.status IN \('queued', 'running'\) AND TRY_CONVERT\(INT, JSON_VALUE\(j\.payload, '\$\.imageId'\)\) = i\.id\)/);
  assert.match(q, /OUTPUT INSERTED\.id, INSERTED\.image_path INTO @swept/);
  await putOriginal(); await putOriginal(jpeg, 'cd'.repeat(16) + '.jpg');
  state.swept = [{ id: 7, image_path: URL_ }];
  assert.equal(await sweepFailedImages(pool), 1);
  assert.deepEqual(await list(pendingDir), ['cd'.repeat(16) + '.jpg'], 'chỉ dọn ảnh gốc của dòng vừa chuyển failed');
  state.swept = [];
  assert.equal(await sweepFailedImages(pool), 0);
});

test('inspectImages: giữ kiểm tra đồng bộ, đuôi ảnh gốc lấy từ nội dung (không từ tên file client)', async () => {
  const file = (buffer, mimetype, originalname) => ({ buffer, mimetype, originalname, size: buffer.length });
  assert.deepEqual(await media.inspectImages([file(png, 'image/png', 'a.png'), file(jpeg, 'image/jpeg', 'b.JPEG')]),
    [{ buffer: png, ext: 'png' }, { buffer: jpeg, ext: 'jpg' }]);
  await assert.rejects(media.inspectImages(Array.from({ length: 6 }, () => file(png, 'image/png', 'a.png'))), e => e.code === 'REVIEW_TOO_MANY_IMAGES');
  await assert.rejects(media.inspectImages([file(Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png', 'a.png')]), e => e.status === 413);
  await assert.rejects(media.inspectImages([file(png, 'image/jpeg', 'a.png')]), e => e.status === 415);
  await assert.rejects(media.inspectImages([file(png, 'image/png', 'a.exe')]), e => e.status === 415);
});

test('inspectImages: đọc header bằng sharp().metadata() -> vượt 4096×4096 điểm ảnh hoặc header hỏng bị từ chối 415', async () => {
  const huge = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: '#000000' } }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(huge.length < 2 * 1024 * 1024, 'ảnh thử nhỏ hơn 2MB để chỉ vướng giới hạn điểm ảnh');
  await assert.rejects(media.inspectImages([{ buffer: huge, mimetype: 'image/png', originalname: 'h.png' }]),
    e => e.status === 415 && e.code === 'REVIEW_INVALID_IMAGE' && e.message === 'Không xử lý được ảnh tải lên');
  const broken = Buffer.concat([png.subarray(0, 16), Buffer.alloc(40)]);
  await assert.rejects(media.inspectImages([{ buffer: broken, mimetype: 'image/png', originalname: 'x.png' }]), e => e.status === 415);
});

test('nơi lưu: ảnh gốc pending/<hex>.<đuôi> cùng hex với URL cuối; remove() xoá cả ảnh cuối lẫn ảnh gốc', async () => {
  const saved = await media.storage.savePending(jpeg, 'jpg');
  const hex = saved.url.slice('/review-images/'.length, -'.webp'.length);
  assert.match(hex, /^[0-9a-f]{32}$/);
  assert.equal(saved.source, hex + '.jpg');
  assert.deepEqual(await list(pendingDir), [hex + '.jpg']);
  assert.deepEqual(await media.storage.readPending(saved.source), jpeg, 'đọc trọn file vào buffer');
  await media.storage.saveFinal(hex, Buffer.from('webp'));
  await media.storage.remove([saved.url]);
  assert.deepEqual([await list(pendingDir), await list(finalDir)], [[], []]);
  await assert.rejects(media.storage.savePending(jpeg, 'gif'), /không hợp lệ/);
  await assert.rejects(media.storage.readPending('../x.png'), /không hợp lệ/);
  await assert.rejects(media.storage.saveFinal('../' + HEX, Buffer.from('x')), /không hợp lệ/);
  assert.equal(media.hexOf('/review-images/../' + HEX + '.webp'), null);
  assert.equal(media.parseSource(HEX + '.jpeg'), null);
});

test('thư mục ảnh gốc mặc định là uploads/reviews-pending, KHÔNG nằm dưới thư mục được phục vụ tĩnh', () => {
  assert.equal(media.PENDING_DIR, path.join(__dirname, '..', 'uploads', 'reviews-pending'));
  assert.equal(media.createStorage().pendingDirectory, media.PENDING_DIR);
  const server = require('node:fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /reviews-pending|PENDING_DIR/);
  assert.match(server, /app\.use\('\/review-images', express\.static\(require\('\.\/lib\/review-media'\)\.REVIEW_DIR,/);
});
