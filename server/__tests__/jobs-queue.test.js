'use strict';

// lib/jobs/queue.js với SQL giả: kiểm kiểm tra đầu vào (trước khi chạm SQL), tham số truyền xuống,
// và các gợi ý khoá bắt buộc trong câu lệnh. Hành vi thật (đồng thời, backoff, khoá hết hạn,
// chống trùng, rollback): scripts/verify-jobs-sql.js trên SQL Server thật.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const realSql = require('mssql');

let calls, nextResult;
class Request {
  constructor(tx) { this.tx = tx; this.params = {}; }
  input(name, type, value) { this.params[name] = { type, value }; return this; }
  async query(text) {
    calls.push({ tx: this.tx, params: this.params, text: text.replace(/\s+/g, ' ').trim() });
    const result = typeof nextResult === 'function' ? nextResult(calls[calls.length - 1]) : nextResult;
    if (result instanceof Error) throw result;
    return result;
  }
}
const pool = { request: () => new Request(null) };
require.cache[require.resolve('../db')] = { exports: { sql: { ...realSql, Request }, getPool: async () => pool } };
const queue = require('../lib/jobs/queue');

const rs = (recordset = [], affected = recordset.length) => ({ recordset, recordsets: [recordset], rowsAffected: [affected] });
const tx = { kind: 'transaction' };
const job = { id: 42, type: 'stats.recompute_day', payload: { day: '2026-11-20' }, attempts: 1, maxAttempts: 5, lockedBy: 'w-1' };
beforeEach(() => { calls = []; nextResult = rs([{ id: '7' }]); });

test('enqueue chạy trong transaction được truyền vào, trả id dạng số', async () => {
  const r = await queue.enqueue(tx, { type: 'stats.recompute_day', payload: { day: '2026-11-20' } });
  assert.deepEqual(r, { id: 7, enqueued: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tx, tx, 'phải dùng new sql.Request(tx), không dùng pool');
  assert.equal(calls[0].params.payload.value, '{"day":"2026-11-20"}');
  assert.equal(calls[0].params.maxAttempts.value, 5);
  assert.equal(calls[0].params.delayMs.value, 0);
  assert.equal(calls[0].params.dedupe.value, null);
  assert.match(calls[0].text, /OUTPUT INSERTED\.id INTO @inserted/);
  assert.match(calls[0].text, /DATEADD\(MILLISECOND, @delayMs, SYSUTCDATETIME\(\)\)/);
});

test('enqueue kiểm tra chống trùng bằng UPDLOCK + HOLDLOCK trên đúng UX_jobs_dedupe, chỉ job queued', async () => {
  await queue.enqueue(tx, { type: 'stats.recompute_day', payload: {}, dedupeKey: 'stats:2026-11-20' });
  assert.equal(calls[0].params.dedupe.value, 'stats:2026-11-20');
  assert.match(calls[0].text, /FROM dbo\.jobs WITH \(UPDLOCK, HOLDLOCK, INDEX\(UX_jobs_dedupe\)\) WHERE dedupe_key = @dedupe AND status = 'queued'/);
});

test('enqueue: đã có job queued cùng khoá -> enqueued:false, không lỗi', async () => {
  nextResult = rs([{ id: null }]);
  assert.deepEqual(await queue.enqueue(tx, { type: 'stats.recompute_day', payload: {}, dedupeKey: 'k' }), { id: null, enqueued: false });
});

test('enqueue: lỗi trùng khoá 2601/2627 khi có dedupeKey -> enqueued:false; không có dedupeKey thì ném lại', async () => {
  for (const number of [2601, 2627]) {
    nextResult = Object.assign(new Error('duplicate'), { number });
    assert.deepEqual(await queue.enqueue(tx, { type: 'stats.recompute_day', payload: {}, dedupeKey: 'k' }), { id: null, enqueued: false });
    await assert.rejects(queue.enqueue(tx, { type: 'stats.recompute_day', payload: {} }), /duplicate/);
  }
  nextResult = Object.assign(new Error('other'), { number: 547 });
  await assert.rejects(queue.enqueue(tx, { type: 'stats.recompute_day', payload: {}, dedupeKey: 'k' }), /other/);
});

test('enqueue từ chối đầu vào sai TRƯỚC khi chạm SQL', async () => {
  const bad = [
    [null, { type: 'stats.recompute_day', payload: {} }],
    [tx, { type: 'unknown.type', payload: {} }],
    [tx, { type: 'Stats.Recompute_Day', payload: {} }],
    [tx, { type: 'stats.recompute_day', payload: null }],
    [tx, { type: 'stats.recompute_day', payload: 'chuỗi' }],
    [tx, { type: 'stats.recompute_day', payload: 5 }],
    [tx, { type: 'stats.recompute_day', payload: { text: 'x'.repeat(2000) } }],
    [tx, { type: 'stats.recompute_day', payload: {}, dedupeKey: '' }],
    [tx, { type: 'stats.recompute_day', payload: {}, dedupeKey: 'có dấu' }],
    [tx, { type: 'stats.recompute_day', payload: {}, dedupeKey: 'k'.repeat(101) }],
    [tx, { type: 'stats.recompute_day', payload: {}, maxAttempts: 0 }],
    [tx, { type: 'stats.recompute_day', payload: {}, maxAttempts: 11 }],
    [tx, { type: 'stats.recompute_day', payload: {}, maxAttempts: 2.5 }],
    [tx, { type: 'stats.recompute_day', payload: {}, delayMs: -1 }],
  ];
  for (const [t, opts] of bad) await assert.rejects(queue.enqueue(t, opts), queue.JobInputError, JSON.stringify(opts));
  assert.equal(calls.length, 0);
  // Biên hợp lệ: payload đúng 2000 ký tự, khoá 100 ký tự, 10 lượt.
  await queue.enqueue(tx, { type: 'review_image.process', payload: { t: 'x'.repeat(1992) }, dedupeKey: 'k'.repeat(100), maxAttempts: 10 });
  assert.equal(calls[0].params.payload.value.length, 2000);
});

test('JOB_TYPES cố định, không sửa được lúc chạy', () => {
  assert.deepEqual([...queue.JOB_TYPES], ['review_image.process', 'stats.recompute_day']);
  assert.ok(Object.isFrozen(queue.JOB_TYPES));
});

test('claim: nguyên tử với UPDLOCK, READPAST, ROWLOCK + OUTPUT INTO; nhận lại job quá khoá còn lượt', async () => {
  nextResult = rs([{ id: '9', type: 'stats.recompute_day', payload: '{"day":"2026-11-20"}', attempts: 2,
    max_attempts: 5, locked_by: 'w-1', locked_until: new Date(0) }]);
  const claimed = await queue.claim(pool, { workerId: 'w-1', lockMs: 60000 });
  assert.deepEqual(claimed, { id: 9, type: 'stats.recompute_day', payload: { day: '2026-11-20' }, attempts: 2,
    maxAttempts: 5, lockedBy: 'w-1', lockedUntil: new Date(0) });
  const q = calls[0].text;
  assert.equal(calls[0].tx, null);
  // Hai câu nhận riêng: job treo còn lượt trước, rồi (chỉ khi chưa nhận được) job queued tới hạn.
  // Mỗi câu một điều kiện status để đọc theo thứ tự index, không đọc-rồi-sắp-xếp cả tập.
  const picks = [...q.matchAll(/SELECT TOP \(1\) (.*?) FROM dbo\.jobs WITH \(UPDLOCK, READPAST, ROWLOCK\) WHERE (.*?) ORDER BY run_after, id \)/g)];
  assert.equal(picks.length, 2);
  assert.equal(picks[0][2], "status = 'running' AND locked_until < @now AND attempts < max_attempts");
  assert.equal(picks[1][2], "status = 'queued' AND run_after <= @now");
  // Một mốc @now DATETIME2(3) cho cả batch: cùng độ chính xác với cột, nên job vừa ghi luôn nhận được ngay.
  assert.ok(q.startsWith('DECLARE @now DATETIME2(3) = SYSUTCDATETIME();'));
  assert.equal((q.match(/SYSUTCDATETIME\(\)/g) || []).length, 1, 'mọi phép so/ghi khác trong claim dùng @now');
  assert.doesNotMatch(q, /\bOR\b/);
  assert.ok(q.indexOf('WITH stale_job') < q.indexOf('IF NOT EXISTS (SELECT 1 FROM @claimed) BEGIN WITH next_job'));
  const sets = [...q.matchAll(/SET status = 'running', attempts = attempts \+ 1, locked_by = @workerId, locked_until = DATEADD\(MILLISECOND, @lockMs, @now\), updated_at = @now OUTPUT (INSERTED\..*?) INTO @claimed/g)];
  assert.equal(sets.length, 2);
  // UPDATE qua CTE chỉ OUTPUT/SET được cột có trong SELECT của CTE (thiếu là lỗi "Invalid column name").
  for (const [, columns] of picks) {
    const cte = columns.split(',').map(s => s.trim());
    const output = sets[0][1].split(',').map(s => s.trim().replace('INSERTED.', ''));
    for (const column of [...output, 'status', 'attempts', 'locked_by', 'locked_until', 'updated_at']) {
      assert.ok(cte.includes(column), 'CTE thiếu cột ' + column);
    }
  }
  // Job quá khoá đã hết lượt: chuyển failed trước, không nhận lại.
  assert.match(q, /SET status = 'failed'.* WHERE status = 'running' AND locked_until < @now AND attempts >= max_attempts/);
  assert.equal(calls[0].params.workerId.value, 'w-1');
  assert.equal(calls[0].params.lockMs.value, 60000);
});

test('claim: hết job -> null; workerId/lockMs sai bị từ chối trước SQL', async () => {
  nextResult = rs([]);
  assert.equal(await queue.claim(pool, { workerId: 'w-1' }), null);
  assert.equal(calls[0].params.lockMs.value, queue.DEFAULT_LOCK_MS);
  calls = [];
  for (const opts of [{}, { workerId: '' }, { workerId: 'có dấu' }, { workerId: 'w'.repeat(65) }, { workerId: 'w', lockMs: 0 }]) {
    await assert.rejects(queue.claim(pool, opts), queue.JobInputError);
  }
  assert.equal(calls.length, 0);
});

test('complete: chỉ ghi khi vẫn giữ đúng lần nhận (id + running + locked_by + attempts)', async () => {
  nextResult = rs([], 1);
  assert.equal(await queue.complete(pool, job), true);
  assert.match(calls[0].text, /SET status = 'done', locked_by = NULL, locked_until = NULL, finished_at = SYSUTCDATETIME\(\)/);
  assert.match(calls[0].text, /WHERE id = @id AND status = 'running' AND locked_by = @workerId AND attempts = @attempts/);
  assert.deepEqual([calls[0].params.id.value, calls[0].params.workerId.value, calls[0].params.attempts.value], [42, 'w-1', 1]);
  nextResult = rs([], 0);
  assert.equal(await queue.complete(pool, job), false);
});

test('fail: backoff 10s·2^(attempts-1) -> 10s, 20s, 40s, 80s; tham số base đổi được', async () => {
  nextResult = rs([{ status: 'queued' }]);
  const delays = [];
  for (const attempts of [1, 2, 3, 4]) {
    calls = [];
    assert.equal(await queue.fail(pool, { ...job, attempts }, new Error('x')), 'queued');
    delays.push(calls[0].params.delayMs.value);
  }
  assert.deepEqual(delays, [10000, 20000, 40000, 80000]);
  calls = [];
  await queue.fail(pool, { ...job, attempts: 3 }, new Error('x'), { baseDelayMs: 500 });
  assert.equal(calls[0].params.delayMs.value, 2000);
  assert.deepEqual([1, 2, 3].map(n => queue.retryDelayMs(n)), [10000, 20000, 40000]);
});

test('fail: hết lượt -> failed + finished_at; còn lượt -> queued + run_after mới; cùng điều kiện giữ khoá', async () => {
  nextResult = rs([{ status: 'failed' }]);
  assert.equal(await queue.fail(pool, { ...job, attempts: 5 }, new Error('x')), 'failed');
  const q = calls[0].text;
  assert.match(q, /status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END/);
  assert.match(q, /run_after = CASE WHEN attempts >= max_attempts THEN run_after ELSE DATEADD\(MILLISECOND, @delayMs, SYSUTCDATETIME\(\)\) END/);
  assert.match(q, /finished_at = CASE WHEN attempts >= max_attempts THEN SYSUTCDATETIME\(\) ELSE NULL END/);
  assert.match(q, /OUTPUT INSERTED\.status INTO @result WHERE id = @id AND status = 'running' AND locked_by = @workerId AND attempts = @attempts/);
  nextResult = rs([]);
  assert.equal(await queue.fail(pool, job, new Error('x')), null, 'mất khoá -> null');
});

test('fail ghi last_error gọn: tên + thông điệp, bỏ ký tự điều khiển, tối đa 400 ký tự', async () => {
  nextResult = rs([{ status: 'queued' }]);
  await queue.fail(pool, job, Object.assign(new TypeError('dòng 1\ndòng 2\t' + 'x'.repeat(500))));
  const text = calls[0].params.error.value;
  assert.equal(text.length, 400);
  assert.match(text, /^TypeError: dòng 1 dòng 2 x+$/);
  assert.equal(queue.errorText('chuỗi trần'), 'Error: chuỗi trần');
});

test('purgeDone: chỉ xoá job done quá 30 ngày, theo lô tới khi hết; failed không bị xoá', async () => {
  let n = 0;
  nextResult = () => rs([], ++n < 3 ? 1000 : 250);
  assert.equal(await queue.purgeDone(pool), 2250);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].params.days.value, 30);
  assert.match(calls[0].text, /DELETE TOP \(@batch\) FROM dbo\.jobs WHERE status = 'done' AND finished_at < DATEADD\(DAY, -@days, SYSUTCDATETIME\(\)\)/);
  assert.doesNotMatch(calls[0].text, /failed/);
  await assert.rejects(queue.purgeDone(pool, { days: 0 }), queue.JobInputError);
});

test('defaultWorkerId: ASCII, ≤ 64 ký tự, khác nhau giữa hai lần gọi', () => {
  const a = queue.defaultWorkerId(), b = queue.defaultWorkerId();
  assert.match(a, /^[\x21-\x7e]{1,64}$/);
  assert.notEqual(a, b);
});
