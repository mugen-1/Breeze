'use strict';

const { sql } = require('../db');

// Shared by Dashboard, Statistics and CSV. Sales use completed orders only;
// order count includes every status; buyers are distinct completed-order users.
async function summary(pool, start, end) {
  const r = await pool.request().input('start', sql.DateTime2, start).input('end', sql.DateTime2, end).query(`
    WITH report_orders AS (
      SELECT id,user_id,status,total_amount FROM dbo.orders WHERE created_at>=@start AND created_at<@end
    )
    SELECT COALESCE(SUM(CASE WHEN status='completed' THEN total_amount ELSE 0 END),0) AS revenue,
      COUNT(*) AS orders,
      COUNT(CASE WHEN status='completed' THEN 1 END) AS completedOrders,
      COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelledOrders,
      COUNT(DISTINCT CASE WHEN status='completed' THEN user_id END) AS customers,
      (SELECT COALESCE(SUM(CAST(oi.quantity AS BIGINT)),0) FROM dbo.order_items oi
        JOIN report_orders o ON o.id=oi.order_id WHERE o.status='completed') AS productsSold
    FROM report_orders;`);
  const row = r.recordset[0];
  const data = Object.fromEntries(['revenue','orders','completedOrders','cancelledOrders','customers','productsSold']
    .map(key => [key, Number(row[key]) || 0]));
  // Keep the existing VND rounding. Revenue includes the order's shipping fee.
  data.aov = data.completedOrders ? Math.round(data.revenue / data.completedOrders) : 0;
  return data;
}

async function dailyRevenue(pool, range) {
  const r = await pool.request().input('start', sql.DateTime2, range.start).input('end', sql.DateTime2, range.end).query(`
    SELECT CONVERT(char(10),DATEADD(MINUTE,420,created_at),23) AS d,
      COALESCE(SUM(CASE WHEN status='completed' THEN total_amount ELSE 0 END),0) AS revenue,
      COUNT(*) AS orders, COUNT(CASE WHEN status='completed' THEN 1 END) AS completedOrders,
      COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelledOrders
    FROM dbo.orders WHERE created_at>=@start AND created_at<@end
    GROUP BY CONVERT(char(10),DATEADD(MINUTE,420,created_at),23);`);
  const byDay = Object.fromEntries(r.recordset.map(row => [row.d, row]));
  const days = [];
  for (let time = range.fromDate.getTime(); time <= range.toDate.getTime(); time += 86400000) {
    const date = new Date(time).toISOString().slice(0,10), row = byDay[date] || {};
    days.push({ date, revenue: Number(row.revenue) || 0, orders: Number(row.orders) || 0,
      completedOrders: Number(row.completedOrders) || 0, cancelledOrders: Number(row.cancelledOrders) || 0 });
  }
  return days;
}

async function products(pool, start, end, limit = 10, sort = 'quantity') {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2147483647 || !['quantity','revenue'].includes(sort)) {
    throw new Error('Invalid report product options');
  }
  // Only these fixed ORDER BY clauses enter SQL; no raw client input.
  const order = sort === 'revenue' ? 'revenue DESC, unitsSold DESC, product_id ASC' : 'unitsSold DESC, revenue DESC, product_id ASC';
  const r = await pool.request().input('start', sql.DateTime2, start).input('end', sql.DateTime2, end)
    .input('lim', sql.Int, limit).query(`
    WITH sold_items AS (
      SELECT oi.*,o.created_at,o.DiscountAmount,
        SUM(oi.line_total) OVER(PARTITION BY oi.order_id) AS subtotal,
        ROW_NUMBER() OVER(PARTITION BY oi.product_id ORDER BY o.created_at DESC,oi.order_id DESC,oi.id DESC) AS name_rank
      FROM dbo.order_items oi JOIN dbo.orders o ON o.id=oi.order_id
      WHERE o.status='completed' AND o.created_at>=@start AND o.created_at<@end
    ), product_sales AS (
      SELECT product_id, MAX(CASE WHEN name_rank=1 THEN product_name END) AS name,
        SUM(CAST(quantity AS BIGINT)) AS unitsSold,
        ROUND(SUM(line_total * CASE
          WHEN subtotal<=0 THEN 0
          WHEN COALESCE(DiscountAmount,0)>=subtotal THEN 0
          ELSE 1 - COALESCE(DiscountAmount,0)*1.0/subtotal END),0) AS revenue
      FROM sold_items GROUP BY product_id
    )
    SELECT TOP (@lim) s.product_id AS id,s.name,s.unitsSold,s.revenue,p.images
    FROM product_sales s LEFT JOIN dbo.products p ON p.id=s.product_id
    ORDER BY ${order};`);
  return r.recordset.map(row => {
    let imageUrl = 'img/breeze.png';
    try {
      const images = JSON.parse(row.images);
      if (Array.isArray(images) && typeof images[0] === 'string' && images[0].trim()) imageUrl = images[0];
    } catch (_) { /* The report name and prices always come from order snapshots. */ }
    // Merchandise revenue is after voucher, excluding shipping, as Statistics used to calculate it.
    return { id: row.id, name: row.name, imageUrl, unitsSold: Number(row.unitsSold) || 0, revenue: Number(row.revenue) || 0 };
  });
}

module.exports = { summary, dailyRevenue, products };
