'use strict';

// Handler stats.recompute_day + việc đối soát đêm (lib/jobs/handlers/stats-day.js). Chạy thật: verify-stats-snapshot-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../lib/stats-snapshot');
const { processStatsDay, createNightlyReconcile, NIGHTLY_HOUR_VN } = require('../lib/jobs/handlers/stats-day');

const job = (attempts, payload = { day: '2026-11-20' }) => ({ id: 1, type: 'stats.recompute_day', payload, attempts, maxAttempts: 5 });
function stub(t, recompute) {
  const seen = { recompute: [], deleted: [] };
  t.mock.method(stats, 'recomputeDay', async (pool, day) => { seen.recompute.push(day); if (recompute) await recompute(); });
  t.mock.method(stats, 'deleteDay', async (pool, day) => { seen.deleted.push(day); });
  return seen;
}

test('handler tính lại đúng ngày trong payload', async t => {
  const seen = stub(t);
  await processStatsDay(job(1), { pool: {} });
  assert.deepEqual(seen, { recompute: ['2026-11-20'], deleted: [] });
});

test('payload ngày sai bị từ chối, không tính gì', async t => {
  const seen = stub(t);
  for (const payload of [{}, { day: '2026-02-30' }, { day: '20/11/2026' }, null]) {
    await assert.rejects(processStatsDay(job(5, payload), { pool: {} }), /Payload job thống kê không hợp lệ/);
  }
  assert.deepEqual(seen, { recompute: [], deleted: [] });
});

test('lỗi chưa phải lần cuối: ném lại để thử lại, KHÔNG xoá snapshot', async t => {
  const seen = stub(t, () => { throw new Error('sql'); });
  await assert.rejects(processStatsDay(job(4), { pool: {} }), /sql/);
  assert.deepEqual(seen.deleted, []);
});

test('lỗi ở lần thử cuối: xoá snapshot của ngày (lần đọc tự tính trực tiếp) rồi vẫn ném lỗi gốc', async t => {
  const seen = stub(t, () => { throw new Error('sql'); });
  await assert.rejects(processStatsDay(job(5), { pool: {} }), /sql/);
  assert.deepEqual(seen.deleted, ['2026-11-20']);
});

test('đối soát đêm: chỉ từ 02:00 giờ VN, mỗi ngày tối đa một lần, gọi đúng reconcileStats(apply:true)', async () => {
  assert.equal(NIGHTLY_HOUR_VN, 2);
  let now = new Date('2026-11-23T18:59:59Z'); // 01:59:59 ngày 24 giờ VN
  const calls = [];
  const run = createNightlyReconcile({ clock: () => now, reconcile: async (pool, opts) => { calls.push(opts); return { enqueued: 3 }; } });
  assert.equal(await run({}), 0, 'trước 02:00 giờ VN không chạy');
  now = new Date('2026-11-23T19:00:00Z'); // 02:00 ngày 24 giờ VN
  assert.equal(await run({}), 3);
  now = new Date('2026-11-24T16:59:00Z'); // 23:59 cùng ngày 24
  assert.equal(await run({}), 0, 'đã chạy trong ngày');
  now = new Date('2026-11-24T19:30:00Z'); // 02:30 ngày 25
  assert.equal(await run({}), 3);
  assert.deepEqual(calls, [{ apply: true }, { apply: true }]);
});

test('đối soát đêm lỗi vẫn tính là đã chạy trong ngày (tối đa một lần), lỗi ném ra cho worker ghi log', async () => {
  let attempts = 0;
  const run = createNightlyReconcile({ clock: () => new Date('2026-11-23T20:00:00Z'), reconcile: async () => { attempts++; throw new Error('db'); } });
  await assert.rejects(run({}), /db/);
  assert.equal(await run({}), 0);
  assert.equal(attempts, 1);
});

test('mặc định việc bảo trì dùng đúng reconcileStats của lib (backfill gọi lại cùng hàm)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'jobs', 'handlers', 'stats-day.js'), 'utf8');
  assert.match(src, /reconcile = stats\.reconcileStats/);
  const backfill = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'stats-backfill.js'), 'utf8');
  assert.match(backfill, /reconcileStats\(pool, \{ apply: confirm \}\)/);
  assert.doesNotMatch(backfill, /INSERT INTO|enqueue\(/, 'backfill không có logic ghi riêng');
});
