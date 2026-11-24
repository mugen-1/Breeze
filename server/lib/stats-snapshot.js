'use strict';
// Thống kê tính sẵn theo ngày giờ Việt Nam (migration 028). Mọi SQL ở đây dựng từ biểu thức dùng chung
// của lib/business-report.js (SALES, soldItemsSelect, ALLOCATED_REVENUE...), nên một ngày tính sẵn
// cho đúng con số mà truy vấn trực tiếp cho ra.
//
//   enqueueStatsDay(tx, createdAt)  đưa job stats.recompute_day của ngày chứa createdAt vào hàng, trong
//                                   transaction của thao tác đổi đơn (khoá chống trùng theo ngày)
//   recomputeDay(pool, day)         tính lại và ghi đè snapshot của một ngày (transaction riêng)
//   createReader(pool, mode)        đọc báo cáo: 'sync' = truy vấn trực tiếp như cũ; 'async' = snapshot,
//                                   các ngày chưa có snapshot hoặc đang có job chờ/chạy thì tính trực tiếp
//   reconcileStats(pool, { apply }) đối soát mọi ngày (từ đơn đầu tiên tới hôm nay) với dữ liệu thật
//   clearFailedDays(pool)           xoá snapshot của ngày mà job mới nhất đã failed
const { sql } = require('../db');
const report = require('./business-report');
const jobsQueue = require('./jobs/queue');

const STATS_JOB = 'stats.recompute_day';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 4000;
const { SALES, soldItemsSelect, ALLOCATED_REVENUE, PRODUCT_ORDER } = report;

// Nhận Date (driver mssql trả về) hoặc chuỗi ISO 8601 có múi giờ; thiếu/sai thì ném lỗi (thao tác rollback).
function vnDayOf(instant) {
  const date = instant instanceof Date ? instant
    : typeof instant === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(instant) ? new Date(instant) : null;
  if (!date || Number.isNaN(date.getTime())) throw new Error('Thời điểm đơn không hợp lệ');
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}
function isDay(value) {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const dedupeKeyFor = day => 'stats:' + day;
// Tham số DATE: truyền Date lúc 00:00 UTC (driver dùng UTC) để SQL nhận đúng ngày.
const dateParam = day => new Date(day + 'T00:00:00Z');

// Gọi ở cuối transaction của thao tác đổi đơn (ngay trước audit). created_at của đơn không bao giờ đổi,
// nên luôn tính lại đúng ngày chứa đơn, kể cả khi đổi trạng thái một đơn cũ.
async function enqueueStatsDay(tx, createdAt) {
  const day = vnDayOf(createdAt);
  return jobsQueue.enqueue(tx, { type: STATS_JOB, payload: { day }, dedupeKey: dedupeKeyFor(day) });
}

// --- SQL theo ngày, dùng chung cho tính sẵn, đọc trực tiếp các ngày còn thiếu và đối soát ------------------
// Bảng @live(day, s, e): các ngày cần tính trực tiếp, s/e = nửa đêm giờ VN quy ra UTC, e loại trừ.
const LIVE_TABLE = 'DECLARE @live TABLE (day DATE PRIMARY KEY, s DATETIME2 NOT NULL, e DATETIME2 NOT NULL);';
const liveRow = day => `${day}, DATEADD(MINUTE,-420,CAST(${day} AS DATETIME2)), DATEADD(MINUTE,1020,CAST(${day} AS DATETIME2))`;
// Tổng theo ngày (chỉ ngày có đơn). Cùng biểu thức với report.summary/dailyRevenue.
const DAY_TOTALS_CTE = `live_orders AS (
    SELECT l.day, o.id, o.user_id, o.status, o.total_amount
    FROM @live l JOIN dbo.orders o ON o.created_at>=l.s AND o.created_at<l.e
  ), day_totals AS (
    SELECT g.day, ${SALES.revenue} AS revenue, ${SALES.orders} AS orders,
      ${SALES.completed} AS completed, ${SALES.cancelled} AS cancelled,
      (SELECT COALESCE(SUM(CAST(oi.quantity AS BIGINT)),0) FROM dbo.order_items oi
        JOIN live_orders o ON o.id=oi.order_id WHERE o.status='completed' AND o.day=g.day) AS products_sold
    FROM live_orders g GROUP BY g.day
  )`;
// Doanh thu sản phẩm theo ngày, chưa làm tròn; tên = dòng hàng mới nhất trong ngày (như report.products).
const PRODUCT_DAYS_CTE = `sold_items AS (
    SELECT l.day, x.* FROM @live l CROSS APPLY (
      ${soldItemsSelect('oi.product_id')}
      WHERE o.status='completed' AND o.created_at>=l.s AND o.created_at<l.e
    ) x
  ), product_days AS (
    SELECT day, product_id, MAX(CASE WHEN name_rank=1 THEN product_name END) AS product_name,
      MAX(created_at) AS last_order_at, SUM(CAST(quantity AS BIGINT)) AS units_sold, ${ALLOCATED_REVENUE} AS revenue
    FROM sold_items GROUP BY day, product_id
  )`;

// sp_getapplock theo ngày: hai worker cùng tính một ngày thì chạy lần lượt, bản ghi sau thắng.
const RECOMPUTE_SQL = `
  ${LIVE_TABLE}
  INSERT INTO @live(day, s, e) VALUES (${liveRow('@day')});
  DECLARE @lock INT;
  EXEC @lock = sp_getapplock @Resource = @lockName, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000;
  IF @lock < 0 THROW 51010, N'Không lấy được khoá tính lại thống kê ngày', 1;
  DELETE FROM dbo.stats_snapshot_products WHERE day = @day;
  DELETE FROM dbo.stats_snapshots WHERE day = @day;
  WITH ${DAY_TOTALS_CTE}
  INSERT INTO dbo.stats_snapshots(day, revenue, orders, completed, cancelled, products_sold, computed_at)
  SELECT l.day, COALESCE(t.revenue,0), COALESCE(t.orders,0), COALESCE(t.completed,0), COALESCE(t.cancelled,0),
    COALESCE(t.products_sold,0), SYSUTCDATETIME()
  FROM @live l LEFT JOIN day_totals t ON t.day = l.day;
  WITH ${PRODUCT_DAYS_CTE}
  INSERT INTO dbo.stats_snapshot_products(day, product_id, product_name, last_order_at, units_sold, revenue)
  SELECT day, product_id, product_name, last_order_at, units_sold, revenue FROM product_days;`;

// Ngày không có đơn vẫn có một dòng toàn 0: ngày đó được tính là "đã có snapshot".
async function recomputeDay(pool, day) {
  if (!isDay(day)) throw new Error('Ngày thống kê không hợp lệ');
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).input('day', sql.Date, dateParam(day)).input('lockName', sql.NVarChar(64), dedupeKeyFor(day)).query(RECOMPUTE_SQL);
    await tx.commit();
  } catch (error) {
    try { await tx.rollback(); } catch (_) { /* SQL đã tự rollback */ }
    throw error;
  }
}
async function deleteDay(pool, day) {
  if (!isDay(day)) throw new Error('Ngày thống kê không hợp lệ');
  await pool.request().input('day', sql.Date, dateParam(day)).query(`
    DELETE FROM dbo.stats_snapshot_products WHERE day = @day;
    DELETE FROM dbo.stats_snapshots WHERE day = @day;`);
}

// --- Đọc theo khoảng ngày ----------------------------------------------------------------------------------
// @days: mọi ngày trong khoảng. @live: ngày chưa có snapshot HOẶC đang có job stats chờ/đang chạy (snapshot
// có thể cũ) -> tính trực tiếp. READPAST: job thuộc thao tác chưa commit thì bỏ qua (đơn đó cũng chưa hiện).
const RANGE_PREFIX = `
  DECLARE @days TABLE (day DATE PRIMARY KEY);
  WITH n AS (SELECT TOP (DATEDIFF(DAY,@from,@to)+1) ROW_NUMBER() OVER(ORDER BY (SELECT NULL))-1 AS i
             FROM sys.all_objects a CROSS JOIN sys.all_objects b)
  INSERT INTO @days(day) SELECT DATEADD(DAY,i,@from) FROM n;
  DECLARE @dirty TABLE (day DATE PRIMARY KEY);
  INSERT INTO @dirty(day) SELECT DISTINCT d.day FROM dbo.jobs j WITH (READPAST)
    JOIN @days d ON j.dedupe_key = 'stats:' + CONVERT(char(10), d.day, 23)
    WHERE j.type = '${STATS_JOB}' AND j.status IN ('queued','running');
  ${LIVE_TABLE}
  INSERT INTO @live(day, s, e) SELECT ${liveRow('d.day')} FROM @days d
    WHERE NOT EXISTS (SELECT 1 FROM dbo.stats_snapshots s WHERE s.day = d.day) OR EXISTS (SELECT 1 FROM @dirty x WHERE x.day = d.day);
  SELECT (SELECT COUNT(*) FROM @days) AS total_days, (SELECT COUNT(*) FROM @live) AS live_days,
    (SELECT MAX(s.computed_at) FROM dbo.stats_snapshots s JOIN @days d ON d.day = s.day
      WHERE NOT EXISTS (SELECT 1 FROM @live l WHERE l.day = s.day)) AS updated_at;`;
const FROM_SNAPSHOT = table => `${table} x JOIN @days d ON d.day = x.day WHERE NOT EXISTS (SELECT 1 FROM @live l WHERE l.day = x.day)`;

const TOTALS_SQL = `${RANGE_PREFIX}
  DECLARE @merged TABLE (day DATE PRIMARY KEY, revenue DECIMAL(19,2), orders INT, completed INT, cancelled INT, products_sold BIGINT);
  INSERT INTO @merged SELECT x.day, x.revenue, x.orders, x.completed, x.cancelled, x.products_sold FROM ${FROM_SNAPSHOT('dbo.stats_snapshots')};
  WITH ${DAY_TOTALS_CTE}
  INSERT INTO @merged SELECT day, revenue, orders, completed, cancelled, products_sold FROM day_totals;
  SELECT CONVERT(char(10), day, 23) AS d, revenue, orders, completed AS completedOrders, cancelled AS cancelledOrders
    FROM @merged WHERE orders > 0;
  SELECT COALESCE(SUM(revenue),0) AS revenue, COALESCE(SUM(orders),0) AS orders, COALESCE(SUM(completed),0) AS completedOrders,
    COALESCE(SUM(cancelled),0) AS cancelledOrders, COALESCE(SUM(products_sold),0) AS productsSold FROM @merged;
  SELECT ${SALES.customers} AS customers FROM dbo.orders WHERE created_at >= @start AND created_at < @end;`;

const productsSql = sort => `${RANGE_PREFIX}
  DECLARE @pd TABLE (day DATE, product_id INT, product_name NVARCHAR(200), last_order_at DATETIME2, units_sold BIGINT, revenue DECIMAL(38,7));
  INSERT INTO @pd SELECT x.day, x.product_id, x.product_name, x.last_order_at, x.units_sold, x.revenue FROM ${FROM_SNAPSHOT('dbo.stats_snapshot_products')};
  WITH ${PRODUCT_DAYS_CTE}
  INSERT INTO @pd SELECT day, product_id, product_name, last_order_at, units_sold, revenue FROM product_days;
  WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER(PARTITION BY product_id ORDER BY last_order_at DESC) AS name_rank FROM @pd
  ), product_sales AS (
    SELECT product_id, MAX(CASE WHEN name_rank=1 THEN product_name END) AS name,
      SUM(units_sold) AS unitsSold, ROUND(SUM(revenue),0) AS revenue
    FROM ranked GROUP BY product_id
  )
  SELECT TOP (@lim) s.product_id AS id,s.name,s.unitsSold,s.revenue,p.images
  FROM product_sales s LEFT JOIN dbo.products p ON p.id=s.product_id
  ORDER BY ${PRODUCT_ORDER[sort]};`;

// range: { from, to ('YYYY-MM-DD' giờ VN), start, end (UTC, end loại trừ), fromDate?, toDate? }.
function rangeRequest(pool, range) {
  if (!isDay(range.from) || !isDay(range.to) || range.from > range.to) throw new Error('Khoảng thống kê không hợp lệ');
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) throw new Error('Khoảng thống kê quá dài');
  return pool.request().input('from', sql.Date, dateParam(range.from)).input('to', sql.Date, dateParam(range.to))
    .input('start', sql.DateTime2, range.start).input('end', sql.DateTime2, range.end);
}

// Báo cáo đọc theo chế độ. Mọi kết quả có cùng hình dạng với lib/business-report.js; headers() mô tả
// nguồn số liệu của TẤT CẢ các lần đọc trong request: snapshot | mixed | live và thời điểm tính.
function createReader(pool, mode) {
  let snapshotDays = 0, liveDays = 0, updatedAt = null;
  const totalsCache = new Map();
  function track(meta) {
    snapshotDays += meta.total_days - meta.live_days;
    liveDays += meta.live_days;
    if (meta.updated_at && (!updatedAt || meta.updated_at > updatedAt)) updatedAt = meta.updated_at;
  }
  async function totals(range) {
    const key = range.from + '|' + range.to;
    if (!totalsCache.has(key)) {
      totalsCache.set(key, rangeRequest(pool, range).query(TOTALS_SQL).then(result => {
        const [[meta], daily, [sums], [buyers]] = result.recordsets;
        track(meta);
        return { daily, summary: report.summaryShape({ ...sums, customers: buyers.customers }) };
      }));
    }
    return totalsCache.get(key);
  }
  if (mode !== 'async') {
    return {
      summary: range => report.summary(pool, range.start, range.end),
      dailyRevenue: range => report.dailyRevenue(pool, range),
      products: (range, limit, sort) => report.products(pool, range.start, range.end, limit, sort),
      headers: () => ({ 'X-Stats-Source': 'live', 'X-Stats-Updated-At': new Date().toISOString() }),
    };
  }
  return {
    summary: async range => (await totals(range)).summary,
    dailyRevenue: async range => report.dailyShape(range, (await totals(range)).daily),
    async products(range, limit = 10, sort = 'quantity') {
      report.checkProductOptions(limit, sort);
      const result = await rangeRequest(pool, range).input('lim', sql.Int, limit).query(productsSql(sort));
      track(result.recordsets[0][0]);
      return result.recordsets[1].map(report.productShape);
    },
    headers() {
      const source = !snapshotDays ? 'live' : liveDays ? 'mixed' : 'snapshot';
      return { 'X-Stats-Source': source, 'X-Stats-Updated-At': (snapshotDays && updatedAt ? updatedAt : new Date()).toISOString() };
    },
  };
}

// --- Đối soát + nạp lịch sử -----------------------------------------------------------------------------------
// Tính trực tiếp MỌI ngày từ ngày sớm nhất (đơn đầu tiên hoặc snapshot đầu tiên) tới hôm nay (giờ VN) và so
// nguyên dòng với snapshot (tổng ngày + từng sản phẩm, tên so nhị phân). Ngày thiếu hoặc lệch -> đưa job.
const RECONCILE_SQL = `
  DECLARE @first DATE = (SELECT MIN(day) FROM (
    SELECT CAST(DATEADD(MINUTE,420,MIN(created_at)) AS DATE) AS day FROM dbo.orders
    UNION ALL SELECT MIN(day) FROM dbo.stats_snapshots) f);
  DECLARE @today DATE = CAST(DATEADD(MINUTE,420,SYSUTCDATETIME()) AS DATE);
  ${LIVE_TABLE}
  IF @first IS NOT NULL AND @first <= @today
  BEGIN
    WITH n AS (SELECT TOP (DATEDIFF(DAY,@first,@today)+1) ROW_NUMBER() OVER(ORDER BY (SELECT NULL))-1 AS i
               FROM sys.all_objects a CROSS JOIN sys.all_objects b)
    INSERT INTO @live(day, s, e) SELECT ${liveRow('DATEADD(DAY,i,@first)')} FROM n;
  END;
  DECLARE @t TABLE (day DATE PRIMARY KEY, revenue DECIMAL(19,2), orders INT, completed INT, cancelled INT, products_sold BIGINT);
  WITH ${DAY_TOTALS_CTE}
  INSERT INTO @t SELECT l.day, COALESCE(t.revenue,0), COALESCE(t.orders,0), COALESCE(t.completed,0), COALESCE(t.cancelled,0),
    COALESCE(t.products_sold,0) FROM @live l LEFT JOIN day_totals t ON t.day = l.day;
  DECLARE @p TABLE (day DATE, product_id INT, product_name VARBINARY(400), last_order_at DATETIME2, units_sold BIGINT, revenue DECIMAL(38,7));
  WITH ${PRODUCT_DAYS_CTE}
  INSERT INTO @p SELECT day, product_id, CAST(product_name AS VARBINARY(400)), last_order_at, units_sold, revenue FROM product_days;
  DECLARE @bad TABLE (day DATE PRIMARY KEY);
  -- EXCEPT và UNION cùng độ ưu tiên, tính trái sang phải: mỗi chiều so sánh phải nằm trong ngoặc riêng.
  INSERT INTO @bad SELECT day FROM (
    (SELECT day, revenue, orders, completed, cancelled, products_sold FROM @t
     EXCEPT SELECT s.day, s.revenue, s.orders, s.completed, s.cancelled, s.products_sold FROM dbo.stats_snapshots s)
    UNION
    (SELECT s.day, s.revenue, s.orders, s.completed, s.cancelled, s.products_sold FROM dbo.stats_snapshots s WHERE s.day <= @today
     EXCEPT SELECT day, revenue, orders, completed, cancelled, products_sold FROM @t)
  ) totals_diff
  UNION
  SELECT day FROM (
    (SELECT day, product_id, product_name, last_order_at, units_sold, revenue FROM @p
     EXCEPT SELECT x.day, x.product_id, CAST(x.product_name AS VARBINARY(400)), x.last_order_at, x.units_sold, x.revenue
       FROM dbo.stats_snapshot_products x)
    UNION
    (SELECT x.day, x.product_id, CAST(x.product_name AS VARBINARY(400)), x.last_order_at, x.units_sold, x.revenue
       FROM dbo.stats_snapshot_products x WHERE x.day <= @today
     EXCEPT SELECT day, product_id, product_name, last_order_at, units_sold, revenue FROM @p)
  ) products_diff;
  SELECT DB_NAME() AS database_name, CONVERT(char(10), @first, 23) AS first_day, CONVERT(char(10), @today, 23) AS today;
  SELECT CONVERT(char(10), day, 23) AS day FROM @bad ORDER BY day;`;

// apply=false: chỉ trả danh sách ngày, không ghi gì. apply=true: đưa job cho các ngày đó (khoá chống trùng
// theo ngày nên chạy lặp hay nhiều process cùng chạy cũng không sinh job trùng đang chờ).
async function reconcileStats(pool, { apply = false } = {}) {
  const result = await pool.request().query(RECONCILE_SQL);
  const [[info], rows] = result.recordsets;
  const days = rows.map(row => row.day);
  let enqueued = 0;
  if (apply && days.length) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const day of days) {
        if ((await jobsQueue.enqueue(tx, { type: STATS_JOB, payload: { day }, dedupeKey: dedupeKeyFor(day) })).enqueued) enqueued++;
      }
      await tx.commit();
    } catch (error) {
      try { await tx.rollback(); } catch (_) { /* SQL đã tự rollback */ }
      throw error;
    }
  }
  return { database: info.database_name, firstDay: info.first_day, today: info.today, days, enqueued };
}

// Job stats mới nhất của một ngày đã failed (kể cả do worker chết ở lần thử cuối, khi claim tự chuyển
// failed mà không qua handler) -> snapshot của ngày đó có thể cũ: xoá để lần đọc tính trực tiếp; đối soát
// đêm sẽ đưa job lại. Ngày đã có job mới hơn (cùng dedupe_key) thì không đụng.
const CLEAR_FAILED_SQL = `
  DECLARE @failed TABLE (day DATE PRIMARY KEY);
  INSERT INTO @failed(day) SELECT DISTINCT TRY_CONVERT(DATE, SUBSTRING(j.dedupe_key, 7, 10)) FROM dbo.jobs j
    WHERE j.type = '${STATS_JOB}' AND j.status = 'failed' AND j.dedupe_key LIKE 'stats:%'
      AND TRY_CONVERT(DATE, SUBSTRING(j.dedupe_key, 7, 10)) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.jobs k WHERE k.type = j.type AND k.dedupe_key = j.dedupe_key AND k.id > j.id);
  DELETE x FROM dbo.stats_snapshot_products x JOIN @failed f ON f.day = x.day;
  DECLARE @cleared TABLE (day DATE);
  DELETE x OUTPUT DELETED.day INTO @cleared FROM dbo.stats_snapshots x JOIN @failed f ON f.day = x.day;
  SELECT COUNT(*) AS cleared FROM @cleared;`;
async function clearFailedDays(pool) {
  return (await pool.request().query(CLEAR_FAILED_SQL)).recordset[0].cleared;
}

module.exports = {
  STATS_JOB, vnDayOf, isDay, dedupeKeyFor, enqueueStatsDay, recomputeDay, deleteDay, createReader,
  reconcileStats, clearFailedDays, RECOMPUTE_SQL, TOTALS_SQL, RECONCILE_SQL, CLEAR_FAILED_SQL, productsSql,
};
