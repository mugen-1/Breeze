'use strict';
const {sql}=require('../db');
const {parseId}=require('./review-create');
const {ReviewError}=require('./review-media');
const imageUrl=/^\/review-images\/[a-f0-9]{32}\.webp$/;
function parseReviewQuery(query={}) {
  const page=query.page===undefined?1:parseId(query.page,1);
  const limit=query.limit===undefined?10:parseId(query.limit,1);
  const rating=query.rating===undefined?null:parseId(query.rating,1);
  if(page===null||limit===null||limit>100||rating!==null&&rating>5||query.rating!==undefined&&rating===null||
    query.hasImages!==undefined&&!['true','false'].includes(query.hasImages)) {
    throw new ReviewError(400,'REVIEW_INVALID_QUERY','Bộ lọc hoặc phân trang đánh giá không hợp lệ');
  }
  return {page,limit,rating,hasImages:query.hasImages==='true'};
}
// Only fixed SQL fragments are composed here; all request values are parameters.
const visible='r.product_id=@pid AND r.is_hidden=0';
const filtered=visible+` AND (@rating IS NULL OR r.rating=@rating)
  AND (@hasImages=0 OR EXISTS(SELECT 1 FROM dbo.review_images i WHERE i.review_id=r.id))`;
const LIST_SQL=`
  SELECT id FROM dbo.products WHERE id=@pid AND is_active=1;
  IF @@ROWCOUNT=0 RETURN;
  SELECT AVG(CAST(r.rating AS DECIMAL(10,4))) AS average_rating,COUNT(*) AS total_reviews,
    COALESCE(SUM(CASE WHEN r.rating=1 THEN 1 ELSE 0 END),0) AS rating_1,
    COALESCE(SUM(CASE WHEN r.rating=2 THEN 1 ELSE 0 END),0) AS rating_2,
    COALESCE(SUM(CASE WHEN r.rating=3 THEN 1 ELSE 0 END),0) AS rating_3,
    COALESCE(SUM(CASE WHEN r.rating=4 THEN 1 ELSE 0 END),0) AS rating_4,
    COALESCE(SUM(CASE WHEN r.rating=5 THEN 1 ELSE 0 END),0) AS rating_5,
    COALESCE(SUM(COALESCE(image.has_image,0)),0) AS reviews_with_images
  FROM dbo.reviews r OUTER APPLY
    (SELECT TOP(1) 1 AS has_image FROM dbo.review_images i WHERE i.review_id=r.id) image
  WHERE ${visible};
  DECLARE @total INT=(SELECT COUNT(*) FROM dbo.reviews r WHERE ${filtered});
  DECLARE @pages INT=CEILING(@total/CAST(@limit AS FLOAT));
  DECLARE @actualPage INT=CASE WHEN @total=0 THEN 1 WHEN @page>@pages THEN @pages ELSE @page END;
  SELECT @total AS total,@actualPage AS page;
  DECLARE @selected TABLE(id INT PRIMARY KEY);
  INSERT INTO @selected(id) SELECT r.id FROM dbo.reviews r WHERE ${filtered}
    ORDER BY r.created_at DESC,r.id DESC OFFSET ((@actualPage-1)*@limit) ROWS FETCH NEXT @limit ROWS ONLY;
  SELECT r.id,r.rating,r.comment,r.created_at,r.updated_at,r.variant_id,r.size_snapshot,r.color_snapshot,u.display_name
    FROM @selected p JOIN dbo.reviews r ON r.id=p.id LEFT JOIN dbo.users u ON u.id=r.user_id
    WHERE ${visible} ORDER BY r.created_at DESC,r.id DESC;
  SELECT i.review_id,i.image_path,i.sort_order FROM dbo.review_images i
    JOIN @selected p ON p.id=i.review_id JOIN dbo.reviews r ON r.id=p.id
    WHERE ${visible} ORDER BY i.review_id,i.sort_order,i.id;`;
async function getPublicReviews(pool,productId,options) {
  const {page,limit,rating,hasImages}=options;
  const {recordsets}=await pool.request().input('pid',sql.Int,productId).input('page',sql.Int,page)
    .input('limit',sql.Int,limit).input('rating',sql.TinyInt,rating).input('hasImages',sql.Bit,hasImages).query(LIST_SQL);
  if(!recordsets[0].length)throw new ReviewError(404,'REVIEW_PRODUCT_NOT_FOUND','Không tìm thấy sản phẩm');
  const [,[summary],[meta],rows,images]=recordsets;
  const grouped=new Map();
  for(const image of images){
    if(!imageUrl.test(image.image_path))continue;
    if(!grouped.has(image.review_id))grouped.set(image.review_id,[]);
    const list=grouped.get(image.review_id);if(list.length<5)list.push({url:image.image_path});
  }
  return {reviews:rows.map(row=>({id:row.id,productId,rating:row.rating,comment:row.comment,
    displayName:row.display_name?.trim()||null,variant:{id:row.variant_id,size:row.size_snapshot,color:row.color_snapshot},
    images:grouped.get(row.id)||[],createdAt:row.created_at,updatedAt:row.updated_at})),
    summary:{averageRating:summary.average_rating==null?null:Math.round(summary.average_rating*10)/10,
      totalReviews:summary.total_reviews,ratingCounts:Object.fromEntries([1,2,3,4,5].map(n=>[String(n),summary['rating_'+n]])),
      reviewsWithImages:summary.reviews_with_images},
    page:meta.page,limit,total:meta.total,totalPages:Math.ceil(meta.total/limit)};
}
module.exports={parseReviewQuery,getPublicReviews};
