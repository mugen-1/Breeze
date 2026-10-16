'use strict';
// Real Express router and Firebase auth middleware; only SQL/Firebase I/O is replaced.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express'), realSql = require('mssql');
let state, server, base;
const rows = recordset => ({ recordset, recordsets:[recordset], rowsAffected:[recordset.length] });
class Transaction { async begin() {} async commit() {} async rollback() {} }
class Request {
  constructor() { this.params = {}; }
  input(name,type,value) { this.params[name]=value; return this; }
  async query(raw) {
    const q=raw.replace(/\s+/g,' ').trim(), p=this.params;
    const userId=p.uid==='review-other'?2:1;
    if(q.startsWith('SELECT id FROM dbo.users WITH')) return rows([{id:userId}]);
    if(q.startsWith('MERGE dbo.users')) return rows([{id:userId,role:'customer'}]);
    state.queries.push({q,p});
    if(state.fail) throw Object.assign(new Error('PRIVATE_SQL_DETAIL'),{code:'EREQUEST'});
    if(q.startsWith('SELECT id FROM dbo.products')) {
      assert.equal(typeof p.id,'number'); assert.match(q,/id = @id AND is_active = 1/);
      return rows(state.products.filter(product=>product.id===p.id&&product.is_active).map(product=>({id:product.id})));
    }
    assert.match(q,/o.user_id = @uid AND o.status = 'completed' AND oi.product_id = @pid/);
    assert.match(q,/ROW_NUMBER\(\) OVER \(PARTITION BY oi.variant_id ORDER BY o.created_at DESC, o.id DESC, oi.id DESC\)/);
    assert.match(q,/SELECT order_item_id, variant_id, size_snapshot, color_snapshot/);
    assert.doesNotMatch(q,/JOIN dbo.product_variants|JOIN dbo.product_colors|firebase_uid|password|token|payment|card_number/i);
    assert.equal(typeof p.uid,'number'); assert.equal(typeof p.pid,'number');
    const purchased=state.items.filter(item=>item.user_id===p.uid&&item.product_id===p.pid&&item.status==='completed')
      .sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.order_id-a.order_id||b.order_item_id-a.order_item_id);
    const unique=new Map();for(const item of purchased)if(!unique.has(item.variant_id))unique.set(item.variant_id,item);
    const variants=[...unique.values()].sort((a,b)=>a.variant_id-b.variant_id).map(({order_item_id,variant_id,size_snapshot,color_snapshot})=>({order_item_id,variant_id,size_snapshot,color_snapshot}));
    const result=rows(variants);
    if(q.includes('AS hasReviewed')) {
      assert.match(q,/FROM dbo.reviews WHERE user_id = @uid AND product_id = @pid/);
      result.recordsets.push([{hasReviewed:state.reviews.some(review=>review.user_id===p.uid&&review.product_id===p.pid)}]);
    }
    return result;
  }
}
require.cache[require.resolve('../db')]={exports:{sql:{...realSql,Request,Transaction},getPool:async()=>({request:()=>new Request()})}};
require.cache[require.resolve('../firebase')]={exports:{getAuth:()=>({async verifyIdToken(token,checkRevoked){
  assert.equal(checkRevoked,true);
  if(!['active','other'].includes(token))throw Object.assign(new Error('PRIVATE_TOKEN_DETAIL'),{code:'auth/id-token-revoked'});
  return {uid:token==='other'?'review-other':'review-owner',email_verified:false};
}})}};
const app=express();app.use('/api/products',require('../routes/products'));
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
beforeEach(()=>{state={queries:[],fail:false,products:[{id:0,is_active:true},{id:7,is_active:true},{id:8,is_active:false}],items:[],reviews:[]};});
const item=patch=>({user_id:1,product_id:7,status:'completed',variant_id:71,order_item_id:11,order_id:1,created_at:'2026-10-14',size_snapshot:'M',color_snapshot:'Đen lúc mua',...patch});
async function call(id=7,query='',token='active',method='GET') {
  const response=await fetch(base+'/api/products/'+id+'/review-eligibility'+query,{method,headers:token==null?{}:{Authorization:'Bearer '+token}});
  return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text(),headers:response.headers};
}
test('missing auth token is rejected before any product/purchase/review SQL',async()=>{assert.equal((await call(7,'',null)).status,401);assert.equal(state.queries.length,0);});
for(const token of ['expired','revoked','disabled','deleted','invalid'])test('inactive token rejected: '+token,async t=>{t.mock.method(console,'warn',()=>{});assert.equal((await call(7,'',token)).status,401);assert.equal(state.queries.length,0);});
test('auth rejects even malformed product IDs before product validation',async()=>{assert.equal((await call('bad','',null)).status,401);});
for(const id of ['-1','1.5','NaN','2147483648','1e100','1e0','0x7','%20','1%20OR%201=1'])test('invalid SQL INT product ID rejected: '+id,async()=>{assert.equal((await call(id)).status,400);assert.equal(state.queries.length,0);});
test('product ID zero remains compatible with the catalog',async()=>{assert.equal((await call(0)).status,200);assert.equal(state.queries[0].p.id,0);});
test('valid INT upper bound reaches product lookup instead of overflow',async()=>{assert.equal((await call(2147483647)).status,404);assert.equal(state.queries[0].p.id,2147483647);});
test('missing product gives 404 without inspecting purchases',async()=>{assert.equal((await call(999)).status,404);assert.equal(state.queries.length,1);});
test('inactive product follows the existing public Product 404 convention',async()=>{assert.equal((await call(8)).status,404);assert.equal(state.queries.length,1);});
test('authenticated user who never bought product receives neutral eligibility',async()=>{const result=await call();assert.equal(result.status,200);assert.deepEqual(result.body,{canReview:false,hasReviewed:false,purchasedVariants:[]});assert.equal(result.headers.get('cache-control'),'no-store');});
for(const status of ['pending','confirmed','processing','shipping','cancelled','paid','shipped'])test('only '+status+' purchases do not qualify',async()=>{state.items=[item({status})];assert.deepEqual((await call()).body,{canReview:false,hasReviewed:false,purchasedVariants:[]});});
test('completed purchase returns only the purchased identity and order snapshot',async()=>{state.items=[item()];assert.deepEqual((await call()).body,{canReview:true,hasReviewed:false,purchasedVariants:[{order_item_id:11,variant_id:71,size_snapshot:'M',color_snapshot:'Đen lúc mua'}]});});
test('completed other-product purchase does not qualify',async()=>{state.items=[item({product_id:0})];assert.equal((await call()).body.canReview,false);});
test('another user completed purchase does not qualify',async()=>{state.items=[item({user_id:2})];assert.equal((await call()).body.canReview,false);});
test('client userId/user_id cannot override authenticated identity',async()=>{state.items=[item({user_id:2})];state.reviews=[{user_id:2,product_id:7}];const result=await call(7,'?userId=2&user_id=2&uid=2');assert.deepEqual(result.body,{canReview:false,hasReviewed:false,purchasedVariants:[]});assert.equal(state.queries[1].p.uid,1);});
test('different authenticated user reads only their own purchase relation',async()=>{state.items=[item({user_id:1}),item({user_id:2,variant_id:72,size_snapshot:'L'})];const result=await call(7,'','other');assert.deepEqual(result.body.purchasedVariants.map(v=>v.variant_id),[72]);assert.equal(state.queries[1].p.uid,2);});
test('repeat completed purchases deduplicate identity using newest snapshot',async()=>{state.items=[item(),item({order_id:2,order_item_id:22,created_at:'2026-10-15',color_snapshot:'Black purchase snapshot'}),item({variant_id:72,size_snapshot:'L'}),item({status:'cancelled',variant_id:73}),item({user_id:2,variant_id:74})];const result=await call();assert.deepEqual(result.body.purchasedVariants,[{order_item_id:22,variant_id:71,size_snapshot:'M',color_snapshot:'Black purchase snapshot'},{order_item_id:11,variant_id:72,size_snapshot:'L',color_snapshot:'Đen lúc mua'}]);assert.equal(state.queries.length,2);});
test('latest item tie breaks by order ID and then item ID',async()=>{state.items=[item({order_item_id:10}),item({order_id:2,order_item_id:11}),item({order_id:2,order_item_id:12})];assert.equal((await call()).body.purchasedVariants[0].order_item_id,12);});
test('legacy BASE purchase preserves null size/color without inventing metadata',async()=>{state.items=[item({size_snapshot:null,color_snapshot:null})];assert.deepEqual((await call()).body.purchasedVariants[0],{order_item_id:11,variant_id:71,size_snapshot:null,color_snapshot:null});});
test('hidden existing own review still sets hasReviewed',async()=>{state.items=[item()];state.reviews=[{user_id:1,product_id:7,is_hidden:true}];assert.deepEqual((await call()).body,{canReview:true,hasReviewed:true,purchasedVariants:[{order_item_id:11,variant_id:71,size_snapshot:'M',color_snapshot:'Đen lúc mua'}]});});
test('another user/product review never sets hasReviewed',async()=>{state.reviews=[{user_id:2,product_id:7},{user_id:1,product_id:0}];assert.equal((await call()).body.hasReviewed,false);});
test('hasReviewed is existence while canReview still requires completed purchase',async()=>{state.reviews=[{user_id:1,product_id:7}];assert.deepEqual((await call()).body,{canReview:false,hasReviewed:true,purchasedVariants:[]});});
test('database error uses generic response without internal SQL/token details',async t=>{t.mock.method(console,'error',()=>{});state.fail=true;const result=await call();assert.equal(result.status,500);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE_|EREQUEST|token|password/i);});
test('shared purchased-variants helper uses the same parameterized purchase relation',async()=>{state.items=[item()];const helper=require('../lib/review-eligibility');assert.deepEqual(await helper.getPurchasedProductVariants({request:()=>new Request()},1,7),[{order_item_id:11,variant_id:71,size_snapshot:'M',color_snapshot:'Đen lúc mua'}]);assert.equal(state.queries.length,1);});
for(const method of ['POST','PUT','PATCH','DELETE'])test('task exposes no review mutation endpoint: '+method,async()=>{assert.equal((await call(7,'','active',method)).status,404);assert.equal(state.queries.length,0);});
