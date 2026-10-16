'use strict';
// HTTP + real SQL verification. All fixtures and image files are disposable.
require('dotenv').config({path:require('node:path').join(__dirname,'..','.env'),quiet:true});
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const express=require('express'),sharp=require('sharp');
const db=require('../db'),{sql,config}=db;
const dbName='BreezeReviewCreateTest_'+process.pid+'_'+Date.now();
if(!/^BreezeReviewCreateTest_[0-9]+_[0-9]+$/.test(dbName)||dbName===config.database)throw Error('Unsafe test database');
const quoted='['+dbName+']',serverDir=path.join(__dirname,'..');
let pool,created=false,server,directory,base,png,checks=0,fixture=0;
const tokens=new Set();
function check(name,value){assert.ok(value,name);checks++;console.log('PASS: '+name);}
function adminSql(query){execFileSync('sqlcmd',['-E','-S',config.server,'-d','master','-No','-b','-Q',query],{stdio:'pipe'});}
async function addUser(uid) {
  return (await pool.request().input('uid',sql.VarChar(128),uid)
    .query('INSERT INTO dbo.users(firebase_uid) OUTPUT INSERTED.id VALUES(@uid);')).recordset[0].id;
}
async function product(slug) {
  const pid = (await pool.request().input('slug',sql.VarChar(160),slug).query(`INSERT INTO dbo.products(slug,name_vi,price,category_id,stock)
    OUTPUT INSERTED.id VALUES(@slug,N'Test-only product',100,(SELECT TOP(1) id FROM dbo.categories ORDER BY id),0);`)).recordset[0].id;
  const variants = (await pool.request().input('pid',sql.Int,pid).query(`INSERT INTO dbo.product_variants(product_id,sku,size,stock,is_base)
    OUTPUT INSERTED.id,INSERTED.size VALUES(@pid,'REVIEW-'+CONVERT(VARCHAR(11),@pid)+'-BASE',NULL,0,1),
    (@pid,'REVIEW-'+CONVERT(VARCHAR(11),@pid)+'-M',N'M',0,0),(@pid,'REVIEW-'+CONVERT(VARCHAR(11),@pid)+'-L',N'L',0,0);`)).recordset;
  return { pid, base:variants.find(v=>v.size==null).id, m:variants.find(v=>v.size==='M').id, l:variants.find(v=>v.size==='L').id };
}
async function purchase(uid, status, p, vid, size = null, color = null, date = '2026-10-14T00:00:00Z') {
  const oid = (await pool.request().input('uid',sql.Int,uid).input('status',sql.VarChar(20),status)
    .input('date',sql.DateTime2,new Date(date)).query(`INSERT INTO dbo.orders(user_id,status,total_amount,created_at)
    OUTPUT INSERTED.id VALUES(@uid,@status,100,@date);`)).recordset[0].id;
  const item = (await pool.request().input('oid',sql.Int,oid).input('pid',sql.Int,p.pid).input('vid',sql.Int,vid)
    .input('size',sql.NVarChar(40),size).input('color',sql.NVarChar(80),color)
    .query(`INSERT INTO dbo.order_items(order_id,product_id,variant_id,product_name,size_snapshot,color_snapshot,unit_price,quantity,line_total)
    OUTPUT INSERTED.id VALUES(@oid,@pid,@vid,N'Test purchase snapshot',@size,@color,100,1,100);`)).recordset[0].id;
  return { oid, item };
}

async function user(){const token='review-create-fixture-'+(++fixture);const uid=await addUser(token);tokens.add(token);return {token,uid};}
async function call(u,p,body,files){
  const headers=u?{Authorization:'Bearer '+u.token}:{};
  let payload;
  if(files){payload=new FormData();for(const[k,v]of Object.entries(body))payload.append(k,String(v));for(const file of files)payload.append('images',new Blob([file.buffer||png],{type:file.type||'image/png'}),file.name||'fixture.png');}
  else {headers['Content-Type']='application/json';payload=JSON.stringify(body);}
  const r=await fetch(base+'/api/products/'+p.pid+'/reviews',{method:'POST',headers,body:payload});return {status:r.status,body:await r.json()};
}
async function snapshot(){return (await pool.request().query('SELECT * FROM dbo.products ORDER BY id; SELECT * FROM dbo.product_variants ORDER BY id; SELECT * FROM dbo.orders ORDER BY id; SELECT * FROM dbo.order_items ORDER BY id;')).recordsets;}
async function counts(){return (await pool.request().query('SELECT (SELECT COUNT(*) FROM dbo.reviews) AS reviews,(SELECT COUNT(*) FROM dbo.review_images) AS images;')).recordset[0];}
async function main(){
  try {
    adminSql('CREATE DATABASE '+quoted+';');created=true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::'+quoted+' TO ['+String(config.user).replace(/]/g,']]')+'];');
    console.log('Created disposable database:',dbName);
    execFileSync(process.execPath,['scripts/setup-db.js','--fresh'],{cwd:serverDir,env:{...process.env,DB_NAME:dbName},stdio:'pipe',maxBuffer:1024*1024});
    pool=await new sql.ConnectionPool({...config,database:dbName}).connect();
    directory=await fs.mkdtemp(path.join(os.tmpdir(),'breeze-review-create-sql-'));
    png=await sharp({create:{width:8,height:6,channels:3,background:'#345678'}}).png().toBuffer();
    // Keep real auth middleware, SQL, transaction, upload decoder and router. Only Firebase
    // verification is substituted for isolated test identities; never used by the dev server.
    require.cache[require.resolve('../db')].exports={...db,getPool:async()=>pool};
    require.cache[require.resolve('../firebase')]={exports:{getAuth:()=>({verifyIdToken:async token=>{if(!tokens.has(token))throw Error('Invalid test identity');return {uid:token};}})}};
    const security=require('../middleware/security');
    require.cache[require.resolve('../middleware/security')].exports={...security,buildUserActionLimiter:()=>((req,res,next)=>next())};
    const media=require('../lib/review-media');media.storage=media.createStorage(directory);
    const app=express();app.use(express.json());app.use('/api/products',require('../routes/products'));
    app.use(media.PUBLIC_PREFIX,express.static(directory,{maxAge:'1y',immutable:true,dotfiles:'deny'}));
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
    const p=await product('review-create-fixture-product'),different=await product('review-create-fixture-other');
    const owner=await user(),other=await user();
    await purchase(owner.uid,'completed',p,p.m,'M','Đen lúc mua');
    await purchase(owner.uid,'completed',p,p.l,'L','Trắng lúc mua');
    await pool.request().input('vid',sql.Int,p.m).query("UPDATE dbo.product_variants SET size=N'XL' WHERE id=@vid;");
    const initial=await snapshot();
    check('unauthenticated HTTP create rejected',(await call(null,p,{rating:4,variant_id:p.m})).status===401);
    check('missing product rejected',(await call(owner,{pid:2147483000},{rating:4,variant_id:p.m})).status===404);
    check('other user cannot use owner purchase',(await call(other,p,{rating:4,variant_id:p.m})).body.code==='REVIEW_NOT_ELIGIBLE');
    check('unbought variant rejected',(await call(owner,p,{rating:4,variant_id:p.base})).body.code==='REVIEW_INVALID_VARIANT');
    check('cross-product variant rejected',(await call(owner,p,{rating:4,variant_id:different.m})).body.code==='REVIEW_INVALID_VARIANT');
    const first=await call(owner,p,{rating:1,variant_id:p.m,comment:'  Rất đẹp 😀  '},[]);
    check('real completed purchase creates review without images',first.status===201&&first.body.images.length===0);
    check('purchase snapshot survives current variant change',first.body.variant.size==='M'&&first.body.variant.color==='Đen lúc mua');
    check('Unicode comment is trimmed and returned',first.body.comment==='Rất đẹp 😀');
    const stored=(await pool.request().input('id',sql.Int,first.body.id).query('SELECT * FROM dbo.reviews WHERE id=@id;')).recordset[0];
    check('author/reference/snapshots/default moderation stored correctly',stored.user_id===owner.uid&&stored.variant_id===p.m&&stored.order_item_id===first.body.variant.orderItemId&&stored.size_snapshot==='M'&&!stored.is_hidden);
    check('sequential duplicate has machine-readable response',(await call(owner,p,{rating:5,variant_id:p.l})).body.code==='REVIEW_ALREADY_EXISTS');
    assert.deepEqual(await snapshot(),initial);checks++;console.log('PASS: create only reads product/order/variant business state');
    for(const status of ['cancelled','shipping']){const u=await user();await purchase(u.uid,status,p,p.m,'M');check(status+'-only purchase cannot create',(await call(u,p,{rating:4,variant_id:p.m})).body.code==='REVIEW_NOT_ELIGIBLE');}
    for(const n of [1,5]){
      const u=await user();await purchase(u.uid,'completed',p,p.m,'M');
      const r=await call(u,p,{rating:5,variant_id:p.m,comment:'Đ'.repeat(1000)},Array.from({length:n},()=>({})));
      check(n+' real uploaded images saved',r.status===201&&r.body.images.length===n);
      const rows=(await pool.request().input('rid',sql.Int,r.body.id).query('SELECT * FROM dbo.review_images WHERE review_id=@rid ORDER BY sort_order;')).recordset;
      check(n+' image rows linked and ordered',rows.length===n&&rows.every((row,i)=>row.sort_order===i&&row.image_path===r.body.images[i].url));
      for(const image of r.body.images){
        check('safe randomized local URL',/^\/review-images\/[a-f0-9]{32}\.webp$/.test(image.url));
        const res=await fetch(base+image.url),buffer=Buffer.from(await res.arrayBuffer()),info=await sharp(buffer).metadata();
        check('static image serves actual WebP with immutable cache',res.status===200&&res.headers.get('content-type').startsWith('image/webp')&&res.headers.get('cache-control').includes('immutable')&&info.format==='webp');
      }
    }
    const racer=await user();await purchase(racer.uid,'completed',p,p.m,'M');
    const race=await Promise.all([call(racer,p,{rating:4,variant_id:p.m},[{}]),call(racer,p,{rating:5,variant_id:p.m},[{}])]);
    assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);checks++;
    check('concurrent duplicate maps losing request to REVIEW_ALREADY_EXISTS',race.find(r=>r.status===409).body.code==='REVIEW_ALREADY_EXISTS');
    const raceRows=(await pool.request().input('uid',sql.Int,racer.uid).query('SELECT COUNT(*) AS n FROM dbo.reviews WHERE user_id=@uid; SELECT COUNT(*) AS n FROM dbo.review_images i JOIN dbo.reviews r ON r.id=i.review_id WHERE r.user_id=@uid;')).recordsets;
    check('concurrent create leaves one review and one image',raceRows[0][0].n===1&&raceRows[1][0].n===1);
    const invalid=await user();await purchase(invalid.uid,'completed',p,p.m,'M');
    for(const files of [Array.from({length:6},()=>({})),[{buffer:Buffer.from('not image')}],[{name:'malware.exe'}],[{type:'video/mp4',name:'video.mp4'}],[{buffer:Buffer.alloc(2*1024*1024+1)}]]){
      const before=await counts(),disk=await fs.readdir(directory);const r=await call(invalid,p,{rating:4,variant_id:p.m},files);
      check('invalid/oversized upload rejected',r.status>=400&&r.status<500);assert.deepEqual(await counts(),before);assert.deepEqual(await fs.readdir(directory),disk);checks+=2;
    }
    const rollbackUser=await user();await purchase(rollbackUser.uid,'completed',p,p.m,'M');
    const beforeRollback=await counts(),beforeFiles=await fs.readdir(directory);
    // A disposable-DB trigger forces the metadata insert to fail AFTER physical image write.
    await pool.request().batch("CREATE TRIGGER dbo.test_review_image_failure ON dbo.review_images AFTER INSERT AS BEGIN THROW 51001,'Test-only metadata failure',1; END;");
    const failed=await call(rollbackUser,p,{rating:4,variant_id:p.m},[{}]);
    check('SQL metadata failure returns safe generic error',failed.status===500&&failed.body.code==='REVIEW_SERVER_ERROR'&&!JSON.stringify(failed.body).includes('51001'));
    assert.deepEqual(await counts(),beforeRollback);checks++;console.log('PASS: real SQL rollback removes review and image metadata');
    assert.deepEqual(await fs.readdir(directory),beforeFiles);checks++;console.log('PASS: rollback cleans physical uploaded image');
    await pool.request().batch('DROP TRIGGER dbo.test_review_image_failure;');
    check('review metadata and physical image counts agree',(await counts()).images===(await fs.readdir(directory)).length);
    console.log('SQL REVIEW CREATE VERIFY:',checks,'checks passed; no production fixtures.');
  } finally {
    if(server)await new Promise(r=>server.close(r));
    if(pool)await pool.close();
    if(directory)await fs.rm(directory,{recursive:true,force:true});
    if(created){adminSql('ALTER DATABASE '+quoted+' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE '+quoted+';');console.log('Dropped disposable database:',dbName);}
  }
}
main().catch(error=>{console.error('Review create SQL verification FAILED:',error.code||error.message);process.exitCode=1;});
