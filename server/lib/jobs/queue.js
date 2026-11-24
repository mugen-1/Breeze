'use strict';
// Hàng đợi job trên bảng dbo.jobs (migration 026). Thời gian luôn lấy từ SQL Server
// (SYSUTCDATETIME), không lấy đồng hồ Node: nhiều process (server + worker.js) dùng chung
// một mốc nên khoá hết hạn và run_after được so đúng dù đồng hồ các máy lệch nhau.
//
//   enqueue(tx, opts)            ghi job trong transaction của nghiệp vụ (rollback = không có job)
//   claim(pool, { workerId })    nhận nguyên tử 1 job sẵn sàng, gồm cả job running đã quá khoá
//   complete(pool, job)          đánh dấu done (chỉ khi vẫn giữ khoá)
//   fail(pool, job, error)       thử lại sau baseDelayMs·2^(attempts-1), hết lượt thì failed
//   purgeDone(pool)              xoá job done quá DONE_RETENTION_DAYS ngày; failed giữ lại
const os = require('node:os'), crypto = require('node:crypto');
const { sql } = require('../../db');

// Phải khớp CK_jobs_type trong 026_jobs.sql (test so khớp hai danh sách).
const JOB_TYPES = Object.freeze(['review_image.process', 'stats.recompute_day']);
const DEFAULT_MAX_ATTEMPTS = 5, MAX_ATTEMPTS_LIMIT = 10;
const DEFAULT_LOCK_MS = 60000, DEFAULT_BASE_DELAY_MS = 10000;
const DONE_RETENTION_DAYS = 30, PURGE_BATCH = 1000;
const PAYLOAD_MAX = 2000, ERROR_MAX = 400, WORKER_ID_MAX = 64;
const MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const DEDUPE_PATTERN = /^[\x21-\x7e]{1,100}$/; // VARCHAR(100): ASCII in được, không khoảng trắng
const DUPLICATE_KEY = [2601, 2627];

class JobInputError extends Error {}

function isInt(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }

function normalizeEnqueue(opts) {
  const { type, payload = {}, dedupeKey = null, delayMs = 0, maxAttempts = DEFAULT_MAX_ATTEMPTS } = opts || {};
  if (!JOB_TYPES.includes(type)) throw new JobInputError('Loại job không hợp lệ');
  if (payload === null || typeof payload !== 'object') throw new JobInputError('payload phải là object hoặc mảng JSON');
  const json = JSON.stringify(payload);
  if (typeof json !== 'string' || json.length > PAYLOAD_MAX) throw new JobInputError('payload quá ' + PAYLOAD_MAX + ' ký tự');
  if (dedupeKey !== null && (typeof dedupeKey !== 'string' || !DEDUPE_PATTERN.test(dedupeKey))) {
    throw new JobInputError('dedupeKey phải là chuỗi ASCII 1–100 ký tự, không khoảng trắng');
  }
  if (!isInt(delayMs, 0, MAX_DELAY_MS)) throw new JobInputError('delayMs không hợp lệ');
  if (!isInt(maxAttempts, 1, MAX_ATTEMPTS_LIMIT)) throw new JobInputError('maxAttempts phải từ 1 đến ' + MAX_ATTEMPTS_LIMIT);
  return { type, json, dedupeKey, delayMs, maxAttempts };
}

// Khoá UPDLOCK + HOLDLOCK trên UX_jobs_dedupe chỉ giữ khoảng của ĐÚNG dedupe_key này tới khi
// transaction nghiệp vụ kết thúc: transaction thứ hai cùng khoá phải chờ rồi thấy job đã có;
// job khác khoá hoặc không có khoá không bị chặn. Gợi ý INDEX để optimizer không chọn
// IX_jobs_ready (khi đó khoảng khoá phủ mọi job queued). Trùng khoá vẫn lọt (2601/2627)
// thì coi như đã có job, không làm hỏng transaction nghiệp vụ.
const ENQUEUE_SQL = `
  DECLARE @inserted TABLE (id BIGINT NOT NULL);
  IF @dedupe IS NOT NULL AND EXISTS (
      SELECT 1 FROM dbo.jobs WITH (UPDLOCK, HOLDLOCK, INDEX(UX_jobs_dedupe))
      WHERE dedupe_key = @dedupe AND status = 'queued')
    SELECT CAST(NULL AS BIGINT) AS id;
  ELSE
  BEGIN
    INSERT INTO dbo.jobs (type, payload, max_attempts, run_after, dedupe_key)
    OUTPUT INSERTED.id INTO @inserted
    VALUES (@type, @payload, @maxAttempts, DATEADD(MILLISECOND, @delayMs, SYSUTCDATETIME()), @dedupe);
    SELECT id FROM @inserted;
  END;`;

async function enqueue(tx, opts) {
  if (!tx || typeof tx !== 'object') throw new JobInputError('enqueue cần transaction của nghiệp vụ');
  const job = normalizeEnqueue(opts);
  try {
    const result = await new sql.Request(tx)
      .input('type', sql.VarChar(40), job.type)
      .input('payload', sql.NVarChar(PAYLOAD_MAX), job.json)
      .input('maxAttempts', sql.TinyInt, job.maxAttempts)
      .input('delayMs', sql.Int, job.delayMs)
      .input('dedupe', sql.VarChar(100), job.dedupeKey)
      .query(ENQUEUE_SQL);
    const row = result.recordset && result.recordset[0];
    return row && row.id != null ? { id: Number(row.id), enqueued: true } : { id: null, enqueued: false };
  } catch (error) {
    if (job.dedupeKey !== null && DUPLICATE_KEY.includes(error.number)) return { id: null, enqueued: false };
    throw error;
  }
}

function defaultWorkerId() {
  return (os.hostname().replace(/[^\x21-\x7e]/g, '').slice(0, 30) || 'host') + ':' + process.pid + ':' +
    crypto.randomBytes(4).toString('hex');
}
function checkWorkerId(workerId) {
  if (typeof workerId !== 'string' || !/^[\x21-\x7e]+$/.test(workerId) || workerId.length > WORKER_ID_MAX) {
    throw new JobInputError('workerId không hợp lệ');
  }
}

// Một batch, ba câu:
//  1. Job running quá khoá mà đã dùng hết lượt -> failed (không nhận lại được nữa).
//  2. Nhận lại job running quá khoá còn lượt (worker cũ chết giữa chừng). Ưu tiên trước để
//     job treo không bị bỏ đói khi hàng đợi luôn có job mới.
//  3. Không có job treo thì nhận job queued tới hạn sớm nhất.
// UPDLOCK + ROWLOCK giữ dòng được chọn, READPAST bỏ qua dòng worker khác đang khoá -> hai worker
// không bao giờ nhận trùng mà cũng không chờ nhau. Mỗi câu chỉ một điều kiện status, ORDER BY
// theo đúng thứ tự khoá của IX_jobs_ready (status, run_after, + id ngầm của khoá chính) nên
// SQL Server đọc tuần tự vài dòng đầu thay vì đọc rồi sắp xếp cả tập (khi đó dòng bị UPDLOCK
// lúc đọc làm worker song song READPAST qua cả job chưa bị nhận và tưởng hàng đợi rỗng).
// OUTPUT ... INTO biến bảng để không vướng trigger về sau. UPDATE qua CTE: INSERTED.* chỉ thấy
// cột có trong SELECT của CTE, nên CTE phải liệt kê đủ mọi cột được SET lẫn được OUTPUT.
// @now: MỘT mốc thời gian DATETIME2(3) cho cả batch, cùng độ chính xác với các cột run_after/locked_until.
// So trực tiếp với SYSUTCDATETIME() (7 chữ số) thì sai: cột DATETIME2(3) làm tròn GẦN NHẤT nên giá trị
// vừa ghi có thể lớn hơn thời điểm hiện tại tới 0,5 ms, và job vừa đưa vào hàng tạm thời không nhận được.
const CLAIM_COLUMNS = 'id, type, payload, status, attempts, max_attempts, locked_by, locked_until, updated_at';
const CLAIM_SET = `SET status = 'running', attempts = attempts + 1, locked_by = @workerId,
      locked_until = DATEADD(MILLISECOND, @lockMs, @now), updated_at = @now
  OUTPUT INSERTED.id, INSERTED.type, INSERTED.payload, INSERTED.attempts, INSERTED.max_attempts,
         INSERTED.locked_by, INSERTED.locked_until INTO @claimed`;
const CLAIM_SQL = `
  DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
  UPDATE dbo.jobs WITH (ROWLOCK, READPAST)
  SET status = 'failed', locked_by = NULL, locked_until = NULL,
      finished_at = @now, updated_at = @now,
      last_error = N'Quá thời gian khoá ở lần thử cuối'
  WHERE status = 'running' AND locked_until < @now AND attempts >= max_attempts;

  DECLARE @claimed TABLE (id BIGINT, type VARCHAR(40), payload NVARCHAR(2000), attempts TINYINT,
    max_attempts TINYINT, locked_by VARCHAR(64), locked_until DATETIME2(3));
  WITH stale_job AS (
    SELECT TOP (1) ${CLAIM_COLUMNS}
    FROM dbo.jobs WITH (UPDLOCK, READPAST, ROWLOCK)
    WHERE status = 'running' AND locked_until < @now AND attempts < max_attempts
    ORDER BY run_after, id
  )
  UPDATE stale_job
  ${CLAIM_SET};

  IF NOT EXISTS (SELECT 1 FROM @claimed)
  BEGIN
    WITH next_job AS (
      SELECT TOP (1) ${CLAIM_COLUMNS}
      FROM dbo.jobs WITH (UPDLOCK, READPAST, ROWLOCK)
      WHERE status = 'queued' AND run_after <= @now
      ORDER BY run_after, id
    )
    UPDATE next_job
    ${CLAIM_SET};
  END;
  SELECT id, type, payload, attempts, max_attempts, locked_by, locked_until FROM @claimed;`;

async function claim(pool, { workerId, lockMs = DEFAULT_LOCK_MS } = {}) {
  checkWorkerId(workerId);
  if (!isInt(lockMs, 1, 24 * 60 * 60 * 1000)) throw new JobInputError('lockMs không hợp lệ');
  const result = await pool.request()
    .input('workerId', sql.VarChar(WORKER_ID_MAX), workerId)
    .input('lockMs', sql.Int, lockMs)
    .query(CLAIM_SQL);
  const row = result.recordset && result.recordset[0];
  if (!row) return null;
  return { id: Number(row.id), type: row.type, payload: JSON.parse(row.payload), attempts: row.attempts,
    maxAttempts: row.max_attempts, lockedBy: row.locked_by, lockedUntil: row.locked_until };
}

// locked_by + attempts xác định đúng LẦN nhận này: khoá đã hết hạn và job bị nhận lại (kể cả
// bởi chính worker này) thì lần cũ không còn ghi được kết quả.
const OWNED = 'id = @id AND status = \'running\' AND locked_by = @workerId AND attempts = @attempts';
function ownedRequest(pool, job) {
  return pool.request().input('id', sql.BigInt, job.id)
    .input('workerId', sql.VarChar(WORKER_ID_MAX), job.lockedBy).input('attempts', sql.TinyInt, job.attempts);
}

async function complete(pool, job) {
  const result = await ownedRequest(pool, job).query(`
    UPDATE dbo.jobs SET status = 'done', locked_by = NULL, locked_until = NULL,
      finished_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
    WHERE ${OWNED};`);
  return result.rowsAffected[0] === 1;
}

function errorText(error) {
  const name = error && typeof error.name === 'string' ? error.name : 'Error';
  const message = error && typeof error.message === 'string' ? error.message : String(error);
  // Bỏ ký tự điều khiển để log/giao diện đọc cột này không bị vỡ dòng.
  return (name + ': ' + message).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, ERROR_MAX);
}
function retryDelayMs(attempts, baseDelayMs = DEFAULT_BASE_DELAY_MS) {
  return baseDelayMs * 2 ** Math.max(0, attempts - 1);
}

// Trả 'queued' (sẽ thử lại), 'failed' (hết lượt) hoặc null (đã mất khoá, không ghi gì).
async function fail(pool, job, error, { baseDelayMs = DEFAULT_BASE_DELAY_MS } = {}) {
  if (!isInt(baseDelayMs, 1, MAX_DELAY_MS)) throw new JobInputError('baseDelayMs không hợp lệ');
  const delayMs = Math.min(retryDelayMs(job.attempts, baseDelayMs), MAX_DELAY_MS);
  const result = await ownedRequest(pool, job)
    .input('error', sql.NVarChar(ERROR_MAX), errorText(error))
    .input('delayMs', sql.Int, delayMs)
    .query(`
      DECLARE @result TABLE (status VARCHAR(12));
      UPDATE dbo.jobs SET
        status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
        run_after = CASE WHEN attempts >= max_attempts THEN run_after
                         ELSE DATEADD(MILLISECOND, @delayMs, SYSUTCDATETIME()) END,
        finished_at = CASE WHEN attempts >= max_attempts THEN SYSUTCDATETIME() ELSE NULL END,
        locked_by = NULL, locked_until = NULL, last_error = @error, updated_at = SYSUTCDATETIME()
      OUTPUT INSERTED.status INTO @result
      WHERE ${OWNED};
      SELECT status FROM @result;`);
  const row = result.recordset && result.recordset[0];
  return row ? row.status : null;
}

async function purgeDone(pool, { days = DONE_RETENTION_DAYS, batch = PURGE_BATCH } = {}) {
  if (!isInt(days, 1, 3650) || !isInt(batch, 1, 100000)) throw new JobInputError('Tham số xoá job không hợp lệ');
  let total = 0;
  for (;;) {
    const result = await pool.request().input('days', sql.Int, days).input('batch', sql.Int, batch).query(`
      DELETE TOP (@batch) FROM dbo.jobs
      WHERE status = 'done' AND finished_at < DATEADD(DAY, -@days, SYSUTCDATETIME());`);
    const removed = result.rowsAffected[0] || 0;
    total += removed;
    if (removed < batch) return total;
  }
}

module.exports = {
  JOB_TYPES, DEFAULT_MAX_ATTEMPTS, MAX_ATTEMPTS_LIMIT, DEFAULT_LOCK_MS, DEFAULT_BASE_DELAY_MS, DONE_RETENTION_DAYS,
  JobInputError, enqueue, claim, complete, fail, purgeDone, retryDelayMs, errorText, defaultWorkerId,
};
