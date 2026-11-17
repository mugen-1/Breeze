'use strict';

// phần thuần: lib/user-review-audit.js qua buildAuditRow THẬT (email / product_id còn ở cả 2 phía nhờ
// khóa con user / review). Route + SQL giả: user-review-audit-routes.test.js; SQL thật: verify-audit-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../db')] = { exports: { sql: require('mssql') } };
const { buildAuditRow } = require('../lib/audit');
const { blacklistChange, reviewVisibility } = require('../lib/user-review-audit');

const req = { user: { id: 1, email: 'staff@example.test', role: 'staff' }, ip: '127.0.0.1', socket: {}, headers: {} };
const logged = (action, entityType, x) => {
  const r = buildAuditRow(req, { action, entityType, entityId: 9, ...x });
  return [JSON.parse(r.before_json), JSON.parse(r.after_json)];
};

test('blacklistChange: false -> true và true -> false, email ở cả 2 phía, chỉ 2 khóa email + is_blacklisted', () => {
  assert.deepEqual(logged('USER_BLACKLIST', 'user', blacklistChange({ email: 'k@example.test', wasBlacklisted: false, isBlacklisted: true })),
    [{ user: { email: 'k@example.test', is_blacklisted: false } }, { user: { email: 'k@example.test', is_blacklisted: true } }]);
  assert.deepEqual(logged('USER_UNBLACKLIST', 'user', blacklistChange({ email: 'k@example.test', wasBlacklisted: 1, isBlacklisted: 0 })),
    [{ user: { email: 'k@example.test', is_blacklisted: true } }, { user: { email: 'k@example.test', is_blacklisted: false } }]);
  const c = blacklistChange({ email: null, wasBlacklisted: false, isBlacklisted: true, role: 'customer', firebase_uid: 'x' });
  assert.deepEqual(Object.keys(c.before.user), ['email', 'is_blacklisted']);
  assert.equal(c.after.user.email, null);
});

test('blacklistChange: không đổi (gọi lặp lại) -> null để route KHÔNG ghi log', () => {
  assert.equal(blacklistChange({ email: 'k@x', wasBlacklisted: true, isBlacklisted: true }), null);
  assert.equal(blacklistChange({ email: 'k@x', wasBlacklisted: 0, isBlacklisted: false }), null);
});

test('reviewVisibility: product_id ở cả 2 phía, chỉ product_id + is_hidden (không nội dung đánh giá)', () => {
  assert.deepEqual(logged('REVIEW_VISIBILITY', 'review', reviewVisibility({ productId: 7, wasHidden: false, isHidden: true })),
    [{ review: { product_id: 7, is_hidden: false } }, { review: { product_id: 7, is_hidden: true } }]);
  const r = reviewVisibility({ productId: 7, wasHidden: true, isHidden: false, comment: 'nội dung' });
  assert.deepEqual(Object.keys(r.after.review), ['product_id', 'is_hidden']);
  assert.equal(reviewVisibility({ productId: undefined, wasHidden: 0, isHidden: 1 }).before.review.product_id, null);
});
