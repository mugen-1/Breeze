'use strict';
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const express=require('express'),realSql=require('mssql'),sharp=require('sharp');
let state,server,base,directory,png;
const result=recordset=>({recordset,recordsets:[recordset]});
class Transaction{
  async begin(){this.rows=structuredClone(state.rows);this.images=structuredClone(state.images);}
  async commit(){if(this.dirty&&state.failCommit)throw Error('PRIVATE commit');state.rows=this.rows;state.images=this.images;}
  async rollback(){state.rollbacks++;}
}
class Request{
  constructor(tx){this.tx=tx;this.params={};}
  input(key,type,value){this.params[key]=value;return this;}
  async query(raw){
    const q=raw.replace(/\s+/g,' ').trim(),p=this.params,rows=this.tx?this.tx.rows:state.rows,images=this.tx?this.tx.images:state.images;
    if(q.startsWith('SELECT id FROM dbo.users WITH')&&typeof p.uid==='string')return result([{id:p.uid==='other'?2:1}]);
    if(q.startsWith('MERGE dbo.users'))return result([{id:p.uid==='other'?2:1,role:'customer'}]);
    state.queries.push({q,p});
    if(q.startsWith('SELECT id FROM dbo.users'))return result([{id:p.uid}]);
    if(q.startsWith('SELECT id FROM dbo.products'))return {recordsets:[p.pid===7?[{id:7}]:[],rows.filter(r=>r.user_id===p.uid&&r.product_id===p.pid),images.filter(i=>rows.some(r=>r.id===i.review_id&&r.user_id===p.uid&&r.product_id===p.pid))]};
    if(q.startsWith('SELECT id,product_id'))return result(rows.filter(r=>r.id===p.rid&&r.user_id===p.uid&&r.product_id===p.pid));
    if(q.startsWith('SELECT id,image_path'))return result(images.filter(i=>i.review_id===p.rid).sort((a,b)=>a.sort_order-b.sort_order));
    if(q.startsWith('WITH purchased')){assert.match(q,/o.user_id = @uid AND o.status = 'completed' AND oi.product_id = @pid/);return result(state.purchases.filter(i=>i.user_id===p.uid&&i.product_id===p.pid&&i.status==='completed'));}
    this.tx.dirty=true;
    if(q.startsWith('UPDATE dbo.reviews SET')){
      assert.doesNotMatch(q,/SET[^]*is_hidden=|created_at=/);const row=rows.find(r=>r.id===p.rid&&r.user_id===p.uid);
      Object.assign(row,{rating:p.rating,comment:p.comment,variant_id:p.vid,order_item_id:p.item,size_snapshot:p.size,color_snapshot:p.color,updated_at:new Date()});return result([row]);
    }
    if(q.startsWith('DELETE FROM dbo.review_images')){this.tx.images=images.filter(i=>!(i.id===p.image&&i.review_id===p.rid));return result([]);}
    if(q.startsWith('UPDATE dbo.review_images')){images.find(i=>i.id===p.image&&i.review_id===p.rid).sort_order=p.sort;return result([]);}
    if(q.startsWith('INSERT INTO dbo.review_images')){if(state.failMetadata)throw Object.assign(Error('PRIVATE metadata'),{code:'EREQUEST'});const id=++state.imageId;images.push({id,review_id:p.rid,image_path:p.url,sort_order:p.sort});return result([{id}]);}
    if(q.startsWith('DELETE FROM dbo.reviews')){if(state.failDelete)throw Error('PRIVATE delete');this.tx.rows=rows.filter(r=>!(r.id===p.rid&&r.user_id===p.uid));this.tx.images=images.filter(i=>i.review_id!==p.rid);return result([]);}
    throw Error('Unexpected test SQL '+q);
  }
}
require.cache[require.resolve('../db')]={exports:{sql:{...realSql,Transaction,Request},getPool:async()=>({request:()=>new Request()})}};
require.cache[require.resolve('../firebase')]={exports:{getAuth:()=>({async verifyIdToken(token,revoked){assert.equal(revoked,true);if(!['active','other'].includes(token))throw Error('PRIVATE token');return {uid:token==='other'?'other':'owner'};}})}};
const security=require('../middleware/security');require.cache[require.resolve('../middleware/security')].exports={...security,buildUserActionLimiter:()=>((req,res,next)=>next())};
const media=require('../lib/review-media');media.storage={save:buffer=>media.createStorage(directory).save(buffer),remove:urls=>media.createStorage(directory).remove(urls)};
const app=express();app.use(express.json());app.use('/api/products',require('../routes/products'));
before(async()=>{directory=await fs.mkdtemp(path.join(os.tmpdir(),'breeze-review-owner-test-'));png=await sharp({create:{width:3,height:2,channels:3,background:'#123456'}}).png().toBuffer();server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
beforeEach(async()=>{
  for(const name of await fs.readdir(directory))await fs.unlink(path.join(directory,name));
  const row={id:91,user_id:1,product_id:7,variant_id:71,order_item_id:11,size_snapshot:'M',color_snapshot:'Đen lúc mua',rating:4,comment:'Ban đầu',is_hidden:false,created_at:new Date('2020-01-01T00:00:00Z'),updated_at:new Date('2020-01-01T00:00:00Z')};
  state={rows:[row,{...row,id:92,user_id:2}],images:[],imageId:100,queries:[],rollbacks:0,purchases:[{user_id:1,product_id:7,status:'completed',variant_id:71,order_item_id:11,size_snapshot:'XL mới',color_snapshot:'Tên màu mới'},
    {user_id:1,product_id:7,status:'completed',variant_id:72,order_item_id:12,size_snapshot:'L',color_snapshot:'Trắng'}]};
  for(let i=0;i<4;i++)state.images.push({id:10+i,review_id:91,image_path:await media.storage.save(png),sort_order:i});
  state.images.push({id:20,review_id:92,image_path:await media.storage.save(png),sort_order:0});
});
async function call(method='PATCH',body={rating:5,variant_id:71,comment:' Mới '},options={}){
  const headers=options.token===null?{}:{Authorization:'Bearer '+(options.token||'active')};let payload;
  if(method==='PATCH'){
    if(options.files){payload=new FormData();for(const[k,v]of Object.entries(body))payload.append(k,k==='remove_image_ids'&&typeof v!=='string'?JSON.stringify(v):String(v));for(const file of options.files)payload.append('images',new Blob([file.buffer||png],{type:file.type||'image/png'}),file.name||'test.png');}
    else{headers['Content-Type']='application/json';payload=JSON.stringify(body);}
  }
  const r=await fetch(base+'/api/products/'+(options.pid??7)+'/reviews/'+(method==='GET'?'me':options.id??91),{method,headers,body:payload});return {status:r.status,body:await r.json()};
}
for(const method of ['GET','PATCH','DELETE'])test(method+' requires authentication',async()=>{assert.equal((await call(method,undefined,{token:null})).status,401);assert.equal(state.queries.length,0);});
test('owner GET returns own hidden review, IDs and purchased variants without sensitive identity',async()=>{state.rows[0].is_hidden=true;const r=await call('GET',undefined,{pid:7});assert.equal(r.status,200);assert.equal(r.body.review.id,91);assert.equal(r.body.review.isOwner,true);assert.deepEqual(r.body.review.images.map(i=>i.id),[10,11,12,13]);assert.equal(r.body.purchasedVariants.length,2);assert.doesNotMatch(JSON.stringify(r.body.review),/user_id|firebase|email|phone|is_hidden/);});
test('client userId cannot select another author',async()=>{const r=await call('GET',undefined,{token:'other'});assert.equal(r.body.review.id,92);assert.equal(r.body.purchasedVariants.length,0);});
test('owner GET no review is explicit null',async()=>{state.rows=[];assert.equal((await call('GET')).body.review,null);});
test('owner GET missing product is 404',async()=>{assert.equal((await call('GET',undefined,{pid:8})).status,404);});
for(const method of ['PATCH','DELETE'])test('other user cannot '+method+' review',async()=>{const before=structuredClone(state.rows);assert.equal((await call(method,undefined,{token:'other'})).status,404);assert.deepEqual(state.rows,before);assert.equal((await fs.readdir(directory)).length,5);});
for(const id of ['bad',0,-1,'1.5',2147483648])for(const method of ['PATCH','DELETE'])test(method+' invalid review ID '+id,async()=>{assert.equal((await call(method,undefined,{id})).status,400);assert.equal(state.queries.length,0);});
test('review cannot be targeted through a different product',async()=>{assert.equal((await call('PATCH',undefined,{pid:8})).status,404);});
for(const field of ['product_id','productId','user_id','userId','is_hidden','isOwner','created_at','updated_at','verified_purchase'])test('immutable/untrusted field '+field+' rejected',async()=>{assert.equal((await call('PATCH',{rating:5,variant_id:71,[field]:1})).status,400);assert.equal(state.queries.length,0);});
for(const rating of [0,6,-1,null,'bad',[],{}])test('invalid edit rating '+JSON.stringify(rating),async()=>{assert.equal((await call('PATCH',{rating,variant_id:71})).body.code,'REVIEW_INVALID_RATING');});
for(const comment of [null,'','  Đẹp 😀  ','Đ'.repeat(1000)])test('comment update '+(comment?.length||0),async()=>{const r=await call('PATCH',{rating:1,variant_id:71,comment});assert.equal(r.status,200);assert.equal(r.body.comment,comment?.trim()||null);});
test('oversized comment rejected',async()=>{assert.equal((await call('PATCH',{rating:5,variant_id:71,comment:'Đ'.repeat(1001)})).body.code,'REVIEW_INVALID_COMMENT');});
test('update changes rating/updated_at while preserving created_at, hidden and unchanged snapshot',async()=>{state.rows[0].is_hidden=true;const r=await call();assert.equal(r.status,200);assert.equal(r.body.rating,5);assert.equal(r.body.createdAt,'2020-01-01T00:00:00.000Z');assert.notEqual(r.body.updatedAt,r.body.createdAt);assert.equal(state.rows[0].is_hidden,true);assert.deepEqual(r.body.variant,{id:71,orderItemId:11,size:'M',color:'Đen lúc mua'});});
test('choosing another purchased variant copies its real snapshot',async()=>{const r=await call('PATCH',{rating:5,variant_id:72});assert.equal(r.status,200);assert.deepEqual(r.body.variant,{id:72,orderItemId:12,size:'L',color:'Trắng'});});
test('unbought variant rejected',async()=>{assert.equal((await call('PATCH',{rating:5,variant_id:73})).body.code,'REVIEW_INVALID_VARIANT');});
for(const patch of [{user_id:2},{product_id:8},{status:'cancelled'},{status:'shipping'}])test('another owner/product or incomplete purchase cannot grant edit variant '+JSON.stringify(patch),async()=>{state.purchases=[{...state.purchases[0],...patch}];assert.equal((await call()).body.code,'REVIEW_NOT_ELIGIBLE');});
test('keeping old images preserves IDs and files',async()=>{const before=state.images.filter(i=>i.review_id===91);const r=await call();assert.deepEqual(r.body.images,before.map(i=>({id:i.id,url:i.image_path})));assert.equal((await fs.readdir(directory)).length,5);});
test('remove one old image and append two new ones reaches five',async()=>{const removed=state.images[0].image_path;const r=await call('PATCH',{rating:5,variant_id:71,remove_image_ids:[10]},{files:[{},{}]});assert.equal(r.status,200);assert.equal(r.body.images.length,5);assert.deepEqual(r.body.images.slice(0,3).map(i=>i.id),[11,12,13]);assert.deepEqual(state.images.filter(i=>i.review_id===91).map(i=>i.sort_order),[0,1,2,3,4]);assert.equal((await fs.readdir(directory)).length,6);assert.ok(!(await fs.readdir(directory)).includes(path.basename(removed)));});
test('kept plus uploaded images over five rejected without files or DB changes',async()=>{const before=structuredClone(state.rows);const r=await call('PATCH',{rating:5,variant_id:71},{files:[{},{}]});assert.equal(r.body.code,'REVIEW_TOO_MANY_IMAGES');assert.deepEqual(state.rows,before);assert.equal((await fs.readdir(directory)).length,5);});
for(const remove_image_ids of [[20],[999],[10,10],null,'not-json',{},[-1]])test('invalid or another review image removal '+JSON.stringify(remove_image_ids),async()=>{const r=await call('PATCH',{rating:5,variant_id:71,remove_image_ids});assert.equal(r.body.code,'REVIEW_INVALID_IMAGES');assert.equal((await fs.readdir(directory)).length,5);});
test('removal without new files deletes metadata and physical file after commit',async()=>{const r=await call('PATCH',{rating:5,variant_id:71,remove_image_ids:[11]});assert.equal(r.status,200);assert.equal(r.body.images.length,3);assert.equal((await fs.readdir(directory)).length,4);});
test('all four old images can be replaced with five new files and all four form fields',async()=>{const r=await call('PATCH',{rating:5,variant_id:71,comment:'Thay ảnh',remove_image_ids:[10,11,12,13]},{files:Array.from({length:5},()=>({}))});assert.equal(r.status,200);assert.equal(r.body.images.length,5);assert.ok(r.body.images.every(i=>i.id>100));assert.deepEqual(state.images.filter(i=>i.review_id===91).map(i=>i.sort_order),[0,1,2,3,4]);});
test('six new files are rejected by multipart limits',async()=>{const r=await call('PATCH',{rating:5,variant_id:71,remove_image_ids:[10,11,12,13]},{files:Array.from({length:6},()=>({}))});assert.equal(r.body.code,'REVIEW_TOO_MANY_IMAGES');assert.equal((await fs.readdir(directory)).length,5);});
for(const file of [{buffer:Buffer.from('not image')},{name:'bad.exe'},{type:'image/jpeg',name:'bad.jpg'},{buffer:Buffer.alloc(2*1024*1024+1)}])test('edit reuses image MIME/extension/content/size validation '+(file.name||file.buffer.length),async()=>{const r=await call('PATCH',{rating:5,variant_id:71},{files:[file]});assert.ok([413,415].includes(r.status));assert.equal((await fs.readdir(directory)).length,5);});
for(const fault of ['failMetadata','failCommit'])test(fault+' rolls back changes, keeps old files and cleans new files',async t=>{t.mock.method(console,'error',()=>{});state[fault]=true;const before=structuredClone({rows:state.rows,images:state.images}),files=await fs.readdir(directory);const r=await call('PATCH',{rating:5,variant_id:71,remove_image_ids:[10]},{files:[{}]});assert.equal(r.status,500);assert.deepEqual({rows:state.rows,images:state.images},before);assert.deepEqual(await fs.readdir(directory),files);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE|stack|[A-Z]:\\/);});
test('owner delete removes row, cascade image metadata and its files only',async()=>{const other=state.images.find(i=>i.review_id===92).image_path;assert.equal((await call('DELETE')).status,200);assert.deepEqual(state.rows.map(r=>r.id),[92]);assert.deepEqual(state.images.map(i=>i.review_id),[92]);assert.deepEqual(await fs.readdir(directory),[path.basename(other)]);assert.equal((await call('GET')).body.review,null);});
test('delete rollback never removes physical images',async t=>{t.mock.method(console,'error',()=>{});state.failDelete=true;assert.equal((await call('DELETE')).status,500);assert.equal(state.rows.length,2);assert.equal((await fs.readdir(directory)).length,5);});
test('physical cleanup failure is logged safely after DB commit',async t=>{const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args.join(' ')));t.mock.method(fs,'unlink',async()=>{throw Object.assign(Error('PRIVATE PATH'),{code:'EACCES'});});assert.equal((await call('DELETE')).status,200);assert.deepEqual(state.rows.map(r=>r.id),[92]);assert.equal(state.images.length,1);assert.ok(logs.length>0);assert.ok(logs.every(log=>log.includes('EACCES')&&!log.includes('PRIVATE')));});
