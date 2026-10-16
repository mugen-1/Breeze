'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict'), express = require('express'), realSql = require('mssql');
let state, server, base;
const result = recordset => ({ recordset });
const review = { id: 9, product_id: 7, variant_id: 71, rating: 2, comment: '<b>Đẹp</b>',
  size_snapshot: 'M lúc mua', color_snapshot: 'Đen lúc mua', display_name: ' Tên người mua ',
  name_vi: 'Áo', name_en: 'Shirt', product_images: '["img/ao1.png"]', verified_purchase: true,
  is_hidden: false, created_at: new Date('2026-10-14T01:00:00Z'), updated_at: new Date('2026-10-14T01:00:00Z'),
  email: 'PRIVATE_EMAIL', firebase_uid: 'PRIVATE_UID', password: 'PRIVATE_PASSWORD', payment_data: 'PRIVATE_PAYMENT' };
class Transaction { async begin() {} async commit() {} async rollback() {} }
class Request {
  constructor() { this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.params;
    if (q.startsWith('SELECT id FROM dbo.users WITH')) return result([{ id: 99 }]);
    if (q.startsWith('MERGE dbo.users')) return result([{ id: 99, role: state.role }]);
    state.queries.push({ q, p });
    if (state.fail) throw Object.assign(Error('PRIVATE_SQL_STACK_PATH'), { code: 'EREQUEST' });
    if (q.startsWith('UPDATE dbo.reviews')) {
      assert.match(q, /SET is_hidden=@hidden,updated_at=SYSUTCDATETIME\(\)/);
      assert.doesNotMatch(q, /rating=|comment=|variant_id=|\bDELETE\b|\bINSERT\b/);
      const r = state.rows.find(r => r.id === p.rid);
      if (r) r.is_hidden = p.hidden;
      return result(r ? [{ id: r.id, is_hidden: r.is_hidden }] : []);
    }
    assert.match(q, /o.user_id=r.user_id AND o.status='completed' AND oi.product_id=r.product_id/);
    assert.doesNotMatch(q, /u.email|password|firebase_uid|token|payment_data/);
    if (p.rid) return { recordsets: [state.rows.filter(r => r.id === p.rid), state.images] };
    assert.match(q, /ORDER BY r.created_at DESC,r.id DESC OFFSET/);
    const rows = state.rows.filter(r => p.hidden === null || r.is_hidden === p.hidden)
      .sort((a, b) => b.created_at - a.created_at || b.id - a.id);
    const page = Math.min(p.page, Math.max(1, Math.ceil(rows.length / p.limit)));
    return { recordsets: [[{ total: rows.length, page }], rows.slice((page - 1) * p.limit, page * p.limit)] };
  }
}
require.cache[require.resolve('../db')] = { exports: { sql: { ...realSql, Request, Transaction }, getPool: async () => ({ request: () => new Request() }) } };
require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ async verifyIdToken(token, revoked) {
  assert.equal(revoked, true); if (token !== 'active') throw Error('PRIVATE_TOKEN');
  return { uid: 'admin-review-test', email_verified: false };
} }) } };
const app = express(); app.use(express.json({ strict: false })); app.use('/api/admin', require('../routes/admin'));
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port; });
after(async () => { await new Promise(r => server.close(r)); });
beforeEach(() => { state = { role: 'admin', queries: [], rows: [{ ...review }, { ...review, id: 10, is_hidden: true }], images: [{ image_path: '/review-images/' + 'a'.repeat(32) + '.webp' }] }; });
async function call(method = 'GET', tail = '', body, token = 'active') {
  const r = await fetch(base + '/api/admin/reviews' + tail, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text(), headers: r.headers };
}
for (const [method, tail, body] of [['GET', ''], ['GET', '/9'], ['PATCH', '/9/visibility', { isHidden: true }], ['PATCH', '/9/visibility', { isHidden: false }]]) {
  test(method + tail + JSON.stringify(body) + ' rejects missing/invalid tokens and customer role', async () => {
    for (const token of [null, 'expired']) assert.equal((await call(method, tail, body, token)).status, 401);
    state.role = 'customer'; assert.equal((await call(method, tail + '?role=admin&user_id=99', method === 'GET' ? undefined : { ...body, role: 'admin', user_id: 99 })).status, 403);
    assert.equal(state.queries.length, 0);
  });
}
test('Admin list returns real fields, newest-first IDs, pagination and no private fields', async () => {
  const r = await call(); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual([r.body.page, r.body.limit, r.body.total, r.body.totalPages], [1, 20, 2, 1]);
  assert.deepEqual(r.body.reviews.map(x => x.id), [10, 9]);
  const row = r.body.reviews[1]; assert.equal(row.rating, 2); assert.equal(row.comment, review.comment);
  assert.equal(row.user.displayName, 'Tên người mua'); assert.equal(row.product.name, 'Áo'); assert.equal(row.verifiedPurchase, true);
  assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE|password|firebase|payment|email/);
  assert.deepEqual(state.queries[0].p, { page: 1, limit: 20, hidden: null });
});
for (const status of ['all', 'visible', 'hidden']) test('status ' + status + ' uses a bound filter', async () => {
  const r = await call('GET', '?status=' + status + '&page=9&limit=1');
  assert.equal(r.body.total, status === 'all' ? 2 : 1);
  assert.equal(r.body.page, status === 'all' ? 2 : 1);
  assert.equal(state.queries[0].p.hidden, status === 'all' ? null : status === 'hidden');
});
for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=', 'page=2147483648', 'page=1&page=2', 'limit=0', 'limit=101', 'limit=bad', 'limit=1&limit=2', 'status=', 'status=bad', 'status=all&status=hidden']) test('invalid pagination/filter ' + query, async () => {
  assert.equal((await call('GET', '?' + query)).status, 400); assert.equal(state.queries.length, 0);
});
test('empty DB returns real empty page and zero totals', async () => { state.rows = []; const r = await call(); assert.deepEqual(r.body, { page: 1, limit: 20, total: 0, totalPages: 0, reviews: [] }); });
test('detail returns hidden review, exact snapshots, safe ordered images and no sensitive data', async () => {
  const r = await call('GET', '/10'); assert.equal(r.status, 200); assert.equal(r.body.status, 'hidden');
  assert.deepEqual(r.body.variant, { id: 71, size: review.size_snapshot, color: review.color_snapshot });
  assert.equal(r.body.images[0].url, state.images[0].image_path); assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE|email|firebase|payment/);
  assert.match(state.queries[0].q, /TOP\(5\).*ORDER BY sort_order,id/);
});
test('detail never exposes invalid filesystem paths or invalid product URLs', async () => {
  state.images.push({ image_path: 'C:\\PRIVATE\\x.png' }); state.rows[0].product_images = '["C:\\\\PRIVATE\\\\x.png","javascript:alert(1)","img/../secret"]';
  const r = await call('GET', '/9'); assert.equal(r.body.images.length, 1); assert.equal(r.body.product.imageUrl, null);
});
for (const id of ['0', '-1', '1.5', 'bad', '2147483648', '1%20OR%201=1']) test('invalid review ID ' + id, async () => {
  assert.equal((await call('GET', '/' + id)).status, 400); assert.equal((await call('PATCH', '/' + id + '/visibility', { isHidden: true })).status, 400); assert.equal(state.queries.length, 0);
});
for (const body of [null, [], {}, { isHidden: 'true' }, { isHidden: 1 }, { isHidden: true, rating: 5 }, { isHidden: false, comment: 'changed' }, { isHidden: false, verifiedPurchase: true }, { isHidden: true, images: [] }]) test('visibility rejects non-allowlisted body ' + JSON.stringify(body), async () => {
  assert.equal((await call('PATCH', '/9/visibility', body)).status, 400); assert.equal(state.queries.length, 0);
});
test('hide/unhide change only visibility and preserve row and content', async () => {
  const before = { ...state.rows[0] }; assert.equal((await call('PATCH', '/9/visibility', { isHidden: true })).status, 200);
  assert.equal(state.rows[0].is_hidden, true); assert.equal(state.rows.length, 2);
  await call('PATCH', '/9/visibility', { isHidden: false }); assert.deepEqual(state.rows[0], before);
});
test('missing reviews return 404 for detail and visibility', async () => { assert.equal((await call('GET', '/99')).status, 404); assert.equal((await call('PATCH', '/99/visibility', { isHidden: true })).status, 404); });
test('there is no Admin DELETE or content-edit endpoint', async () => { assert.equal((await call('DELETE', '/9')).status, 404); assert.equal((await call('PATCH', '/9', { rating: 5 })).status, 404); });
test('SQL errors are safe and do not publish raw errors', async t => {
  t.mock.method(console, 'error', () => {}); state.fail = true;
  for (const [method, tail, body] of [['GET', ''], ['GET', '/9'], ['PATCH', '/9/visibility', { isHidden: true }]]) {
    const r = await call(method, tail, body); assert.equal(r.status, 500); assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE|EREQUEST|stack/);
  }
});
