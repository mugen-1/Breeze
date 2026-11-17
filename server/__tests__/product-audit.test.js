'use strict';

// phần thuần: hằng DIFF_KEEP_KEY của lib/audit.js và các hàm dựng before/after của lib/product-audit.js.
// Route + SQL giả: product-audit-routes.test.js; SQL thật: scripts/verify-audit-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../db')] = { exports: { sql: require('mssql') } };
const { buildAuditRow, DIFF_KEEP_KEY } = require('../lib/audit');
const { productColumns, createSnapshot, variantChange, REQUEST_FIELDS } = require('../lib/product-audit');

const XSS = '<img src=x onerror=alert(1)>';
const req = { user: { id: 1, email: 'admin@example.test', role: 'admin' }, ip: '127.0.0.1', socket: {}, headers: {} };
const row = (before, after) => {
  const r = buildAuditRow(req, { action: 'PRODUCT_VARIANT_CHANGE', entityType: 'product', entityId: 5, before, after });
  return [JSON.parse(r.before_json), JSON.parse(r.after_json)];
};

test("DIFF_KEEP_KEY = 'action': giữ ở cả 2 phía dù bằng nhau; khóa khác bằng nhau vẫn bị lọc", () => {
  assert.equal(DIFF_KEEP_KEY, 'action');
  assert.deepEqual(row({ action: 'adjust', note: 'x', stock: 1 }, { action: 'adjust', note: 'x', stock: 2 }),
    [{ action: 'adjust', stock: 1 }, { action: 'adjust', stock: 2 }]);
  assert.deepEqual(row({ action: 'update' }, { action: 'update' }), [{ action: 'update' }, { action: 'update' }]);
  assert.deepEqual(row({ note: 'x' }, { note: 'x' }), [{}, {}], 'không có action -> như cũ');
});

test("DIFF_KEEP_KEY: 'action' lồng sâu KHÔNG được giữ; chỉ có ở 1 phía thì như cũ", () => {
  assert.deepEqual(row({ meta: { action: 'a' }, s: 1 }, { meta: { action: 'a' }, s: 2 }), [{ s: 1 }, { s: 2 }]);
  assert.deepEqual(row({ list: [{ action: 'a' }] }, { list: [{ action: 'a' }] }), [{}, {}]);
  assert.deepEqual(row({ s: 1 }, { action: 'x', s: 1 }), [{}, { action: 'x' }]);
});

test('productColumns: đúng 12 cột nghiệp vụ, images parse thành mảng, is_active boolean; bỏ id/thời gian/cờ', () => {
  const r = productColumns({ id: 5, slug: 's', name_vi: XSS, name_en: null, description_vi: 'd', description_en: null,
    price: 1, sale_price: null, currency: 'VND', images: '["img/a.png"]', category_id: 2, stock: 3, is_active: 1,
    created_at: 'c', updated_at: 'u', size_configured: 1 });
  assert.deepEqual(r, { slug: 's', name_vi: XSS, name_en: null, description_vi: 'd', description_en: null, price: 1,
    sale_price: null, currency: 'VND', images: ['img/a.png'], category_id: 2, stock: 3, is_active: true });
  assert.equal(productColumns({ images: 'not json' }).images, null);
});

test('createSnapshot: có id, cột vừa INSERT, images_count thay cho danh sách ảnh', () => {
  const r = createSnapshot({ id: 9, slug: 's', name_vi: 'A', price: 1, currency: 'VND', images: '["a","b"]', category_id: 1,
    stock: 0, is_active: true });
  assert.equal(r.id, 9); assert.equal(r.images_count, 2); assert.ok(!('images' in r));
  assert.equal(createSnapshot({ id: 1, images: null }).images_count, 0);
});

// ctx.before / result đúng hình dạng thật của changeSizes / changeColors.
const sizeCtx = { before: { product: { id: 6, stock: 10 }, variants: [
  { id: 60, size: null, color: null, stock: 4, is_active: true, is_base: true },
  { id: 61, size: 'S', color: null, stock: 6, is_active: true, is_base: false },
  { id: 69, size: 'S', color: 'den', stock: 1, is_active: true, is_base: false }] } };
const sizeResult = (over = {}) => ({ product: { id: 6, stock: 10, ...over.product }, kind: 'apparel', variants: [
  { id: 60, sku: 'B', size: null, stock: 4, is_active: true, is_base: true, last_allocation_quantity: 0 },
  { id: 61, sku: 'S', size: 'S', stock: 6, is_active: true, is_base: false, last_allocation_quantity: 0 },
  ...(over.variants || [])].map(v => ({ ...v, ...((over.patch || {})[v.id] || {}) })) });

test('variantChange size: configure -> chỉ biến thể mới; allocate -> nguồn + đích; adjust -> biến thể + product.stock', () => {
  const conf = variantChange('size', 'configure', sizeCtx,
    sizeResult({ variants: [{ id: 62, sku: 'M', size: 'M', stock: 0, is_active: true, is_base: false }] }), { sizes: ['M'], x: 1 });
  assert.deepEqual(conf, { before: { action: 'configure' },
    after: { action: 'configure', variants: [{ id: 62, size: 'M', color: null, stock: 0, is_active: true }], request: { sizes: ['M'] } } });
  const alloc = variantChange('size', 'allocate', sizeCtx, sizeResult({ patch: { 60: { stock: 1 }, 61: { stock: 9 } } }),
    { allocations: [{ variant_id: 61, quantity: 3, evil: 'x' }] });
  assert.deepEqual(alloc.before.variants.map(v => [v.id, v.stock]), [[60, 4], [61, 6]]);
  assert.deepEqual(alloc.after.variants.map(v => [v.id, v.stock]), [[60, 1], [61, 9]]);
  assert.deepEqual(alloc.after.request, { allocations: [{ variant_id: 61, quantity: 3 }] });
  assert.ok(!alloc.before.product, 'tồn tổng không đổi -> không có product');
  const adj = variantChange('size', 'adjust', sizeCtx, sizeResult({ product: { stock: 12 }, patch: { 61: { stock: 8 } } }),
    { variant_id: 61, stock: 8, expected_stock: 6, reason: XSS, password: 'p' });
  assert.deepEqual(adj, {
    before: { action: 'adjust', product: { stock: 10 }, variants: [{ id: 61, size: 'S', color: null, stock: 6, is_active: true }] },
    after: { action: 'adjust', product: { stock: 12 }, variants: [{ id: 61, size: 'S', color: null, stock: 8, is_active: true }],
      request: { variant_id: 61, stock: 8, expected_stock: 6, reason: XSS } } });
});

const colorCtx = (images) => ({ before: { product: { id: 7, stock: 3 },
  colors: [{ id: 3, color_key: 'den', label: 'Đen', swatch_hex: '#000000', is_active: true }],
  variants: [{ id: 70, size: null, color: null, stock: 0, is_active: true, is_base: true },
    { id: 71, size: null, color: 'den', stock: 3, is_active: true, is_base: false }], ...(images ? { images } : {}) } });
const colorResult = ({ colors, variants, images = [] } = {}) => ({ product: { id: 7, stock: 3 },
  variants: variants || [{ id: 70, sku: 'B', size: null, color: null, stock: 0, is_active: true, is_base: true },
    { id: 71, sku: 'D', size: null, color: 'den', stock: 3, is_active: true, is_base: false }],
  colors: (colors || [{ id: 3, color_key: 'den', label: 'Đen', swatch_hex: '#000000', is_active: true }])
    .map(c => ({ ...c, variants: [], images: images.filter(i => i.color_id === c.id) })) });
const img = (id, path, sort, primary) => ({ id, color_id: 3, image_path: path, sort_order: sort, is_primary: primary });

test('variantChange color: create / update / add-size chỉ ghi màu, biến thể bị đụng', () => {
  const create = variantChange('color', 'create', { before: { product: { stock: 3 }, colors: [],
    variants: [{ id: 70, size: null, color: null, stock: 0, is_active: true, is_base: true }] } },
  colorResult(), { label: 'Đen', swatch_hex: '#000000', color_id: 999 });
  assert.deepEqual(create.after.variants, [{ id: 71, size: null, color: 'den', stock: 3, is_active: true }]);
  assert.deepEqual(create.after.colors, [{ id: 3, label: 'Đen', swatch_hex: '#000000', is_active: true }]);
  assert.deepEqual(create.after.request, { label: 'Đen', swatch_hex: '#000000' });
  assert.deepEqual(create.before, { action: 'create' });
  const update = variantChange('color', 'update', colorCtx(),
    colorResult({ colors: [{ id: 3, color_key: 'den', label: XSS, swatch_hex: '#000000', is_active: true }] }), { color_id: 3, label: XSS });
  assert.deepEqual([update.before.colors, update.after.colors],
    [[{ id: 3, label: 'Đen', swatch_hex: '#000000', is_active: true }], [{ id: 3, label: XSS, swatch_hex: '#000000', is_active: true }]]);
  assert.ok(!update.before.variants && !update.after.variants);
  const same = variantChange('color', 'update', colorCtx(), colorResult(), { color_id: 3, label: 'Đen' });
  assert.deepEqual(same, { before: { action: 'update' }, after: { action: 'update', request: { color_id: 3, label: 'Đen' } } });
  const addSize = variantChange('color', 'add-size', colorCtx(), colorResult({ variants: [
    { id: 70, size: null, color: null, stock: 0, is_active: true, is_base: true },
    { id: 71, size: null, color: 'den', stock: 3, is_active: true, is_base: false },
    { id: 72, size: 'L', color: null, stock: 0, is_active: true, is_base: false },
    { id: 73, size: 'L', color: 'den', stock: 0, is_active: true, is_base: false }] }), { size: 'L' });
  assert.deepEqual(addSize, { before: { action: 'add-size' }, after: { action: 'add-size', variants: [
    { id: 72, size: 'L', color: null, stock: 0, is_active: true }, { id: 73, size: 'L', color: 'den', stock: 0, is_active: true }],
  request: { size: 'L' } } });
});

test('variantChange color ảnh: add-image (ảnh chính cũ bị hạ) / update-image / delete-image (giữ URL ảnh đã xoá)', () => {
  const add = variantChange('color', 'add-image', colorCtx([img(7, 'img/a.png', 0, true)]),
    colorResult({ images: [img(7, 'img/a.png', 0, false), img(8, 'img/b.png', 1, true)] }),
    { color_id: 3, image_path: 'img/b.png', is_primary: true });
  assert.deepEqual(add.before.images, [img(7, 'img/a.png', 0, true)]);
  assert.deepEqual(add.after.images, [img(7, 'img/a.png', 0, false), img(8, 'img/b.png', 1, true)]);
  const upd = variantChange('color', 'update-image', colorCtx([img(7, 'img/a.png', 0, true), img(8, 'img/b.png', 1, false)]),
    colorResult({ images: [img(7, 'img/a.png', 0, true), img(8, 'img/b.png', 5, false)] }), { color_id: 3, image_id: 8, sort_order: 5 });
  assert.deepEqual([upd.before.images, upd.after.images], [[img(8, 'img/b.png', 1, false)], [img(8, 'img/b.png', 5, false)]]);
  const del = variantChange('color', 'delete-image', colorCtx([img(7, 'img/a.png', 0, false), img(8, 'img/b.png', 1, true)]),
    colorResult({ images: [img(7, 'img/a.png', 0, true)] }), { color_id: 3, image_id: 8 });
  assert.deepEqual(del.before.images, [img(7, 'img/a.png', 0, false), img(8, 'img/b.png', 1, true)]);
  assert.deepEqual(del.after.images, [img(7, 'img/a.png', 0, true)]);
  assert.deepEqual(del.after.request, { color_id: 3, image_id: 8 });
});

test('request: đủ danh sách cho 11 route; trường lạ / nhạy cảm không được chép; action lạ -> throw', () => {
  assert.equal(Object.keys(REQUEST_FIELDS).length, 11);
  const r = variantChange('color', 'allocate', colorCtx(), colorResult(), { allocations: [{ source_variant_id: 70,
    target_variant_id: 71, quantity: 1, expected_source_stock: 1, expected_target_stock: 3, note: 'x' }], role: 'admin', token: 't' });
  assert.deepEqual(r.after.request, { allocations: [{ source_variant_id: 70, target_variant_id: 71, quantity: 1,
    expected_source_stock: 1, expected_target_stock: 3 }] });
  assert.throws(() => variantChange('color', 'hack', colorCtx(), colorResult(), {}), /request/);
  assert.throws(() => variantChange('order', 'adjust', colorCtx(), colorResult(), {}), /kind/);
});
