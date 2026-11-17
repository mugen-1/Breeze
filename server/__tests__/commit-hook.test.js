'use strict';

// Hook onCommitting (lib/commit-hook.js) ở 6 hàm tự mở transaction: cancelOrder, changeSizes, changeColors,
// createReview, changeOwnerReview, setReviewVisibility. Dùng SQL giả có transaction: begin chụp bản sao dữ liệu,
// commit ghi đè, rollback bỏ bản sao — nên "rollback thì dữ liệu không đổi" kiểm được bằng deepEqual.
// Test cũ của từng hàm (không sửa) là bằng chứng chính cho đường KHÔNG có hook; transaction thật:
// scripts/verify-audit-sql.js.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const realSql = require('mssql');

let db, events, lastTx;
const clone = x => structuredClone(x);
const rs = (recordset = [], affected = recordset.length) => ({ recordset, recordsets: [recordset], rowsAffected: [affected] });
class Transaction {
  constructor(pool) { this.pool = pool; lastTx = this; }
  async begin() { this.data = clone(db); events.push('begin'); }
  async commit() { db = this.data; events.push('commit'); }
  async rollback() { this.data = null; events.push('rollback'); }
}
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim();
    events.push(this.tx ? 'sql:tx' : 'sql:pool');
    return handle(q, this.p, this.tx ? this.tx.data : db);
  }
}
const pool = { request: () => new Request(null) };
require.cache[require.resolve('../db')] = { exports: { sql: { ...realSql, Transaction, Request }, getPool: async () => pool } };
const { cancelOrder } = require('../lib/cancel-order');
const { changeSizes } = require('../lib/size-variants');
const { changeColors } = require('../lib/color-variants');
const { createReview } = require('../lib/review-create');
const { changeOwnerReview } = require('../lib/review-owner');
const { setReviewVisibility } = require('../lib/review-admin');
const { commitHook } = require('../lib/commit-hook');

function freshDb() {
  return {
    order: { id: 7, user_id: 1, status: 'pending' },
    items: [{ product_id: 5, variant_id: 50, quantity: 2 }],
    payments: [{ order_id: 7, status: 'pending' }],
    products: [
      { id: 5, slug: 'ao-nam', name_vi: 'Áo', name_en: 'Shirt', stock: 7, is_active: true, category_slug: 'sanpham-ao' },
      { id: 6, slug: 'tui-den', name_vi: 'Túi', name_en: 'Bag', stock: 5, is_active: true, category_slug: 'tui-xach' },
    ],
    variants: [
      { id: 50, product_id: 5, sku: 'BR-P5-BASE', size: null, color: null, stock: 3, is_active: true, is_base: true },
      { id: 51, product_id: 5, sku: 'BR-P5-M', size: 'M', color: null, stock: 4, is_active: true, is_base: false },
      { id: 60, product_id: 6, sku: 'BR-P6-BASE', size: null, color: null, stock: 3, is_active: true, is_base: true },
      { id: 61, product_id: 6, sku: 'BR-P6-DEN', size: null, color: 'den', stock: 2, is_active: true, is_base: false },
    ],
    colors: [{ id: 3, product_id: 6, color_key: 'den', label: 'Đen', swatch_hex: '#000000', is_active: true }],
    movements: [],
    users: [{ id: 1 }],
    purchased: [{ order_item_id: 70, variant_id: 50, size_snapshot: 'M lúc mua', color_snapshot: null }],
    reviews: [{ id: 9, user_id: 1, product_id: 5, variant_id: 50, order_item_id: 70, size_snapshot: 'M lúc mua',
      color_snapshot: null, rating: 4, comment: 'Cũ', is_hidden: false, created_at: 'c', updated_at: 'u' }],
    reviewImages: [{ id: 91, review_id: 9, image_path: '/review-images/' + 'a'.repeat(32) + '.webp', sort_order: 0 }],
  };
}
const product = (d, id) => d.products.find(p => p.id === id);
const variant = (d, id) => d.variants.find(v => v.id === id);
function handle(q, p, d) {
  if (!d) throw new Error('SQL sau rollback');
  // --- cancelOrder ---
  if (q.startsWith('SELECT id, user_id, status FROM dbo.orders')) {
    return rs(d.order && d.order.id === p.id && (p.uid === undefined || d.order.user_id === p.uid) ? [clone(d.order)] : []);
  }
  if (q.startsWith('SELECT product_id, variant_id, quantity FROM dbo.order_items')) return rs(clone(d.items));
  if (q.startsWith('UPDATE dbo.products SET stock = stock + @qty')) { product(d, p.pid).stock += p.qty; return rs([], 1); }
  if (q.startsWith('UPDATE dbo.product_variants SET stock = stock + @qty')) {
    const v = variant(d, p.vid), before = v.stock; v.stock += p.qty;
    return rs([{ stock_before: before, stock_after: v.stock }], 1);
  }
  if (q.startsWith('INSERT INTO dbo.inventory_movements')) { d.movements.push({ type: p.type, vid: p.vid, delta: p.delta }); return rs([], 1); }
  if (q.startsWith("UPDATE dbo.orders SET status = 'cancelled'")) {
    if (d.order.status !== p.current) return rs([]);
    Object.assign(d.order, { status: 'cancelled', cancel_reason: p.reason, cancelled_at: 'db-time' });
    return rs([{ id: d.order.id, status: 'cancelled', total_amount: 100, created_at: 'c', cancel_reason: p.reason, cancelled_at: 'db-time' }]);
  }
  if (q.startsWith('UPDATE dbo.payment_transactions')) {
    for (const pay of d.payments) if (pay.order_id === p.oid && pay.status === 'pending') pay.status = 'cancelled';
    return rs([], 1);
  }
  // --- changeSizes / changeColors ---
  if (q.startsWith('SELECT p.id, p.slug, p.stock, p.is_active, c.slug AS category_slug FROM dbo.products p WITH')) {
    const x = product(d, p.pid); return rs(x ? [{ id: x.id, slug: x.slug, stock: x.stock, is_active: x.is_active, category_slug: x.category_slug }] : []);
  }
  if (q.startsWith('SELECT id, size, color, stock, is_active, is_base FROM dbo.product_variants WITH')) {
    return rs(d.variants.filter(v => v.product_id === p.pid).map(({ id, size, color, stock, is_active, is_base }) =>
      ({ id, size, color, stock, is_active, is_base })));
  }
  if (q.startsWith('SELECT id, color_key, label, swatch_hex, is_active FROM dbo.product_colors')) {
    return rs(d.colors.filter(c => c.product_id === p.pid).map(({ product_id, ...c }) => c));
  }
  if (q.startsWith('UPDATE dbo.product_variants SET stock = @stock')) { variant(d, p.vid).stock = p.stock; return rs([], 1); }
  if (q.startsWith('UPDATE dbo.product_variants SET stock = @next')) {
    const v = variant(d, p.vid); if (v.stock !== p.expected) return rs([], 0);
    v.stock = p.next; return rs([], 1);
  }
  if (/^UPDATE dbo\.products SET stock ?= ?stock ?\+ ?@delta/.test(q)) { product(d, p.pid).stock += p.delta; return rs([], 1); }
  if (/^UPDATE dbo\.product_variants SET is_active ?= ?@active/.test(q)) { variant(d, p.vid).is_active = p.active; return rs([], 1); }
  if (q.startsWith('SELECT p.id, p.slug, p.name_vi, p.name_en, p.stock')) { // readSizes
    const x = product(d, p.pid); return rs([{ ...clone(x), size_configured: 1, color_configured: 0 }]);
  }
  if (q.startsWith('SELECT v.id, v.sku, v.size, v.stock')) { // readSizes
    return rs(d.variants.filter(v => v.product_id === p.pid && v.color == null)
      .map(({ id, sku, size, stock, is_active, is_base }) => ({ id, sku, size, stock, is_active, is_base, last_allocation_quantity: 0 })));
  }
  if (q.startsWith('SELECT p.id, p.name_vi, p.slug, p.stock')) { // readColors
    const x = product(d, p.pid); return rs([{ ...clone(x), size_configured: 0, color_configured: 1 }]);
  }
  if (q.startsWith('SELECT v.id, v.sku, v.size, v.color, v.stock')) { // readColors
    return rs(d.variants.filter(v => v.product_id === p.pid).map(v => ({ ...clone(v), last_allocation_quantity: 0 })));
  }
  if (q.startsWith('SELECT i.id, i.color_id, i.image_path')) return rs([]);
  // --- createReview / changeOwnerReview / setReviewVisibility ---
  if (/^SELECT id FROM dbo\.users WITH \(UPDLOCK, ?HOLDLOCK\)/.test(q)) return rs(d.users.filter(u => u.id === p.uid));
  if (q.startsWith('SELECT id FROM dbo.products WITH (HOLDLOCK)')) return rs(d.products.filter(x => x.id === p.pid && x.is_active).map(x => ({ id: x.id })));
  if (q.startsWith('SELECT id FROM dbo.reviews WHERE user_id')) return rs(d.reviews.filter(r => r.user_id === p.uid && r.product_id === p.pid).map(r => ({ id: r.id })));
  if (q.startsWith('WITH purchased AS')) return rs(clone(d.purchased));
  if (q.startsWith('INSERT INTO dbo.reviews')) {
    const row = { id: 900, user_id: p.uid, product_id: p.pid, variant_id: p.vid, order_item_id: p.item, size_snapshot: p.size,
      color_snapshot: p.color, rating: p.rating, comment: p.comment, is_hidden: false, created_at: 'now', updated_at: 'now' };
    d.reviews.push(row); return rs([{ id: row.id, rating: row.rating, comment: row.comment, created_at: row.created_at, updated_at: row.updated_at }]);
  }
  if (q.startsWith('SELECT id,product_id,variant_id,order_item_id')) {
    const { user_id, is_hidden, ...r } = d.reviews.find(x => x.id === p.rid && x.user_id === p.uid && x.product_id === p.pid) || {};
    return rs(r.id ? [r] : []);
  }
  if (q.startsWith('SELECT id,image_path,sort_order FROM dbo.review_images')) {
    return rs(d.reviewImages.filter(i => i.review_id === p.rid).map(({ review_id, ...i }) => i));
  }
  if (q.startsWith('DELETE FROM dbo.reviews WHERE id=@rid')) {
    d.reviews = d.reviews.filter(r => r.id !== p.rid); d.reviewImages = d.reviewImages.filter(i => i.review_id !== p.rid); return rs([], 1);
  }
  if (q.startsWith('DELETE FROM dbo.review_images WHERE id=@image')) {
    d.reviewImages = d.reviewImages.filter(i => !(i.id === p.image && i.review_id === p.rid)); return rs([], 1);
  }
  if (q.startsWith('UPDATE dbo.review_images SET sort_order=@sort')) {
    d.reviewImages.find(i => i.id === p.image).sort_order = p.sort; return rs([], 1);
  }
  if (q.startsWith('INSERT INTO dbo.review_images(review_id,image_path,sort_order) OUTPUT')) {
    const row = { id: 950 + d.reviewImages.length, review_id: p.rid, image_path: p.url, sort_order: p.sort };
    d.reviewImages.push(row); return rs([{ id: row.id }]);
  }
  if (q.startsWith('UPDATE dbo.reviews SET rating=@rating')) {
    const r = d.reviews.find(x => x.id === p.rid);
    Object.assign(r, { rating: p.rating, comment: p.comment, variant_id: p.vid, order_item_id: p.item, size_snapshot: p.size,
      color_snapshot: p.color, updated_at: 'edited' });
    const { user_id, is_hidden, ...out } = r; return rs([clone(out)]);
  }
  if (q.startsWith('UPDATE dbo.reviews SET is_hidden=@hidden')) {
    assert.match(q, /OUTPUT INSERTED\.id,INSERTED\.is_hidden,DELETED\.is_hidden AS was_hidden/);
    const r = d.reviews.find(x => x.id === p.rid); if (!r) return rs([]);
    const was = r.is_hidden; r.is_hidden = p.hidden; r.updated_at = 'vis';
    return rs([{ id: r.id, is_hidden: r.is_hidden, was_hidden: was }]);
  }
  throw new Error('Unexpected SQL: ' + q);
}
const storage = { saved: [], removed: [], async save() { const u = '/review-images/' + 'b'.repeat(32) + '.webp'; this.saved.push(u); return u; },
  async remove(paths) { this.removed.push(...paths); } };
beforeEach(() => { db = freshDb(); events = []; lastTx = null; storage.saved = []; storage.removed = []; });

// Hook ghi lại đối số + thứ tự; `fail` -> ném đúng lỗi đó.
function spy(fail) {
  const calls = [];
  const fn = async (...args) => { calls.push(args); events.push('hook'); if (fail) throw fail; };
  fn.calls = calls; return fn;
}
const beforeCommit = () => assert.deepEqual(events.slice(-2), ['hook', 'commit'], 'hook chạy ngay trước commit');

// Kịch bản của từng hàm: run(opts) gọi hàm; early(opts) đi đường thoát sớm; before = ctx.before mong đợi.
const CASES = {
  cancelOrder: {
    run: o => cancelOrder(pool, { orderId: 7, ownerId: 1, reason: 'Đặt nhầm', actorUserId: 1, ...o }),
    early: o => cancelOrder(pool, { orderId: 8, ownerId: 1, ...o }), earlyCode: 'ORDER_NOT_FOUND',
    ctx: { before: { status: 'pending', user_id: 1 }, order_code: undefined, restored: [{ product_id: 5, variant_id: 50, quantity: 2 }] },
  },
  changeSizes: {
    run: o => changeSizes(pool, 5, 1, 'adjust', { variant_id: 51, stock: 6, expected_stock: 4, reason: 'Nhập thêm' }, o),
    early: o => changeSizes(pool, 5, 1, 'adjust', { variant_id: 999, stock: 1, expected_stock: 0 }, o), earlyCode: 'VARIANT_NOT_FOUND',
    before: { product: { id: 5, slug: 'ao-nam', stock: 7, is_active: true, category_slug: 'sanpham-ao' },
      variants: [{ id: 50, size: null, color: null, stock: 3, is_active: true, is_base: true },
        { id: 51, size: 'M', color: null, stock: 4, is_active: true, is_base: false }] },
  },
  changeColors: {
    run: o => changeColors(pool, 6, 1, 'adjust', { variant_id: 61, stock: 5, expected_stock: 2, reason: 'Nhập thêm' }, o),
    early: o => changeColors(pool, 6, 1, 'update', { color_id: 999, label: 'Xanh' }, o), earlyCode: 'COLOR_NOT_FOUND',
    before: { product: { id: 6, slug: 'tui-den', stock: 5, is_active: true, category_slug: 'tui-xach' },
      colors: [{ id: 3, color_key: 'den', label: 'Đen', swatch_hex: '#000000', is_active: true }],
      variants: [{ id: 60, size: null, color: null, stock: 3, is_active: true, is_base: true },
        { id: 61, size: null, color: 'den', stock: 2, is_active: true, is_base: false }] },
  },
  createReview: {
    setup: () => { db.reviews = []; db.reviewImages = []; },
    run: o => createReview(pool, { userId: 1, productId: 5, data: { rating: 5, variantId: 50, comment: 'Tốt' }, images: [], storage, ...o }),
    early: o => createReview(pool, { userId: 1, productId: 5, data: { rating: 5, variantId: 999, comment: null }, images: [], storage, ...o }),
    earlyCode: 'REVIEW_INVALID_VARIANT', before: undefined, ctx: {},
  },
  'changeOwnerReview (sửa)': {
    run: o => changeOwnerReview(pool, { userId: 1, productId: 5, reviewId: 9, data: { rating: 2, variantId: 50, comment: 'Mới', removeIds: [] },
      images: [], storage, ...o }),
    early: o => changeOwnerReview(pool, { userId: 1, productId: 5, reviewId: 99, data: { rating: 2, variantId: 50, comment: null, removeIds: [] },
      storage, ...o }), earlyCode: 'REVIEW_NOT_FOUND',
    before: { review: { id: 9, product_id: 5, variant_id: 50, order_item_id: 70, size_snapshot: 'M lúc mua', color_snapshot: null,
      rating: 4, comment: 'Cũ', created_at: 'c', updated_at: 'u' },
    images: [{ id: 91, image_path: '/review-images/' + 'a'.repeat(32) + '.webp', sort_order: 0 }] },
  },
  'changeOwnerReview (xoá)': {
    run: o => changeOwnerReview(pool, { userId: 1, productId: 5, reviewId: 9, storage, removeReview: true, ...o }),
    early: o => changeOwnerReview(pool, { userId: 2, productId: 5, reviewId: 9, storage, removeReview: true, ...o }), earlyCode: 'REVIEW_AUTH_REQUIRED',
    before: null, // dùng chung với (sửa) — gán bên dưới
  },
  setReviewVisibility: {
    run: o => setReviewVisibility(pool, 9, true, o),
    early: o => setReviewVisibility(pool, 99, true, o), earlyCode: 'REVIEW_NOT_FOUND',
    ctx: { before: { isHidden: false }, product_id: undefined },
  },
};
CASES['changeOwnerReview (xoá)'].before = CASES['changeOwnerReview (sửa)'].before;
const optsOf = (name, hook) => (['changeSizes', 'changeColors', 'setReviewVisibility'].includes(name)
  ? (hook === undefined ? undefined : { onCommitting: hook }) : (hook === undefined ? {} : { onCommitting: hook }));

for (const [name, c] of Object.entries(CASES)) {
  test(`${name}: có hook -> gọi đúng 1 lần (tx, đúng giá trị trả về, ctx.before) và ngay trước commit`, async () => {
    if (c.setup) c.setup();
    const hook = spy();
    const result = await c.run(optsOf(name, hook));
    assert.equal(hook.calls.length, 1);
    const [tx, value, ctx] = hook.calls[0];
    assert.ok(tx instanceof Transaction && tx === lastTx, 'đối số 1 là tx đang mở của hàm');
    assert.equal(value, result, 'đối số 2 là CHÍNH giá trị hàm trả về');
    assert.deepEqual(ctx, c.ctx || { before: c.before });
    beforeCommit();
  });

  test(`${name}: kết quả có hook deepEqual kết quả không hook (cùng kịch bản)`, async () => {
    if (c.setup) c.setup();
    const plain = await c.run(optsOf(name, undefined)); const dbPlain = clone(db);
    db = freshDb(); if (c.setup) c.setup();
    const hooked = await c.run(optsOf(name, spy()));
    assert.deepEqual(hooked, plain);
    assert.deepEqual(db, dbPlain, 'dữ liệu sau commit như nhau');
  });

  test(`${name}: hook ném lỗi -> rollback, dữ liệu không đổi, ném lại đúng lỗi đó`, async () => {
    if (c.setup) c.setup();
    const original = clone(db), boom = Object.assign(new Error('audit failed'), { number: 2627 });
    await assert.rejects(c.run(optsOf(name, spy(boom))), e => e === boom);
    assert.deepEqual(db, original);
    assert.equal(events.at(-1), 'rollback');
    assert.ok(!events.includes('commit'));
  });

  test(`${name}: đường thoát sớm (${c.earlyCode}) -> hook KHÔNG được gọi`, async () => {
    if (c.setup) c.setup();
    const hook = spy(), original = clone(db);
    await assert.rejects(c.early(optsOf(name, hook)), e => e.code === c.earlyCode);
    assert.equal(hook.calls.length, 0);
    assert.deepEqual(db, original);
  });

  test(`${name}: onCommitting không phải hàm -> TypeError, không mở transaction`, async () => {
    for (const bad of [null, 'audit', { fn() {} }, 1]) {
      events = [];
      await assert.rejects(c.run(optsOf(name, bad)), TypeError);
      assert.ok(!events.includes('begin'), JSON.stringify(bad));
    }
  });
}

test('setReviewVisibility không hook: bọc transaction, kết quả + dữ liệu như cũ, commit', async () => {
  assert.deepEqual(await setReviewVisibility(pool, 9, true), { id: 9, isHidden: true });
  assert.equal(db.reviews[0].is_hidden, true);
  assert.deepEqual(events, ['begin', 'sql:tx', 'commit']);
  await assert.rejects(setReviewVisibility(pool, 99, false), e => e.code === 'REVIEW_NOT_FOUND' && e.status === 404 &&
    e.message === 'Không tìm thấy đánh giá');
  assert.equal(events.at(-1), 'rollback');
});

test('setReviewVisibility đã ở trạng thái đích -> vẫn UPDATE + commit như cũ, hook KHÔNG được gọi', async () => {
  db.reviews[0].is_hidden = true;
  const hook = spy();
  assert.deepEqual(await setReviewVisibility(pool, 9, true, { onCommitting: hook }), { id: 9, isHidden: true });
  assert.equal(hook.calls.length, 0);
  assert.equal(db.reviews[0].updated_at, 'vis', 'UPDATE vẫn chạy (updated_at đổi) như đường cũ');
  assert.equal(events.at(-1), 'commit');
});

for (const [name, run] of [
  ['changeSizes', o => changeSizes(pool, 5, 1, 'adjust', { variant_id: 51, stock: 4, expected_stock: 4 }, o)],
  ['changeColors', o => changeColors(pool, 6, 1, 'adjust', { variant_id: 61, stock: 2, expected_stock: 2 }, o)],
]) {
  test(`${name} adjust delta 0 (không is_active) -> commit như cũ, hook KHÔNG được gọi`, async () => {
    const original = clone(db), hook = spy();
    const result = await run({ onCommitting: hook });
    assert.equal(hook.calls.length, 0);
    assert.ok(result && result.product, 'vẫn trả kết quả đọc lại như cũ');
    assert.deepEqual(db, original);
    assert.ok(events.includes('commit') && events.at(-1) === 'sql:pool', 'commit rồi đọc lại qua pool như đường cũ');
  });
}

test('changeSizes/changeColors có hook: kết quả đọc QUA tx trước commit; không hook: đọc qua pool sau commit', async () => {
  await changeSizes(pool, 5, 1, 'adjust', { variant_id: 51, stock: 6, expected_stock: 4, reason: 'x' }, { onCommitting: spy() });
  assert.ok(!events.includes('sql:pool') && events.at(-1) === 'commit');
  db = freshDb(); events = [];
  await changeSizes(pool, 5, 1, 'adjust', { variant_id: 51, stock: 6, expected_stock: 4, reason: 'x' });
  assert.equal(events.at(-1), 'sql:pool');
  assert.ok(events.indexOf('commit') < events.lastIndexOf('sql:pool'));
});

test('changeColors: ctx.before chụp TRƯỚC khi writeStock sửa variant.stock tại chỗ', async () => {
  const hook = spy();
  await changeColors(pool, 6, 1, 'adjust', { variant_id: 61, stock: 5, expected_stock: 2, reason: 'x' }, { onCommitting: hook });
  assert.equal(hook.calls[0][2].before.variants.find(v => v.id === 61).stock, 2);
  assert.equal(hook.calls[0][1].variants.find(v => v.id === 61).stock, 5);
});

test('cancelOrder: hook thấy tồn kho đã cộng lại + payment đã huỷ trong tx (gọi sau restoreOrderStock)', async () => {
  let seen;
  await cancelOrder(pool, { orderId: 7, ownerId: 1, onCommitting: async tx => {
    seen = { stock: variant(tx.data, 50).stock, product: product(tx.data, 5).stock, pay: tx.data.payments[0].status, moves: tx.data.movements.length };
  } });
  assert.deepEqual(seen, { stock: 5, product: 9, pay: 'cancelled', moves: 1 });
});

test('changeOwnerReview: hook lỗi -> không xoá file ảnh cũ (chỉ dọn ảnh mới), review còn nguyên', async () => {
  const boom = new Error('x');
  await assert.rejects(changeOwnerReview(pool, { userId: 1, productId: 5, reviewId: 9, data: { rating: 1, variantId: 50, comment: null, removeIds: [91] },
    images: [Buffer.from('img')], storage, onCommitting: async () => { throw boom; } }), e => e === boom);
  assert.deepEqual(storage.removed, storage.saved, 'chỉ xoá ảnh vừa lưu, không xoá ảnh cũ');
  assert.equal(db.reviewImages.length, 1);
});

test('commitHook: undefined/thiếu -> null; hàm -> chính nó; khác -> TypeError', () => {
  assert.equal(commitHook(undefined), null); assert.equal(commitHook({}), null);
  const f = () => {}; assert.equal(commitHook({ onCommitting: f }), f);
  assert.throws(() => commitHook({ onCommitting: null }), TypeError);
});
