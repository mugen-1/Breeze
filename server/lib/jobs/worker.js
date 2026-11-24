'use strict';
// Worker xử lý dbo.jobs, cùng mẫu startCleanup (lib/support-session.js): setInterval + cờ
// running chống chạy chồng. Mỗi tick nhận và chạy LẦN LƯỢT từng job tới khi hết job sẵn sàng
// (1 job tại một thời điểm), nên poll chỉ quyết định độ trễ khi hàng đợi đang rỗng.
// Nhiều worker (server + server/worker.js) chạy cùng lúc vẫn an toàn: claim là nguyên tử.
const defaultQueue = require('./queue');
const { HANDLERS, MAINTENANCE } = require('./handlers');

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_PURGE_INTERVAL_MS = 60 * 60 * 1000;

// JOBS_WORKER=on|off cho worker chạy TRONG process server. Để trống = off. Giá trị lạ = off
// kèm cảnh báo, để gõ sai không vô tình bật xử lý nền.
function parseWorkerFlag(raw) {
  const value = raw == null ? '' : String(raw).trim().toLowerCase();
  if (value === 'on') return { enabled: true, value, valid: true };
  if (value === '' || value === 'off') return { enabled: false, value: value || 'off', valid: true };
  return { enabled: false, value, valid: false };
}

function startWorker(getPool, options = {}) {
  const {
    handlers = HANDLERS,
    maintenance = MAINTENANCE, // [{ name, run(pool) }] chạy cùng lượt xoá job cũ
    queue = defaultQueue,
    intervalMs = DEFAULT_INTERVAL_MS,
    lockMs = defaultQueue.DEFAULT_LOCK_MS,
    baseDelayMs = defaultQueue.DEFAULT_BASE_DELAY_MS,
    purgeIntervalMs = DEFAULT_PURGE_INTERVAL_MS,
    retentionDays = defaultQueue.DONE_RETENTION_DAYS,
    workerId = defaultQueue.defaultWorkerId(),
    unref = true,          // server: không giữ process sống vì worker; server/worker.js truyền false
    log = console,
  } = options;
  let running = false, stopped = false, current = null, lastPurge = 0;

  function handlerFor(type) {
    return Object.prototype.hasOwnProperty.call(handlers, type) && typeof handlers[type] === 'function' ? handlers[type] : null;
  }

  async function runJob(pool, job) {
    try {
      const handler = handlerFor(job.type);
      if (!handler) throw new Error('Không có handler cho loại job ' + job.type);
      await handler(job, { pool, workerId });
      if (!(await queue.complete(pool, job))) log.warn('[jobs] job ' + job.id + ' đã mất khoá trước khi ghi hoàn tất');
    } catch (error) {
      const state = await queue.fail(pool, job, error, { baseDelayMs });
      log.error('[jobs] job ' + job.id + ' (' + job.type + ') lỗi lần ' + job.attempts + ' -> ' + (state || 'đã mất khoá') +
        ': ' + defaultQueue.errorText(error));
    }
  }

  async function run() {
    try {
      const pool = await getPool();
      if (Date.now() - lastPurge >= purgeIntervalMs) {
        lastPurge = Date.now();
        try {
          const removed = await queue.purgeDone(pool, { days: retentionDays });
          if (removed) log.log('[jobs] đã xoá ' + removed + ' job done quá ' + retentionDays + ' ngày');
        } catch (error) { log.error('[jobs] xoá job cũ lỗi:', error.code || error.message); }
        // Việc bảo trì: mỗi việc độc lập, lỗi chỉ ghi log để không chặn việc sau và việc nhận job.
        for (const step of maintenance) {
          try {
            const count = await step.run(pool);
            if (count) log.log('[jobs] bảo trì ' + step.name + ': ' + count + ' dòng');
          } catch (error) { log.error('[jobs] bảo trì ' + step.name + ' lỗi:', error.code || error.message); }
        }
      }
      while (!stopped) {
        const job = await queue.claim(pool, { workerId, lockMs });
        if (!job) break;
        await runJob(pool, job);
      }
    } catch (error) {
      log.error('[jobs] worker tick lỗi:', error.code || error.message);
    } finally {
      running = false;
    }
  }

  function tick() {
    if (running || stopped) return current;
    running = true;
    current = run();
    return current;
  }

  const timer = setInterval(tick, intervalMs);
  if (unref && timer.unref) timer.unref();
  tick();
  return {
    workerId,
    tick,
    // Dừng êm: không nhận job mới, chờ job đang chạy (nếu có) ghi xong kết quả.
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (current) await current;
    },
  };
}

module.exports = { parseWorkerFlag, startWorker, DEFAULT_INTERVAL_MS, DEFAULT_PURGE_INTERVAL_MS };
