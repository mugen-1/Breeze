'use strict';

// SQL fixtures are SELECTs over parameterized JSON CTEs. No database rows,
// tables, configuration or shop data are created or changed by this script.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet:true });
const assert=require('node:assert/strict');
const {getPool,sql}=require('../db');
const report=require('../lib/business-report');
const fixture=require('../__tests__/helpers/business-report');
const declarations=`WITH fixture_orders AS (
  SELECT * FROM OPENJSON(@fixtureOrders) WITH(id INT,user_id INT,status VARCHAR(20),total_amount DECIMAL(12,2),DiscountAmount DECIMAL(12,2),created_at DATETIME2)
), fixture_items AS (
  SELECT * FROM OPENJSON(@fixtureItems) WITH(id INT,order_id INT,product_id INT,product_name NVARCHAR(200),quantity INT,line_total DECIMAL(12,2))
), fixture_products AS (
  SELECT * FROM OPENJSON(@fixtureProducts) WITH(id INT,name_vi NVARCHAR(200),images NVARCHAR(MAX))
)`;
async function main(){
  const pool=await getPool();
  try{
    const reader={request(){
      const request=pool.request().input('fixtureOrders',sql.NVarChar(sql.MAX),JSON.stringify(fixture.orders))
        .input('fixtureItems',sql.NVarChar(sql.MAX),JSON.stringify(fixture.items)).input('fixtureProducts',sql.NVarChar(sql.MAX),JSON.stringify(fixture.products));
      const query=request.query.bind(request);
      request.query=q=>{
        const source=q.replace(/dbo\.orders\b/g,'fixture_orders').replace(/dbo\.order_items\b/g,'fixture_items').replace(/dbo\.products\b/g,'fixture_products').trim();
        return query(declarations+(/^WITH\b/i.test(source)?', '+source.replace(/^WITH\s+/i,''):' '+source));
      };
      return request;
    }};
    const range={from:'2026-10-01',to:'2026-10-07',fromDate:new Date('2026-10-01T00:00:00Z'),toDate:new Date('2026-10-07T00:00:00Z'),
      start:new Date('2026-09-30T17:00:00Z'),end:new Date('2026-10-07T17:00:00Z')};
    assert.deepEqual(await report.summary(reader,range.start,range.end),fixture.summary);
    assert.deepEqual(await report.products(reader,range.start,range.end,10),fixture.top);
    const daily=await report.dailyRevenue(reader,range);
    assert.equal(daily.length,7);assert.deepEqual(daily[0],{date:'2026-10-01',revenue:880,orders:2,completedOrders:1,cancelledOrders:0});
    assert.deepEqual(daily[6],{date:'2026-10-07',revenue:220,orders:1,completedOrders:1,cancelledOrders:0});
    assert.equal(daily.reduce((n,d)=>n+d.revenue,0),1750);
    assert.deepEqual(await report.products(reader,range.start,range.end,1),[fixture.top[0]]);
    assert.deepEqual(await report.summary(reader,new Date('2026-11-01T00:00:00Z'),new Date('2026-11-02T00:00:00Z')),
      {revenue:0,orders:0,completedOrders:0,cancelledOrders:0,customers:0,productsSold:0,aov:0});
    assert.deepEqual(await report.products(reader,new Date('2026-11-01T00:00:00Z'),new Date('2026-11-02T00:00:00Z'),10),[]);
    console.log('Report SQL fixtures: revenue/order counts/distinct buyers/AOV/quantity/top sorting/snapshot names/voucher allocation/VN boundaries/empty range: PASS (read-only)');
  }finally{await pool.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
