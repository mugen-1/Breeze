'use strict';

const { sql } = require('../db');

// Biểu thức dùng chung cho truy vấn trực tiếp (dưới đây) và thống kê tính sẵn theo ngày
// (lib/stats-snapshot.js): cả hai dựng SQL từ CÙNG các chuỗi này, nên chỉ có một định nghĩa
// doanh thu / số đơn / số sản phẩm bán / phân bổ voucher.
const SALES = Object.freeze({
  revenue: "COALESCE(SUM(CASE WHEN status='completed' THEN total_amount ELSE 0 END),0)",
  orders: 'COUNT(*)',
  completed: "COUNT(CASE WHEN status='completed' THEN 1 END)",
  cancelled: "COUNT(CASE WHEN status='cancelled' THEN 1 END)",
  customers: "COUNT(DISTINCT CASE WHEN status='completed' THEN user_id END)",
});
// Ngày theo giờ Việt Nam (UTC+7) dạng 'YYYY-MM-DD'.
const vnDay = column => `CONVERT(char(10),DATEADD(MINUTE,420,${column}),23)`;
// Số sản phẩm bán của các đơn completed trong tập đơn `orders` (tên CTE/bảng có cột id, status).
const productsSold = orders => `(SELECT COALESCE(SUM(CAST(oi.quantity AS BIGINT)),0) FROM dbo.order_items oi
        JOIN ${orders} o ON o.id=oi.order_id WHERE o.status='completed')`;
// Dòng hàng của đơn completed kèm subtotal của đơn (để phân bổ voucher) và thứ hạng tên snapshot
// (dòng mới nhất trong partition). Điều kiện lọc đơn ghép phía sau.
const soldItemsSelect = partition => `SELECT oi.*,o.created_at,o.DiscountAmount,
        SUM(oi.line_total) OVER(PARTITION BY oi.order_id) AS subtotal,
        ROW_NUMBER() OVER(PARTITION BY ${partition} ORDER BY o.created_at DESC,oi.order_id DESC,oi.id DESC) AS name_rank
      FROM dbo.order_items oi JOIN dbo.orders o ON o.id=oi.order_id`;
// Doanh thu dòng hàng sau phân bổ voucher theo tỉ lệ line_total/subtotal, CHƯA làm tròn (numeric(38,7)).
// Báo cáo làm tròn SAU khi cộng cả khoảng, nên bảng tính sẵn lưu giá trị chưa làm tròn.
const ALLOCATED_REVENUE = `SUM(line_total * CASE
          WHEN subtotal<=0 THEN 0
          WHEN COALESCE(DiscountAmount,0)>=subtotal THEN 0
          ELSE 1 - COALESCE(DiscountAmount,0)*1.0/subtotal END)`;
// Only these fixed ORDER BY clauses enter SQL; no raw client input.
const PRODUCT_ORDER = Object.freeze({
  revenue: 'revenue DESC, unitsSold DESC, product_id ASC',
  quantity: 'unitsSold DESC, revenue DESC, product_id ASC',
});

// Shared by Dashboard, Statistics and CSV. Sales use completed orders only;
// order count includes every status; buyers are distinct completed-order users.
async function summary(pool, start, end) {
  const r = await pool.request().input('start', sql.DateTime2, start).input('end', sql.DateTime2, end).query(`
    WITH report_orders AS (
      SELECT id,user_id,status,total_amount FROM dbo.orders WHERE created_at>=@start AND created_at<@end
    )
    SELECT ${SALES.revenue} AS revenue,
      ${SALES.orders} AS orders,
      ${SALES.completed} AS completedOrders,
      ${SALES.cancelled} AS cancelledOrders,
      ${SALES.customers} AS customers,
      ${productsSold('report_orders')} AS productsSold
    FROM report_orders;`);
  return summaryShape(r.recordset[0]);
}
// Cùng một hình dạng kết quả cho truy vấn trực tiếp và bảng tính sẵn.
function summaryShape(row) {
  const data = Object.fromEntries(['revenue','orders','completedOrders','cancelledOrders','customers','productsSold']
    .map(key => [key, Number(row[key]) || 0]));
  // Keep the existing VND rounding. Revenue includes the order's shipping fee.
  data.aov = data.completedOrders ? Math.round(data.revenue / data.completedOrders) : 0;
  return data;
}

async function dailyRevenue(pool, range) {
  const r = await pool.request().input('start', sql.DateTime2, range.start).input('end', sql.DateTime2, range.end).query(`
    SELECT ${vnDay('created_at')} AS d,
      ${SALES.revenue} AS revenue,
      ${SALES.orders} AS orders, ${SALES.completed} AS completedOrders,
      ${SALES.cancelled} AS cancelledOrders
    FROM dbo.orders WHERE created_at>=@start AND created_at<@end
    GROUP BY ${vnDay('created_at')};`);
  return dailyShape(range, r.recordset);
}
// Mọi ngày trong khoảng (kể cả ngày không có đơn), theo thứ tự ngày.
function dailyShape(range, rows) {
  const byDay = Object.fromEntries(rows.map(row => [row.d, row]));
  const days = [];
  for (let time = range.fromDate.getTime(); time <= range.toDate.getTime(); time += 86400000) {
    const date = new Date(time).toISOString().slice(0,10), row = byDay[date] || {};
    days.push({ date, revenue: Number(row.revenue) || 0, orders: Number(row.orders) || 0,
      completedOrders: Number(row.completedOrders) || 0, cancelledOrders: Number(row.cancelledOrders) || 0 });
  }
  return days;
}

function checkProductOptions(limit, sort) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2147483647 || !Object.prototype.hasOwnProperty.call(PRODUCT_ORDER, sort)) {
    throw new Error('Invalid report product options');
  }
}
async function products(pool, start, end, limit = 10, sort = 'quantity') {
  checkProductOptions(limit, sort);
  const r = await pool.request().input('start', sql.DateTime2, start).input('end', sql.DateTime2, end)
    .input('lim', sql.Int, limit).query(`
    WITH sold_items AS (
      ${soldItemsSelect('oi.product_id')}
      WHERE o.status='completed' AND o.created_at>=@start AND o.created_at<@end
    ), product_sales AS (
      SELECT product_id, MAX(CASE WHEN name_rank=1 THEN product_name END) AS name,
        SUM(CAST(quantity AS BIGINT)) AS unitsSold,
        ROUND(${ALLOCATED_REVENUE},0) AS revenue
      FROM sold_items GROUP BY product_id
    )
    SELECT TOP (@lim) s.product_id AS id,s.name,s.unitsSold,s.revenue,p.images
    FROM product_sales s LEFT JOIN dbo.products p ON p.id=s.product_id
    ORDER BY ${PRODUCT_ORDER[sort]};`);
  return r.recordset.map(productShape);
}
function productShape(row) {
  let imageUrl = 'img/breeze.png';
  try {
    const images = JSON.parse(row.images);
    if (Array.isArray(images) && typeof images[0] === 'string' && images[0].trim()) imageUrl = images[0];
  } catch (_) { /* The report name and prices always come from order snapshots. */ }
  // Merchandise revenue is after voucher, excluding shipping, as Statistics used to calculate it.
  return { id: row.id, name: row.name, imageUrl, unitsSold: Number(row.unitsSold) || 0, revenue: Number(row.revenue) || 0 };
}

module.exports = {
  summary, dailyRevenue, products,
  SALES, vnDay, productsSold, soldItemsSelect, ALLOCATED_REVENUE, PRODUCT_ORDER,
  summaryShape, dailyShape, productShape, checkProductOptions,
};
