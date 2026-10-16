'use strict';
const {sql}=require('../db');
const {parseId,validateReview}=require('./review-create');
const {getPurchasedProductVariants}=require('./review-eligibility');
const {ReviewError}=require('./review-media');
const safeImage=/^\/review-images\/[a-f0-9]{32}\.webp$/;
const columns='id,product_id,variant_id,order_item_id,size_snapshot,color_snapshot,rating,comment,created_at,updated_at';
function dto(row,images){
  return {id:row.id,productId:row.product_id,isOwner:true,rating:row.rating,comment:row.comment,
    variant:{id:row.variant_id,orderItemId:row.order_item_id,size:row.size_snapshot,color:row.color_snapshot},
    images:images.filter(image=>safeImage.test(image.image_path)).map(image=>({id:image.id,url:image.image_path})),
    createdAt:row.created_at,updatedAt:row.updated_at};
}
function validateUpdate(body={}){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['rating','comment','variant_id','remove_image_ids'].includes(key)))
    throw new ReviewError(400,'REVIEW_INVALID_INPUT','Dữ liệu đánh giá không hợp lệ');
  const data=validateReview({rating:body.rating,variant_id:body.variant_id,comment:body.comment});
  let remove=body.remove_image_ids===undefined?[]:body.remove_image_ids;
  if(typeof remove==='string'){try{remove=JSON.parse(remove);}catch(_){remove=null;}}
  if(!Array.isArray(remove)||remove.length>5||remove.some(id=>parseId(id,1)===null)||new Set(remove.map(Number)).size!==remove.length)
    throw new ReviewError(400,'REVIEW_INVALID_IMAGES','Danh sách ảnh cần xóa không hợp lệ');
  return {...data,removeIds:remove.map(Number)};
}
async function getOwnerReview(pool,userId,productId){
  const {recordsets}=await pool.request().input('uid',sql.Int,userId).input('pid',sql.Int,productId).query(`
    SELECT id FROM dbo.products WHERE id=@pid AND is_active=1;
    SELECT ${columns} FROM dbo.reviews WHERE user_id=@uid AND product_id=@pid;
    SELECT i.id,i.image_path,i.sort_order FROM dbo.review_images i JOIN dbo.reviews r ON r.id=i.review_id
      WHERE r.user_id=@uid AND r.product_id=@pid ORDER BY i.sort_order,i.id;`);
  if(!recordsets[0].length)throw new ReviewError(404,'REVIEW_PRODUCT_NOT_FOUND','Không tìm thấy sản phẩm');
  return {review:recordsets[1].length?dto(recordsets[1][0],recordsets[2]):null,
    purchasedVariants:await getPurchasedProductVariants(pool,userId,productId)};
}
async function changeOwnerReview(pool,{userId,productId,reviewId,data,images=[],storage,removeReview=false}){
  const tx=new sql.Transaction(pool),newPaths=[];
  let committed=false,oldPaths=[];
  try{
    await tx.begin();
    // Same author-first lock order as Create: concurrent create/edit/delete and account
    // deletion cannot interleave against this owner's review or its image metadata.
    const user=await new sql.Request(tx).input('uid',sql.Int,userId)
      .query('SELECT id FROM dbo.users WITH (UPDLOCK,HOLDLOCK) WHERE id=@uid;');
    if(!user.recordset.length)throw new ReviewError(401,'REVIEW_AUTH_REQUIRED','Vui lòng đăng nhập');
    const row=(await new sql.Request(tx).input('uid',sql.Int,userId).input('pid',sql.Int,productId).input('rid',sql.Int,reviewId)
      .query(`SELECT ${columns} FROM dbo.reviews WITH (UPDLOCK,HOLDLOCK) WHERE id=@rid AND user_id=@uid AND product_id=@pid;`)).recordset[0];
    if(!row)throw new ReviewError(404,'REVIEW_NOT_FOUND','Không tìm thấy đánh giá của bạn');
    const existing=(await new sql.Request(tx).input('rid',sql.Int,reviewId)
      .query('SELECT id,image_path,sort_order FROM dbo.review_images WITH (UPDLOCK,HOLDLOCK) WHERE review_id=@rid ORDER BY sort_order,id;')).recordset;
    if(removeReview){
      await new sql.Request(tx).input('rid',sql.Int,reviewId).input('uid',sql.Int,userId)
        .query('DELETE FROM dbo.reviews WHERE id=@rid AND user_id=@uid;');
      oldPaths=existing.map(image=>image.image_path);
      await tx.commit();committed=true;
      await storage.remove(oldPaths);
      return null;
    }
    const purchased=await getPurchasedProductVariants({request:()=>new sql.Request(tx)},userId,productId,true);
    if(!purchased.length)throw new ReviewError(403,'REVIEW_NOT_ELIGIBLE','Bạn không thể đánh giá nếu chưa từng mua');
    const selected=purchased.find(item=>item.variant_id===data.variantId);
    if(!selected)throw new ReviewError(400,'REVIEW_INVALID_VARIANT','Phân loại không thuộc sản phẩm đã mua');
    if(data.removeIds.some(id=>!existing.some(image=>image.id===id)))throw new ReviewError(400,'REVIEW_INVALID_IMAGES','Ảnh không thuộc đánh giá này');
    const kept=existing.filter(image=>!data.removeIds.includes(image.id));
    if(kept.length+images.length>5)throw new ReviewError(400,'REVIEW_TOO_MANY_IMAGES','Chỉ nhận tối đa 5 ảnh');
    const snapshot=selected.variant_id===row.variant_id?row:selected;
    const updated=(await new sql.Request(tx).input('rid',sql.Int,reviewId).input('uid',sql.Int,userId)
      .input('rating',sql.TinyInt,data.rating).input('comment',sql.NVarChar(1000),data.comment).input('vid',sql.Int,selected.variant_id)
      .input('item',sql.Int,snapshot.order_item_id).input('size',sql.NVarChar(40),snapshot.size_snapshot).input('color',sql.NVarChar(80),snapshot.color_snapshot)
      .query(`UPDATE dbo.reviews SET rating=@rating,comment=@comment,variant_id=@vid,order_item_id=@item,
        size_snapshot=@size,color_snapshot=@color,updated_at=SYSUTCDATETIME()
        OUTPUT INSERTED.id,INSERTED.product_id,INSERTED.variant_id,INSERTED.order_item_id,INSERTED.size_snapshot,
          INSERTED.color_snapshot,INSERTED.rating,INSERTED.comment,INSERTED.created_at,INSERTED.updated_at
        WHERE id=@rid AND user_id=@uid;`)).recordset[0];
    for(const id of data.removeIds)await new sql.Request(tx).input('rid',sql.Int,reviewId).input('image',sql.Int,id)
      .query('DELETE FROM dbo.review_images WHERE id=@image AND review_id=@rid;');
    // Compact ascending old slots after deletion: each target slot is now free, so
    // the unique (review_id,sort_order) constraint remains valid throughout the transaction.
    for(const [sort,image]of kept.entries())if(image.sort_order!==sort)await new sql.Request(tx)
      .input('rid',sql.Int,reviewId).input('image',sql.Int,image.id).input('sort',sql.TinyInt,sort)
      .query('UPDATE dbo.review_images SET sort_order=@sort WHERE id=@image AND review_id=@rid;');
    for(const buffer of images){
      const url=await storage.save(buffer);newPaths.push(url);
      const inserted=(await new sql.Request(tx).input('rid',sql.Int,reviewId).input('url',sql.NVarChar(500),url).input('sort',sql.TinyInt,kept.length)
        .query('INSERT INTO dbo.review_images(review_id,image_path,sort_order) OUTPUT INSERTED.id VALUES(@rid,@url,@sort);')).recordset[0];
      kept.push({id:inserted.id,image_path:url});
    }
    oldPaths=existing.filter(image=>data.removeIds.includes(image.id)).map(image=>image.image_path);
    await tx.commit();committed=true;
    await storage.remove(oldPaths);
    return dto(updated,kept);
  }catch(error){
    if(!committed){try{await tx.rollback();}catch(_){}await storage.remove(newPaths);}
    throw error;
  }
}
module.exports={getOwnerReview,validateUpdate,changeOwnerReview};
