'use strict';
/* Job stats.recompute_day: tính lại snapshot thống kê của một ngày giờ Việt Nam (lib/stats-snapshot.js).
   Payload: { day: 'YYYY-MM-DD' }, dedupe_key 'stats:<day>'. Ghi đè trọn ngày nên chạy lại an toàn.
   Lỗi ở lần thử cuối -> xoá snapshot của ngày (lần đọc tự quay về tính trực tiếp), rồi ném lỗi để job failed.

   Việc bảo trì (worker chạy cùng lượt xoá job cũ, mỗi giờ):
   - stats-failed-cleanup: ngày mà job stats MỚI NHẤT đã failed (kể cả do worker chết ở lần thử cuối) ->
     xoá snapshot của ngày đó.
   - stats-nightly-reconcile: từ 02:00 giờ Việt Nam, mỗi process tối đa MỘT lần mỗi ngày (đếm cả lần chạy
     lỗi), đối soát mọi ngày và đưa job cho ngày thiếu/lệch. scripts/stats-backfill.js gọi lại đúng hàm này. */
const stats = require('../../stats-snapshot');

async function processStatsDay(job, { pool }) {
  const day = job.payload && job.payload.day;
  if (!stats.isDay(day)) throw new Error('Payload job thống kê không hợp lệ');
  try {
    await stats.recomputeDay(pool, day);
  } catch (error) {
    if (job.attempts >= job.maxAttempts) {
      try { await stats.deleteDay(pool, day); }
      catch (cleanupError) { console.error('[jobs] xoá snapshot ngày lỗi:', cleanupError.code || cleanupError.message); }
    }
    throw error;
  }
}

const NIGHTLY_HOUR_VN = 2;
// clock/reconcile tiêm được để test. lastDay nhớ trong bộ nhớ của process: khởi động lại thì có thể chạy
// thêm một lần trong ngày — vô hại vì khoá chống trùng theo ngày chặn job trùng đang chờ.
function createNightlyReconcile({ clock = () => new Date(), reconcile = stats.reconcileStats } = {}) {
  let lastDay = null;
  return async function nightlyReconcile(pool) {
    const nowVn = new Date(clock().getTime() + 7 * 60 * 60 * 1000);
    const today = nowVn.toISOString().slice(0, 10);
    if (nowVn.getUTCHours() < NIGHTLY_HOUR_VN || lastDay === today) return 0;
    lastDay = today; // ghi nhận TRƯỚC khi chạy: tối đa một lần mỗi ngày, kể cả khi lần đó lỗi
    return (await reconcile(pool, { apply: true })).enqueued;
  };
}

module.exports = { processStatsDay, createNightlyReconcile, NIGHTLY_HOUR_VN };
