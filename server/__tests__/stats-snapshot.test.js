'use strict';

// lib/stats-snapshot.js với SQL giả: ngày giờ VN, job đưa vào hàng, reader (nguồn + header, hình dạng kết quả)
// và các ràng buộc bắt buộc trong câu SQL. So khớp số liệu thật giữa snapshot và truy vấn trực tiếp:
// scripts/verify-stats-snapshot-sql.js.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const realSql = require('mssql');

let calls, answer;
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(k, type, v) { this.p[k] = v; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim();
    calls.push({ q, p: this.p, tx: this.tx });
    return answer(q, this.p);
  }
}
class Transaction { async begin() {} async commit() {} async rollback() {} }
const pool = { request: () => new Request(null) };
require.cache[require.resolve('../db')] = { exports: { sql: { ...realSql, Request, Transaction }, getPool: async () => pool } };
const stats = require('../lib/stats-snapshot');
const report = require('../lib/business-report');
const norm = s => s.replace(/\s+/g, ' ').trim();
beforeEach(() => { calls = []; answer = () => ({ recordset: [{ id: '5' }], recordsets: [[{ id: '5' }]], rowsAffected: [1] }); });

const range = { from: '2026-11-01', to: '2026-11-02', fromDate: new Date('2026-11-01T00:00:00Z'), toDate: new Date('2026-11-02T00:00:00Z'),
  start: new Date('2026-10-31T17:00:00Z'), end: new Date('2026-11-02T17:00:00Z') };

test('ngày giờ VN của đơn: 16:59:59.999Z còn hôm trước, 17:00Z sang ngày mới; nhận Date hoặc ISO có múi giờ', () => {
  assert.equal(stats.vnDayOf(new Date('2026-11-23T16:59:59.999Z')), '2026-11-23');
  assert.equal(stats.vnDayOf(new Date('2026-11-23T17:00:00.000Z')), '2026-11-24');
  assert.equal(stats.vnDayOf('2026-11-23T17:00:00Z'), '2026-11-24');
  assert.equal(stats.vnDayOf('2026-11-23T23:00:00+07:00'), '2026-11-23');
  for (const bad of [undefined, null, 'c', '2026-11-23', new Date('x'), 0]) assert.throws(() => stats.vnDayOf(bad), /không hợp lệ/);
  assert.ok(stats.isDay('2024-02-29'));
  for (const bad of ['2026-02-30', '2026-1-01', '20261101', null]) assert.equal(stats.isDay(bad), false);
});

test('enqueueStatsDay: job stats.recompute_day của NGÀY TẠO đơn, khoá chống trùng theo ngày, trong transaction được truyền', async () => {
  const tx = { tag: 'tx' };
  assert.deepEqual(await stats.enqueueStatsDay(tx, new Date('2026-11-23T17:30:00Z')), { id: 5, enqueued: true });
  assert.equal(calls[0].tx, tx);
  assert.deepEqual([calls[0].p.type, JSON.parse(calls[0].p.payload), calls[0].p.dedupe],
    ['stats.recompute_day', { day: '2026-11-24' }, 'stats:2026-11-24']);
  await assert.rejects(stats.enqueueStatsDay(tx, undefined), /không hợp lệ/);
});

test('reader sync: gọi đúng các hàm truy vấn trực tiếp cũ, header live + thời điểm hiện tại', async () => {
  answer = q => q.startsWith('WITH report_orders') ? { recordset: [{ revenue: 10, orders: 2, completedOrders: 1, cancelledOrders: 0, customers: 1, productsSold: 3 }] }
    : { recordset: [] };
  const reader = stats.createReader(pool, 'sync');
  assert.deepEqual(await reader.summary(range), { revenue: 10, orders: 2, completedOrders: 1, cancelledOrders: 0, customers: 1, productsSold: 3, aov: 10 });
  assert.ok(calls[0].q.startsWith('WITH report_orders'));
  const before = Date.now(), h = reader.headers();
  assert.equal(h['X-Stats-Source'], 'live');
  assert.ok(Date.parse(h['X-Stats-Updated-At']) >= before - 1000 && /Z$/.test(h['X-Stats-Updated-At']));
});

function totalsAnswer(meta) {
  return { recordsets: [[meta], [{ d: '2026-11-01', revenue: 20, orders: 3, completedOrders: 1, cancelledOrders: 1 }],
    [{ revenue: 20, orders: 3, completedOrders: 1, cancelledOrders: 1, productsSold: 4 }], [{ customers: 1 }]] };
}
test('reader async: hình dạng y hệt business-report, gộp 1 lần cho summary + dailyRevenue cùng khoảng', async () => {
  answer = () => totalsAnswer({ total_days: 2, live_days: 0, updated_at: new Date('2026-11-03T01:02:03.004Z') });
  const reader = stats.createReader(pool, 'async');
  assert.deepEqual(await reader.summary(range), { revenue: 20, orders: 3, completedOrders: 1, cancelledOrders: 1, customers: 1, productsSold: 4, aov: 20 });
  assert.deepEqual(await reader.dailyRevenue(range), [
    { date: '2026-11-01', revenue: 20, orders: 3, completedOrders: 1, cancelledOrders: 1 },
    { date: '2026-11-02', revenue: 0, orders: 0, completedOrders: 0, cancelledOrders: 0 }]);
  assert.equal(calls.length, 1, 'summary + dailyRevenue cùng khoảng chỉ chạy một câu');
  assert.deepEqual(reader.headers(), { 'X-Stats-Source': 'snapshot', 'X-Stats-Updated-At': '2026-11-03T01:02:03.004Z' });
});

test('header nguồn: mixed khi có cả ngày snapshot lẫn ngày tính trực tiếp; live khi không ngày nào từ snapshot (thời điểm = bây giờ)', async () => {
  answer = () => totalsAnswer({ total_days: 2, live_days: 1, updated_at: new Date('2026-11-03T00:00:00.000Z') });
  let reader = stats.createReader(pool, 'async'); await reader.summary(range);
  assert.deepEqual(reader.headers(), { 'X-Stats-Source': 'mixed', 'X-Stats-Updated-At': '2026-11-03T00:00:00.000Z' });
  answer = () => totalsAnswer({ total_days: 2, live_days: 2, updated_at: null });
  reader = stats.createReader(pool, 'async'); await reader.summary(range);
  const before = Date.now(), h = reader.headers();
  assert.equal(h['X-Stats-Source'], 'live');
  assert.ok(Date.parse(h['X-Stats-Updated-At']) >= before - 1000);
});

test('header thời điểm: computed_at MỚI NHẤT qua mọi lần đọc trong request', async () => {
  let n = 0;
  answer = q => q.includes('@pd') ? { recordsets: [[{ total_days: 2, live_days: 0, updated_at: new Date('2026-11-05T00:00:00.000Z') }], []] }
    : totalsAnswer({ total_days: 2, live_days: 0, updated_at: new Date(++n === 1 ? '2026-11-04T00:00:00.000Z' : '2026-11-01T00:00:00.000Z') });
  const reader = stats.createReader(pool, 'async');
  await reader.summary(range); await reader.summary({ ...range, from: '2026-10-30', to: '2026-10-31' }); await reader.products(range, 5);
  assert.deepEqual(reader.headers(), { 'X-Stats-Source': 'snapshot', 'X-Stats-Updated-At': '2026-11-05T00:00:00.000Z' });
});

test('reader async products: cùng ánh xạ ảnh/tên/doanh thu với business-report; tham số sai bị từ chối', async () => {
  answer = () => ({ recordsets: [[{ total_days: 2, live_days: 0, updated_at: null }],
    [{ id: 3, name: 'Áo', unitsSold: '7', revenue: '1234', images: '["img/a.png"]' }, { id: 4, name: 'Quần', unitsSold: 1, revenue: 5, images: null }]] });
  const reader = stats.createReader(pool, 'async');
  assert.deepEqual(await reader.products(range, 5, 'revenue'), [
    { id: 3, name: 'Áo', imageUrl: 'img/a.png', unitsSold: 7, revenue: 1234 },
    { id: 4, name: 'Quần', imageUrl: 'img/breeze.png', unitsSold: 1, revenue: 5 }]);
  assert.equal(calls[0].p.lim, 5);
  assert.match(calls[0].q, /ORDER BY revenue DESC, unitsSold DESC, product_id ASC;$/);
  await assert.rejects(reader.products(range, 0), /Invalid report product options/);
  await assert.rejects(reader.products(range, 5, 'name'), /Invalid report product options/);
  await assert.rejects(reader.summary({ ...range, from: '2026-11-03' }), /không hợp lệ/);
});

test('SQL đọc khoảng: ngày thiếu snapshot HOẶC đang có job stats chờ/chạy (READPAST) thì tính trực tiếp; số khách luôn trực tiếp', () => {
  const q = norm(stats.TOTALS_SQL);
  assert.match(q, /FROM dbo\.jobs j WITH \(READPAST\) JOIN @days d ON j\.dedupe_key = 'stats:' \+ CONVERT\(char\(10\), d\.day, 23\) WHERE j\.type = 'stats\.recompute_day' AND j\.status IN \('queued','running'\)/);
  assert.match(q, /WHERE NOT EXISTS \(SELECT 1 FROM dbo\.stats_snapshots s WHERE s\.day = d\.day\) OR EXISTS \(SELECT 1 FROM @dirty x WHERE x\.day = d\.day\)/);
  assert.ok(q.includes(norm(`SELECT ${report.SALES.customers} AS customers FROM dbo.orders WHERE created_at >= @start AND created_at < @end`)));
  assert.doesNotMatch(q, /customers FROM dbo\.stats_snapshots/);
});

test('SQL dùng chung biểu thức của business-report: tính lại 1 ngày, đọc ngày thiếu, đối soát', () => {
  for (const [name, text] of [['recompute', stats.RECOMPUTE_SQL], ['totals', stats.TOTALS_SQL], ['reconcile', stats.RECONCILE_SQL]]) {
    const q = norm(text);
    for (const expr of [report.SALES.revenue, report.SALES.orders, report.SALES.completed, report.SALES.cancelled]) assert.ok(q.includes(expr), name + ': ' + expr);
  }
  for (const [name, text] of [['recompute', stats.RECOMPUTE_SQL], ['products', stats.productsSql('quantity')], ['reconcile', stats.RECONCILE_SQL]]) {
    const q = norm(text);
    assert.ok(q.includes(norm(report.soldItemsSelect('oi.product_id'))), name + ': soldItemsSelect');
    assert.ok(q.includes(norm(report.ALLOCATED_REVENUE)), name + ': ALLOCATED_REVENUE');
  }
  const recompute = norm(stats.RECOMPUTE_SQL);
  assert.doesNotMatch(recompute, /ROUND\(/, 'snapshot lưu doanh thu chưa làm tròn');
  assert.match(norm(stats.productsSql('quantity')), /ROUND\(SUM\(revenue\),0\) AS revenue/, 'làm tròn SAU khi cộng các ngày');
  assert.match(recompute, /EXEC @lock = sp_getapplock @Resource = @lockName, @LockMode = 'Exclusive', @LockOwner = 'Transaction'/);
  assert.ok(recompute.indexOf('DELETE FROM dbo.stats_snapshots WHERE day = @day') < recompute.indexOf('INSERT INTO dbo.stats_snapshots'));
});

test('SQL đối soát: so nguyên dòng hai chiều (mỗi chiều EXCEPT trong ngoặc riêng), tên so nhị phân, từ ngày sớm nhất tới hôm nay', () => {
  const q = norm(stats.RECONCILE_SQL);
  assert.match(q, /\(SELECT day, revenue, orders, completed, cancelled, products_sold FROM @t EXCEPT SELECT s\.day/);
  assert.match(q, /\) UNION \(SELECT s\.day, s\.revenue, s\.orders, s\.completed, s\.cancelled, s\.products_sold FROM dbo\.stats_snapshots s WHERE s\.day <= @today EXCEPT/);
  assert.match(q, /CAST\(x\.product_name AS VARBINARY\(400\)\)/);
  assert.match(q, /DECLARE @today DATE = CAST\(DATEADD\(MINUTE,420,SYSUTCDATETIME\(\)\) AS DATE\);/);
  assert.match(q, /UNION ALL SELECT MIN\(day\) FROM dbo\.stats_snapshots/);
});

test('reconcileStats: apply=false không ghi gì; apply=true đưa job cho từng ngày lệch trong một transaction', async () => {
  answer = q => q.includes('@bad') ? { recordsets: [[{ database_name: 'BreezeTemp', first_day: '2026-11-01', today: '2026-11-03' }],
    [{ day: '2026-11-01' }, { day: '2026-11-03' }]] } : { recordset: [{ id: '9' }], rowsAffected: [1] };
  assert.deepEqual(await stats.reconcileStats(pool), { database: 'BreezeTemp', firstDay: '2026-11-01', today: '2026-11-03', days: ['2026-11-01', '2026-11-03'], enqueued: 0 });
  assert.equal(calls.length, 1);
  calls = [];
  const r = await stats.reconcileStats(pool, { apply: true });
  assert.equal(r.enqueued, 2);
  const jobs = calls.filter(c => c.q.includes('INSERT INTO dbo.jobs'));
  assert.deepEqual(jobs.map(c => c.p.dedupe), ['stats:2026-11-01', 'stats:2026-11-03']);
  assert.ok(jobs.every(c => c.tx instanceof Transaction));
});

test('SQL dọn ngày có job failed: chỉ khi đó là job MỚI NHẤT cùng dedupe_key; xoá cả hai bảng snapshot', () => {
  const q = norm(stats.CLEAR_FAILED_SQL);
  assert.match(q, /j\.status = 'failed'/);
  assert.match(q, /AND NOT EXISTS \(SELECT 1 FROM dbo\.jobs k WHERE k\.type = j\.type AND k\.dedupe_key = j\.dedupe_key AND k\.id > j\.id\)/);
  assert.match(q, /DELETE x FROM dbo\.stats_snapshot_products x JOIN @failed f ON f\.day = x\.day;/);
  assert.match(q, /DELETE x OUTPUT DELETED\.day INTO @cleared FROM dbo\.stats_snapshots x JOIN @failed f ON f\.day = x\.day;/);
});
