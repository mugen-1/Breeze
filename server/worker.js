// Chạy worker hàng đợi (dbo.jobs) như một process riêng, tách khỏi server web:
//   node server/worker.js          (hoặc trong server/: node worker.js)
// Luôn chạy worker, không đọc JOBS_WORKER (cờ đó chỉ dành cho worker bên trong server.js).
// Ctrl+C / SIGTERM: ngừng nhận job mới, chờ job đang chạy ghi xong rồi mới thoát.
const ENV_PATH = require('path').join(__dirname, '.env');
const envResult = require('dotenv').config({ path: ENV_PATH, quiet: true });
if (Object.keys(envResult.parsed || {}).length === 0 && !process.env.DB_SERVER) {
  console.error(`[env] Không nạp được biến nào từ ${ENV_PATH}`);
  process.exit(1);
}

const { getPool } = require('./db');
const { startWorker } = require('./lib/jobs/worker');

const worker = startWorker(getPool, { unref: false });
console.log('[jobs] worker process đang chạy, id =', worker.workerId);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[jobs] nhận ${signal}, đang dừng worker...`);
  try { await worker.stop(); } catch (error) { console.error('[jobs] dừng worker lỗi:', error.message); }
  try { await (await getPool()).close(); } catch (_) { /* pool chưa mở hoặc đã đóng */ }
  console.log('[jobs] worker đã dừng.');
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
