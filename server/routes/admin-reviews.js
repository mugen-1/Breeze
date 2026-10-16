'use strict';
// Mounted after the Admin router's Firebase and role middleware.
const router = require('express').Router();
const { getPool } = require('../db');
const { parseId } = require('../lib/review-create');
const { ReviewError } = require('../lib/review-media');
const { parseAdminQuery, visibilityInput, listAdminReviews, adminReviewDetail, setReviewVisibility } = require('../lib/review-admin');
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
function handle(action) {
  return async (req, res) => {
    try { res.json(await action(req)); }
    catch (error) {
      if (error instanceof ReviewError) return res.status(error.status).json({ status: 'error', code: error.code, message: error.message });
      console.error('[admin-reviews] request failed:', error.code || 'server-error');
      res.status(500).json({ status: 'error', code: 'REVIEW_ADMIN_ERROR', message: 'Không xử lý được đánh giá. Vui lòng thử lại' });
    }
  };
}
function id(req) {
  const value = parseId(req.params.reviewId, 1);
  if (value === null) throw new ReviewError(400, 'REVIEW_INVALID_INPUT', 'Mã đánh giá không hợp lệ');
  return value;
}
router.get('/', handle(async req => { const options = parseAdminQuery(req.query); return listAdminReviews(await getPool(), options); }));
router.get('/:reviewId', handle(async req => { const rid = id(req); return adminReviewDetail(await getPool(), rid); }));
router.patch('/:reviewId/visibility', handle(async req => {
  const rid = id(req), hidden = visibilityInput(req.body);
  return setReviewVisibility(await getPool(), rid, hidden);
}));
module.exports = router;
