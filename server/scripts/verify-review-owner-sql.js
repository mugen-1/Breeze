'use strict';
// Owner API verification against disposable SQL Server fixtures and temporary image storage.
require('dotenv').config({path:require('node:path').join(__dirname,'..','.env'),quiet:true});
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),express=require('express'),sharp=require('sharp');
const db=require('../db'),{sql,config}=db,media=require('../lib/review-media');
const dbName='BreezeReviewOwnerTest_'+process.pid+'_'+Date.now();
if(!/^BreezeReviewOwnerTest_[0-9]+_[0-9]+$/.test(dbName)||dbName===config.database)throw Error('Unsafe test database');
const quoted='['+dbName+']',serverDir=path.join(__dirname,'..');
let pool,created=false,server,directory,base,png,checks=0;const tokens=new Set();
function check(name,value){assert.ok(value,name);checks++;console.log('PASS: '+name);}
function same(name,actual,expected){assert.deepEqual(actual,expected,name);checks++;console.log('PASS: '+name);}
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


async function call(method,pid,tail='',body,files,token='owner'){
  const headers=token?{Authorization:'Bearer '+token}:{};let payload;
  if(body){if(files){payload=new FormData();for(const[k,v]of Object.entries(body))payload.append(k,k==='remove_image_ids'&&typeof v!=='string'?JSON.stringify(v):String(v));for(const file of files)payload.append('images',new Blob([file.buffer||png],{type:file.type||'image/png'}),file.name||'test.png');}else{headers['Content-Type']='application/json';payload=JSON.stringify(body);}}
  const r=await fetch(base+'/api/products/'+pid+'/reviews'+tail,{method,headers,body:payload});return {status:r.status,body:await r.json()};
}
async function reviewSnapshot(){return (await pool.request().query('SELECT * FROM dbo.reviews ORDER BY id; SELECT * FROM dbo.review_images ORDER BY id;')).recordsets;}
async function main(){
  try{
    adminSql('CREATE DATABASE '+quoted+';');created=true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::'+quoted+' TO ['+String(config.user).replace(/]/g,']]')+'];');console.log('Created disposable database:',dbName);
    execFileSync(process.execPath,['scripts/setup-db.js','--fresh'],{cwd:serverDir,env:{...process.env,DB_NAME:dbName},stdio:'pipe',maxBuffer:1024*1024});
    pool=await new sql.ConnectionPool({...config,database:dbName}).connect();directory=await fs.mkdtemp(path.join(os.tmpdir(),'breeze-review-owner-sql-'));
    png=await sharp({create:{width:5,height:4,channels:3,background:'#234567'}}).png().toBuffer();
    require.cache[require.resolve('../db')].exports={...db,getPool:async()=>pool};
    require.cache[require.resolve('../firebase')]={exports:{getAuth:()=>({verifyIdToken:async token=>{if(!tokens.has(token))throw Error('Test token rejected');return {uid:'review-owner-fixture-'+token};}})}};
    const security=require('../middleware/security');require.cache[require.resolve('../middleware/security')].exports={...security,buildUserActionLimiter:()=>((req,res,next)=>next())};
    media.storage=media.createStorage(directory);
    const app=express();app.use(express.json());app.use('/api/products',require('../routes/products'));
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
    const p=await product('review-owner-fixture-product'),otherProduct=await product('review-owner-fixture-other');
    const uid=await addUser('review-owner-fixture-owner'),other=await addUser('review-owner-fixture-other');tokens.add('owner');tokens.add('other');
    await pool.request().input('uid',sql.Int,other).query("UPDATE dbo.users SET role='admin' WHERE id=@uid;");
    const m=await purchase(uid,'completed',p,p.m,'M','Đen lúc mua'),l=await purchase(uid,'completed',p,p.l,'L','Trắng lúc mua');
    await purchase(other,'completed',p,p.m,'M','Khách khác');
    const orderBefore=(await pool.request().query('SELECT * FROM dbo.orders ORDER BY id; SELECT * FROM dbo.order_items ORDER BY id;')).recordsets;
    const original=await call('POST',p.pid,'',{rating:4,variant_id:p.m,comment:'Ban đầu'},Array.from({length:4},()=>({})));
    check('real Create baseline succeeds with four images',original.status===201&&original.body.images.length===4);
    const rid=original.body.id,otherReview=await call('POST',p.pid,'',{rating:3,variant_id:p.m},[{}],'other');check('separate owner fixture created',otherReview.status===201);
    for(const method of ['GET','PATCH','DELETE'])check(method+' owner operation requires auth',(await call(method,p.pid,method==='GET'?'/me':'/'+rid,method==='PATCH'?{rating:5,variant_id:p.m}:undefined,undefined,null)).status===401);
    const own=await call('GET',p.pid,'/me?userId='+other);
    check('owner GET ignores supplied user ID',own.status===200&&own.body.review.id===rid&&own.body.review.isOwner);
    same('owner purchased variants include only own completed identities',own.body.purchasedVariants.map(v=>v.variant_id),[p.m,p.l]);
    check('owner image IDs are available for safe removal',own.body.review.images.length===4&&own.body.review.images.every(i=>Number.isInteger(i.id)));
    check('owner response has no sensitive user or filesystem details',!JSON.stringify(own.body).match(/firebase|email|phone|user_id|[A-Z]:\\/));
    same('no own review for another product is explicit null',(await call('GET',otherProduct.pid,'/me')).body.review,null);
    for(const method of ['PATCH','DELETE'])check('other account including Admin cannot '+method+' this review',(await call(method,p.pid,'/'+rid,{rating:5,variant_id:p.m},undefined,'other')).status===404);
    const beforeInvalid=await reviewSnapshot();
    for(const field of ['user_id','product_id','is_hidden','created_at','verified_purchase'])check('allowlist rejects '+field,(await call('PATCH',p.pid,'/'+rid,{rating:5,variant_id:p.m,[field]:1})).status===400);
    for(const rating of [0,6])check('rating '+rating+' rejected',(await call('PATCH',p.pid,'/'+rid,{rating,variant_id:p.m})).body.code==='REVIEW_INVALID_RATING');
    check('comment above 1000 rejected',(await call('PATCH',p.pid,'/'+rid,{rating:5,variant_id:p.m,comment:'Đ'.repeat(1001)})).body.code==='REVIEW_INVALID_COMMENT');
    check('unbought BASE variant rejected',(await call('PATCH',p.pid,'/'+rid,{rating:5,variant_id:p.base})).body.code==='REVIEW_INVALID_VARIANT');
    check('another product variant rejected',(await call('PATCH',p.pid,'/'+rid,{rating:5,variant_id:otherProduct.m})).body.code==='REVIEW_INVALID_VARIANT');
    check('another review image ID cannot be removed',(await call('PATCH',p.pid,'/'+rid,{rating:5,variant_id:p.m,remove_image_ids:[(await call('GET',p.pid,'/me',undefined,undefined,'other')).body.review.images[0].id]})).body.code==='REVIEW_INVALID_IMAGES');
    same('rejected edits do not modify reviews or images',await reviewSnapshot(),beforeInvalid);
    await pool.request().input('rid',sql.Int,rid).query("UPDATE dbo.reviews SET is_hidden=1,created_at='2020-01-01',updated_at='2020-01-01' WHERE id=@rid;");
    await pool.request().input('vid',sql.Int,p.m).query("UPDATE dbo.product_variants SET size=N'XL' WHERE id=@vid;");
    const sameVariant=await call('PATCH',p.pid,'/'+rid,{rating:1,variant_id:p.m,comment:null});
    check('owner edits a hidden review without unhiding it',sameVariant.status===200&&(await call('GET',p.pid)).body.reviews.every(r=>r.id!==rid));
    same('unchanged variant retains historical snapshot',sameVariant.body.variant,{id:p.m,orderItemId:m.item,size:'M',color:'Đen lúc mua'});
    check('updated_at advances while created_at stays unchanged',sameVariant.body.createdAt==='2020-01-01T00:00:00.000Z'&&sameVariant.body.updatedAt!==sameVariant.body.createdAt);
    same('keeping old images preserves original IDs',sameVariant.body.images.map(i=>i.id),own.body.review.images.map(i=>i.id));
    const changed=await call('PATCH',p.pid,'/'+rid,{rating:5,variant_id:p.l,comment:'  Đẹp 😀  '});
    same('changing purchased variant copies the correct snapshot',changed.body.variant,{id:p.l,orderItemId:l.item,size:'L',color:'Trắng lúc mua'});
    same('Unicode comment trims correctly',changed.body.comment,'Đẹp 😀');
    check('new files plus kept files cannot exceed five',(await call('PATCH',p.pid,'/'+rid,{rating:5,variant_id:p.l},[{},{}])).body.code==='REVIEW_TOO_MANY_IMAGES');
    const removed=changed.body.images[0],mixed=await call('PATCH',p.pid,'/'+rid,{rating:5,variant_id:p.l,remove_image_ids:[removed.id]},[{},{}]);
    check('remove one of four plus add two reaches five',mixed.status===200&&mixed.body.images.length===5);
    same('kept IDs retain their order',mixed.body.images.slice(0,3).map(i=>i.id),changed.body.images.slice(1).map(i=>i.id));
    check('old removed physical image is cleaned only after commit',!(await fs.readdir(directory)).includes(path.basename(removed.url)));
    const slots=(await pool.request().input('rid',sql.Int,rid).query('SELECT sort_order FROM dbo.review_images WHERE review_id=@rid ORDER BY sort_order;')).recordset;
    same('SQL unique image slots compact to 0..4',slots.map(r=>r.sort_order),[0,1,2,3,4]);
    for(const file of [{buffer:Buffer.from('not image')},{name:'test.exe'},{buffer:Buffer.alloc(2*1024*1024+1)}])check('invalid edit upload rejected',[413,415].includes((await call('PATCH',p.pid,'/'+rid,{rating:5,variant_id:p.l},[file])).status));
    const beforeFailure=await reviewSnapshot(),filesBefore=await fs.readdir(directory);
    await pool.request().batch("CREATE TRIGGER dbo.test_owner_image_failure ON dbo.review_images AFTER INSERT AS BEGIN THROW 51001,'Test-only metadata failure',1; END;");
    const failed=await call('PATCH',p.pid,'/'+rid,{rating:2,variant_id:p.l,remove_image_ids:[mixed.body.images[0].id]},[{}]);
    check('real SQL metadata failure returns safe server error',failed.status===500&&failed.body.code==='REVIEW_SERVER_ERROR');
    same('failed edit rolls back rating/metadata changes',await reviewSnapshot(),beforeFailure);same('failed edit keeps old files and cleans newly written file',await fs.readdir(directory),filesBefore);
    await pool.request().batch('DROP TRIGGER dbo.test_owner_image_failure;');
    const removeOnly=await call('PATCH',p.pid,'/'+rid,{rating:4,variant_id:p.l,comment:'Đ'.repeat(1000),remove_image_ids:[mixed.body.images[1].id]});
    check('remove-only edit and 1000 Unicode comment work',removeOnly.status===200&&removeOnly.body.images.length===4&&removeOnly.body.comment.length===1000);
    const replaceAll=await call('PATCH',p.pid,'/'+rid,{rating:5,variant_id:p.l,comment:'Thay toàn bộ ảnh',remove_image_ids:removeOnly.body.images.map(i=>i.id)},Array.from({length:5},()=>({})));
    check('five new uploads with all edit fields replace all old images',replaceAll.status===200&&replaceAll.body.images.length===5);
    const beforeDeleteFail=await reviewSnapshot(),beforeDeleteFiles=await fs.readdir(directory);
    await pool.request().batch("CREATE TRIGGER dbo.test_owner_delete_failure ON dbo.reviews AFTER DELETE AS BEGIN THROW 51002,'Test-only delete failure',1; END;");
    check('failed delete returns generic server response',(await call('DELETE',p.pid,'/'+rid)).status===500);
    same('delete failure rolls back review and cascade metadata',await reviewSnapshot(),beforeDeleteFail);same('delete failure leaves old physical files untouched',await fs.readdir(directory),beforeDeleteFiles);
    await pool.request().batch('DROP TRIGGER dbo.test_owner_delete_failure;');
    check('owner DELETE succeeds',(await call('DELETE',p.pid,'/'+rid)).status===200);
    same('owner GET becomes null after delete',(await call('GET',p.pid,'/me')).body.review,null);
    const afterDelete=await reviewSnapshot();check('review and image rows are gone',!afterDelete[0].some(r=>r.id===rid)&&!afterDelete[1].some(i=>i.review_id===rid));
    same('physical images belonging to other owner remain only',(await fs.readdir(directory)).sort(),otherReview.body.images.map(i=>path.basename(i.url)).sort());
    const eligibility=await (await fetch(base+'/api/products/'+p.pid+'/review-eligibility',{headers:{Authorization:'Bearer owner'}})).json();check('eligibility permits new create after delete',eligibility.canReview&&!eligibility.hasReviewed);
    const again=await call('POST',p.pid,'',{rating:5,variant_id:p.m},[]);check('same buyer can create again after real delete',again.status===201&&again.body.id!==rid);
    check('duplicate protection still applies after re-create',(await call('POST',p.pid,'',{rating:5,variant_id:p.l},[])).body.code==='REVIEW_ALREADY_EXISTS');
    const race=await Promise.all([call('PATCH',p.pid,'/'+again.body.id,{rating:4,variant_id:p.m}),call('DELETE',p.pid,'/'+again.body.id)]);
    check('concurrent owner update/delete serialize safely',race[1].status===200&&[200,404].includes(race[0].status));
    check('no review or file reappears after delete',(await call('GET',p.pid,'/me')).body.review===null&&(await fs.readdir(directory)).length===1);
    same('owner mutations do not change orders or purchase history',(await pool.request().query('SELECT * FROM dbo.orders ORDER BY id; SELECT * FROM dbo.order_items ORDER BY id;')).recordsets,orderBefore);
    console.log('SQL REVIEW OWNER VERIFY:',checks,'checks passed; no production fixtures.');
  }finally{
    if(server)await new Promise(r=>server.close(r));if(pool)await pool.close();if(directory)await fs.rm(directory,{recursive:true,force:true});
    if(created){adminSql('ALTER DATABASE '+quoted+' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE '+quoted+';');console.log('Dropped disposable database:',dbName);}
  }
}
main().catch(error=>{console.error('Review owner SQL verification FAILED:',error.code||error.message);process.exitCode=1;});
