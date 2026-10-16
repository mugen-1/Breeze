'use strict';
// All users, purchases, reviews and images belong to a disposable database/directory.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process'), express = require('express'), sharp = require('sharp');
const db = require('../db'), { sql, config } = db, media = require('../lib/review-media');
const dbName = 'BreezeReviewAdminTest_' + process.pid + '_' + Date.now();
if (!/^BreezeReviewAdminTest_[0-9]+_[0-9]+$/.test(dbName) || dbName === config.database) throw Error('Unsafe test database');
const quoted = '[' + dbName + ']', tokens = new Set();
let pool, server, base, directory, png, created = false, checks = 0;
function adminSql(query) { execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' }); }
function same(label, actual, expected) { assert.deepEqual(actual, expected, label); checks++; console.log('PASS: ' + label); }
function check(label, value) { same(label, !!value, true); }
async function user(token, role = 'customer') {
  tokens.add(token);
  return (await pool.request().input('uid', sql.VarChar(128), 'review-admin-fixture-' + token).input('role', sql.VarChar(20), role)
    .query(`INSERT INTO dbo.users(firebase_uid,display_name,email,role) OUTPUT INSERTED.id
      VALUES(@uid,N'Người mua <script>','private@example.test',@role);`)).recordset[0].id;
}
async function product(slug) {
  const id = (await pool.request().input('slug', sql.VarChar(160), slug).query(`
    INSERT INTO dbo.products(slug,name_vi,price,category_id,stock,images) OUTPUT INSERTED.id
      VALUES(@slug,N'Áo kiểm thử',100,(SELECT id FROM dbo.categories WHERE slug='sanpham-ao'),0,N'["img/ao1.png"]');`)).recordset[0].id;
  const variants = (await pool.request().input('pid', sql.Int, id).query(`
    INSERT INTO dbo.product_variants(product_id,sku,size,stock,is_base) OUTPUT INSERTED.id,INSERTED.size
      VALUES(@pid,'ADMIN-'+CONVERT(VARCHAR(11),@pid)+'-BASE',NULL,0,1),
        (@pid,'ADMIN-'+CONVERT(VARCHAR(11),@pid)+'-M',N'M',0,0);`)).recordset;
  return { id, variant: variants.find(v => v.size === 'M').id };
}
async function purchase(uid, p, status) {
  const oid = (await pool.request().input('uid', sql.Int, uid).input('status', sql.VarChar(20), status)
    .query('INSERT INTO dbo.orders(user_id,status,total_amount) OUTPUT INSERTED.id VALUES(@uid,@status,100);')).recordset[0].id;
  await pool.request().input('oid', sql.Int, oid).input('pid', sql.Int, p.id).input('vid', sql.Int, p.variant)
    .query(`INSERT INTO dbo.order_items(order_id,product_id,variant_id,product_name,size_snapshot,color_snapshot,unit_price,quantity,line_total)
      VALUES(@oid,@pid,@vid,N'Áo lúc mua',N'M lúc mua',N'Đen lúc mua',100,1,100);`);
}
async function directReview(uid, p, hidden = false) {
  return (await pool.request().input('uid', sql.Int, uid).input('pid', sql.Int, p.id).input('vid', sql.Int, p.variant).input('hidden', sql.Bit, hidden)
    .query(`INSERT INTO dbo.reviews(user_id,product_id,variant_id,size_snapshot,rating,comment,is_hidden,created_at)
      OUTPUT INSERTED.id VALUES(@uid,@pid,@vid,N'Snapshot alone is not proof',3,N'Fixture only',@hidden,'2026-10-14T00:00:00');`)).recordset[0].id;
}
async function call(method, route, body, token = 'admin', images = 0) {
  const headers = token ? { Authorization: 'Bearer ' + token } : {}; let payload;
  if (images) {
    payload = new FormData(); for (const [key, value] of Object.entries(body)) payload.append(key, String(value));
    for (let i = 0; i < images; i++) payload.append('images', new Blob([png], { type: 'image/png' }), 'test.png');
  } else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + '/api/' + route, { method, headers, body: payload });
  return { status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text(), headers: r.headers };
}
async function summary(p) { return (await call('GET', 'products/' + p.id + '/reviews', undefined, null)).body; }
async function business() { return (await pool.request().query('SELECT * FROM dbo.orders ORDER BY id; SELECT * FROM dbo.order_items ORDER BY id; SELECT * FROM dbo.products ORDER BY id; SELECT * FROM dbo.product_variants ORDER BY id; SELECT * FROM dbo.inventory_movements ORDER BY id; SELECT * FROM dbo.payment_transactions ORDER BY id;')).recordsets; }
async function main() {
  try {
    adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
    console.log('Created disposable database:', dbName);
    execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 1024 * 1024 });
    pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'breeze-review-admin-sql-'));
    png = await sharp({ create: { width: 5, height: 4, channels: 3, background: '#234567' } }).png().toBuffer();
    require.cache[require.resolve('../db')].exports = { ...db, getPool: async () => pool };
    require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ verifyIdToken: async token => {
      if (!tokens.has(token)) throw Error('Fixture token rejected'); return { uid: 'review-admin-fixture-' + token };
    } }) } };
    const security = require('../middleware/security');
    require.cache[require.resolve('../middleware/security')].exports = { ...security, buildUserActionLimiter: () => ((req, res, next) => next()) };
    media.storage = media.createStorage(directory);
    const app = express(); app.use(express.json()); app.use('/api/admin', require('../routes/admin')); app.use('/api/products', require('../routes/products'));
    server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port;
    await user('admin', 'admin'); const owner = await user('owner'), other = await user('other');
    const p = await product('admin-public-fixture'), verification = await product('admin-verification-fixture');
    same('empty database returns empty Admin list', (await call('GET', 'admin/reviews')).body, { page: 1, limit: 20, total: 0, totalPages: 0, reviews: [] });
    await purchase(owner, p, 'completed'); await purchase(other, p, 'completed');
    const five = await call('POST', 'products/' + p.id + '/reviews', { rating: 5, variant_id: p.variant, comment: 'Năm sao' }, 'owner');
    const one = await call('POST', 'products/' + p.id + '/reviews', { rating: 1, variant_id: p.variant, comment: 'Một sao' }, 'other', 2);
    same('real Create API creates both baseline reviews', [five.status, one.status], [201, 201]);
    const rid = one.body.id;
    for (const [method, route, body] of [['GET', 'admin/reviews'], ['GET', 'admin/reviews/' + rid], ['PATCH', 'admin/reviews/' + rid + '/visibility', { isHidden: true }], ['PATCH', 'admin/reviews/' + rid + '/visibility', { isHidden: false }]]) {
      same(method + route + ' requires authentication', (await call(method, route, body, null)).status, 401);
      same(method + route + ' rejects a customer', (await call(method, route, body, 'owner')).status, 403);
    }
    for (const status of ['cancelled', 'pending', 'shipping', 'confirmed', 'processing', 'paid', 'shipped']) {
      const uid = await user('status-' + status); await purchase(uid, verification, status); const id = await directReview(uid, verification);
      same(status + '-only purchase is not verified', (await call('GET', 'admin/reviews/' + id)).body.verifiedPurchase, false);
    }
    const wrong = await user('wrong-product'); await purchase(wrong, p, 'completed'); const wrongReview = await directReview(wrong, verification);
    same('completed order for a different product is not proof', (await call('GET', 'admin/reviews/' + wrongReview + '?verifiedPurchase=true&user_id=' + owner)).body.verifiedPurchase, false);
    const noPurchase = await user('no-purchase'), noReview = await directReview(noPurchase, p);
    same('another buyer completed purchase cannot verify this author', (await call('GET', 'admin/reviews/' + noReview)).body.verifiedPurchase, false);
    await pool.request().input('rid', sql.Int, noReview).query('DELETE FROM dbo.reviews WHERE id=@rid;');
    const anonymous = await directReview(null, verification);
    same('anonymized reviewer is not verified', (await call('GET', 'admin/reviews/' + anonymous)).body.verifiedPurchase, false);
    for (let i = 0; i < 22; i++) await directReview(await user('page-' + i), verification, i % 2 === 0);
    const listing = await call('GET', 'admin/reviews?limit=5');
    same('Admin list is bounded', listing.body.reviews.length, 5);
    check('multiple pages expose real totals', listing.body.total > 20 && listing.body.totalPages === Math.ceil(listing.body.total / 5));
    const expectedIds = (await pool.request().query('SELECT id FROM dbo.reviews ORDER BY created_at DESC,id DESC;')).recordset.map(r => r.id), seen = [];
    for (let page = 1; page <= listing.body.totalPages; page++) seen.push(...(await call('GET', 'admin/reviews?limit=5&page=' + page)).body.reviews.map(r => r.id));
    same('all pages are newest-first with no duplicate or omitted IDs', seen, expectedIds);
    for (const status of ['visible', 'hidden']) {
      const r = await call('GET', 'admin/reviews?limit=100&status=' + status);
      const n = (await pool.request().input('hidden', sql.Bit, status === 'hidden').query('SELECT COUNT(*) AS n FROM dbo.reviews WHERE is_hidden=@hidden;')).recordset[0].n;
      same(status + ' filter uses real count', r.body.total, n); check(status + ' rows match status', r.body.reviews.every(x => x.status === status));
    }
    same('out-of-range page clamps safely', (await call('GET', 'admin/reviews?limit=100&page=2147483647')).body.page, 1);
    const detail = (await call('GET', 'admin/reviews/' + rid)).body;
    same('completed author/product relation is verified', detail.verifiedPurchase, true);
    same('detail preserves purchased variant snapshots', detail.variant, { id: p.variant, size: 'M lúc mua', color: 'Đen lúc mua' });
    same('detail images follow original sort order', detail.images, one.body.images);
    check('detail has real product image and public name', detail.product.imageUrl === 'img/ao1.png' && detail.user.displayName === 'Người mua <script>');
    check('Admin DTO contains no private fields', !/private@example|firebase_uid|password|payment|token|[A-Z]:\\/.test(JSON.stringify(detail)));
    const initialBusiness = await business(), files = await fs.readdir(directory);
    const baseline = await summary(p); same('visible 5 and 1 stars average to 3', [baseline.summary.averageRating, baseline.summary.totalReviews, baseline.summary.reviewsWithImages], [3, 2, 1]);
    same('hide succeeds', (await call('PATCH', 'admin/reviews/' + rid + '/visibility', { isHidden: true })).status, 200);
    const hidden = await summary(p); same('hidden review disappears from list/average/count/image count', [hidden.reviews.map(r => r.id), hidden.summary.averageRating, hidden.summary.totalReviews, hidden.summary.ratingCounts['1'], hidden.summary.reviewsWithImages], [[five.body.id], 5, 1, 0, 0]);
    const hiddenDetail = (await call('GET', 'admin/reviews/' + rid)).body;
    same('hidden review and images still exist for Admin', [hiddenDetail.isHidden, hiddenDetail.images], [true, detail.images]);
    same('hide preserves rating, comment, author, product, variant and creation time',
      [hiddenDetail.rating, hiddenDetail.comment, hiddenDetail.user, hiddenDetail.product, hiddenDetail.variant, hiddenDetail.createdAt],
      [detail.rating, detail.comment, detail.user, detail.product, detail.variant, detail.createdAt]);
    same('physical images survive moderation', await fs.readdir(directory), files);
    const ownerGet = await call('GET', 'products/' + p.id + '/reviews/me', undefined, 'other'); same('owner still sees own hidden review', ownerGet.body.review.id, rid);
    same('hidden review still blocks duplicate Create', (await call('POST', 'products/' + p.id + '/reviews', { rating: 1, variant_id: p.variant }, 'other')).status, 409);
    same('owner can edit hidden review', (await call('PATCH', 'products/' + p.id + '/reviews/' + rid, { rating: 1, variant_id: p.variant, comment: 'Owner edit' }, 'other')).status, 200);
    same('owner edit never unhides', (await call('GET', 'admin/reviews/' + rid)).body.isHidden, true);
    same('unhide succeeds', (await call('PATCH', 'admin/reviews/' + rid + '/visibility', { isHidden: false })).status, 200);
    same('unhide restores all public summary counts', (await summary(p)).summary, baseline.summary);
    for (const body of [{ isHidden: true, rating: 5 }, { isHidden: true, comment: 'Admin edit' }, { isHidden: true, variant_id: p.variant }, { isHidden: true, images: [] }, { isHidden: true, verifiedPurchase: true }])
      same('moderation rejects content/ownership input ' + Object.keys(body)[1], (await call('PATCH', 'admin/reviews/' + rid + '/visibility', body)).status, 400);
    same('Admin has no Delete API', (await call('DELETE', 'admin/reviews/' + rid)).status, 404);
    for (const query of ['page=0', 'limit=101', 'status=bad', 'status=visible&status=hidden']) same('invalid filter rejected ' + query, (await call('GET', 'admin/reviews?' + query)).status, 400);
    same('invalid review ID rejected', (await call('GET', 'admin/reviews/2147483648')).status, 400);
    same('missing detail returns 404', (await call('GET', 'admin/reviews/2147483647')).status, 404);
    await pool.request().batch("CREATE TRIGGER dbo.test_admin_visibility_failure ON dbo.reviews AFTER UPDATE AS BEGIN THROW 51003,'Fixture failure',1; END;");
    const failed = await call('PATCH', 'admin/reviews/' + rid + '/visibility', { isHidden: true });
    same('SQL failure produces safe server error', failed.status, 500); check('failure hides raw SQL', !/Fixture|51003|stack|EREQUEST/.test(JSON.stringify(failed.body)));
    same('failed update rolls visibility back', (await call('GET', 'admin/reviews/' + rid)).body.isHidden, false);
    await pool.request().batch('DROP TRIGGER dbo.test_admin_visibility_failure;');
    const race = await Promise.all([call('PATCH', 'admin/reviews/' + rid + '/visibility', { isHidden: true }), call('PATCH', 'products/' + p.id + '/reviews/' + rid, { rating: 1, variant_id: p.variant, comment: 'Concurrent owner edit' }, 'other')]);
    same('owner edit and moderation both finish safely', race.map(r => r.status), [200, 200]);
    same('concurrent owner edit cannot lose hidden state', (await call('GET', 'admin/reviews/' + rid)).body.isHidden, true);
    same('moderation never changes order/product/stock/payment business data', await business(), initialBusiness);
    same('all review files still exist', await fs.readdir(directory), files);
    console.log('SQL REVIEW ADMIN VERIFY:', checks, 'checks passed; no production fixtures.');
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (pool) await pool.close();
    if (directory) {
      const resolved = path.resolve(directory), parent = path.resolve(os.tmpdir()) + path.sep;
      if (!resolved.startsWith(parent) || !path.basename(resolved).startsWith('breeze-review-admin-sql-')) throw Error('Unsafe fixture directory');
      await fs.rm(resolved, { recursive: true, force: true });
    }
    if (created) { adminSql('ALTER DATABASE ' + quoted + ' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + quoted + ';'); console.log('Dropped disposable database:', dbName); }
  }
}
main().catch(error => { console.error('Admin review verification FAILED:', error.code || error.message); process.exitCode = 1; });
