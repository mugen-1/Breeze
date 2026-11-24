#!/usr/bin/env node
/*
 * stats-backfill.js — nạp thống kê tính sẵn lần đầu (và bất cứ lúc nào cần đồng bộ lại).
 * Gọi lại ĐÚNG hàm đối soát đêm (reconcileStats trong lib/stats-snapshot.js): tính trực tiếp mọi ngày từ
 * đơn đầu tiên tới hôm nay (giờ VN), so với snapshot, và đưa job stats.recompute_day cho ngày thiếu/lệch.
 * Không có logic ghi riêng; worker (JOBS_WORKER=on hoặc node server/worker.js) xử lý các job đó.
 *
 * Cách dùng (trong server/, DB lấy từ server/.env hoặc biến DB_NAME đặt ngay trong lệnh):
 *   node scripts/stats-backfill.js            chạy thử: in tên DB đích + số ngày sẽ đưa vào hàng, KHÔNG ghi gì
 *   node scripts/stats-backfill.js --confirm  ghi thật: đưa job vào hàng (chạy lặp lại an toàn: khoá chống trùng theo ngày)
 * Ví dụ PowerShell trên DB sao chép:  $env:DB_NAME = 'BreezeShopDB_AuditVerify'; node scripts/stats-backfill.js
 * Thứ tự triển khai: backup DB -> chạy RIÊNG từng migration 026, 027, 028 trên DB đích
 *   (trong server/: node db/run-sql.js db/migrations/026_jobs.sql, rồi 027_review_image_status.sql, rồi 028_stats_snapshots.sql)
 *   -> khởi động code mới -> script này chạy thử rồi --confirm -> bật worker (JOBS_WORKER=on hoặc node server/worker.js)
 *   -> chỉ đặt JOBS_MODE=async sau khi worker đã xử lý xong các job nạp lịch sử.
 * Không chạy lại cả chuỗi scripts/setup-db.js trên DB đang có dữ liệu: chạy lại 012_product_variants.sql trên DB đã
 * có các migration sau đó sẽ lỗi CHECK CK_inventory_movements_type (giới hạn đã biết của setup-db.js).
 */
'use strict';
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { getPool } = require('../db');
const { reconcileStats } = require('../lib/stats-snapshot');

const confirm = process.argv.includes('--confirm');

(async () => {
  const pool = await getPool();
  try {
    const database = (await pool.request().query('SELECT DB_NAME() AS name;')).recordset[0].name;
    console.log('[stats-backfill] DB đích:', database, confirm ? '(GHI THẬT)' : '(chạy thử, không ghi)');
    const result = await reconcileStats(pool, { apply: confirm });
    console.log('[stats-backfill] Khoảng ngày:', result.firstDay ? result.firstDay + ' .. ' + result.today : '(chưa có đơn nào)');
    console.log('[stats-backfill] Số ngày thiếu/lệch:', result.days.length + (result.days.length ? ' (' + result.days[0] + ' .. ' + result.days[result.days.length - 1] + ')' : ''));
    if (confirm) console.log('[stats-backfill] Đã đưa vào hàng:', result.enqueued, 'job (ngày đã có job đang chờ thì bỏ qua)');
    else console.log('[stats-backfill] Chạy lại với --confirm để đưa', result.days.length, 'ngày vào hàng.');
  } finally {
    await pool.close();
  }
})().catch(error => { console.error('[stats-backfill] LỖI:', error.code || error.message); process.exitCode = 1; });
