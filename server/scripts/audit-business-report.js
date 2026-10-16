'use strict';

// Read-only verification against real SQL Server. No fixture, migration or write.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { getPool, sql } = require('../db');
const report = require('../lib/business-report');
const day = time => new Date(new Date(time).getTime() + 7*3600000).toISOString().slice(0,10);
async function main() {
  const pool = await getPool(), tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const reader = { request: () => new sql.Request(tx) };
    const orders = (await reader.request().query('SELECT id,user_id,status,total_amount,DiscountAmount,created_at FROM dbo.orders ORDER BY id;')).recordset;
    const items = (await reader.request().query('SELECT id,order_id,product_id,product_name,quantity,line_total FROM dbo.order_items ORDER BY id;')).recordset;
    const completed = orders.filter(o => o.status === 'completed');
    const anchor = (completed.length ? completed : orders).reduce((n,o) => Math.max(n,new Date(o.created_at).getTime()), 0) || Date.now();
    const to = day(anchor), y = +to.slice(0,4), m = +to.slice(5,7), d = +to.slice(8,10);
    for (const preset of ['7d','30d','month','year']) {
      const from = preset === 'month' ? to.slice(0,7)+'-01' : preset === 'year' ? to.slice(0,4)+'-01-01' :
        new Date(Date.UTC(y,m-1,d) - (preset==='7d'?6:29)*86400000).toISOString().slice(0,10);
      const range = { from,to,fromDate:new Date(from+'T00:00:00Z'),toDate:new Date(to+'T00:00:00Z'),
        start:new Date(from+'T00:00:00+07:00'),end:new Date(new Date(to+'T00:00:00+07:00').getTime()+86400000) };
      const selected = orders.filter(o => new Date(o.created_at)>=range.start && new Date(o.created_at)<range.end);
      const sold = selected.filter(o => o.status==='completed'), byOrder = new Map(sold.map(o=>[o.id,o]));
      const soldItems = items.filter(it=>byOrder.has(it.order_id));
      const revenue = sold.reduce((sum,o)=>sum+Number(o.total_amount),0);
      const expected = { revenue,orders:selected.length,completedOrders:sold.length,
        cancelledOrders:selected.filter(o=>o.status==='cancelled').length,
        customers:new Set(sold.map(o=>o.user_id).filter(id=>id!=null)).size,
        productsSold:soldItems.reduce((sum,it)=>sum+it.quantity,0),aov:sold.length?Math.round(revenue/sold.length):0 };
      const actual = await report.summary(reader,range.start,range.end);
      assert.deepEqual(actual,expected);
      const daily = await report.dailyRevenue(reader,range);
      for (const row of daily) {
        const group=selected.filter(o=>day(o.created_at)===row.date), sales=group.filter(o=>o.status==='completed');
        assert.deepEqual(row,{date:row.date,revenue:sales.reduce((sum,o)=>sum+Number(o.total_amount),0),orders:group.length,
          completedOrders:sales.length,cancelledOrders:group.filter(o=>o.status==='cancelled').length});
      }
      assert.equal(daily.reduce((sum,row)=>sum+row.revenue,0),expected.revenue);
      const totals = new Map();
      for (const it of soldItems) totals.set(it.order_id,(totals.get(it.order_id)||0)+Number(it.line_total));
      const products = new Map();
      for (const it of soldItems) {
        const o=byOrder.get(it.order_id), subtotal=totals.get(it.order_id);
        const factor=subtotal>0?Math.max(0,subtotal-Number(o.DiscountAmount||0))/subtotal:0;
        const p=products.get(it.product_id)||{id:it.product_id,name:it.product_name,unitsSold:0,revenue:0,stamp:-Infinity,orderId:0,itemId:0};
        p.unitsSold+=it.quantity;p.revenue+=Number(it.line_total)*factor;
        const stamp=new Date(o.created_at).getTime();
        if(stamp>p.stamp||(stamp===p.stamp&&(o.id>p.orderId||(o.id===p.orderId&&it.id>p.itemId)))) {
          p.name=it.product_name;p.stamp=stamp;p.orderId=o.id;p.itemId=it.id;
        }
        products.set(it.product_id,p);
      }
      const expectedProducts=[...products.values()].map(p=>({id:p.id,name:p.name,unitsSold:p.unitsSold,revenue:Math.round(p.revenue)}))
        .sort((a,b)=>b.unitsSold-a.unitsSold||b.revenue-a.revenue||a.id-b.id).slice(0,10);
      const top=await report.products(reader,range.start,range.end,10);
      assert.deepEqual(top.map(({imageUrl,...p})=>p),expectedProducts);
      console.log(JSON.stringify({preset,from,to,...actual,topProducts:top.length,verification:'PASS'}));
    }
    await tx.commit();
    console.log('Business report SQL audit: PASS (read-only; source snapshots verified independently)');
  } catch(error) {
    try { await tx.rollback(); } catch(_) { /* already rolled back */ }
    throw error;
  } finally { await pool.close(); }
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
