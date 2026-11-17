'use strict';

// phần thuần: reviewCreate / reviewUpdate / reviewDelete (lib/user-review-audit.js) qua buildAuditRow THẬT,
// tác nhân là khách. Route + SQL giả: review-audit-routes.test.js; SQL thật: scripts/verify-audit-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../db')] = { exports: { sql: require('mssql') } };
const { buildAuditRow } = require('../lib/audit');
const { reviewCreate, reviewUpdate, reviewDelete } = require('../lib/user-review-audit');

const XSS = '<img src=x onerror=alert(1)>';
const req = { user: { id: 3, email: 'khach@example.test', role: 'customer', display_name: 'Tên Khách', phone: '0911222333',
  firebase_uid: 'fb-khach' }, ip: '127.0.0.1', socket: {}, headers: {} };
const row = (action, x) => buildAuditRow(req, { action, entityType: 'review', entityId: 91, ...x });
const sides = r => [JSON.parse(r.before_json), JSON.parse(r.after_json)];
// Dòng review như changeOwnerReview đọc có khoá (cột `columns` + is_hidden) — có cả khoá KHÔNG được vào log.
const OLD_ROW = { id: 91, product_id: 7, variant_id: 71, order_item_id: 11, size_snapshot: 'M', color_snapshot: 'Đen', rating: 4,
  comment: 'Ban đầu', created_at: new Date('2026-11-16T01:00:00Z'), updated_at: new Date('2026-11-16T01:00:00Z'), is_hidden: false,
  user_id: 3, firebase_uid: 'fb-khach' };
const OLD_IMAGES = [{ id: 10, image_path: '/review-images/' + 'a'.repeat(32) + '.webp', sort_order: 0 },
  { id: 11, image_path: '/review-images/' + 'b'.repeat(32) + '.webp', sort_order: 1 }];
const dto = (over = {}) => ({ id: 91, productId: 7, isOwner: true, rating: 4, comment: 'Ban đầu',
  variant: { id: 71, orderItemId: 11, size: 'M', color: 'Đen' }, images: OLD_IMAGES.map(i => ({ id: i.id, url: i.image_path })),
  createdAt: OLD_ROW.created_at, updatedAt: new Date(), ...over });

test('reviewCreate: before null, after đúng 3 khoá product_id + rating + images_count (không nội dung, phân loại, người viết)', () => {
  const result = { id: 101, productId: 8, rating: 5, comment: XSS, variant: { id: 81, orderItemId: 13, size: 'S', color: 'Xanh' },
    images: [{ url: '/review-images/' + 'c'.repeat(32) + '.webp' }], createdAt: new Date(), updatedAt: new Date() };
  const r = row('REVIEW_CREATE', reviewCreate(result));
  assert.deepEqual(sides(r), [null, { review: { product_id: 8, rating: 5, images_count: 1 } }]);
  assert.equal(row('REVIEW_CREATE', reviewCreate({ ...result, images: [] })).after_json, '{"review":{"product_id":8,"rating":5,"images_count":0}}');
});

test('reviewUpdate: đổi sao / nội dung (XSS nguyên văn) / phân loại / số ảnh -> cả khoá con review ở 2 phía, product_id còn cả 2', () => {
  const r = row('REVIEW_UPDATE', reviewUpdate({ before: { review: OLD_ROW, images: OLD_IMAGES } },
    dto({ rating: 2, comment: XSS, variant: { id: 72, orderItemId: 12, size: 'L', color: 'Trắng' }, images: [{ id: 11, url: 'x' }] })));
  assert.deepEqual(sides(r), [
    { review: { product_id: 7, rating: 4, content: 'Ban đầu', images_count: 2, variant: { id: 71, size: 'M', color: 'Đen' } } },
    { review: { product_id: 7, rating: 2, content: XSS, images_count: 1, variant: { id: 72, size: 'L', color: 'Trắng' } } }]);
  assert.ok(r.after_json.includes(XSS), 'nội dung lưu nguyên văn');
});

test('reviewUpdate: chỉ đổi số sao -> vẫn đủ khoá con review 2 phía (diff ở cấp ngoài cùng)', () => {
  const [b, a] = sides(row('REVIEW_UPDATE', reviewUpdate({ before: { review: OLD_ROW, images: OLD_IMAGES } }, dto({ rating: 5 }))));
  assert.deepEqual([b.review.rating, a.review.rating, b.review.product_id, a.review.product_id, a.review.content], [4, 5, 7, 7, 'Ban đầu']);
});

test('reviewUpdate: lưu không đổi gì -> {} / {} (vẫn là 1 dòng, như PRODUCT_UPDATE); comment null -> content null', () => {
  assert.deepEqual(sides(row('REVIEW_UPDATE', reviewUpdate({ before: { review: OLD_ROW, images: OLD_IMAGES } }, dto()))), [{}, {}]);
  const noText = reviewUpdate({ before: { review: { ...OLD_ROW, comment: null }, images: [] } }, dto({ comment: null, images: [] }));
  assert.deepEqual([noText.before.review.content, noText.after.review.content, noText.after.review.images_count], [null, null, 0]);
});

test('reviewDelete: snapshot đúng khoá cho phép + media là đường dẫn ảnh; is_hidden / created_at; after null', () => {
  const r = row('REVIEW_DELETE', { before: reviewDelete({ before: { review: { ...OLD_ROW, comment: XSS, is_hidden: true }, images: OLD_IMAGES } }), after: null });
  assert.equal(r.after_json, null);
  assert.deepEqual(JSON.parse(r.before_json), {
    review: { product_id: 7, rating: 4, content: XSS, variant: { id: 71, size: 'M', color: 'Đen' }, is_hidden: true, created_at: '2026-11-16T01:00:00.000Z' },
    media: OLD_IMAGES.map(i => i.image_path) });
  const none = reviewDelete({ before: { review: { ...OLD_ROW, is_hidden: undefined }, images: [] } });
  assert.deepEqual([none.review.is_hidden, none.media], [null, []], 'thiếu cột is_hidden -> null, không đoán false');
});

test('3 hàm: không lộ dữ liệu cá nhân người viết dù dòng nguồn có user_id / firebase_uid / order_item_id', () => {
  const all = [
    row('REVIEW_CREATE', reviewCreate({ id: 1, productId: 7, rating: 3, images: [], userId: 3, email: req.user.email })),
    row('REVIEW_UPDATE', reviewUpdate({ before: { review: OLD_ROW, images: OLD_IMAGES } }, dto({ rating: 1 }))),
    row('REVIEW_DELETE', { before: reviewDelete({ before: { review: OLD_ROW, images: OLD_IMAGES } }), after: null }),
  ];
  for (const r of all) {
    assert.deepEqual([r.actor_role, r.actor_email, r.actor_user_id], ['customer', null, 3]);
    const text = (r.before_json || '') + (r.after_json || '');
    for (const v of ['khach@example.test', 'Tên Khách', '0911222333', 'fb-khach', 'user_id', 'firebase', 'order_item', 'orderItemId', 'updated'])
      assert.ok(!text.includes(v), r.action + ' không được chứa ' + v);
  }
});
