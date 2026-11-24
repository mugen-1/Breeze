'use strict';

// lib/jobs/worker.js với queue giả (không SQL). Hai worker thật song song trên SQL Server:
// scripts/verify-jobs-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWorkerFlag, startWorker } = require('../lib/jobs/worker');
const { HANDLERS, MAINTENANCE } = require('../lib/jobs/handlers');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const quietLog = () => { const lines = []; const push = (...a) => lines.push(a.join(' ')); return { lines, log: push, warn: push, error: push }; };

function fakeQueue(jobs) {
  const q = {
    claims: 0, completed: [], failed: [], purges: 0, pending: [...jobs], completeResult: true,
    async claim(pool, { workerId, lockMs }) { q.claims++; q.lastClaim = { workerId, lockMs }; return q.pending.shift() || null; },
    async complete(pool, job) { q.completed.push(job.id); return q.completeResult; },
    async fail(pool, job, error, opts) { q.failed.push({ id: job.id, message: error.message, opts }); return 'queued'; },
    async purgeDone(pool, opts) { q.purges++; q.purgeOpts = opts; return 0; },
  };
  return q;
}
const job = (id, type = 'stats.recompute_day') => ({ id, type, payload: { id }, attempts: 1, maxAttempts: 5, lockedBy: 'w' });

test('JOBS_WORKER: on bật; off/trống tắt; giá trị lạ tắt và báo không hợp lệ', () => {
  assert.deepEqual(parseWorkerFlag('on'), { enabled: true, value: 'on', valid: true });
  assert.deepEqual(parseWorkerFlag(' ON '), { enabled: true, value: 'on', valid: true });
  assert.deepEqual(parseWorkerFlag('off'), { enabled: false, value: 'off', valid: true });
  assert.deepEqual(parseWorkerFlag(undefined), { enabled: false, value: 'off', valid: true });
  assert.deepEqual(parseWorkerFlag(''), { enabled: false, value: 'off', valid: true });
  for (const v of ['1', 'true', 'yes', 'onn']) assert.deepEqual(parseWorkerFlag(v), { enabled: false, value: v, valid: false });
});

test('chạy ngay khi khởi động, xử lý lần lượt hết job sẵn sàng, mỗi lúc đúng 1 job', async () => {
  const q = fakeQueue([job(1), job(2), job(3)]);
  let active = 0, maxActive = 0; const seen = [];
  const handlers = { 'stats.recompute_day': async j => { maxActive = Math.max(maxActive, ++active); seen.push(j.id); await wait(5); active--; } };
  const w = startWorker(async () => ({}), { queue: q, handlers, intervalMs: 1000, workerId: 'w-test', lockMs: 1234, log: quietLog() });
  await wait(60);
  await w.stop();
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(q.completed, [1, 2, 3]);
  assert.equal(maxActive, 1);
  assert.deepEqual(q.lastClaim, { workerId: 'w-test', lockMs: 1234 });
});

test('handler nhận job và { pool, workerId }', async () => {
  const q = fakeQueue([job(5)]); const pool = { tag: 'pool' }; let args;
  const w = startWorker(async () => pool, { queue: q, handlers: { 'stats.recompute_day': async (...a) => { args = a; } }, workerId: 'w-x', log: quietLog() });
  await wait(20); await w.stop();
  assert.equal(args[0].id, 5);
  assert.deepEqual(args[1], { pool, workerId: 'w-x' });
});

test('không chạy chồng tick: tick mới trong lúc job đang chạy không nhận thêm', async () => {
  const q = fakeQueue([job(1)]); let release;
  const gate = new Promise(r => { release = r; });
  const w = startWorker(async () => ({}), { queue: q, handlers: { 'stats.recompute_day': () => gate }, intervalMs: 5, log: quietLog() });
  await wait(40);
  assert.equal(q.claims, 1, 'đang chạy job thì các interval sau không claim');
  release(); await wait(20); await w.stop();
  assert.deepEqual(q.completed, [1]);
});

test('handler ném lỗi -> fail kèm lỗi và baseDelayMs; type chưa có handler -> fail ghi rõ loại job', async () => {
  const q = fakeQueue([job(1), job(2, 'review_image.process')]); const logger = quietLog();
  const w = startWorker(async () => ({}), { queue: q, handlers: { 'stats.recompute_day': async () => { throw new Error('hỏng'); } },
    baseDelayMs: 777, log: logger });
  await wait(30); await w.stop();
  assert.deepEqual(q.completed, []);
  assert.deepEqual(q.failed.map(f => [f.id, f.message, f.opts.baseDelayMs]), [
    [1, 'hỏng', 777], [2, 'Không có handler cho loại job review_image.process', 777]]);
  assert.ok(logger.lines.some(l => l.includes('job 2 (review_image.process) lỗi lần 1 -> queued')));
});

test('bảng handler mặc định: đủ hai loại job; không dùng thuộc tính kế thừa làm handler', async () => {
  assert.deepEqual(Object.keys(HANDLERS), ['review_image.process', 'stats.recompute_day']);
  assert.equal(HANDLERS['review_image.process'], require('../lib/jobs/handlers/review-image').processReviewImage);
  assert.equal(HANDLERS['stats.recompute_day'], require('../lib/jobs/handlers/stats-day').processStatsDay);
  assert.ok(Object.isFrozen(HANDLERS));
  assert.deepEqual(MAINTENANCE.map(step => step.name), ['review-image-sweep', 'stats-failed-cleanup', 'stats-nightly-reconcile']);
  assert.equal(MAINTENANCE[0].run, require('../lib/jobs/handlers/review-image').sweepFailedImages);
  assert.equal(MAINTENANCE[1].run, require('../lib/stats-snapshot').clearFailedDays);
  assert.ok(Object.isFrozen(MAINTENANCE));
  const q = fakeQueue([job(1, 'toString')]);
  const w = startWorker(async () => ({}), { queue: q, log: quietLog() });
  await wait(20); await w.stop();
  assert.equal(q.failed[0].message, 'Không có handler cho loại job toString');
});

test('complete trả false (mất khoá) -> chỉ cảnh báo, không fail', async () => {
  const q = fakeQueue([job(1)]); q.completeResult = false; const logger = quietLog();
  const w = startWorker(async () => ({}), { queue: q, handlers: { 'stats.recompute_day': async () => {} }, log: logger });
  await wait(20); await w.stop();
  assert.deepEqual(q.failed, []);
  assert.ok(logger.lines.some(l => l.includes('job 1 đã mất khoá')));
});

test('stop(): chờ job đang chạy ghi xong, sau đó không nhận job mới', async () => {
  const q = fakeQueue([job(1), job(2)]); let release, finished = false;
  const gate = new Promise(r => { release = r; });
  const w = startWorker(async () => ({}), { queue: q, intervalMs: 5,
    handlers: { 'stats.recompute_day': async j => { if (j.id === 1) await gate; finished = true; } }, log: quietLog() });
  await wait(20);
  const stopping = w.stop(); let stopped = false; stopping.then(() => { stopped = true; });
  await wait(20);
  assert.equal(stopped, false, 'stop chưa xong khi job còn chạy');
  release(); await stopping;
  assert.ok(finished);
  assert.deepEqual(q.completed, [1], 'job 2 không được nhận sau khi stop');
  const claims = q.claims; await wait(30); assert.equal(q.claims, claims);
});

test('xoá job done: lần đầu chạy ngay, sau đó tối đa một lần mỗi purgeIntervalMs, truyền retentionDays', async () => {
  const q = fakeQueue([]);
  const w = startWorker(async () => ({}), { queue: q, intervalMs: 5, purgeIntervalMs: 60000, retentionDays: 30, log: quietLog() });
  await wait(50); await w.stop();
  assert.equal(q.purges, 1);
  assert.deepEqual(q.purgeOpts, { days: 30 });
  assert.ok(q.claims > 1);
});

test('lỗi khi xoá job cũ không chặn việc nhận job; lỗi getPool được giữ trong tick và tick sau thử lại', async () => {
  const q = fakeQueue([job(1)]); q.purgeDone = async () => { throw new Error('purge'); };
  const w1 = startWorker(async () => ({}), { queue: q, handlers: { 'stats.recompute_day': async () => {} }, log: quietLog() });
  await wait(20); await w1.stop();
  assert.deepEqual(q.completed, [1]);
  let calls = 0; const logger = quietLog();
  const w2 = startWorker(async () => { if (++calls === 1) throw new Error('db down'); return {}; },
    { queue: fakeQueue([]), intervalMs: 5, log: logger });
  await wait(40); await w2.stop();
  assert.ok(calls >= 2);
  assert.ok(logger.lines.some(l => l.includes('worker tick lỗi: db down')));
});

test('việc bảo trì chạy cùng lượt xoá job cũ (một lần mỗi purgeIntervalMs), nhận pool, sau purge', async () => {
  const q = fakeQueue([]); const order = []; const pool = { tag: 'pool' }; const seen = [];
  q.purgeDone = async () => { order.push('purge'); return 0; };
  const maintenance = [
    { name: 'a', run: async p => { order.push('a'); seen.push(p); return 2; } },
    { name: 'b', run: async () => { order.push('b'); return 0; } },
  ];
  const logger = quietLog();
  const w = startWorker(async () => pool, { queue: q, maintenance, intervalMs: 5, purgeIntervalMs: 60000, log: logger });
  await wait(50); await w.stop();
  assert.deepEqual(order, ['purge', 'a', 'b'], 'đúng một lượt, theo thứ tự, dù nhiều tick');
  assert.deepEqual(seen, [pool]);
  assert.ok(logger.lines.some(l => l.includes('bảo trì a: 2 dòng')));
  assert.ok(!logger.lines.some(l => l.includes('bảo trì b')), 'việc không xử lý dòng nào thì không ghi log');
});

test('việc bảo trì lỗi: chỉ ghi log, các việc sau vẫn chạy, worker vẫn nhận job', async () => {
  const q = fakeQueue([job(1)]); const ran = []; const logger = quietLog();
  const maintenance = [
    { name: 'hong', run: async () => { throw Object.assign(new Error('sweep'), { code: 'ETIMEOUT' }); } },
    { name: 'sau', run: async () => { ran.push('sau'); return 0; } },
  ];
  const w = startWorker(async () => ({}), { queue: q, maintenance, handlers: { 'stats.recompute_day': async () => {} }, log: logger });
  await wait(30); await w.stop();
  assert.deepEqual(ran, ['sau']);
  assert.deepEqual(q.completed, [1]);
  assert.ok(logger.lines.some(l => l.includes('bảo trì hong lỗi: ETIMEOUT')));
});

test('mặc định: poll 2s, khoá 60s, backoff 10s, giữ job done 30 ngày', () => {
  const { DEFAULT_INTERVAL_MS } = require('../lib/jobs/worker');
  const queue = require('../lib/jobs/queue');
  assert.equal(DEFAULT_INTERVAL_MS, 2000);
  assert.equal(queue.DEFAULT_LOCK_MS, 60000);
  assert.equal(queue.DEFAULT_BASE_DELAY_MS, 10000);
  assert.equal(queue.DONE_RETENTION_DAYS, 30);
});

test('server.js bật worker theo JOBS_WORKER và dừng khi server đóng; server/worker.js chạy worker không unref', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /parseWorkerFlag\(process\.env\.JOBS_WORKER\)/);
  assert.match(server, /if \(jobsFlag\.enabled\) jobsWorker = startWorker\(/);
  assert.match(server, /httpServer\.on\('close', \(\) => \{[\s\S]*jobsWorker\.stop\(\)/);
  const standalone = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
  assert.match(standalone, /startWorker\(getPool, \{ unref: false \}\)/);
  assert.match(standalone, /process\.on\('SIGINT'/);
  assert.match(standalone, /process\.on\('SIGTERM'/);
});
