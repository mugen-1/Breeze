'use strict';
// Bảng handler theo type: { '<type>': async (job, { pool, workerId }) => {...} }.
// Handler chạy xong không ném lỗi = job done; ném lỗi = job thử lại theo backoff (lib/jobs/queue.js).
// Type có trong JOB_TYPES nhưng chưa có ở đây thì worker ghi lỗi và xử lý như một lần thất bại.
//
// MAINTENANCE: việc bảo trì worker chạy cùng lượt xoá job cũ (mỗi giờ), cả trong server lẫn
// server/worker.js. Mỗi việc: { name, run: async (pool) => số dòng đã xử lý }; lỗi chỉ ghi log.
const reviewImage = require('./review-image');
const statsDay = require('./stats-day');
const { STATS_JOB, clearFailedDays } = require('../../stats-snapshot');

module.exports = {
  HANDLERS: Object.freeze({
    [reviewImage.IMAGE_JOB]: reviewImage.processReviewImage,
    [STATS_JOB]: statsDay.processStatsDay,
  }),
  MAINTENANCE: Object.freeze([
    Object.freeze({ name: 'review-image-sweep', run: reviewImage.sweepFailedImages }),
    Object.freeze({ name: 'stats-failed-cleanup', run: clearFailedDays }),
    Object.freeze({ name: 'stats-nightly-reconcile', run: statsDay.createNightlyReconcile() }),
  ]),
};
