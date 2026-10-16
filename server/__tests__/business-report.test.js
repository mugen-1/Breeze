'use strict';
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),express=require('express'),realSql=require('mssql');
const fixture=require('./helpers/business-report');
let queries,fail,empty;
const result=rows=>({recordset:rows,rowsAffected:[rows.length]});
function selected(p){return empty?[]:fixture.orders.filter(o=>new Date(o.created_at)>=p.start&&new Date(o.created_at)<p.end);}
class Transaction{async begin(){} async commit(){} async rollback(){}}
class Request{
  constructor(){this.params={};}
  input(name,type,value){this.params[name]=value;return this;}
  async query(source){
    const q=source.replace(/\s+/g,' ').trim(),p=this.params;queries.push({q,p});
    if(q.startsWith('SELECT id FROM dbo.users WITH'))return result([{id:1}]);
    if(q.startsWith('MERGE dbo.users'))return result([{id:1,role:p.uid==='admin'?'admin':'customer'}]);
    if(q.includes('MAX(created_at)'))return result([{mx:new Date('2026-10-07T16:59:59.999Z')}]);
    assert.ok(p.start instanceof Date&&p.end instanceof Date);
    assert.ok(p.start<p.end);assert.doesNotMatch(q,/INSERT|UPDATE|DELETE|dbo\.payment_transactions|dbo\.cart_items/);
    if(fail)throw Object.assign(new Error('PRIVATE_REPORT_SQL_CREDENTIAL'),{code:'EQUERY'});
    const rows=selected(p),sold=rows.filter(o=>o.status==='completed'),ids=new Set(sold.map(o=>o.id));
    if(q.startsWith('WITH report_orders')){
      assert.match(q,/CASE WHEN status='completed'/);assert.match(q,/COUNT\(DISTINCT CASE/);
      return result([{revenue:sold.reduce((n,o)=>n+o.total_amount,0),orders:rows.length,completedOrders:sold.length,
        cancelledOrders:rows.filter(o=>o.status==='cancelled').length,customers:new Set(sold.map(o=>o.user_id)).size,
        productsSold:fixture.items.filter(it=>ids.has(it.order_id)).reduce((n,it)=>n+it.quantity,0)}]);
    }
    if(q.startsWith('WITH sold_items')){
      assert.match(q,/o.status='completed'/);assert.match(q,/ROW_NUMBER\(\) OVER/);
      assert.match(q,/PARTITION BY oi.order_id/);assert.doesNotMatch(q,/p\.name_vi|p\.price/);
      return result(sold.length?fixture.top.slice(0,p.lim).map(o=>({...o,images:o.id===12?'["img/test.png"]':'[]'})):[]);
    }
    if(q.includes('DATEADD(MINUTE,420,created_at)')){
      const groups={};
      for(const o of rows){const d=new Date(new Date(o.created_at).getTime()+7*3600000).toISOString().slice(0,10);
        const r=groups[d]||(groups[d]={d,revenue:0,orders:0,completedOrders:0,cancelledOrders:0});r.orders++;
        if(o.status==='completed'){r.revenue+=o.total_amount;r.completedOrders++;}if(o.status==='cancelled')r.cancelledOrders++;}
      return result(Object.values(groups));
    }
    if(q.includes('GROUP BY status'))return result([]);
    throw new Error('Unexpected report query: '+q);
  }
}
const pool={request:()=>new Request()};
require.cache[require.resolve('../db')]={exports:{getPool:async()=>pool,sql:{...realSql,Request,Transaction}}};
require.cache[require.resolve('../firebase')]={exports:{getAuth:()=>({async verifyIdToken(token,revoked){
  assert.equal(revoked,true);if(!['admin','buyer'].includes(token))throw new Error('invalid token');
  return {uid:token,email:token+'@example.test',email_verified:true};
}})}};
const app=express();app.use('/api/admin',require('../routes/admin'));let server,base;
const savedAdmins=process.env.ADMIN_EMAILS;
before(async()=>{process.env.ADMIN_EMAILS='';server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{if(savedAdmins==null)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=savedAdmins;await new Promise(r=>server.close(r));});
beforeEach(()=>{queries=[];fail=false;empty=false;});
async function call(path='/stats/business-report?from=2026-10-01&to=2026-10-07',token='admin'){
  const r=await fetch(base+'/api/admin'+path,{headers:token?{Authorization:'Bearer '+token}:{}});return {status:r.status,body:await r.json()};
}
test('Admin report contains complete KPI, daily data and Top 10',async()=>{
  const r=await call();assert.equal(r.status,200);assert.deepEqual(r.body.summary,fixture.summary);
  assert.deepEqual(r.body.range,{from:'2026-10-01',to:'2026-10-07'});assert.deepEqual(r.body.topProducts,fixture.top);
  assert.equal(r.body.dailyRevenue.length,7);assert.equal(r.body.dailyRevenue.reduce((n,d)=>n+d.revenue,0),1750);
  assert.equal(r.body.dailyRevenue[0].orders,2);assert.equal(r.body.dailyRevenue[0].completedOrders,1);
  assert.doesNotMatch(JSON.stringify(r.body),/firebase_uid|email|shipping_address|transaction_code|password/);
  const reportQueries=queries.filter(x=>x.p.start);assert.equal(reportQueries.length,3);
  assert.ok(reportQueries.every(x=>x.p.start.toISOString()==='2026-09-30T17:00:00.000Z'&&x.p.end.toISOString()==='2026-10-07T17:00:00.000Z'));
  assert.equal(reportQueries.find(x=>x.p.lim).p.lim,10);
});
test('Dashboard uses the same KPI and daily formula as the report',async()=>{
  const report=await call(),dash=await call('/stats?from=2026-10-01&to=2026-10-07');
  assert.equal(dash.status,200);assert.deepEqual(dash.body.current,report.body.summary);
  assert.deepEqual(dash.body.dailyRevenue,report.body.dailyRevenue);
  assert.equal(dash.body.previous.revenue,55555,'previous range uses VN midnight and same length');
});
test('Statistics and dashboard top products share completed snapshots and voucher revenue',async()=>{
  const stat=await call('/statistics?range=7d'),top=await call('/stats/top-products?from=2026-10-01&to=2026-10-07&limit=5');
  assert.equal(stat.status,200);assert.equal(top.status,200);assert.equal(stat.body.totalRevenue,1650);
  assert.deepEqual(stat.body.items,fixture.top.map(p=>({productName:p.name,quantity:p.unitsSold,revenue:p.revenue})));
  assert.deepEqual(top.body,fixture.top);
});
for(const [key,from]of[['7d','2026-10-01'],['30d','2026-09-08'],['month','2026-10-01'],['year','2026-01-01']]){
  test('Statistics '+key+' uses VN dates consistent with Dashboard range',async()=>{
    const r=await call('/statistics?range='+key);assert.equal(r.status,200);assert.equal(r.body.from,from);assert.equal(r.body.to,'2026-10-07');
    const q=queries.find(x=>x.p.start);assert.equal(q.p.start.toISOString(),new Date(from+'T00:00:00+07:00').toISOString());
    assert.equal(q.p.end.toISOString(),'2026-10-07T17:00:00.000Z');
  });
}
test('default range is exactly 30 inclusive days',async()=>{const r=await call('/stats/business-report');assert.deepEqual(r.body.range,{from:'2026-09-08',to:'2026-10-07'});assert.equal(r.body.dailyRevenue.length,30);});
test('empty range has zero KPI, zero AOV, valid daily rows and no top products',async()=>{
  empty=true;const r=await call();assert.equal(r.status,200);assert.ok(Object.values(r.body.summary).every(n=>n===0));
  assert.equal(r.body.dailyRevenue.length,7);assert.ok(r.body.dailyRevenue.every(d=>d.revenue===0&&d.orders===0));assert.deepEqual(r.body.topProducts,[]);
});
for(const token of [null,'invalid','buyer'])test('report rejects '+token+' access',async()=>{
  const r=await call(undefined,token);assert.equal(r.status,token==='buyer'?403:401);assert.ok(!queries.some(x=>x.p.start));
});
for(const suffix of ['from=2026-10-01','from=bad&to=2026-10-07','from=2026-02-30&to=2026-10-07',
  'from=2026-10-08&to=2026-10-07','from=2025-01-01&to=2026-10-07','from=0000-01-01&to=0000-01-02',
  'from=10000-01-01&to=10000-01-01','from=2026-10-01%27%3BDROP%20TABLE%20orders&to=2026-10-07',
  'from=2026-10-01&from=2026-10-02&to=2026-10-07'])test('invalid report dates rejected: '+suffix,async()=>{
  assert.equal((await call('/stats/business-report?'+suffix)).status,400);assert.ok(!queries.some(x=>x.p.start));
});
test('invalid Statistics range is rejected',async()=>assert.equal((await call('/statistics?range=anything')).status,400));
test('last SQL Server date is valid because VN end midnight is still inside UTC year 9999',async()=>{
  const r=await call('/stats/business-report?from=9999-12-31&to=9999-12-31');assert.equal(r.status,200);
  assert.equal(queries.find(x=>x.p.end).p.end.toISOString(),'9999-12-31T17:00:00.000Z');
});
test('database error yields generic report failure without private details',async t=>{
  const logs=[];t.mock.method(console,'error',(...parts)=>logs.push(parts.join(' ')));fail=true;
  const r=await call();assert.equal(r.status,500);assert.doesNotMatch(JSON.stringify(r.body)+logs.join(' '),/PRIVATE_REPORT_SQL_CREDENTIAL/);
});
