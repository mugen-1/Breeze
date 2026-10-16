'use strict';
const { sql } = require('../db');
const { getPurchasedProductVariants } = require('./review-eligibility');
const { ReviewError } = require('./review-media');
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
async function createReview(pool, {userId,productId,data,images,storage}) {
  const tx = new sql.Transaction(pool), paths = [];
  let committed = false;
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
    for (const [sort,buffer] of images.entries()) {
      const url = await storage.save(buffer); paths.push(url);
      await new sql.Request(tx).input('rid',sql.Int,row.id).input('url',sql.NVarChar(500),url).input('sort',sql.TinyInt,sort)
        .query('INSERT INTO dbo.review_images(review_id,image_path,sort_order) VALUES(@rid,@url,@sort);');
    }
    await tx.commit(); committed = true;
    return {id:row.id,productId,rating:row.rating,comment:row.comment,
      variant:{id:variant.variant_id,orderItemId:variant.order_item_id,size:variant.size_snapshot,color:variant.color_snapshot},
      images:paths.map(url=>({url})),createdAt:row.created_at,updatedAt:row.updated_at};
  } catch (error) {
    if (!committed) {
      try { await tx.rollback(); } catch (_) { /* may already be rolled back by SQL */ }
      await storage.remove(paths);
    }
    if ([2601,2627].includes(error.number)) throw new ReviewError(409,'REVIEW_ALREADY_EXISTS','Bạn đã đánh giá sản phẩm này');
    throw error;
  }
}
module.exports = { parseId, validateReview, createReview };
