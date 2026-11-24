'use strict';
// Kiểm hàng đợi dbo.jobs (migration 026, lib/jobs/queue.js, lib/jobs/worker.js) trên SQL Server
// thật, bằng DB TẠM tự tạo và tự xoá. Hai "worker" dùng hai connection pool riêng, như hai process.
// Chạy (trong server/, cần sqlcmd + Windows auth như các script verify-*-sql khác):
//   node scripts/verify-jobs-sql.js
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const realDb = process.env.DB_NAME;
const dbName = 'BreezeJobsTest_' + process.pid + '_' + Date.now();
if (!/^BreezeJobsTest_[0-9]+_[0-9]+$/.test(dbName) || dbName === realDb) throw Error('Unsafe test database');
process.env.DB_NAME = dbName;
const db = require('../db'), { sql, config } = db;
if (config.database !== dbName) throw Error('db.js không nhận DB tạm');
const queue = require('../lib/jobs/queue');
const { startWorker } = require('../lib/jobs/worker');
const quoted = '[' + dbName + ']', serverDir = path.join(__dirname, '..');

let poolA, poolB, created = false, checks = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const quiet = { log() {}, warn() {}, error() {} };
function check(name, value) { assert.ok(value, name); checks++; console.log('PASS: ' + name); }
function same(name, actual, expected) { assert.deepEqual(actual, expected, name); checks++; console.log('PASS: ' + name); }
function adminSql(query) { execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' }); }
async function rows(text, pool = poolA) { return (await pool.request().query(text)).recordset; }
async function reset() { await poolA.request().query('DELETE FROM dbo.jobs;'); }
// Mọi transaction mở qua đây được theo dõi: kiểm tra giữa chừng thất bại thì finally rollback
// hết trước khi đóng pool (pool.close() chờ kết nối đang giữ transaction, nên không rollback
// là treo và DB tạm không được xoá).
const openTx = new Set();
async function beginTx(pool) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  openTx.add(tx);
  tx.once('commit', () => openTx.delete(tx));
  tx.once('rollback', () => openTx.delete(tx));
  return tx;
}
function withTimeout(promise, ms) { return Promise.race([promise, wait(ms)]); }
async function enqueueCommitted(opts, pool = poolA) {
  const tx = await beginTx(pool);
  try { const r = await queue.enqueue(tx, opts); await tx.commit(); return r; }
  catch (error) { try { await tx.rollback(); } catch (_) { /* đã rollback */ } throw error; }
}
async function rejects(name, text, number = 547) {
  let error = null;
  try { await poolA.request().query(text); } catch (e) { error = e; }
  check(name, error && error.number === number);
}
async function waitFor(fn, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await fn()) return; await wait(25); }
  throw Error('Hết thời gian chờ: ' + label);
}
const STATS = 'stats.recompute_day';

async function main() {
  try {
    adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
    console.log('Created disposable database:', dbName);
    execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'],
      { cwd: serverDir, env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
    poolA = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    poolB = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    same('both pools target the disposable database',
      [(await rows('SELECT DB_NAME() AS n;'))[0].n, (await rows('SELECT DB_NAME() AS n;', poolB))[0].n], [dbName, dbName]);
    check('setup-db --fresh creates dbo.jobs', (await rows("SELECT OBJECT_ID('dbo.jobs','U') AS id;"))[0].id);

    // --- Ràng buộc của bảng -----------------------------------------------------------
    await rejects('unknown type rejected', "INSERT INTO dbo.jobs(type,payload) VALUES('unknown.type','{}');");
    await rejects('type is case-sensitive', "INSERT INTO dbo.jobs(type,payload) VALUES('Stats.Recompute_Day','{}');");
    await rejects('type with trailing space rejected', "INSERT INTO dbo.jobs(type,payload) VALUES('stats.recompute_day ','{}');");
    await rejects('non-JSON payload rejected', "INSERT INTO dbo.jobs(type,payload) VALUES('stats.recompute_day','không phải json');");
    await rejects('unknown status rejected', "INSERT INTO dbo.jobs(type,payload,status) VALUES('stats.recompute_day','{}','paused');");
    await rejects('running without lock rejected', "INSERT INTO dbo.jobs(type,payload,status) VALUES('stats.recompute_day','{}','running');");
    await rejects('queued with lock rejected', "INSERT INTO dbo.jobs(type,payload,locked_by,locked_until) VALUES('stats.recompute_day','{}','w',SYSUTCDATETIME());");
    await rejects('done without finished_at rejected', "INSERT INTO dbo.jobs(type,payload,status) VALUES('stats.recompute_day','{}','done');");
    await rejects('queued with finished_at rejected', "INSERT INTO dbo.jobs(type,payload,finished_at) VALUES('stats.recompute_day','{}',SYSUTCDATETIME());");
    await rejects('max_attempts above 10 rejected', "INSERT INTO dbo.jobs(type,payload,max_attempts) VALUES('stats.recompute_day','{}',11);");
    await rejects('attempts above max_attempts rejected', "INSERT INTO dbo.jobs(type,payload,attempts,max_attempts) VALUES('stats.recompute_day','{}',3,2);");
    await rejects('empty dedupe_key rejected', "INSERT INTO dbo.jobs(type,payload,dedupe_key) VALUES('stats.recompute_day','{}','');");
    await poolA.request().query("INSERT INTO dbo.jobs(type,payload,dedupe_key) VALUES('stats.recompute_day','{}','raw-key');");
    await rejects('UX_jobs_dedupe blocks a second queued row with the same key',
      "INSERT INTO dbo.jobs(type,payload,dedupe_key) VALUES('stats.recompute_day','{}','raw-key');", 2601);
    await poolA.request().query("INSERT INTO dbo.jobs(type,payload,dedupe_key,status,finished_at) VALUES('stats.recompute_day','{}','raw-key','done',SYSUTCDATETIME());");
    check('same key allowed when the other row is not queued', (await rows("SELECT COUNT(*) AS n FROM dbo.jobs WHERE dedupe_key='raw-key';"))[0].n === 2);
    const beforeRerun = await rows('SELECT * FROM dbo.jobs ORDER BY id;');
    execFileSync(process.execPath, ['db/run-sql.js', 'db/migrations/026_jobs.sql'],
      { cwd: serverDir, env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe' });
    same('rerunning 026 keeps existing rows unchanged', await rows('SELECT * FROM dbo.jobs ORDER BY id;'), beforeRerun);
    await reset();

    // --- enqueue trong transaction ------------------------------------------------------
    const txRollback = await beginTx(poolA);
    const rolled = await queue.enqueue(txRollback, { type: STATS, payload: { day: '2026-11-20' } });
    check('enqueue returns an id inside the transaction', rolled.enqueued && Number.isInteger(rolled.id));
    check('uncommitted job is skipped by another worker (READPAST), not waited on',
      (await queue.claim(poolB, { workerId: 'worker-b' })) === null);
    await txRollback.rollback();
    check('rollback leaves no job', (await rows('SELECT COUNT(*) AS n FROM dbo.jobs;'))[0].n === 0);
    const committed = await enqueueCommitted({ type: STATS, payload: { day: '2026-11-20' } });
    same('commit keeps the job queued with defaults',
      (await rows('SELECT status, attempts, max_attempts, payload FROM dbo.jobs WHERE id=' + committed.id + ';'))[0],
      { status: 'queued', attempts: 0, max_attempts: 5, payload: '{"day":"2026-11-20"}' });
    await reset();

    // --- dedupe_key ----------------------------------------------------------------------
    const key = 'stats:2026-11-20';
    check('first enqueue with a key inserts', (await enqueueCommitted({ type: STATS, payload: {}, dedupeKey: key })).enqueued);
    same('second enqueue while queued is skipped', await enqueueCommitted({ type: STATS, payload: {}, dedupeKey: key }), { id: null, enqueued: false });
    const tx1 = await beginTx(poolA);
    const tx2 = await beginTx(poolB);
    await reset();
    check('transaction 1 enqueues the key', (await queue.enqueue(tx1, { type: STATS, payload: {}, dedupeKey: key })).enqueued);
    let settled = false;
    const second = queue.enqueue(tx2, { type: STATS, payload: {}, dedupeKey: key }).then(r => { settled = true; return r; });
    await wait(500);
    check('concurrent enqueue of the same key waits for transaction 1', !settled);
    // Job không có khoá chống trùng không đi qua UX_jobs_dedupe nên không phải chờ.
    const tx3 = await beginTx(poolB);
    const startedNoKey = Date.now();
    await queue.enqueue(tx3, { type: STATS, payload: {} });
    check('enqueue without a key is not blocked by an open dedupe transaction', Date.now() - startedNoKey < 1000);
    await tx3.rollback();
    // Khác khoá: chỉ đo và in ra (khoá khoảng trên index có thể phủ cả khoảng trống chứa khoá khác).
    const tx4 = await beginTx(poolB);
    const startedOther = Date.now();
    const other = queue.enqueue(tx4, { type: STATS, payload: {}, dedupeKey: 'stats:2026-11-21' });
    let otherDone = false; other.then(() => { otherDone = true; }, () => { otherDone = true; });
    await wait(300);
    const otherBlocked = !otherDone;
    await tx1.commit();
    same('after commit the waiting enqueue sees the job and skips', await second, { id: null, enqueued: false });
    await tx2.commit();
    await other; await tx4.rollback();
    console.log('INFO: enqueue with a DIFFERENT key while another key transaction is open: ' +
      (otherBlocked ? 'waited until that transaction committed' : 'not blocked') + ' (' + (Date.now() - startedOther) + ' ms total)');
    same('exactly one queued job for the key', (await rows("SELECT COUNT(*) AS n FROM dbo.jobs WHERE dedupe_key='" + key + "';"))[0].n, 1);
    const running = await queue.claim(poolA, { workerId: 'worker-a' });
    check('claimed job leaves the queued set', running && running.type === STATS);
    check('a new job with the same key is accepted once the old one is running',
      (await enqueueCommitted({ type: STATS, payload: {}, dedupeKey: key })).enqueued);
    same('running + queued rows now share the key', await rows("SELECT status FROM dbo.jobs WHERE dedupe_key='" + key + "' ORDER BY id;"),
      [{ status: 'running' }, { status: 'queued' }]);
    await reset();

    // --- Nhận nguyên tử: 2 pool tranh nhau ----------------------------------------------
    const seedTx = await beginTx(poolA);
    for (let i = 0; i < 40; i++) await queue.enqueue(seedTx, { type: STATS, payload: { i } });
    await seedTx.commit();
    const raced = await Promise.all(Array.from({ length: 60 }, (_, i) =>
      queue.claim(i % 2 ? poolB : poolA, { workerId: i % 2 ? 'worker-b' : 'worker-a' })));
    const racedIds = raced.filter(Boolean).map(j => j.id);
    check('no job claimed twice during the race', new Set(racedIds).size === racedIds.length);
    check('both pools won some claims', raced.some(j => j && j.lockedBy === 'worker-a') && raced.some(j => j && j.lockedBy === 'worker-b'));
    // READPAST không chờ dòng đang bị khoá: một lần nhận có thể trả null dù còn job (job đó vừa
    // bị lần nhận khác giữ). Bảo đảm cần có: không trùng, và vét tiếp thì nhận đủ phần còn lại.
    const drained = [];
    for (let job; (job = await queue.claim(poolA, { workerId: 'worker-a' }));) drained.push(job.id);
    const all = [...racedIds, ...drained];
    same('race + sequential drain claims all 40 jobs exactly once', [all.length, new Set(all).size], [40, 40]);
    console.log('INFO: race claimed ' + racedIds.length + '/40, ' + drained.length + ' left for the drain');
    await reset();

    // --- Hai worker chạy song song ---------------------------------------------------------
    const bulk = await beginTx(poolA);
    for (let i = 0; i < 200; i++) await queue.enqueue(bulk, { type: STATS, payload: { i } });
    await bulk.commit();
    const handled = [];
    const handler = name => async job => { handled.push({ id: job.id, name }); await wait(job.id % 4); };
    const workerA = startWorker(async () => poolA, { workerId: 'worker-a', intervalMs: 10, log: quiet, handlers: { [STATS]: handler('a') } });
    const workerB = startWorker(async () => poolB, { workerId: 'worker-b', intervalMs: 10, log: quiet, handlers: { [STATS]: handler('b') } });
    await waitFor(async () => (await rows("SELECT COUNT(*) AS n FROM dbo.jobs WHERE status='done';"))[0].n === 200, 60000, '200 jobs done');
    await Promise.all([workerA.stop(), workerB.stop()]);
    same('two workers handled 200 jobs exactly once each', [handled.length, new Set(handled.map(h => h.id)).size], [200, 200]);
    check('both workers took part', handled.some(h => h.name === 'a') && handled.some(h => h.name === 'b'));
    same('every job done on its first attempt', await rows("SELECT COUNT(*) AS n FROM dbo.jobs WHERE status='done' AND attempts=1 AND finished_at IS NOT NULL;"), [{ n: 200 }]);
    console.log('INFO: worker-a handled ' + handled.filter(h => h.name === 'a').length + ', worker-b handled ' + handled.filter(h => h.name === 'b').length);
    await reset();

    // --- Thử lại có backoff, hết lượt thì failed ----------------------------------------------
    const retry = await enqueueCommitted({ type: STATS, payload: {}, maxAttempts: 4 });
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (attempt > 1) {
        check('attempt ' + attempt + ' is not claimable before run_after', (await queue.claim(poolA, { workerId: 'worker-a' })) === null);
        // Chỉ ở DB tạm: kéo run_after về quá khứ thay vì chờ thật.
        await poolA.request().query('UPDATE dbo.jobs SET run_after = DATEADD(MILLISECOND, -1, SYSUTCDATETIME()) WHERE id=' + retry.id + ';');
      }
      const claimed = await queue.claim(poolA, { workerId: 'worker-a' });
      same('attempt ' + attempt + ' claimed with attempts=' + attempt, [claimed && claimed.id, claimed && claimed.attempts], [retry.id, attempt]);
      const state = await queue.fail(poolA, claimed, new Error('lần ' + attempt), { baseDelayMs: 1000 });
      const [row] = await rows('SELECT status, DATEDIFF_BIG(MILLISECOND, updated_at, run_after) AS delay_ms, finished_at, last_error, locked_by FROM dbo.jobs WHERE id=' + retry.id + ';');
      if (attempt < 4) {
        same('failure ' + attempt + ' requeues after ' + 1000 * 2 ** (attempt - 1) + ' ms', [state, row.status, Number(row.delay_ms), row.finished_at, row.locked_by],
          ['queued', 'queued', 1000 * 2 ** (attempt - 1), null, null]);
      } else {
        same('failure 4 of 4 marks the job failed', [state, row.status, row.locked_by], ['failed', 'failed', null]);
        check('failed job keeps finished_at and the last error', row.finished_at instanceof Date && row.last_error === 'Error: lần 4');
      }
    }
    check('failed job is never claimed again', (await queue.claim(poolA, { workerId: 'worker-a' })) === null);
    const defaultDelay = await enqueueCommitted({ type: STATS, payload: {}, maxAttempts: 3 });
    for (const expected of [10000, 20000]) {
      if (expected > 10000) await poolA.request().query('UPDATE dbo.jobs SET run_after = DATEADD(MILLISECOND, -1, SYSUTCDATETIME()) WHERE id=' + defaultDelay.id + ';');
      await queue.fail(poolA, await queue.claim(poolA, { workerId: 'worker-a' }), new Error('x'));
      const [row] = await rows('SELECT DATEDIFF_BIG(MILLISECOND, updated_at, run_after) AS d FROM dbo.jobs WHERE id=' + defaultDelay.id + ';');
      same('default backoff is ' + expected / 1000 + ' s', Number(row.d), expected);
    }
    await reset();

    // --- Job treo (worker chết giữa chừng) được nhận lại --------------------------------------
    const stuck = await enqueueCommitted({ type: STATS, payload: {} });
    const lostRun = await queue.claim(poolA, { workerId: 'worker-a', lockMs: 300 });
    check('worker A claims with a short lock', lostRun && lostRun.id === stuck.id);
    check('worker B cannot take it while the lock is valid', (await queue.claim(poolB, { workerId: 'worker-b' })) === null);
    await wait(450);
    const takeover = await queue.claim(poolB, { workerId: 'worker-b' });
    same('after the lock expires worker B reclaims it as attempt 2', [takeover && takeover.id, takeover && takeover.attempts, takeover && takeover.lockedBy],
      [stuck.id, 2, 'worker-b']);
    check('stale worker A can no longer complete', (await queue.complete(poolA, lostRun)) === false);
    check('stale worker A can no longer fail it', (await queue.fail(poolA, lostRun, new Error('muộn'))) === null);
    check('worker B completes', await queue.complete(poolB, takeover));
    same('job done after takeover', await rows('SELECT status, attempts, last_error FROM dbo.jobs WHERE id=' + stuck.id + ';'),
      [{ status: 'done', attempts: 2, last_error: null }]);
    const lastTry = await enqueueCommitted({ type: STATS, payload: {}, maxAttempts: 1 });
    await queue.claim(poolA, { workerId: 'worker-a', lockMs: 200 });
    await wait(350);
    check('expired lock on the last attempt is not reclaimed', (await queue.claim(poolB, { workerId: 'worker-b' })) === null);
    const [expired] = await rows('SELECT status, last_error, finished_at, locked_by FROM dbo.jobs WHERE id=' + lastTry.id + ';');
    check('it is marked failed with a lock-expiry error',
      expired.status === 'failed' && expired.last_error === 'Quá thời gian khoá ở lần thử cuối' && expired.finished_at && expired.locked_by === null);
    await reset();

    // --- Loại job chưa có handler ---------------------------------------------------------------
    const orphan = await enqueueCommitted({ type: 'review_image.process', payload: { image: 1 } });
    const lonely = startWorker(async () => poolA, { workerId: 'worker-a', intervalMs: 10, baseDelayMs: 60000, log: quiet, handlers: {} });
    await waitFor(async () => (await rows('SELECT attempts FROM dbo.jobs WHERE id=' + orphan.id + ';'))[0].attempts === 1 &&
      (await rows('SELECT status FROM dbo.jobs WHERE id=' + orphan.id + ';'))[0].status === 'queued', 5000, 'orphan job failed once');
    await lonely.stop();
    same('job without a handler is failed with a recorded reason and retried later',
      await rows('SELECT status, attempts, last_error FROM dbo.jobs WHERE id=' + orphan.id + ';'),
      [{ status: 'queued', attempts: 1, last_error: 'Error: Không có handler cho loại job review_image.process' }]);
    await reset();

    // --- Xoá job done quá 30 ngày -----------------------------------------------------------------
    await poolA.request().query(`
      INSERT INTO dbo.jobs(type,payload,status,finished_at,dedupe_key) VALUES
        ('stats.recompute_day','{}','done',  DATEADD(DAY,-31,SYSUTCDATETIME()),'old-done'),
        ('stats.recompute_day','{}','done',  DATEADD(DAY,-29,SYSUTCDATETIME()),'recent-done'),
        ('stats.recompute_day','{}','failed',DATEADD(DAY,-40,SYSUTCDATETIME()),'old-failed');
      INSERT INTO dbo.jobs(type,payload,dedupe_key) VALUES('stats.recompute_day','{}','queued');`);
    same('purge removes only done jobs older than 30 days', await queue.purgeDone(poolA), 1);
    same('recent done, failed and queued jobs remain', (await rows('SELECT dedupe_key FROM dbo.jobs ORDER BY dedupe_key;')).map(r => r.dedupe_key),
      ['old-failed', 'queued', 'recent-done']);

    console.log('SQL JOBS VERIFY:', checks, 'checks passed; all fixtures confined to disposable database.');
  } finally {
    for (const tx of openTx) await withTimeout(tx.rollback().catch(() => {}), 5000);
    if (poolA) await withTimeout(poolA.close().catch(() => {}), 10000);
    if (poolB) await withTimeout(poolB.close().catch(() => {}), 10000);
    if (created) {
      adminSql('ALTER DATABASE ' + quoted + ' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + quoted + ';');
      console.log('Removed disposable database:', dbName);
    }
  }
}
main().catch(error => {
  // Assertion: in thông điệp (tên mục kiểm) để biết mục nào sai; lỗi SQL: chỉ mã lỗi.
  console.error('Jobs SQL verification FAILED:', error.code === 'ERR_ASSERTION' ? error.message : (error.code || error.message));
  process.exitCode = 1;
});
