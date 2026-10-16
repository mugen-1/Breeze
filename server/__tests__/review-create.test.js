'use strict';
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const express=require('express'),realSql=require('mssql'),sharp=require('sharp');
let state,server,base,directory,png;
const result=recordset=>({recordset,rowsAffected:[recordset.length]});
class Transaction {
  constructor(){this.reviews=[];this.images=[];}
  async begin(){}
  async commit(){if(state.failCommit&&this.reviews.length)throw Error('PRIVATE commit');state.reviews.push(...this.reviews);state.images.push(...this.images);}
  async rollback(){this.reviews=[];this.images=[];state.rollbacks++;}
}
class Request {
  constructor(tx){this.tx=tx;this.params={};}
  input(k,type,v){this.params[k]=v;return this;}
  async query(raw){
    const q=raw.replace(/\s+/g,' ').trim(),p=this.params;
    if(q.startsWith('SELECT id FROM dbo.users WITH')&&typeof p.uid==='string')return result([{id:p.uid==='other'?2:1}]);
    if(q.startsWith('MERGE dbo.users'))return result([{id:p.uid==='other'?2:1,role:'customer'}]);
    state.queries.push({q,p});
    if(q.startsWith('SELECT id FROM dbo.users'))return result([{id:p.uid}]);
    if(q.startsWith('SELECT id FROM dbo.products'))return result(p.pid===7?[{id:7}]:[]);
    if(q.startsWith('SELECT id FROM dbo.reviews'))return result(state.reviews.filter(r=>r.user_id===p.uid&&r.product_id===p.pid));
    if(q.startsWith('WITH purchased')){
      assert.match(q,/o.user_id = @uid AND o.status = 'completed' AND oi.product_id = @pid/);
      assert.match(q,/dbo.orders o WITH \(HOLDLOCK\) JOIN dbo.order_items oi WITH \(HOLDLOCK\)/);
      return result(state.items.filter(i=>i.user_id===p.uid&&i.product_id===p.pid&&i.status==='completed')
        .map(({variant_id,order_item_id,size_snapshot,color_snapshot})=>({variant_id,order_item_id,size_snapshot,color_snapshot})));
    }
    if(q.startsWith('INSERT INTO dbo.reviews')){
      if(state.duplicate)throw Object.assign(Error('PRIVATE unique'),{number:2627});
      assert.doesNotMatch(q,/is_hidden/);
      const row={id:state.reviews.length+1,user_id:p.uid,product_id:p.pid,variant_id:p.vid,order_item_id:p.item,
        size_snapshot:p.size,color_snapshot:p.color,rating:p.rating,comment:p.comment,is_hidden:false,created_at:new Date(),updated_at:new Date()};
      this.tx.reviews.push(row);return result([row]);
    }
    if(q.startsWith('INSERT INTO dbo.review_images')){
      if(state.failMetadata)throw Object.assign(Error('PRIVATE metadata path'),{code:'EREQUEST'});
      this.tx.images.push({review_id:p.rid,image_path:p.url,sort_order:p.sort});return result([]);
    }
    throw Error('Unexpected test SQL '+q);
  }
}
require.cache[require.resolve('../db')]={exports:{sql:{...realSql,Request,Transaction},getPool:async()=>({request:()=>new Request()})}};
require.cache[require.resolve('../firebase')]={exports:{getAuth:()=>({async verifyIdToken(token,revoked){
  assert.equal(revoked,true);if(!['active','other'].includes(token))throw Object.assign(Error('PRIVATE token'),{code:'auth/id-token-expired'});
  return {uid:token==='other'?'other':'owner'};
}})}};
// The upload policy uses the existing limiter; avoid sharing its counters across fixtures.
const security=require('../middleware/security');
require.cache[require.resolve('../middleware/security')].exports={...security,buildUserActionLimiter:()=>((req,res,next)=>next())};
const media=require('../lib/review-media');
const injectedStorage={save:buffer=>media.createStorage(directory).save(buffer),remove:urls=>media.createStorage(directory).remove(urls)};
media.storage=injectedStorage;
const app=express();app.use(express.json());app.use('/api/products',require('../routes/products'));
before(async()=>{directory=await fs.mkdtemp(path.join(os.tmpdir(),'breeze-review-create-test-'));png=await sharp({create:{width:3,height:2,channels:3,background:'#123456'}}).png().toBuffer();server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
beforeEach(async()=>{for(const file of await fs.readdir(directory))await fs.unlink(path.join(directory,file));state={queries:[],reviews:[],images:[],rollbacks:0,items:[{user_id:1,product_id:7,status:'completed',variant_id:71,order_item_id:11,size_snapshot:'M',color_snapshot:'Đen'}]};});
async function call(body={rating:4,variant_id:71},options={}){
  const headers=options.token===null?{}:{Authorization:'Bearer '+(options.token||'active')};let data;
  if(options.files){data=new FormData();for(const [key,value]of Object.entries(body))data.append(key,String(value));for(const file of options.files)data.append('images',new Blob([file.buffer||png],{type:file.type||'image/png'}),file.name||'test.png');}
  else {headers['Content-Type']='application/json';data=JSON.stringify(body);}
  const r=await fetch(base+'/api/products/'+(options.id??7)+'/reviews',{method:'POST',headers,body:data});return {status:r.status,body:await r.json()};
}
test('create requires Firebase authentication before processing files or SQL',async()=>{assert.equal((await call(undefined,{token:null,files:[{}]})).status,401);assert.equal(state.queries.length,0);assert.deepEqual(await fs.readdir(directory),[]);});
test('expired Firebase token is rejected',async t=>{t.mock.method(console,'warn',()=>{});assert.equal((await call(undefined,{token:'expired'})).status,401);});
for(const id of ['bad','-1','1.5','2147483648','1%20OR%201=1'])test('invalid product ID: '+id,async()=>{assert.equal((await call(undefined,{id})).body.code,'REVIEW_INVALID_PRODUCT');assert.equal(state.queries.length,0);});
test('missing product returns 404',async()=>{assert.equal((await call(undefined,{id:999})).status,404);assert.equal(state.reviews.length,0);});
test('never purchased product is forbidden',async()=>{state.items=[];const r=await call();assert.equal(r.status,403);assert.equal(r.body.code,'REVIEW_NOT_ELIGIBLE');});
for(const status of ['pending','confirmed','processing','shipping','cancelled','paid','shipped'])test(status+' alone never qualifies',async()=>{state.items[0].status=status;assert.equal((await call()).body.code,'REVIEW_NOT_ELIGIBLE');assert.equal(state.reviews.length,0);});
test('another user cannot submit against owner purchase',async()=>{assert.equal((await call(undefined,{token:'other'})).body.code,'REVIEW_NOT_ELIGIBLE');});
test('purchase of another product does not qualify',async()=>{state.items[0].product_id=8;assert.equal((await call()).body.code,'REVIEW_NOT_ELIGIBLE');});
test('only selected purchased variant is accepted',async()=>{assert.equal((await call({rating:4,variant_id:72})).body.code,'REVIEW_INVALID_VARIANT');assert.equal(state.reviews.length,0);});
for(const variant_id of [null,'bad',[71],0,-1])test('invalid variant reference '+JSON.stringify(variant_id),async()=>{assert.equal((await call({rating:4,variant_id})).body.code,'REVIEW_INVALID_VARIANT');});
for(const rating of [0,6,-1,null,'bad','4.5',[],{}])test('invalid rating '+JSON.stringify(rating),async()=>{assert.equal((await call({rating,variant_id:71})).body.code,'REVIEW_INVALID_RATING');});
for(const rating of [1,5])test('completed purchase accepts rating '+rating,async()=>{const r=await call({rating,variant_id:71});assert.equal(r.status,201);assert.equal(r.body.rating,rating);assert.equal(state.reviews.length,1);assert.equal(state.reviews[0].is_hidden,false);assert.equal(r.body.variant.orderItemId,11);});
for(const comment of [null,'','   ','Đ'.repeat(1000)])test('optional/Unicode comment length '+(comment?.length||0),async()=>{const r=await call({rating:4,variant_id:71,comment});assert.equal(r.status,201);assert.equal(r.body.comment,comment?.trim()||null);});
test('comment trims sensibly',async()=>{assert.equal((await call({rating:4,variant_id:71,comment:'  Rất đẹp  '})).body.comment,'Rất đẹp');});
for(const comment of ['x'.repeat(1001),3,{},[]])test('invalid comment '+typeof comment,async()=>{assert.equal((await call({rating:4,variant_id:71,comment})).body.code,'REVIEW_INVALID_COMMENT');});
for(const extra of [{userId:2},{is_hidden:true},{user_id:2}])test('client cannot choose identity or moderation '+Object.keys(extra)[0],async()=>{assert.equal((await call({rating:4,variant_id:71,...extra})).body.code,'REVIEW_INVALID_INPUT');});
test('existing review rejects create even if hidden',async()=>{state.reviews=[{id:1,user_id:1,product_id:7,is_hidden:true}];const r=await call();assert.equal(r.status,409);assert.equal(r.body.code,'REVIEW_ALREADY_EXISTS');assert.equal(state.reviews.length,1);});
test('unique constraint violation maps to explicit duplicate error',async()=>{state.duplicate=true;const r=await call();assert.equal(r.status,409);assert.equal(r.body.code,'REVIEW_ALREADY_EXISTS');assert.equal(state.reviews.length,0);});
for(const count of [0,1,5])test('create with '+count+' actual multipart PNG images',async()=>{const r=await call({rating:4,variant_id:71,comment:'Đẹp'},{files:Array.from({length:count},()=>({}))});assert.equal(r.status,201);assert.equal(r.body.images.length,count);assert.equal(state.images.length,count);assert.equal((await fs.readdir(directory)).length,count);for(const [i,image]of state.images.entries()){assert.equal(image.review_id,r.body.id);assert.equal(image.sort_order,i);assert.match(image.image_path,/^\/review-images\/[a-f0-9]{32}\.webp$/);const info=await sharp(await fs.readFile(path.join(directory,path.basename(image.image_path)))).metadata();assert.equal(info.format,'webp');assert.equal(info.exif,undefined);}});
test('six images are rejected before any file write',async()=>{const r=await call(undefined,{files:Array.from({length:6},()=>({}))});assert.equal(r.body.code,'REVIEW_TOO_MANY_IMAGES');assert.equal(state.reviews.length,0);assert.deepEqual(await fs.readdir(directory),[]);});
test('file larger than existing 2MB policy is rejected',async()=>{const r=await call(undefined,{files:[{buffer:Buffer.alloc(2*1024*1024+1)}]});assert.equal(r.status,413);assert.equal(r.body.code,'REVIEW_IMAGE_TOO_LARGE');});
for(const file of [{buffer:Buffer.from('not an image')},{type:'video/mp4',name:'test.mp4'},{type:'image/png',name:'test.exe'},{type:'image/jpeg',name:'test.jpg'},{buffer:Buffer.from('<svg></svg>'),type:'image/svg+xml',name:'test.svg'}])test('image content/MIME/extension mismatch is rejected '+(file.name||'text'),async()=>{const r=await call(undefined,{files:[file]});assert.equal(r.status,415);assert.equal(r.body.code,'REVIEW_INVALID_IMAGE');assert.equal(state.reviews.length,0);assert.deepEqual(await fs.readdir(directory),[]);});
test('client filename never controls final path',async()=>{const r=await call(undefined,{files:[{name:'../../unsafe.png'}]});assert.equal(r.status,201);assert.match(r.body.images[0].url,/^\/review-images\/[a-f0-9]{32}\.webp$/);assert.doesNotMatch(r.body.images[0].url,/unsafe|\.\./);});
for(const phase of ['failMetadata','failCommit'])test(phase+' rolls back review/images and cleans physical uploads',async t=>{t.mock.method(console,'error',()=>{});state[phase]=true;const r=await call(undefined,{files:[{}]});assert.equal(r.status,500);assert.equal(r.body.code,'REVIEW_SERVER_ERROR');assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE|[A-Z]:\\|stack/);assert.equal(state.reviews.length,0);assert.equal(state.images.length,0);assert.deepEqual(await fs.readdir(directory),[]);assert.ok(state.rollbacks>0);});
test('snapshot response contains no user, token or absolute path',async()=>{const r=await call();assert.equal(r.status,201);assert.deepEqual(Object.keys(r.body).sort(),['id','productId','rating','comment','variant','images','createdAt','updatedAt'].sort());assert.deepEqual(r.body.variant,{id:71,orderItemId:11,size:'M',color:'Đen'});assert.doesNotMatch(JSON.stringify(r.body),/firebase|password|token|user_id|[A-Z]:\\/);});
