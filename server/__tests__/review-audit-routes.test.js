'use strict';

// log phía khách cho đánh giá: REVIEW_CREATE (POST /api/products/:id/reviews), REVIEW_UPDATE (PATCH .../:reviewId),
// REVIEW_DELETE (DELETE .../:reviewId). Router + middleware/auth + lib/audit.js THẬT; chỉ thay Firebase, SQL (giả, có
// transaction: begin chụp bản sao, commit ghi đè, rollback bỏ; SELECT trả ĐÚNG các cột câu lệnh chọn) và nơi lưu ảnh
// (thư mục tạm, tên file tất định). JSON so với hằng số VIẾT CỨNG = JSON thật của bản 7d547cb (trước khi có log), lấy
// MỘT LẦN ngày 2026-11-16 trên đúng SQL giả này — test không dùng git. SQL thật: scripts/verify-audit-sql.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const express = require('express'), realSql = require('mssql'), sharp = require('sharp');

const XSS = '<img src=x onerror=alert(1)>';
const T0 = '2026-11-16T01:00:00.000Z', T1 = '2026-11-16T02:00:00.000Z';
let db, failAudit, failSql, directory, png, fileNo;
const rs = (recordset = []) => ({ recordset, recordsets: [recordset], rowsAffected: [recordset.length] });
const pick = (row, cols) => Object.fromEntries(cols.map(c => [c, row[c]]));
const colsOf = q => q.slice(q.indexOf('SELECT ') + 7, q.indexOf(' FROM ')).split(',').map(c => c.trim());
const bySort = (a, b) => a.sort_order - b.sort_order || a.id - b.id;
class Transaction {
  async begin() { this.data = structuredClone(db); }
  async commit() { db = this.data; this.data = null; }
  async rollback() { this.data = null; db.rollbacks++; }
}
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(k, type, v) { this.p[k] = v; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.p, d = this.tx ? this.tx.data : db;
    if (!d) throw new Error('SQL sau commit/rollback');
    if (failSql && q.startsWith(failSql)) throw Object.assign(new Error('PRIVATE sql giả lỗi'), { code: 'EREQUEST' });
    // middleware/auth.js (thật): khoá + MERGE theo firebase_uid; trả dòng user đầy đủ như câu SELECT của nó.
    if (q.startsWith('SELECT id FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE firebase_uid')) {
      return rs(d.users.filter(u => u.firebase_uid === p.uid).map(u => ({ id: u.id })));
    }
    if (q.startsWith('MERGE dbo.users')) return rs(d.users.filter(u => u.firebase_uid === p.uid).map(u => ({ ...u })));
    if (/^SELECT id FROM dbo\.users WITH \(UPDLOCK, ?HOLDLOCK\) WHERE id=@uid;$/.test(q)) {
      return rs(d.users.filter(u => u.id === p.uid).map(u => ({ id: u.id })));
    }
    if (q.startsWith('SELECT id FROM dbo.products WITH (HOLDLOCK) WHERE id=@pid AND is_active=1')) {
      return rs(d.products.filter(x => x.id === p.pid).map(x => ({ id: x.id })));
    }
    if (q === 'SELECT id FROM dbo.reviews WHERE user_id=@uid AND product_id=@pid;') {
      return rs(d.reviews.filter(r => r.user_id === p.uid && r.product_id === p.pid).map(r => ({ id: r.id })));
    }
    if (q.startsWith('WITH purchased')) {
      return rs(d.purchases.filter(x => x.user_id === p.uid && x.product_id === p.pid && x.status === 'completed')
        .map(x => pick(x, ['order_item_id', 'variant_id', 'size_snapshot', 'color_snapshot'])));
    }
    if (q.startsWith('SELECT id FROM dbo.products WHERE id=@pid AND is_active=1; SELECT ')) { // GET /me
      const mine = d.reviews.filter(r => r.user_id === p.uid && r.product_id === p.pid);
      const sets = [d.products.filter(x => x.id === p.pid).map(x => ({ id: x.id })), mine.map(r => pick(r, colsOf(q.split('; ')[1]))),
        d.images.filter(i => mine.some(r => r.id === i.review_id)).sort(bySort).map(i => pick(i, ['id', 'image_path', 'sort_order']))];
      return { recordset: sets[0], recordsets: sets };
    }
    if (q.startsWith('SELECT ') && q.endsWith(' FROM dbo.reviews WITH (UPDLOCK,HOLDLOCK) WHERE id=@rid AND user_id=@uid AND product_id=@pid;')) {
      return rs(d.reviews.filter(r => r.id === p.rid && r.user_id === p.uid && r.product_id === p.pid).map(r => pick(r, colsOf(q))));
    }
    if (q.startsWith('SELECT id,image_path,sort_order FROM dbo.review_images WITH (UPDLOCK,HOLDLOCK) WHERE review_id=@rid')) {
      return rs(d.images.filter(i => i.review_id === p.rid).sort(bySort).map(i => pick(i, ['id', 'image_path', 'sort_order'])));
    }
    assert.ok(this.tx, 'câu ghi phải chạy trong transaction: ' + q.slice(0, 60));
    if (q.startsWith('INSERT INTO dbo.reviews(')) {
      const r = { id: ++d.seq.review, user_id: p.uid, product_id: p.pid, variant_id: p.vid, order_item_id: p.item, size_snapshot: p.size,
        color_snapshot: p.color, rating: p.rating, comment: p.comment, is_hidden: false, created_at: new Date(T0), updated_at: new Date(T0) };
      d.reviews.push(r);
      return rs([pick(r, ['id', 'rating', 'comment', 'created_at', 'updated_at'])]);
    }
    if (q.startsWith('INSERT INTO dbo.review_images(')) {
      const img = { id: ++d.seq.image, review_id: p.rid, image_path: p.url, sort_order: p.sort };
      d.images.push(img);
      return rs(q.includes('OUTPUT INSERTED.id') ? [{ id: img.id }] : []);
    }
    if (q.startsWith('UPDATE dbo.reviews SET rating=@rating')) {
      const r = d.reviews.find(x => x.id === p.rid && x.user_id === p.uid);
      Object.assign(r, { rating: p.rating, comment: p.comment, variant_id: p.vid, order_item_id: p.item, size_snapshot: p.size,
        color_snapshot: p.color, updated_at: new Date(T1) });
      return rs([pick(r, ['id', 'product_id', 'variant_id', 'order_item_id', 'size_snapshot', 'color_snapshot', 'rating', 'comment',
        'created_at', 'updated_at'])]);
    }
    if (q.startsWith('DELETE FROM dbo.review_images WHERE id=@image AND review_id=@rid')) {
      d.images = d.images.filter(i => !(i.id === p.image && i.review_id === p.rid)); return rs();
    }
    if (q.startsWith('UPDATE dbo.review_images SET sort_order=@sort')) {
      d.images.find(i => i.id === p.image && i.review_id === p.rid).sort_order = p.sort; return rs();
    }
    if (q.startsWith('DELETE FROM dbo.reviews WHERE id=@rid AND user_id=@uid')) { // review_images: ON DELETE CASCADE
      const gone = d.reviews.filter(r => r.id === p.rid && r.user_id === p.uid).map(r => r.id);
      d.reviews = d.reviews.filter(r => !gone.includes(r.id)); d.images = d.images.filter(i => !gone.includes(i.review_id));
      return rs();
    }
    if (q.startsWith('UPDATE dbo.reviews SET is_hidden=@hidden')) { // quản trị ẩn/hiện
      const r = d.reviews.find(x => x.id === p.rid); if (!r) return rs();
      const was = r.is_hidden; r.is_hidden = p.hidden;
      return rs([{ id: r.id, is_hidden: r.is_hidden, was_hidden: was, product_id: r.product_id }]);
    }
    if (q.startsWith('INSERT INTO dbo.audit_logs')) {
      if (failAudit) throw new Error('audit giả lỗi');
      d.audit.push(pick(p, ['actor_user_id', 'actor_email', 'actor_role', 'action', 'entity_type', 'entity_id', 'before_json', 'after_json']));
      return rs([{ id: String(d.audit.length) }]);
    }
    throw new Error('Unexpected SQL: ' + q);
  }
}
require.cache[require.resolve('../db')] = { exports: {
  sql: { ...realSql, Transaction, Request }, getPool: async () => ({ request: () => new Request(null) }),
} };
const TOKENS = { buyer: 'fb-buyer', staff: 'fb-staff', admin: 'fb-admin', nobuy: 'fb-nobuy', other: 'fb-other' };
require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ async verifyIdToken(token, revoked) {
  assert.equal(revoked, true);
  if (!TOKENS[token]) throw Object.assign(new Error('PRIVATE token'), { code: 'auth/id-token-expired' });
  return { uid: TOKENS[token] };
} }) } };
const security = require('../middleware/security'); // bỏ giới hạn số lần để các test không dùng chung bộ đếm
require.cache[require.resolve('../middleware/security')].exports = { ...security, buildUserActionLimiter: () => (req, res, next) => next() };
const media = require('../lib/review-media'); // PHẢI gán trước khi nạp route (route lấy `storage` lúc require)
media.storage = {
  async save(buffer) {
    const name = (++fileNo).toString(16).padStart(32, '0') + '.webp';
    fs.writeFileSync(path.join(directory, name), buffer);
    return media.PUBLIC_PREFIX + name;
  },
  remove: urls => media.createStorage(directory).remove(urls),
};
const app = express();
app.use(express.json());
app.use('/api/products', require('../routes/products'));
app.use('/api/admin', require('../routes/admin'));
let server, base;
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'breeze-review-audit-test-'));
  png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });

const person = (id, key, email, display_name, phone, role) => ({ id, firebase_uid: TOKENS[key], email, display_name, role,
  created_at: new Date(T0), last_login: null, phone, dob: null, gender: null, country: null, avatar_url: null, is_blacklisted: false });
const BUYER = person(3, 'buyer', 'khach.rieng@example.test', 'Tên Riêng Tư', '0911222333', 'customer');
const STAFF = person(5, 'staff', 'nv.rieng@example.test', 'Nhân Viên Riêng', '0944555666', 'staff');
const buy = (user_id, product_id, variant_id, order_item_id, size_snapshot, color_snapshot, status = 'completed') =>
  ({ user_id, product_id, variant_id, order_item_id, size_snapshot, color_snapshot, status });
beforeEach(async () => {
  for (const f of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, f));
  fileNo = 0; failAudit = false; failSql = null;
  db = { audit: [], rollbacks: 0, seq: { review: 100, image: 100 },
    users: [person(1, 'admin', 'admin@example.test', 'Quản Trị', null, 'admin'), BUYER,
      person(4, 'other', 'khac@example.test', 'Khách Khác', null, 'customer'), STAFF,
      person(6, 'nobuy', 'chua.mua@example.test', 'Chưa Mua', null, 'customer')],
    products: [{ id: 7 }, { id: 8 }],
    purchases: [buy(3, 7, 71, 11, 'M', 'Đen'), buy(3, 7, 72, 12, 'L', 'Trắng'), buy(3, 8, 81, 13, 'S', 'Xanh'),
      buy(5, 8, 81, 21, 'S', 'Xanh'), buy(6, 8, 81, 31, 'S', 'Xanh', 'shipping'), buy(4, 7, 71, 41, 'M', 'Đen')],
    reviews: [
      { id: 91, user_id: 3, product_id: 7, variant_id: 71, order_item_id: 11, size_snapshot: 'M', color_snapshot: 'Đen', rating: 4,
        comment: 'Ban đầu', is_hidden: false, created_at: new Date(T0), updated_at: new Date(T0) },
      { id: 92, user_id: 4, product_id: 7, variant_id: 71, order_item_id: 41, size_snapshot: 'M', color_snapshot: 'Đen', rating: 2,
        comment: 'Của người khác', is_hidden: false, created_at: new Date(T0), updated_at: new Date(T0) }],
    images: [] };
  const seed = async (id, review_id, sort_order) => db.images.push({ id, review_id, image_path: await media.storage.save(png), sort_order });
  await seed(10, 91, 0); await seed(11, 91, 1); await seed(20, 92, 0);
});

async function call(method, url, { token = 'buyer', body, files = 0 } = {}) {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  let payload;
  if (files) {
    payload = new FormData();
    for (const [k, v] of Object.entries(body || {})) payload.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    for (let i = 0; i < files; i++) payload.append('images', new Blob([png], { type: 'image/png' }), 'anh.png');
  } else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  return { status: r.status, body: await r.json() };
}
// JSON + mã HTTP thật của bản 7d547cb (chưa có log) cho từng kịch bản, chạy trên SQL giả + dữ liệu đầu ở trên.
const OLD = {
  'create': { "status": 201, "body": {
    "id": 101,
    "productId": 8,
    "rating": 5,
    "comment": "<img src=x onerror=alert(1)>",
    "variant": {"id":81,"orderItemId":13,"size":"S","color":"Xanh"},
    "images": [{"url":"/review-images/00000000000000000000000000000004.webp"}],
    "createdAt": "2026-11-16T01:00:00.000Z",
    "updatedAt": "2026-11-16T01:00:00.000Z",
  } },
  'create-no-image': { "status": 201, "body": {
    "id": 101,
    "productId": 8,
    "rating": 3,
    "comment": null,
    "variant": {"id":81,"orderItemId":13,"size":"S","color":"Xanh"},
    "images": [],
    "createdAt": "2026-11-16T01:00:00.000Z",
    "updatedAt": "2026-11-16T01:00:00.000Z",
  } },
  'create-staff': { "status": 201, "body": {
    "id": 101,
    "productId": 8,
    "rating": 4,
    "comment": null,
    "variant": {"id":81,"orderItemId":21,"size":"S","color":"Xanh"},
    "images": [],
    "createdAt": "2026-11-16T01:00:00.000Z",
    "updatedAt": "2026-11-16T01:00:00.000Z",
  } },
  'update': { "status": 200, "body": {
    "id": 91,
    "productId": 7,
    "isOwner": true,
    "rating": 2,
    "comment": "<img src=x onerror=alert(1)>",
    "variant": {"id":72,"orderItemId":12,"size":"L","color":"Trắng"},
    "images": [{"id":11,"url":"/review-images/00000000000000000000000000000002.webp"},{"id":101,"url":"/review-images/00000000000000000000000000000004.webp"}],
    "createdAt": "2026-11-16T01:00:00.000Z",
    "updatedAt": "2026-11-16T02:00:00.000Z",
  } },
  'update-same': { "status": 200, "body": {
    "id": 91,
    "productId": 7,
    "isOwner": true,
    "rating": 4,
    "comment": "Ban đầu",
    "variant": {"id":71,"orderItemId":11,"size":"M","color":"Đen"},
    "images": [{"id":10,"url":"/review-images/00000000000000000000000000000001.webp"},{"id":11,"url":"/review-images/00000000000000000000000000000002.webp"}],
    "createdAt": "2026-11-16T01:00:00.000Z",
    "updatedAt": "2026-11-16T02:00:00.000Z",
  } },
  'delete': {"status":200,"body":{"status":"success"}},
  'me': { "status": 200, "body": {
    "review": {"id":91,"productId":7,"isOwner":true,"rating":4,"comment":"Ban đầu","variant":{"id":71,"orderItemId":11,"size":"M","color":"Đen"},"images":[{"id":10,"url":"/review-images/00000000000000000000000000000001.webp"},{"id":11,"url":"/review-images/00000000000000000000000000000002.webp"}],"createdAt":"2026-11-16T01:00:00.000Z","updatedAt":"2026-11-16T01:00:00.000Z"},
    "purchasedVariants": [{"order_item_id":11,"variant_id":71,"size_snapshot":"M","color_snapshot":"Đen"},{"order_item_id":12,"variant_id":72,"size_snapshot":"L","color_snapshot":"Trắng"}],
  } },
  'create-401': {"status":401,"body":{"status":"error","message":"Thiếu token. Gửi header: Authorization: Bearer <idToken>"}},
  'create-403-chua-mua': {"status":403,"body":{"status":"error","code":"REVIEW_NOT_ELIGIBLE","message":"Bạn không thể đánh giá nếu chưa từng mua"}},
  'create-409-da-danh-gia': {"status":409,"body":{"status":"error","code":"REVIEW_ALREADY_EXISTS","message":"Bạn đã đánh giá sản phẩm này"}},
  'create-400-sai-phan-loai': { "status": 400, "body": {
    "status": "error",
    "code": "REVIEW_INVALID_VARIANT",
    "message": "Phân loại không thuộc sản phẩm đã mua",
  } },
  'create-404-san-pham': {"status":404,"body":{"status":"error","code":"REVIEW_PRODUCT_NOT_FOUND","message":"Không tìm thấy sản phẩm"}},
  'update-401': {"status":401,"body":{"status":"error","message":"Thiếu token. Gửi header: Authorization: Bearer <idToken>"}},
  'update-404-cua-nguoi-khac': {"status":404,"body":{"status":"error","code":"REVIEW_NOT_FOUND","message":"Không tìm thấy đánh giá của bạn"}},
  'update-400-sai-phan-loai': { "status": 400, "body": {
    "status": "error",
    "code": "REVIEW_INVALID_VARIANT",
    "message": "Phân loại không thuộc sản phẩm đã mua",
  } },
  'delete-401': {"status":401,"body":{"status":"error","message":"Thiếu token. Gửi header: Authorization: Bearer <idToken>"}},
  'delete-404-cua-nguoi-khac': {"status":404,"body":{"status":"error","code":"REVIEW_NOT_FOUND","message":"Không tìm thấy đánh giá của bạn"}},
  'create-500': {"status":500,"body":{"status":"error","code":"REVIEW_SERVER_ERROR","message":"Không gửi được đánh giá. Vui lòng thử lại"}},
  'update-500': {"status":500,"body":{"status":"error","code":"REVIEW_SERVER_ERROR","message":"Không gửi được đánh giá. Vui lòng thử lại"}},
  'delete-500': {"status":500,"body":{"status":"error","code":"REVIEW_SERVER_ERROR","message":"Không gửi được đánh giá. Vui lòng thử lại"}},
};
async function sameAsOld(name, run) {
  const r = await run();
  assert.deepEqual(r, OLD[name], 'JSON + mã HTTP y như bản cũ (7d547cb): ' + name);
  return r;
}
const files = () => fs.readdirSync(directory).sort();
const fileOf = url => url.slice(media.PUBLIC_PREFIX.length);
const quiet = t => t.mock.method(console, 'error', () => {});
const oneRow = (action, actor = BUYER) => {
  assert.equal(db.audit.length, 1, 'đúng 1 dòng log');
  const r = db.audit[0];
  assert.deepEqual([r.action, r.entity_type, r.actor_role, r.actor_user_id, r.actor_email],
    [action, 'review', actor.role, actor.id, actor.role === 'customer' ? null : actor.email]);
  return { ...r, before: JSON.parse(r.before_json), after: JSON.parse(r.after_json) };
};
const leaks = r => [BUYER.email, BUYER.display_name, BUYER.phone, BUYER.firebase_uid, 'user_id', 'firebase', 'order_item', directory]
  .filter(v => ((r.before_json || '') + (r.after_json || '')).includes(v));
const CREATE = { body: { rating: 5, variant_id: 81, comment: XSS }, files: 1 };
const UPDATE = { body: { rating: 2, variant_id: 72, comment: XSS, remove_image_ids: [10] }, files: 1 };

test('REVIEW_CREATE: khách đã mua viết (1 ảnh, nội dung XSS) -> JSON y như bản cũ, 1 dòng (customer, email NULL), after 3 khoá', async () => {
  const r = await sameAsOld('create', () => call('POST', '/api/products/8/reviews', CREATE));
  assert.equal(r.status, 201);
  const log = oneRow('REVIEW_CREATE');
  assert.equal(log.entity_id, String(r.body.id)); assert.equal(log.before, null);
  assert.deepEqual(log.after, { review: { product_id: 8, rating: 5, images_count: 1 } });
  assert.deepEqual(leaks(log), []);
  assert.equal(db.reviews.find(x => x.id === r.body.id).comment, XSS, 'DB lưu nguyên văn như cũ');
  assert.ok(files().includes(fileOf(r.body.images[0].url)), 'ảnh mới còn trên đĩa');
});

test('REVIEW_CREATE không ảnh -> JSON y như bản cũ, images_count 0', async () => {
  const r = await sameAsOld('create-no-image', () => call('POST', '/api/products/8/reviews', { body: { rating: 3, variant_id: 81 } }));
  assert.equal(r.status, 201);
  assert.deepEqual(oneRow('REVIEW_CREATE').after, { review: { product_id: 8, rating: 3, images_count: 0 } });
});

test('REVIEW_CREATE: staff đã có đơn hoàn tất viết đánh giá -> 1 dòng actor_role staff (role thật, email như mọi tác nhân quản trị)', async () => {
  const r = await sameAsOld('create-staff', () => call('POST', '/api/products/8/reviews', { token: 'staff', body: { rating: 4, variant_id: 81 } }));
  assert.equal(r.status, 201);
  const log = oneRow('REVIEW_CREATE', STAFF);
  assert.deepEqual([log.entity_id, log.after], [String(r.body.id), { review: { product_id: 8, rating: 4, images_count: 0 } }]);
});

test('REVIEW_UPDATE: đổi sao + nội dung XSS + phân loại + bỏ 1 ảnh thêm 1 ảnh -> JSON y như cũ, 1 dòng, khoá con review 2 phía', async () => {
  const removed = fileOf(db.images.find(i => i.id === 10).image_path);
  const r = await sameAsOld('update', () => call('PATCH', '/api/products/7/reviews/91', UPDATE));
  assert.equal(r.status, 200);
  const log = oneRow('REVIEW_UPDATE');
  assert.equal(log.entity_id, '91');
  assert.deepEqual([log.before, log.after], [
    { review: { product_id: 7, rating: 4, content: 'Ban đầu', images_count: 2, variant: { id: 71, size: 'M', color: 'Đen' } } },
    { review: { product_id: 7, rating: 2, content: XSS, images_count: 2, variant: { id: 72, size: 'L', color: 'Trắng' } } }]);
  assert.ok(log.after_json.includes(XSS), 'content lưu nguyên văn');
  assert.deepEqual(leaks(log), []);
  assert.ok(!files().includes(removed), 'ảnh bị bỏ xoá sau commit như cũ');
});

test('REVIEW_UPDATE lưu không đổi gì -> JSON y như cũ, vẫn 1 dòng {} / {} (như PRODUCT_UPDATE)', async () => {
  const r = await sameAsOld('update-same', () => call('PATCH', '/api/products/7/reviews/91', { body: { rating: 4, variant_id: 71, comment: 'Ban đầu' } }));
  assert.equal(r.status, 200);
  const log = oneRow('REVIEW_UPDATE');
  assert.deepEqual([log.entity_id, log.before, log.after], ['91', {}, {}]);
});

test('REVIEW_DELETE (đánh giá đang bị ẩn, nội dung XSS) -> JSON y như cũ, 1 dòng snapshot + media, after null, file xoá sau commit', async () => {
  Object.assign(db.reviews[0], { is_hidden: true, comment: XSS });
  const media91 = db.images.filter(i => i.review_id === 91).map(i => i.image_path), keep = fileOf(db.images.find(i => i.id === 20).image_path);
  const r = await sameAsOld('delete', () => call('DELETE', '/api/products/7/reviews/91'));
  assert.equal(r.status, 200);
  const log = oneRow('REVIEW_DELETE');
  assert.deepEqual([log.entity_id, log.after], ['91', null]);
  assert.deepEqual(log.before, { review: { product_id: 7, rating: 4, content: XSS, variant: { id: 71, size: 'M', color: 'Đen' },
    is_hidden: true, created_at: T0 }, media: media91 });
  assert.deepEqual(leaks(log), []);
  assert.deepEqual([db.reviews.map(x => x.id), files()], [[92], [keep]]);
});

test('GET /me: JSON y như bản cũ (không lộ is_hidden dù câu khoá của sửa/xoá đã chọn thêm cột), không ghi log', async () => {
  db.reviews[0].is_hidden = true;
  const r = await sameAsOld('me', () => call('GET', '/api/products/7/reviews/me'));
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body).includes('is_hidden') && !JSON.stringify(r.body).includes('isHidden'));
  assert.equal(db.audit.length, 0);
});

const ERRORS = {
  'create-401': () => call('POST', '/api/products/8/reviews', { token: null, body: { rating: 5, variant_id: 81 } }),
  'create-403-chua-mua': () => call('POST', '/api/products/8/reviews', { token: 'nobuy', body: { rating: 5, variant_id: 81 } }),
  'create-409-da-danh-gia': () => call('POST', '/api/products/7/reviews', { body: { rating: 5, variant_id: 71 } }),
  'create-400-sai-phan-loai': () => call('POST', '/api/products/8/reviews', { body: { rating: 5, variant_id: 72 } }),
  'create-404-san-pham': () => call('POST', '/api/products/999/reviews', { body: { rating: 5, variant_id: 81 } }),
  'update-401': () => call('PATCH', '/api/products/7/reviews/91', { token: null, body: { rating: 1, variant_id: 71 } }),
  'update-404-cua-nguoi-khac': () => call('PATCH', '/api/products/7/reviews/92', { body: { rating: 1, variant_id: 71 } }),
  'update-400-sai-phan-loai': () => call('PATCH', '/api/products/7/reviews/91', { body: { rating: 1, variant_id: 81 } }),
  'delete-401': () => call('DELETE', '/api/products/7/reviews/91', { token: null }),
  'delete-404-cua-nguoi-khac': () => call('DELETE', '/api/products/7/reviews/92'),
};
for (const [name, run] of Object.entries(ERRORS)) {
  test(`lỗi ${name} -> JSON y như bản cũ, 0 dòng log, đánh giá + ảnh + file không đổi`, async () => {
    const was = structuredClone({ reviews: db.reviews, images: db.images }), onDisk = files();
    const r = await sameAsOld(name, run);
    assert.ok(r.status >= 400 && r.status < 500, String(r.status));
    assert.equal(db.audit.length, 0);
    assert.deepEqual({ reviews: db.reviews, images: db.images }, was);
    assert.deepEqual(files(), onDisk);
  });
}

// Lỗi 500 cũ lấy bằng lỗi SQL có sẵn trong luồng (không phải audit); audit() lỗi phải trả ĐÚNG JSON đó.
test('REVIEW_CREATE audit() lỗi -> 500 y như lỗi máy chủ cũ, không có đánh giá mới, ảnh vừa tải bị xoá, 0 dòng', async t => {
  quiet(t);
  const was = structuredClone({ reviews: db.reviews, images: db.images }), onDisk = files();
  await sameAsOld('create-500', async () => { failSql = 'INSERT INTO dbo.review_images('; try { return await call('POST', '/api/products/8/reviews', CREATE); } finally { failSql = null; } });
  failAudit = true;
  const r = await call('POST', '/api/products/8/reviews', CREATE);
  assert.deepEqual(r, OLD['create-500']);
  assert.deepEqual([{ reviews: db.reviews, images: db.images }, files(), db.audit.length], [was, onDisk, 0]);
  assert.ok(db.rollbacks >= 2);
});

test('REVIEW_UPDATE audit() lỗi -> 500 như cũ, nội dung + ảnh cũ giữ nguyên (cả file ảnh định bỏ), ảnh mới bị xoá, 0 dòng', async t => {
  quiet(t);
  const was = structuredClone({ reviews: db.reviews, images: db.images }), onDisk = files();
  await sameAsOld('update-500', async () => { failSql = 'INSERT INTO dbo.review_images('; try { return await call('PATCH', '/api/products/7/reviews/91', UPDATE); } finally { failSql = null; } });
  failAudit = true;
  const r = await call('PATCH', '/api/products/7/reviews/91', UPDATE);
  assert.deepEqual(r, OLD['update-500']);
  assert.deepEqual([{ reviews: db.reviews, images: db.images }, files(), db.audit.length], [was, onDisk, 0]);
});

test('REVIEW_DELETE audit() lỗi -> 500 như cũ, đánh giá + ảnh + file còn nguyên, 0 dòng', async t => {
  quiet(t);
  const was = structuredClone({ reviews: db.reviews, images: db.images }), onDisk = files();
  await sameAsOld('delete-500', async () => { failSql = 'DELETE FROM dbo.reviews'; try { return await call('DELETE', '/api/products/7/reviews/91'); } finally { failSql = null; } });
  failAudit = true;
  const r = await call('DELETE', '/api/products/7/reviews/91');
  assert.deepEqual(r, OLD['delete-500']);
  assert.deepEqual([{ reviews: db.reviews, images: db.images }, files(), db.audit.length], [was, onDisk, 0]);
});

test('quản trị ẩn đánh giá vẫn ghi REVIEW_VISIBILITY (admin), không sinh dòng REVIEW_* của khách', async () => {
  const r = await call('PATCH', '/api/admin/reviews/91/visibility', { token: 'admin', body: { isHidden: true } });
  assert.deepEqual(r, { status: 200, body: { id: 91, isHidden: true } });
  assert.deepEqual(db.audit.map(x => [x.action, x.actor_role, x.entity_id]), [['REVIEW_VISIBILITY', 'admin', '91']]);
});
