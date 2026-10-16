'use strict';
// Fixtures, reviews and images are confined to a disposable DB and OS temp directory.
require('dotenv').config({path:require('node:path').join(__dirname,'..','.env'),quiet:true});
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),express=require('express'),sharp=require('sharp');
const db=require('../db'),{sql,config}=db,{createReview}=require('../lib/review-create'),media=require('../lib/review-media');
const dbName='BreezeReviewListTest_'+process.pid+'_'+Date.now();
if(!/^BreezeReviewListTest_[0-9]+_[0-9]+$/.test(dbName)||dbName===config.database)throw Error('Unsafe test database');
const quoted='['+dbName+']',serverDir=path.join(__dirname,'..');
let pool,created=false,server,directory,base,checks=0,reads=0;
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


async function call(pid,query='') {const r=await fetch(base+'/api/products/'+pid+'/reviews'+query);return {status:r.status,body:await r.json()};}
async function main(){
  try {
    adminSql('CREATE DATABASE '+quoted+';');created=true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::'+quoted+' TO ['+String(config.user).replace(/]/g,']]')+'];');
    console.log('Created disposable database:',dbName);
    execFileSync(process.execPath,['scripts/setup-db.js','--fresh'],{cwd:serverDir,env:{...process.env,DB_NAME:dbName},stdio:'pipe',maxBuffer:1024*1024});
    pool=await new sql.ConnectionPool({...config,database:dbName}).connect();
    directory=await fs.mkdtemp(path.join(os.tmpdir(),'breeze-review-list-sql-'));
    const storage=media.createStorage(directory),png=await sharp({create:{width:4,height:3,channels:3,background:'#123456'}}).png().toBuffer();
    const encoded=(await media.prepareImages([{buffer:png,mimetype:'image/png',originalname:'test.png'}]))[0];
    const p=await product('review-list-fixture-product'),empty=await product('review-list-fixture-empty');
    const fixtures=[],ratings=[5,4,3,2,1,5,4,3,2,1,5,4,1,5];
    for(let i=0;i<ratings.length;i++){
      const uid=await addUser('review-list-fixture-'+i);
      await pool.request().input('uid',sql.Int,uid).input('name',sql.NVarChar(150),i===1?null:'Tên công khai '+i)
        .query("UPDATE dbo.users SET display_name=@name,email='PRIVATE_EMAIL',phone='PRIVATE_PHONE' WHERE id=@uid;");
      await purchase(uid,'completed',p,p.m,'M','Đen lúc mua');
      const n=i>=12?1:i===3?5:i%3===0?1:0;
      const row=await createReview(pool,{userId:uid,productId:p.pid,data:{rating:ratings[i],variantId:p.m,comment:i===1?null:'Review Unicode '+i},images:Array.from({length:n},()=>encoded),storage});
      const date=new Date(i===0?'2026-10-14T10:16:00Z':'2026-10-15T10:16:00Z');
      await pool.request().input('rid',sql.Int,row.id).input('date',sql.DateTime2,date).input('hidden',sql.Bit,i>=12)
        .query('UPDATE dbo.reviews SET created_at=@date,updated_at=@date,is_hidden=@hidden WHERE id=@rid;');
      fixtures.push({...row,createdAt:date.toISOString(),hidden:i>=12,uid});
    }
    await pool.request().input('vid',sql.Int,p.m).query("UPDATE dbo.product_variants SET size=N'XL' WHERE id=@vid;");
    const before=(await pool.request().query('SELECT * FROM dbo.reviews ORDER BY id; SELECT * FROM dbo.review_images ORDER BY id; SELECT * FROM dbo.users ORDER BY id; SELECT * FROM dbo.orders ORDER BY id; SELECT * FROM dbo.order_items ORDER BY id; SELECT * FROM dbo.product_variants ORDER BY id;')).recordsets;
    require.cache[require.resolve('../db')].exports={...db,getPool:async()=>({request(){reads++;return pool.request();}})};
    const app=express();app.use('/api/products',require('../routes/products'));app.use('/review-images',express.static(directory));
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
    const visible=fixtures.filter(r=>!r.hidden).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id-a.id);
    const expectedSummary={averageRating:3.3,totalReviews:12,ratingCounts:{1:2,2:2,3:2,4:3,5:3},reviewsWithImages:4};
    const start=reads,first=await call(p.pid);
    check('public HTTP succeeds without Firebase auth',first.status===200);
    same('one SQL batch loads aggregate, count, page and all page images',reads-start,1);
    same('summary excludes hidden ratings and image reviews',first.body.summary,expectedSummary);
    same('default ten rows are newest-first with stable descending ID tie break',first.body.reviews.map(r=>r.id),visible.slice(0,10).map(r=>r.id));
    same('pagination metadata is real',[first.body.page,first.body.limit,first.body.total,first.body.totalPages],[1,10,12,2]);
    const second=await call(p.pid,'?page=2');
    same('page two contains only remaining older reviews',second.body.reviews.map(r=>r.id),visible.slice(10).map(r=>r.id));
    check('hidden review IDs never appear in public pages',[...first.body.reviews,...second.body.reviews].every(row=>fixtures.find(f=>f.id===row.id).hidden===false));
    same('out-of-range page clamps to last page',(await call(p.pid,'?page=2147483647')).body.page,2);
    const small=await call(p.pid,'?limit=2&page=2');same('custom page size slices the stable sequence',small.body.reviews.map(r=>r.id),visible.slice(2,4).map(r=>r.id));
    for(const rating of [1,2,3,4,5]){
      const r=await call(p.pid,'?rating='+rating),expected=visible.filter(row=>row.rating===rating);
      same('rating '+rating+' filters exactly matching reviews',r.body.reviews.map(row=>row.id),expected.map(row=>row.id));
      same('rating '+rating+' has filtered total',r.body.total,expected.length);
      same('summary stays global when rating '+rating+' is selected',r.body.summary,expectedSummary);
    }
    const pictures=await call(p.pid,'?hasImages=true');
    same('image filter counts reviews rather than individual images',pictures.body.reviews.map(row=>row.id),visible.filter(row=>row.images.length).map(row=>row.id));
    same('image filter total is four reviews, not eight files',pictures.body.total,4);
    const combined=await call(p.pid,'?rating=5&hasImages=true');
    same('combined filters use AND',combined.body.reviews.map(row=>row.id),visible.filter(row=>row.rating===5&&row.images.length).map(row=>row.id));
    same('hasImages=false leaves all visible rows',(await call(p.pid,'?hasImages=false')).body.total,12);
    const all=(await call(p.pid,'?limit=100')).body.reviews;
    for(const row of all){
      const fixture=fixtures.find(f=>f.id===row.id);
      same('stored purchase snapshots survive current size changing to XL',row.variant,{id:p.m,size:'M',color:'Đen lúc mua'});
      same('images retain original sort order and only their review association',row.images,fixture.images);
      check('public images are capped at five safe upload URLs',row.images.length<=5&&row.images.every(i=>/^\/review-images\/[a-f0-9]{32}\.webp$/.test(i.url)));
    }
    check('timestamps are ISO UTC data',all.every(row=>row.createdAt===fixtures.find(f=>f.id===row.id).createdAt));
    const nullName=all.find(row=>row.id===fixtures[1].id);check('missing name and comment remain null without inventing content',nullName.displayName===null&&nullName.comment===null);
    check('public DTO exposes no email, phone, Firebase UID or internal ownership IDs',!JSON.stringify(all).match(/PRIVATE_|firebase|user_id|order_item_id|email|phone|token/));
    const deleted=fixtures[1];await pool.request().input('rid',sql.Int,deleted.id).query('UPDATE dbo.reviews SET user_id=NULL WHERE id=@rid;');
    same('anonymous history remains public',(await call(p.pid,'?limit=100')).body.reviews.find(r=>r.id===deleted.id).displayName,null);
    await pool.request().input('rid',sql.Int,deleted.id).input('uid',sql.Int,deleted.uid).query('UPDATE dbo.reviews SET user_id=@uid WHERE id=@rid;');
    const zero=await call(empty.pid);same('product without reviews has an empty response',zero.body,{reviews:[],summary:{averageRating:null,totalReviews:0,ratingCounts:{1:0,2:0,3:0,4:0,5:0},reviewsWithImages:0},page:1,limit:10,total:0,totalPages:0});
    const noMatch=await call(p.pid,'?rating=3&hasImages=true');
    same('empty combined filter does not erase global summary',noMatch.body.summary,expectedSummary);
    same('empty filtered page has real zero total',[noMatch.body.reviews,noMatch.body.total,noMatch.body.totalPages],[[],0,0]);
    await pool.request().input('pid',sql.Int,p.pid).query('UPDATE dbo.reviews SET is_hidden=1 WHERE product_id=@pid;');
    same('hidden-only product is publicly indistinguishable from zero reviews',(await call(p.pid)).body,zero.body);
    for(const fixture of fixtures)await pool.request().input('rid',sql.Int,fixture.id).input('hidden',sql.Bit,fixture.hidden)
      .query('UPDATE dbo.reviews SET is_hidden=@hidden WHERE id=@rid;');
    check('missing product returns 404',(await call(2147483000)).status===404);
    for(const query of ['page=0','limit=101','rating=6','hasImages=1'])check('invalid '+query+' rejected',(await call(p.pid,'?'+query)).status===400);
    const served=await fetch(base+fixtures[0].images[0].url);check('returned image URL is client-accessible',served.status===200&&(await served.arrayBuffer()).byteLength>0);
    same('public requests do not mutate business or review state',(await pool.request().query('SELECT * FROM dbo.reviews ORDER BY id; SELECT * FROM dbo.review_images ORDER BY id; SELECT * FROM dbo.users ORDER BY id; SELECT * FROM dbo.orders ORDER BY id; SELECT * FROM dbo.order_items ORDER BY id; SELECT * FROM dbo.product_variants ORDER BY id;')).recordsets,before);
    console.log('SQL REVIEW LIST VERIFY:',checks,'checks passed; no production fixtures.');
  } finally {
    if(server)await new Promise(r=>server.close(r));
    if(pool)await pool.close();
    if(directory)await fs.rm(directory,{recursive:true,force:true});
    if(created){adminSql('ALTER DATABASE '+quoted+' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE '+quoted+';');console.log('Dropped disposable database:',dbName);}
  }
}
main().catch(error=>{console.error('Review list SQL verification FAILED:',error.code||error.message);process.exitCode=1;});
