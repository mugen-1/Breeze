'use strict';

// lib/purchase-receipt.js (chuyển trạng thái, kiểm body, biến thể lá, DTO) + lib/receipt-audit.js.
// Route + SQL giả: admin-receipts-routes.test.js; SQL thật: scripts/verify-audit-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/purchase-receipt');
const A = require('../lib/receipt-audit');

const fails = (fn, field, index) => assert.throws(fn, e => {
  assert.ok(e instanceof R.ReceiptError, 'phải là ReceiptError: ' + e);
  assert.deepEqual([e.status, e.code, e.extra.field, e.extra.index], [400, 'RECEIPT_INVALID_INPUT', field, index]);
  assert.ok(e.message.length > 0);
  return true;
});
const item = (over = {}) => ({ product_id: 5, variant_id: 50, quantity: 10, unit_cost: 120000, ...over });
const body = (over = {}) => ({ supplier_id: 3, items: [item()], ...over });

test('canTransition / nextStatus: đúng bảng chuyển trạng thái, mọi cặp khác bị chặn', () => {
  const allowed = { update: { draft: 'draft' }, submit: { draft: 'pending' }, approve: { pending: 'approved' },
    reject: { pending: 'draft' }, cancel: { draft: 'cancelled', pending: 'cancelled', approved: 'cancelled' },
    receive: { approved: 'received' } };
  for (const action of [...Object.keys(allowed), 'delete', '__proto__', 'constructor', '']) {
    for (const from of [...R.STATUSES, 'rejected', 'DRAFT', '', undefined]) {
      const want = (allowed[action] && Object.hasOwn(allowed[action], from)) ? allowed[action][from] : null;
      assert.equal(R.nextStatus(from, action), want, `${from} --${action}`);
      assert.equal(R.canTransition(from, action), want !== null, `${from} --${action}`);
    }
  }
  assert.deepEqual([R.cancelNeedsApprove('approved'), R.cancelNeedsApprove('pending'), R.cancelNeedsApprove('draft')], [true, false, false]);
  assert.ok(Object.isFrozen(R.TRANSITIONS) && Object.isFrozen(R.TRANSITIONS.cancel.from));
});

test('parseReceiptInput: hợp lệ; note trim, "" -> null; expected_date tuỳ chọn; chỉ giữ 4 trường mỗi dòng', () => {
  assert.deepEqual(R.parseReceiptInput(body({ note: '  Giao sáng ', expected_date: '2026-12-01',
    items: [item({ name: 'client gửi', sku: 'GIẢ', size: 'XL' }), item({ variant_id: 51, unit_cost: 0, quantity: 100000 })] })),
  { supplierId: 3, note: 'Giao sáng', expectedDate: '2026-12-01',
    items: [item(), { product_id: 5, variant_id: 51, quantity: 100000, unit_cost: 0 }] });
  for (const empty of ['', '   ', null, undefined]) assert.equal(R.parseReceiptInput(body({ note: empty })).note, null);
  for (const empty of ['', null, undefined]) assert.equal(R.parseReceiptInput(body({ expected_date: empty })).expectedDate, null);
  assert.equal(R.parseReceiptInput(body({ expected_date: '2020-01-01' })).expectedDate, '2020-01-01', 'không chặn ngày quá khứ');
  assert.equal(R.parseReceiptInput(body({ items: [item({ unit_cost: 1000000000 })] })).items[0].unit_cost, 1000000000);
  assert.equal(R.parseReceiptInput(body({ items: Array.from({ length: 200 }, (_, i) => item({ variant_id: i + 1 })) })).items.length, 200);
});

test('parseReceiptInput: sai -> 400 đúng field (+ index với dòng hàng)', () => {
  for (const b of [null, [], 'x']) fails(() => R.parseReceiptInput(b), undefined, undefined);
  for (const v of [undefined, 0, -1, 1.5, '3', null, 2147483648]) fails(() => R.parseReceiptInput(body({ supplier_id: v })), 'supplier_id');
  fails(() => R.parseReceiptInput(body({ note: 'x'.repeat(501) })), 'note');
  fails(() => R.parseReceiptInput(body({ note: 5 })), 'note');
  for (const d of ['2026-02-30', '2026/12/01', '01-12-2026', '0000-01-01', '2026-13-01', 20261201]) {
    fails(() => R.parseReceiptInput(body({ expected_date: d })), 'expected_date');
  }
  for (const items of [undefined, [], {}, 'x']) fails(() => R.parseReceiptInput(body({ items })), 'items');
  fails(() => R.parseReceiptInput(body({ items: Array.from({ length: 201 }, (_, i) => item({ variant_id: i + 1 })) })), 'items');
  fails(() => R.parseReceiptInput(body({ items: [item(), null] })), 'items', 1);
  assert.equal(R.parseReceiptInput(body({ items: [item({ product_id: 0 })] })).items[0].product_id, 0, 'products.id bắt đầu từ 0');
  for (const [k, vals] of [['product_id', [-1, '5', 1.5, null]], ['variant_id', [0, '50', -2]],
    ['quantity', [0, 100001, '10', 1.5, -1, null]], ['unit_cost', [-1, 1000000001, '120000', 0.5, null]]]) {
    for (const v of vals) fails(() => R.parseReceiptInput(body({ items: [item({ variant_id: 9 }), item({ [k]: v })] })), k, 1);
  }
  fails(() => R.parseReceiptInput(body({ items: [item(), item({ quantity: 1 })] })), 'variant_id', 1);
});

test('parseReason: trim, 1–250, bắt buộc', () => {
  assert.equal(R.parseReason({ reason: '  Sai giá nhập ' }), 'Sai giá nhập');
  assert.equal(R.parseReason({ reason: 'x'.repeat(250) }).length, 250);
  for (const b of [{}, { reason: '' }, { reason: '   ' }, { reason: null }, { reason: 5 }, undefined, []]) fails(() => R.parseReason(b), 'reason');
  fails(() => R.parseReason({ reason: 'x'.repeat(251) }), 'reason');
});

test('parseListQuery: mặc định; lọc status / supplier_id / q (thoát LIKE); sai -> 400', () => {
  assert.deepEqual(R.parseListQuery({}), { page: 1, limit: 20, status: 'all', supplierId: null, q: null });
  assert.deepEqual(R.parseListQuery({ page: '2', limit: '50', status: 'pending', supplier_id: '7', q: ' pn-00_1 ' }),
    { page: 2, limit: 50, status: 'pending', supplierId: 7, q: '%pn-00[_]1%' });
  for (const s of R.STATUSES) assert.equal(R.parseListQuery({ status: s }).status, s);
  for (const [k, v] of [['status', 'rejected'], ['status', 'ALL'], ['limit', '51'], ['page', '0'], ['supplier_id', '0'],
    ['supplier_id', 'x'], ['q', 'x'.repeat(101)], ['status', ['a', 'b']]]) fails(() => R.parseListQuery({ [k]: v }), k);
});

test('parseId / parseProductId', () => {
  assert.equal(R.parseId('12'), 12);
  for (const v of ['0', 'x', '1.5', '2147483648', undefined]) fails(() => R.parseId(v), 'id');
  assert.equal(R.parseProductId('5'), 5);
  assert.equal(R.parseProductId('0'), 0, 'products.id bắt đầu từ 0');
  for (const v of [undefined, '', '-1', '00', '05', 'abc', ['5', '6']]) fails(() => R.parseProductId(v), 'product_id');
});

// ---- biến thể lá ----
const shirt = (over = {}) => ({ id: 5, slug: 'ao-thun', category_slug: 'sanpham-ao', size_configured: false, color_configured: false, ...over });
const V = (over = {}) => ({ id: 1, product_id: 5, is_base: false, size: null, color: null, color_exists: false, is_active: true, ...over });
test('productMode + isLeafVariant: BASE / size / màu / size + màu; không xét is_active', () => {
  const base = shirt(), size = shirt({ size_configured: true }), color = shirt({ color_configured: true }),
    matrix = shirt({ size_configured: true, color_configured: true });
  assert.deepEqual([base, size, color, matrix].map(R.productMode), ['base', 'size', 'color', 'size_color']);
  const B = V({ is_base: true }), S = V({ size: 'M' }), S_OUT = V({ size: '42' }), C = V({ color: 'den', color_exists: true }),
    C_GONE = V({ color: 'den', color_exists: false }), M = V({ size: 'M', color: 'den', color_exists: true }),
    M_OUT = V({ size: '42', color: 'den', color_exists: true });
  const table = [[base, [B]], [size, [S]], [color, [C]], [matrix, [M]]];
  for (const [p, leaves] of table) {
    for (const v of [B, S, S_OUT, C, C_GONE, M, M_OUT]) {
      assert.equal(R.isLeafVariant(p, v), leaves.includes(v), R.productMode(p) + ' ' + JSON.stringify(v));
    }
  }
  assert.equal(R.isLeafVariant(size, { ...S, is_active: false }), true, 'biến thể đang tắt vẫn là lá');
  assert.equal(R.isLeafVariant({ ...size, is_active: false }, S), true, 'sản phẩm đang ẩn vẫn nhập được');
  assert.equal(R.isLeafVariant(color, { ...C, color_active: false }), true, 'màu đang tắt vẫn là lá');
  const shoes = shirt({ slug: 'giay-nam-chay', category_slug: 'sanpham-giay', size_configured: true });
  assert.equal(R.isLeafVariant(shoes, V({ size: '40.5' })), true);
  assert.equal(R.isLeafVariant(shoes, V({ size: 'M' })), false);
  assert.equal(R.isLeafVariant(null, B), false);
  assert.equal(R.isLeafVariant(base, undefined), false);
});

test('checkItems: NOT_FOUND / PRODUCT_MISMATCH / NOT_LEAF theo đúng index; hợp lệ -> rỗng', () => {
  const products = new Map([[5, shirt({ size_configured: true })], [6, shirt({ id: 6 })]]);
  const variants = new Map([[50, V({ id: 50, size: 'M' })], [51, V({ id: 51, is_base: true })], [60, V({ id: 60, product_id: 6, is_base: true })]]);
  assert.deepEqual(R.checkItems([{ product_id: 5, variant_id: 50 }, { product_id: 6, variant_id: 60 }], products, variants), []);
  assert.deepEqual(R.checkItems([{ product_id: 5, variant_id: 50 }, { product_id: 5, variant_id: 99 }, { product_id: 7, variant_id: 50 },
    { product_id: 5, variant_id: 60 }, { product_id: 5, variant_id: 51 }], products, variants), [
    { index: 1, product_id: 5, variant_id: 99, reason: 'NOT_FOUND' },
    { index: 2, product_id: 7, variant_id: 50, reason: 'NOT_FOUND' },
    { index: 3, product_id: 5, variant_id: 60, reason: 'PRODUCT_MISMATCH' },
    { index: 4, product_id: 5, variant_id: 51, reason: 'NOT_LEAF' }]);
});

test('sortLeafVariants: theo size của profile, rồi id màu, rồi id', () => {
  const p = shirt({ size_configured: true, color_configured: true });
  const list = [V({ id: 9, size: 'L', color_id: 1 }), V({ id: 8, size: 'S', color_id: 2 }), V({ id: 7, size: 'S', color_id: 1 }),
    V({ id: 6, size: 'XL', color_id: 1 }), V({ id: 5, size: 'M', color_id: 2 })];
  assert.deepEqual(R.sortLeafVariants(p, list).map(v => v.id), [7, 8, 5, 9, 6]);
});

// ---- DTO ----
const at = new Date('2026-11-27T03:04:05.006Z');
const detailRow = (over = {}) => ({ id: 4, code: 'PN-000004', status: 'pending', supplier_id: 3, supplier_code: 'NCC-1', supplier_name: 'A',
  supplier_active: 0, note: null, expected_date: new Date('2026-12-01T00:00:00Z'), updated_at: at, reject_reason: 'Sai giá', cancel_reason: null,
  created_by: 2, created_at: at, created_user: 2, created_name: 'Nhân viên', created_email: 'nv@example.test',
  submitted_by: 9, submitted_at: at, submitted_user: null, submitted_name: null, submitted_email: null,
  approved_by: null, approved_at: null, approved_user: null, approved_name: null, approved_email: null,
  rejected_by: 1, rejected_at: at, rejected_user: 1, rejected_name: null, rejected_email: 'admin@example.test',
  received_by: null, received_at: null, received_user: null, received_name: null, received_email: null,
  cancelled_by: null, cancelled_at: null, cancelled_user: null, cancelled_name: null, cancelled_email: null, ...over });
const itemRows = [{ id: 1, product_id: 5, variant_id: 50, quantity: 3, unit_cost: 1000, name_snapshot: 'Áo', sku_snapshot: 'SKU-M',
  size_snapshot: 'M', color_snapshot: null }, { id: 2, product_id: 5, variant_id: 51, quantity: 2, unit_cost: 500, name_snapshot: 'Áo',
  sku_snapshot: 'SKU-L', size_snapshot: 'L', color_snapshot: 'Đen' }];

test('toReceiptDetail: người xem có quyền thấy email; user đã xoá -> deleted, không tên / email; mốc chưa có -> null', () => {
  const d = R.toReceiptDetail(detailRow(), itemRows, { canSeeEmail: true });
  assert.deepEqual([d.id, d.code, d.status, d.supplier, d.note, d.expected_date, d.reject_reason, d.cancel_reason, d.created_at, d.updated_at],
    [4, 'PN-000004', 'pending', { id: 3, code: 'NCC-1', name: 'A', is_active: false }, null, '2026-12-01', 'Sai giá', null,
      at.toISOString(), at.toISOString()]);
  assert.deepEqual(d.actors, {
    created: { id: 2, display_name: 'Nhân viên', email: 'nv@example.test', deleted: false, at: at.toISOString() },
    submitted: { id: 9, display_name: null, email: null, deleted: true, at: at.toISOString() },
    approved: null,
    rejected: { id: 1, display_name: null, email: 'admin@example.test', deleted: false, at: at.toISOString() },
    received: null, cancelled: null });
  assert.deepEqual(d.items[1], { id: 2, product_id: 5, variant_id: 51, name: 'Áo', sku: 'SKU-L', size: 'L', color: 'Đen', quantity: 2,
    unit_cost: 500, line_total: 1000 });
  assert.deepEqual([d.item_count, d.total_quantity, d.total_cost], [2, 5, 4000]);
});

test('toReceiptDetail / toReceiptListRow: không có quyền xem email (staff) -> email null ở MỌI mốc', () => {
  const d = R.toReceiptDetail(detailRow(), itemRows, { canSeeEmail: false });
  for (const a of Object.values(d.actors).filter(Boolean)) assert.equal(a.email, null);
  assert.equal(d.actors.created.display_name, 'Nhân viên');
  const row = R.toReceiptListRow({ ...detailRow(), item_count: 2, total_quantity: '5', total_cost: '4000' }, { canSeeEmail: false });
  assert.deepEqual(row, { id: 4, code: 'PN-000004', status: 'pending', supplier: { id: 3, code: 'NCC-1', name: 'A', is_active: false },
    item_count: 2, total_quantity: 5, total_cost: 4000, expected_date: '2026-12-01', created_at: at.toISOString(), updated_at: at.toISOString(),
    created_by: { id: 2, display_name: 'Nhân viên', email: null, deleted: false, at: at.toISOString() } });
  assert.equal(R.toReceiptListRow({ ...detailRow(), item_count: 2, total_quantity: '5', total_cost: '4000' }, { canSeeEmail: true }).created_by.email,
    'nv@example.test');
});

test('dateParam: YYYY-MM-DD -> Date 00:00 UTC; null giữ null', () => {
  assert.equal(R.dateParam('2026-12-01').toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(R.dateParam(null), null);
});

test('receipt-audit: snapshot tạo / sửa / chuyển trạng thái', () => {
  const items = [{ product_id: 5, variant_id: 50, sku: 'SKU-M', quantity: 3, unit_cost: 1000, extra: 'bỏ' }];
  assert.deepEqual(A.createSnapshot({ id: 4, code: 'PN-000004', status: 'draft', supplier_id: 3, note: null, expected_date: '2026-12-01' }, items),
    { id: 4, code: 'PN-000004', supplier_id: 3, status: 'draft', note: null, expected_date: '2026-12-01',
      items: [{ product_id: 5, variant_id: 50, sku: 'SKU-M', quantity: 3, unit_cost: 1000 }] });
  const fromDb = A.updateSnapshot({ id: 4, code: 'x', status: 'draft', supplier_id: 3, note: 'n', expected_date: new Date('2026-12-01T00:00:00Z') },
    [{ product_id: 5, variant_id: 50, sku_snapshot: 'SKU-M', quantity: 3, unit_cost: 1000 }]);
  const fromBody = A.updateSnapshot({ supplier_id: 3, note: 'n', expected_date: '2026-12-01' }, items);
  assert.deepEqual(fromDb, fromBody, 'cùng dữ liệu đọc từ DB (Date, sku_snapshot) và từ body -> giống hệt (để {} / {} khi không đổi)');
  assert.deepEqual(Object.keys(fromDb), ['supplier_id', 'note', 'expected_date', 'items']);
  assert.deepEqual(A.statusChange('pending', 'draft', { reject_reason: 'Sai' }), { before: { status: 'pending' }, after: { status: 'draft', reject_reason: 'Sai' } });
  assert.deepEqual(A.statusChange('draft', 'pending'), { before: { status: 'draft' }, after: { status: 'pending' } });
});
