'use strict';
const { sql } = require('../db');
const { getPurchasedProductVariants } = require('./review-eligibility');
const { ReviewError } = require('./review-media');
const { commitHook } = require('./commit-hook');
const jobsQueue = require('./jobs/queue');
const IMAGE_JOB = 'review_image.process';
// JOBS_MODE=async: dòng ảnh 'pending' + ảnh gốc trên đĩa; id lấy qua OUTPUT ... INTO để không vỡ
// nếu sau này review_images có trigger. sync: ảnh đã xử lý xong, ghi thẳng 'ready'.
// paths nhận URL NGAY sau khi file được ghi (trước INSERT) để rollback dọn được cả khi INSERT lỗi.
async function insertImage(tx, reviewId, sort, image, storage, mode, paths) {
  if (mode === 'async') {
    const saved = await storage.savePending(image.buffer, image.ext); paths.push(saved.url);
    const id = (await new sql.Request(tx).input('rid', sql.Int, reviewId).input('url', sql.NVarChar(500), saved.url).input('sort', sql.TinyInt, sort)
      .query(`DECLARE @inserted TABLE (id INT);
        INSERT INTO dbo.review_images(review_id,image_path,sort_order,status) OUTPUT INSERTED.id INTO @inserted VALUES(@rid,@url,@sort,'pending');
        SELECT id FROM @inserted;`)).recordset[0].id;
    return { id, url: saved.url, status: 'pending', source: saved.source };
  }
  const url = await storage.save(image); paths.push(url);
  await new sql.Request(tx).input('rid', sql.Int, reviewId).input('url', sql.NVarChar(500), url).input('sort', sql.TinyInt, sort)
    .query("INSERT INTO dbo.review_images(review_id,image_path,sort_order,status) VALUES(@rid,@url,@sort,'ready');");
  return { url, status: 'ready' };
}
// Gọi ở cuối transaction (ngay trước hook audit): job chỉ tồn tại khi dòng ảnh được commit.
// Payload chỉ có id ảnh + tên ảnh gốc do server sinh, không có nội dung ảnh.
async function enqueueImageJobs(tx, images) {
  for (const image of images) {
    if (image.status === 'pending') await jobsQueue.enqueue(tx, { type: IMAGE_JOB, payload: { imageId: image.id, source: image.source } });
  }
}
function parseId(raw, minimum = 0) {
  if (!['string','number'].includes(typeof raw)) return null;
  const value = Number(raw);
  return /^(0|[1-9]\d*)$/.test(String(raw)) && Number.isInteger(value) && value >= minimum && value <= 2147483647 ? value : null;
}
function validateReview(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReviewError(400,'REVIEW_INVALID_INPUT','Dữ liệu đánh giá không hợp lệ');
  if (Object.keys(body).some(key => !['rating','variant_id','comment'].includes(key))) {
    throw new ReviewError(400,'REVIEW_INVALID_INPUT','Dữ liệu đánh giá không hợp lệ');
  }
  if (!['number','string'].includes(typeof body.rating) || !/^[1-5]$/.test(String(body.rating))) {
    throw new ReviewError(400,'REVIEW_INVALID_RATING','Đánh giá phải từ 1 đến 5 sao');
  }
  const variantId = parseId(body.variant_id,1);
  if (variantId === null) throw new ReviewError(400,'REVIEW_INVALID_VARIANT','Phân loại đã mua không hợp lệ');
  if (body.comment != null && typeof body.comment !== 'string') throw new ReviewError(400,'REVIEW_INVALID_COMMENT','Bình luận không hợp lệ');
  const comment = body.comment == null ? null : body.comment.trim() || null;
  if (comment && comment.length > 1000) throw new ReviewError(400,'REVIEW_INVALID_COMMENT','Bình luận tối đa 1000 ký tự');
  return { rating:Number(body.rating),variantId,comment };
}
// onCommitting (lib/commit-hook.js): gọi sau khi ghi review + ảnh, ngay trước commit; tạo mới nên ctx = {}.
// Lỗi của hook được ném lại nguyên văn (không đổi thành REVIEW_ALREADY_EXISTS dù mang number 2601/2627).
// mode: 'sync' (images = buffer WebP đã xử lý) | 'async' (images = { buffer gốc, ext } từ inspectImages).
async function createReview(pool, {userId,productId,data,images,storage,onCommitting,mode='sync'}) {
  const hook = commitHook({ onCommitting });
  const tx = new sql.Transaction(pool), paths = [];
  let committed = false, hookError = null;
  try {
    await tx.begin();
    // Serialize this user's creates and keep account deletion from removing the author mid-insert.
    const author = await new sql.Request(tx).input('uid',sql.Int,userId)
      .query('SELECT id FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE id=@uid;');
    if (!author.recordset.length) throw new ReviewError(401,'REVIEW_AUTH_REQUIRED','Vui lòng đăng nhập để đánh giá');
    const product = await new sql.Request(tx).input('pid',sql.Int,productId)
      .query('SELECT id FROM dbo.products WITH (HOLDLOCK) WHERE id=@pid AND is_active=1;');
    if (!product.recordset.length) throw new ReviewError(404,'REVIEW_PRODUCT_NOT_FOUND','Không tìm thấy sản phẩm');
    const existing = await new sql.Request(tx).input('uid',sql.Int,userId).input('pid',sql.Int,productId)
      .query('SELECT id FROM dbo.reviews WHERE user_id=@uid AND product_id=@pid;');
    if (existing.recordset.length) throw new ReviewError(409,'REVIEW_ALREADY_EXISTS','Bạn đã đánh giá sản phẩm này');
    const purchased = await getPurchasedProductVariants({request:()=>new sql.Request(tx)},userId,productId,true);
    if (!purchased.length) throw new ReviewError(403,'REVIEW_NOT_ELIGIBLE','Bạn không thể đánh giá nếu chưa từng mua');
    const variant = purchased.find(item => item.variant_id === data.variantId);
    if (!variant) throw new ReviewError(400,'REVIEW_INVALID_VARIANT','Phân loại không thuộc sản phẩm đã mua');
    const row = (await new sql.Request(tx).input('uid',sql.Int,userId).input('pid',sql.Int,productId)
      .input('vid',sql.Int,variant.variant_id).input('item',sql.Int,variant.order_item_id)
      .input('size',sql.NVarChar(40),variant.size_snapshot).input('color',sql.NVarChar(80),variant.color_snapshot)
      .input('rating',sql.TinyInt,data.rating).input('comment',sql.NVarChar(1000),data.comment)
      .query(`INSERT INTO dbo.reviews(user_id,product_id,variant_id,order_item_id,size_snapshot,color_snapshot,rating,comment)
        OUTPUT INSERTED.id,INSERTED.rating,INSERTED.comment,INSERTED.created_at,INSERTED.updated_at
        VALUES(@uid,@pid,@vid,@item,@size,@color,@rating,@comment);`)).recordset[0];
    const saved = [];
    for (const [sort,image] of images.entries()) {
      // Ghi file trước rồi mới chèn dòng; paths giữ URL để rollback dọn cả ảnh cuối lẫn ảnh gốc.
      saved.push(await insertImage(tx, row.id, sort, image, storage, mode, paths));
    }
    await enqueueImageJobs(tx, saved);
    const result = {id:row.id,productId,rating:row.rating,comment:row.comment,
      variant:{id:variant.variant_id,orderItemId:variant.order_item_id,size:variant.size_snapshot,color:variant.color_snapshot},
      images:saved.map(({url,status})=>({url,status})),createdAt:row.created_at,updatedAt:row.updated_at};
    if (hook) { try { await hook(tx, result, {}); } catch (error) { hookError = error; throw error; } }
    await tx.commit(); committed = true;
    return result;
  } catch (error) {
    if (!committed) {
      try { await tx.rollback(); } catch (_) { /* may already be rolled back by SQL */ }
      await storage.remove(paths);
    }
    if (error !== hookError && [2601,2627].includes(error.number)) throw new ReviewError(409,'REVIEW_ALREADY_EXISTS','Bạn đã đánh giá sản phẩm này');
    throw error;
  }
}
module.exports = { parseId, validateReview, createReview, insertImage, enqueueImageJobs };
