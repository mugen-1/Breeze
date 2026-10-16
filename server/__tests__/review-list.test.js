'use strict';
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),express=require('express'),realSql=require('mssql');
let state,server,base;
const image=n=>'/review-images/'+String(n).padStart(32,'0')+'.webp';
const review={id:9,rating:4,comment:'Đẹp <script>',created_at:new Date('2026-10-15T10:16:00Z'),updated_at:new Date('2026-10-15T10:16:00Z'),
  variant_id:71,size_snapshot:'M',color_snapshot:'Đen lúc mua',display_name:'  Tên công khai  ',
  email:'PRIVATE email',phone:'PRIVATE phone',firebase_uid:'PRIVATE uid',user_id:1,order_item_id:11};
function request(){const params={};return {input(name,type,value){params[name]=value;return this;},async query(sql){
  state.queries.push({sql,params});if(state.fail)throw Object.assign(Error('PRIVATE SQL/path/stack'),{code:'EREQUEST'});
  return {recordsets:state.recordsets};
}};}
require.cache[require.resolve('../db')]={exports:{sql:realSql,getPool:async()=>({request})}};
// Public GET must never verify a token or write/upsert a user.
require.cache[require.resolve('../firebase')]={exports:{getAuth(){throw Error('Public GET called Firebase');}}};
const app=express();app.use('/api/products',require('../routes/products'));
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{await new Promise(r=>server.close(r));});
beforeEach(()=>{state={queries:[],recordsets:[[{id:7}],[{average_rating:4.86,total_reviews:7,rating_1:0,rating_2:0,rating_3:0,rating_4:1,rating_5:6,reviews_with_images:1}],
  [{total:7,page:1}],[{...review}],Array.from({length:5},(_,i)=>({review_id:9,image_path:image(i+1),sort_order:i}))]};});
async function call(query='',id=7,headers={}){const r=await fetch(base+'/api/products/'+id+'/reviews'+query,{headers});return {status:r.status,body:await r.json(),headers:r.headers};}
test('public guest gets reviews without authentication or user upsert',async()=>{const r=await call();assert.equal(r.status,200);assert.equal(state.queries.length,1);assert.equal(r.headers.get('cache-control'),'no-store');assert.doesNotMatch(state.queries[0].sql,/INSERT INTO dbo\.|UPDATE dbo\.|MERGE dbo\./);});
test('unverified bearer/header identity does not claim review ownership',async()=>{const r=await call('?userId=1',7,{Authorization:'Bearer invalid'});assert.equal(r.status,200);assert.equal(r.body.reviews[0].isOwner,undefined);assert.equal(state.queries[0].params.uid,undefined);});
for(const id of ['bad','-1','1.5','2147483648','1%20OR%201=1'])test('invalid product ID '+id,async()=>{assert.equal((await call('',id)).status,400);assert.equal(state.queries.length,0);});
test('product zero remains supported',async()=>{assert.equal((await call('',0)).status,200);assert.equal(state.queries[0].params.pid,0);});
test('missing/inactive product returns 404',async()=>{state.recordsets=[[]];assert.equal((await call()).status,404);});
for(const query of ['page=0','page=-1','page=1.5','page=bad','page=','page=2147483648','page=1&page=2','limit=0','limit=-1','limit=1.5','limit=101','limit=bad','limit=','limit=1&limit=2','rating=0','rating=6','rating=bad','rating=1.5','rating=','rating=1&rating=5','hasImages=1','hasImages=bad','hasImages=','hasImages=true&hasImages=false'])test('invalid query '+query,async()=>{const r=await call('?'+query);assert.equal(r.status,400);assert.equal(r.body.code,'REVIEW_INVALID_QUERY');assert.equal(state.queries.length,0);});
test('default page size and query values are bound parameters',async()=>{await call();assert.deepEqual(state.queries[0].params,{pid:7,page:1,limit:10,rating:null,hasImages:false});});
for(const rating of [1,2,3,4,5])test('rating '+rating+' and image filter bind independently with AND',async()=>{await call('?rating='+rating+'&hasImages=true&page=2&limit=100');assert.deepEqual(state.queries[0].params,{pid:7,page:2,limit:100,rating,hasImages:true});assert.match(state.queries[0].sql,/AND \(@rating IS NULL OR r.rating=@rating\)\s+AND \(@hasImages=0 OR EXISTS/);});
test('hasImages=false is the unfiltered default',async()=>{await call('?hasImages=false');assert.equal(state.queries[0].params.hasImages,false);});
test('public DTO uses only explicit public fields and stored variant snapshots',async()=>{const r=await call();assert.deepEqual(r.body.reviews[0],{id:9,productId:7,rating:4,comment:'Đẹp <script>',displayName:'Tên công khai',
  variant:{id:71,size:'M',color:'Đen lúc mua'},images:Array.from({length:5},(_,i)=>({url:image(i+1)})),createdAt:review.created_at.toISOString(),updatedAt:review.updated_at.toISOString()});assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE|email|phone|firebase|token|user_id|order_item_id/);});
test('summary exposes real aggregate with one decimal and all five counts',async()=>{const r=await call();assert.deepEqual(r.body.summary,{averageRating:4.9,totalReviews:7,ratingCounts:{1:0,2:0,3:0,4:1,5:6},reviewsWithImages:1});assert.deepEqual([r.body.page,r.body.limit,r.body.total,r.body.totalPages],[1,10,7,1]);});
test('empty visible data has null average and zero summary',async()=>{state.recordsets=[[{id:7}],[{average_rating:null,total_reviews:0,rating_1:0,rating_2:0,rating_3:0,rating_4:0,rating_5:0,reviews_with_images:0}],[{total:0,page:1}],[],[]];const r=await call();assert.equal(r.body.summary.averageRating,null);assert.equal(r.body.summary.totalReviews,0);assert.equal(r.body.totalPages,0);assert.deepEqual(r.body.reviews,[]);});
test('missing author name never falls back to sensitive email or invented name',async()=>{state.recordsets[3][0].display_name=null;assert.equal((await call()).body.reviews[0].displayName,null);});
test('SQL page metadata, not the requested out-of-range page, controls response',async()=>{state.recordsets[2]=[{total:7,page:1}];assert.equal((await call('?page=2147483647')).body.page,1);});
test('batched image load is bounded to five safe upload URLs per review',async()=>{state.recordsets[4].unshift({review_id:9,image_path:'C:\\PRIVATE\\image.webp',sort_order:0});state.recordsets[4].push({review_id:9,image_path:image(6),sort_order:6});const r=await call();assert.equal(r.body.reviews[0].images.length,5);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE/);assert.equal(state.queries.length,1);assert.match(state.queries[0].sql,/JOIN @selected/);});
test('SQL uses visible reviews in aggregate/count/page and stable ordering without current variant lookup',async()=>{await call();const q=state.queries[0].sql;assert.equal((q.match(/r.product_id=@pid AND r.is_hidden=0/g)||[]).length,5);assert.match(q,/AVG\(CAST/);assert.match(q,/ORDER BY r.created_at DESC,r.id DESC OFFSET/);assert.doesNotMatch(q,/dbo.product_variants|u.email|u.phone|firebase_uid/);});
test('database failure does not expose SQL, paths or raw stack',async t=>{t.mock.method(console,'error',()=>{});state.fail=true;const r=await call();assert.equal(r.status,500);assert.equal(r.body.code,'REVIEW_LIST_ERROR');assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE|EREQUEST|stack|[A-Z]:\\/);});
