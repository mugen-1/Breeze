'use strict';
/* Job review_image.process: chuyển ảnh gốc của đánh giá (uploads/reviews-pending/<32hex>.<jpg|png|webp>)
   thành /review-images/<32hex>.webp rồi đánh dấu review_images.status = 'ready'.
   Payload: { imageId, source } do server sinh (lib/review-create.js), không chứa nội dung ảnh.

   Chạy lại an toàn (job có thể chạy lại sau khi worker chết hoặc bị nhận lại):
   - UPDATE luôn kèm WHERE status = 'pending'; ảnh đã ready/failed thì chỉ dọn ảnh gốc rồi xong.
   - File cuối ghi đè cùng tên (rename nguyên tử), nên lần thử sau thay file của lần trước.
   - Ảnh hoặc đánh giá đã bị xoá (0 dòng) -> xoá file vừa ghi + ảnh gốc, job xong, không thử lại.
   - Ảnh gốc không còn trên đĩa mà dòng vẫn pending -> ảnh 'failed', job xong (không thử lại).
   - Lỗi ở lần thử cuối -> ảnh 'failed' + xoá ảnh gốc, rồi ném lỗi để hàng đợi ghi job 'failed'.
     Worker chết ngay ở lần cuối (claim tự chuyển job 'failed', không qua handler) -> việc bảo trì
     sweepFailedImages (worker chạy mỗi giờ) đánh dấu ảnh 'failed' và xoá ảnh gốc.

   Giới hạn đã biết: process chết giữa lúc request ghi ảnh gốc và lúc transaction của request commit
   thì file trong uploads/reviews-pending/ không có dòng nào trỏ tới (rollback không kịp chạy) và
   không có gì dọn nó — cùng giới hạn với uploads/reviews/ ở đường xử lý đồng bộ. */
const { sql } = require('../../../db');
const media = require('../../review-media');

const IMAGE_JOB = 'review_image.process';

function parsePayload(payload) {
  const imageId = payload && payload.imageId;
  const parsed = media.parseSource(payload && payload.source);
  if (!Number.isInteger(imageId) || imageId < 1 || imageId > 2147483647 || !parsed) throw new Error('Payload job ảnh không hợp lệ');
  return { imageId, source: payload.source, hex: parsed.hex };
}
async function readImage(pool, imageId) {
  return (await pool.request().input('id', sql.Int, imageId)
    .query('SELECT id, image_path, status FROM dbo.review_images WHERE id = @id;')).recordset[0] || null;
}
async function markFailed(pool, imageId) {
  await pool.request().input('id', sql.Int, imageId)
    .query("UPDATE dbo.review_images SET status = 'failed' WHERE id = @id AND status = 'pending';");
}
// Dọn file theo trạng thái hiện tại của dòng: chỉ ảnh 'ready' mới giữ file WebP cuối.
async function cleanup(pool, storage, { imageId, source, hex }) {
  const row = await readImage(pool, imageId);
  if (!row || row.status !== 'ready') await storage.removeFinal(hex);
  await storage.removePending(source);
}

async function run(job, pool, storage, target) {
  const row = await readImage(pool, target.imageId);
  if (!row) return cleanup(pool, storage, target);                       // ảnh/đánh giá đã bị xoá
  if (media.hexOf(row.image_path) !== target.hex) throw new Error('Payload job không khớp ảnh ' + target.imageId);
  if (row.status !== 'pending') return storage.removePending(target.source); // lần chạy trước đã xong
  let original;
  try { original = await storage.readPending(target.source); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await markFailed(pool, target.imageId);                               // ảnh gốc đã mất: không thể xử lý
    return cleanup(pool, storage, target);
  }
  const webp = await media.processImage(original);
  await storage.saveFinal(target.hex, webp);
  const updated = await pool.request().input('id', sql.Int, target.imageId)
    .query("UPDATE dbo.review_images SET status = 'ready' WHERE id = @id AND status = 'pending';");
  if (updated.rowsAffected[0] === 1) return storage.removePending(target.source);
  return cleanup(pool, storage, target);                                  // bị xoá/đổi trong lúc xử lý
}

async function processReviewImage(job, { pool }) {
  const storage = media.storage;
  const target = parsePayload(job.payload);
  try {
    await run(job, pool, storage, target);
  } catch (error) {
    if (job.attempts >= job.maxAttempts) {
      // Lần thử cuối: ảnh không bao giờ được xử lý nữa. Lỗi ở đây không che lỗi gốc; ảnh còn
      // pending thì việc bảo trì sẽ xử lý.
      try { await markFailed(pool, target.imageId); await cleanup(pool, storage, target); }
      catch (cleanupError) { console.error('[jobs] đánh dấu ảnh failed lỗi:', cleanupError.code || cleanupError.message); }
    }
    throw error;
  }
}

// Việc bảo trì: ảnh pending có job tương ứng đã failed (và không còn job queued/running nào cho
// ảnh đó) -> 'failed' + xoá ảnh gốc (và file cuối nếu lỡ ghi). WHERE status = 'pending' nên chạy lại an toàn.
const SWEEP_SQL = `
  DECLARE @swept TABLE (id INT, image_path NVARCHAR(500));
  UPDATE i SET status = 'failed'
  OUTPUT INSERTED.id, INSERTED.image_path INTO @swept
  FROM dbo.review_images i
  WHERE i.status = 'pending'
    AND EXISTS (SELECT 1 FROM dbo.jobs j WHERE j.type = '${IMAGE_JOB}' AND j.status = 'failed'
                AND TRY_CONVERT(INT, JSON_VALUE(j.payload, '$.imageId')) = i.id)
    AND NOT EXISTS (SELECT 1 FROM dbo.jobs j WHERE j.type = '${IMAGE_JOB}' AND j.status IN ('queued', 'running')
                AND TRY_CONVERT(INT, JSON_VALUE(j.payload, '$.imageId')) = i.id);
  SELECT id, image_path FROM @swept;`;

async function sweepFailedImages(pool) {
  const rows = (await pool.request().query(SWEEP_SQL)).recordset;
  if (rows.length) await media.storage.remove(rows.map(row => row.image_path));
  return rows.length;
}

module.exports = { IMAGE_JOB, processReviewImage, sweepFailedImages, SWEEP_SQL };
