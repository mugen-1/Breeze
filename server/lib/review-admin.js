'use strict';
const { sql } = require('../db');
const { parseId } = require('./review-create');
const { ReviewError } = require('./review-media');

function parseAdminQuery(query = {}) {
  const page = query.page === undefined ? 1 : parseId(query.page, 1);
  const limit = query.limit === undefined ? 20 : parseId(query.limit, 1);
  const status = query.status === undefined ? 'all' : query.status;
  if (page === null || limit === null || limit > 100 || !['all', 'visible', 'hidden'].includes(status))
    throw new ReviewError(400, 'REVIEW_INVALID_QUERY', 'Bộ lọc hoặc phân trang đánh giá không hợp lệ');
  return { page, limit, status };
}
function visibilityInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || typeof body.isHidden !== 'boolean')
    throw new ReviewError(400, 'REVIEW_INVALID_INPUT', 'Chỉ nhận trạng thái ẩn đánh giá');
  return body.isHidden;
}
// Same qualifying relation as Backend 1: the review author bought this product
// in a completed order. A snapshot/variant or client flag alone grants nothing.
const verified = `CAST(CASE WHEN EXISTS (
  SELECT 1 FROM dbo.orders o JOIN dbo.order_items oi ON oi.order_id=o.id
  WHERE o.user_id=r.user_id AND o.status='completed' AND oi.product_id=r.product_id
) THEN 1 ELSE 0 END AS BIT) AS verified_purchase`;
const columns = `r.id,r.product_id,r.variant_id,r.size_snapshot,r.color_snapshot,
  r.rating,r.comment,r.is_hidden,r.created_at,r.updated_at,u.display_name,
  p.name_vi,p.name_en,p.images AS product_images,${verified}`;
const joins = `FROM dbo.reviews r LEFT JOIN dbo.users u ON u.id=r.user_id
  JOIN dbo.products p ON p.id=r.product_id`;
const filtered = `(@hidden IS NULL OR r.is_hidden=@hidden)`;
function dto(row) {
  let productImages = [];
  try { const images = JSON.parse(row.product_images); if (Array.isArray(images)) productImages = images; } catch (_) {}
  const image = productImages.find(url => typeof url === 'string' && /^(?:\/)?img\/[a-zA-Z0-9_./-]+$/.test(url) && !url.includes('..'));
  return { id: row.id, user: { displayName: row.display_name?.trim() || null },
    product: { id: row.product_id, name: row.name_vi, nameEn: row.name_en, imageUrl: image || null },
    rating: row.rating, comment: row.comment, verifiedPurchase: !!row.verified_purchase,
    variant: { id: row.variant_id, size: row.size_snapshot, color: row.color_snapshot },
    isHidden: !!row.is_hidden, status: row.is_hidden ? 'hidden' : 'visible',
    createdAt: row.created_at, updatedAt: row.updated_at };
}
async function listAdminReviews(pool, { page, limit, status }) {
  const { recordsets } = await pool.request().input('page', sql.Int, page).input('limit', sql.Int, limit)
    .input('hidden', sql.Bit, status === 'all' ? null : status === 'hidden').query(`
    DECLARE @total INT=(SELECT COUNT(*) FROM dbo.reviews r WHERE ${filtered});
    DECLARE @pages INT=CEILING(@total/CAST(@limit AS FLOAT));
    DECLARE @actualPage INT=CASE WHEN @total=0 THEN 1 WHEN @page>@pages THEN @pages ELSE @page END;
    SELECT @total AS total,@actualPage AS page;
    SELECT ${columns} ${joins} WHERE ${filtered}
      ORDER BY r.created_at DESC,r.id DESC OFFSET ((@actualPage-1)*@limit) ROWS FETCH NEXT @limit ROWS ONLY;`);
  const [meta] = recordsets[0];
  return { page: meta.page, limit, total: meta.total, totalPages: Math.ceil(meta.total / limit), reviews: recordsets[1].map(dto) };
}
async function adminReviewDetail(pool, id) {
  const { recordsets } = await pool.request().input('rid', sql.Int, id).query(`
    SELECT ${columns} ${joins} WHERE r.id=@rid;
    SELECT TOP(5) image_path,sort_order FROM dbo.review_images WHERE review_id=@rid ORDER BY sort_order,id;`);
  if (!recordsets[0].length) throw new ReviewError(404, 'REVIEW_NOT_FOUND', 'Không tìm thấy đánh giá');
  return { ...dto(recordsets[0][0]), images: recordsets[1].filter(i => /^\/review-images\/[a-f0-9]{32}\.webp$/.test(i.image_path)).map(i => ({ url: i.image_path })) };
}
async function setReviewVisibility(pool, id, hidden) {
  // One atomic update serializes with owner edit/delete; no content or image writes.
  const result = await pool.request().input('rid', sql.Int, id).input('hidden', sql.Bit, hidden).query(`
    UPDATE dbo.reviews SET is_hidden=@hidden,updated_at=SYSUTCDATETIME()
    OUTPUT INSERTED.id,INSERTED.is_hidden WHERE id=@rid;`);
  if (!result.recordset.length) throw new ReviewError(404, 'REVIEW_NOT_FOUND', 'Không tìm thấy đánh giá');
  return { id: result.recordset[0].id, isHidden: !!result.recordset[0].is_hidden };
}
module.exports = { parseAdminQuery, visibilityInput, listAdminReviews, adminReviewDetail, setReviewVisibility };
