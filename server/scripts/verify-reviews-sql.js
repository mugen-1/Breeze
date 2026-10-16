'use strict';
// All fixtures live in a generated disposable database, never BreezeShopDB.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { execFileSync } = require('node:child_process');
const path = require('node:path'), assert = require('node:assert/strict');
const { sql, config } = require('../db');
const { getReviewEligibility, getPurchasedProductVariants } = require('../lib/review-eligibility');
const { audit } = require('./audit-reviews');
const dbName = `BreezeReviewTest_${process.pid}_${Date.now()}`;
if (!/^BreezeReviewTest_[0-9]+_[0-9]+$/.test(dbName) || dbName === config.database) throw new Error('Unsafe test database');
const quoted = `[${dbName}]`, serverDir = path.join(__dirname, '..');
let pool, created = false, checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log('PASS: ' + name); }
function adminSql(query) {
  execFileSync('sqlcmd', ['-E','-S',config.server,'-d','master','-No','-b','-Q',query], { stdio:'pipe' });
}
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
async function insertReview(uid, p, options = {}) {
  const data = { pid:p.pid, vid:p.m, item:null, rating:4, comment:null, ...options };
  return (await pool.request().input('uid',sql.Int,uid).input('pid',sql.Int,data.pid).input('vid',sql.Int,data.vid)
    .input('item',sql.Int,data.item).input('rating',sql.Int,data.rating).input('comment',sql.NVarChar(sql.MAX),data.comment)
    .query(`INSERT INTO dbo.reviews(user_id,product_id,variant_id,order_item_id,rating,comment,size_snapshot,color_snapshot)
    OUTPUT INSERTED.* VALUES(@uid,@pid,@vid,@item,@rating,@comment,N'M',N'Đen lúc mua');`)).recordset[0];
}
async function rejects(name, work, numbers) {
  await assert.rejects(work, error => numbers.includes(error.number)); checks++; console.log('PASS: ' + name);
}
async function main() {
  try {
    adminSql(`CREATE DATABASE ${quoted};`); created = true;
    adminSql(`ALTER AUTHORIZATION ON DATABASE::${quoted} TO [${String(config.user).replace(/]/g,']]')}];`);
    console.log('Created disposable database:',dbName);
    execFileSync(process.execPath,['scripts/setup-db.js','--fresh'], { cwd:serverDir,env:{...process.env,DB_NAME:dbName},stdio:'pipe',maxBuffer:1024*1024 });
    pool = await new sql.ConnectionPool({...config,database:dbName}).connect();
    const fresh = await audit(pool);
    check('migration chain creates both empty review tables',fresh.reviews===0&&fresh.review_images===0);
    const u = await addUser('review-test-owner'), other = await addUser('review-test-other');
    const p = await product('review-test-product'), different = await product('review-test-different');
    let eligibility = await getReviewEligibility(pool,u,p.pid);
    check('no purchase means false eligibility and no review',!eligibility.canReview&&!eligibility.hasReviewed&&!eligibility.purchasedVariants.length);
    await purchase(other,'completed',p,p.m,'M','Other user');
    await insertReview(other,p);
    eligibility = await getReviewEligibility(pool,u,p.pid);
    check('another user purchase and review cannot grant access or hasReviewed',!eligibility.canReview&&!eligibility.hasReviewed&&!eligibility.purchasedVariants.length);
    await purchase(u,'completed',different,different.m,'M','Other product');
    check('completed order for another product cannot grant access',!(await getReviewEligibility(pool,u,p.pid)).canReview);
    for(const status of ['pending','confirmed','processing','shipping','cancelled','paid','shipped']) {
      await purchase(u,status,p,p.base);
      check(status+' is not a completed purchase',!(await getReviewEligibility(pool,u,p.pid)).canReview);
    }
    await purchase(u,'completed',p,p.m,'M','Black at purchase');
    const newest = await purchase(u,'completed',p,p.m,'M','Đen lúc mua','2026-10-15T00:00:00Z');
    await purchase(u,'completed',p,p.l,'L','White at purchase');
    await pool.request().input('vid',sql.Int,p.m).query("UPDATE dbo.product_variants SET size=N'XL' WHERE id=@vid;");
    eligibility = await getReviewEligibility(pool,u,p.pid);
    check('completed orders grant review eligibility without claiming a review',eligibility.canReview&&!eligibility.hasReviewed);
    assert.deepEqual(eligibility.purchasedVariants,[
      {order_item_id:newest.item,variant_id:p.m,size_snapshot:'M',color_snapshot:'Đen lúc mua'},
      {order_item_id:eligibility.purchasedVariants[1].order_item_id,variant_id:p.l,size_snapshot:'L',color_snapshot:'White at purchase'}
    ]);checks++;
    check('only two purchased identities despite repeated orders',eligibility.purchasedVariants.length===2);
    check('cancelled/non-completed BASE variant is absent',eligibility.purchasedVariants.every(v=>v.variant_id!==p.base));
    check('snapshot is preserved despite current variant being changed to XL',eligibility.purchasedVariants[0].size_snapshot==='M');
    assert.deepEqual(await getPurchasedProductVariants(pool,u,p.pid),eligibility.purchasedVariants);checks++;
    const review = await insertReview(u,p,{item:newest.item,comment:'Đánh giá tiếng Việt: đẹp, vừa vặn.'});
    check('comment round-trips Unicode',review.comment==='Đánh giá tiếng Việt: đẹp, vừa vặn.');
    check('hidden defaults false and timestamps default correctly',review.is_hidden===false&&review.created_at instanceof Date&&review.updated_at instanceof Date);
    eligibility = await getReviewEligibility(pool,u,p.pid);
    check('test-only existing review returns hasReviewed true while retaining purchase eligibility',eligibility.canReview&&eligibility.hasReviewed);
    await pool.request().input('rid',sql.Int,review.id).query('UPDATE dbo.reviews SET is_hidden=1 WHERE id=@rid;');
    check('hidden review still counts as existing review',(await getReviewEligibility(pool,u,p.pid)).hasReviewed);
    await rejects('unique user/product includes hidden reviews',()=>insertReview(u,p),[2601,2627]);
    for(const rating of [0,6,-1]) await rejects('rating rejected: '+rating,()=>insertReview(null,p,{rating}),[547,220,8115]);
    for(const rating of [1,2,3,4,5]) check('rating accepted: '+rating,(await insertReview(null,p,{rating})).rating===rating);
    check('comment can be null',(await insertReview(null,p)).comment===null);
    check('comment accepts 1000 Unicode characters',(await insertReview(null,p,{comment:'Đ'.repeat(1000)})).comment.length===1000);
    await rejects('comment rejects over 1000 characters',()=>insertReview(null,p,{comment:'Đ'.repeat(1001)}),[2628,8152]);
    await rejects('user FK rejects a missing user',()=>insertReview(2147483000,p),[547]);
    await rejects('product FK rejects a missing product',()=>insertReview(null,p,{pid:2147483000}),[547]);
    await rejects('order item FK rejects a missing item',()=>insertReview(null,p,{item:2147483000}),[547]);
    await rejects('variant/product FK rejects cross-product variant',()=>insertReview(null,p,{vid:different.m}),[547]);
    const firstImage = (await pool.request().input('rid',sql.Int,review.id).query(`INSERT INTO dbo.review_images(review_id,image_path)
      OUTPUT INSERTED.sort_order VALUES(@rid,N'/test-only/image-0.png');`)).recordset[0];
    check('image sort order defaults zero',firstImage.sort_order===0);
    for(let i=1;i<5;i++) await pool.request().input('rid',sql.Int,review.id).input('i',sql.Int,i)
      .query("INSERT INTO dbo.review_images(review_id,image_path,sort_order) VALUES(@rid,N'/test-only/image.png',@i);");
    const imageInsert = (rid,sort,pathValue='/test-only/image.png')=>pool.request().input('rid',sql.Int,rid).input('sort',sql.Int,sort)
      .input('path',sql.NVarChar(500),pathValue).query('INSERT INTO dbo.review_images(review_id,image_path,sort_order) VALUES(@rid,@path,@sort);');
    await rejects('image FK rejects missing review',()=>imageInsert(2147483000,0),[547]);
    await rejects('sixth image slot is rejected',()=>imageInsert(review.id,5),[547]);
    await rejects('duplicate image slot is rejected',()=>imageInsert(review.id,0),[2601,2627]);
    const emptyPathReview = await insertReview(null,p);
    await rejects('blank image path is rejected with a valid review FK',()=>imageInsert(emptyPathReview.id,0,''),[547]);
    const beforeRerun = (await pool.request().query('SELECT * FROM dbo.reviews ORDER BY id; SELECT * FROM dbo.review_images ORDER BY id;')).recordsets;
    const migration = require('node:fs').readFileSync(path.join(serverDir,'db/migrations/019_reviews.sql'),'utf8');
    await pool.request().batch(migration);
    assert.deepEqual((await pool.request().query('SELECT * FROM dbo.reviews ORDER BY id; SELECT * FROM dbo.review_images ORDER BY id;')).recordsets,beforeRerun);checks++;
    check('schema audit passes after rerun on populated test tables',(await audit(pool)).review_images===5);
    await pool.request().input('oid',sql.Int,newest.oid).query('DELETE FROM dbo.orders WHERE id=@oid;');
    const detached = (await pool.request().input('rid',sql.Int,review.id).query('SELECT * FROM dbo.reviews WHERE id=@rid;')).recordset[0];
    check('existing Admin order deletion detaches review reference without deleting history',detached.order_item_id===null&&detached.size_snapshot==='M'&&detached.color_snapshot==='Đen lúc mua');
    await pool.request().input('uid',sql.Int,u).query('UPDATE dbo.orders SET user_id=NULL WHERE user_id=@uid; DELETE FROM dbo.users WHERE id=@uid;');
    const anonymous = (await pool.request().input('rid',sql.Int,review.id).query('SELECT user_id FROM dbo.reviews WHERE id=@rid;')).recordset[0];
    check('existing account deletion anonymizes review without blocking deletion',anonymous.user_id===null);
    check('account deletion preserves review image history',(await audit(pool)).review_images===5);
    await pool.request().input('rid',sql.Int,review.id).query('DELETE FROM dbo.reviews WHERE id=@rid;');
    check('review deletion cascades only its image associations',(await audit(pool)).review_images===0);
    console.log(`SQL REVIEW VERIFY: ${checks} checks passed; all fixtures confined to disposable database.`);
  } finally {
    if(pool) await pool.close();
    if(created) { adminSql(`ALTER DATABASE ${quoted} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${quoted};`);console.log('Dropped disposable database:',dbName); }
  }
}
main().catch(error=>{console.error('Review SQL verification FAILED:',error.code||error.message);process.exitCode=1;});
