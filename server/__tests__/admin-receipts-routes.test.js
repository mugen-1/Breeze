'use strict';

// /api/admin/receipts qua HTTP: router /api/admin + requireBackOffice/requirePermission + securityLogger + lib/audit.js THẬT;
// chỉ thay xác thực và SQL (SQL giả có transaction: begin chép dữ liệu, commit mới áp, rollback bỏ).
// Hàm thuần: purchase-receipt.test.js; SQL thật: scripts/verify-audit-sql.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

let db, actor, events, failAudit, routeSql, security;
const clone = x => structuredClone(x);
const rs = (recordset = [], recordsets, affected) => ({ recordset, recordsets: recordsets || [recordset],
  rowsAffected: [affected === undefined ? recordset.length : affected] });
let clock = 0;
const tick = () => new Date(Date.UTC(2026, 10, 27, 1, 0, ++clock));
const ACTORS = ['created', 'submitted', 'approved', 'rejected', 'received', 'cancelled'];
const like = (value, pattern) => {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '%') re += '.*';
    else if (c === '[') { const j = pattern.indexOf(']', i + 2); re += pattern.slice(i + 1, j).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i = j; }
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i').test(value);
};
const ids = (p, prefix) => Object.keys(p).filter(k => new RegExp('^' + prefix + '\\d+$').test(k)).map(k => p[k]);

class Transaction {
  async begin() { this.data = clone(db); events.push('begin'); }
  async commit() { db = this.data; this.data = null; events.push('commit'); }
  async rollback() { this.data = null; events.push('rollback'); }
}
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.p;
    if (q.startsWith('INSERT INTO dbo.SecurityEvents')) { security.push({ ...p }); return rs([]); }
    const d = this.tx ? this.tx.data : db;
    if (!d) throw new Error('SQL sau commit/rollback');
    routeSql.push({ q, tx: !!this.tx });
    const needTx = () => assert.ok(this.tx, 'phải chạy trong transaction: ' + q.slice(0, 60));
    if (q.startsWith('INSERT INTO dbo.audit_logs')) {
      needTx();
      if (failAudit) throw new Error('audit giả lỗi');
      d.audit.push({ actor_user_id: p.actor_user_id, actor_role: p.actor_role, action: p.action, entity_type: p.entity_type,
        entity_id: p.entity_id, before: JSON.parse(p.before_json), after: JSON.parse(p.after_json) });
      return rs([{ id: String(d.audit.length) }]);
    }
    if (q === 'SELECT s.id, s.is_active FROM dbo.suppliers s WITH (UPDLOCK, HOLDLOCK) WHERE s.id = @sid;') {
      needTx(); d.locks.push('supplier:' + p.sid);
      return rs(d.suppliers.filter(s => s.id === p.sid).map(s => ({ id: s.id, is_active: s.is_active })));
    }
    if (q.startsWith('SELECT r.id, r.code, r.status, r.supplier_id, r.note, r.expected_date FROM dbo.purchase_receipts r WITH (UPDLOCK, HOLDLOCK) WHERE r.id = @id;')) {
      needTx(); d.locks.push('receipt:' + p.id);
      return rs(d.receipts.filter(r => r.id === p.id).map(r => ({ id: r.id, code: r.code, status: r.status, supplier_id: r.supplier_id,
        note: r.note, expected_date: r.expected_date })));
    }
    if (q.startsWith('SELECT i.product_id, i.variant_id, i.sku_snapshot, i.quantity, i.unit_cost FROM dbo.purchase_receipt_items i WHERE i.receipt_id = @id ORDER BY i.id;')) {
      return rs(d.items.filter(i => i.receipt_id === p.id).sort((a, b) => a.id - b.id)
        .map(i => ({ product_id: i.product_id, variant_id: i.variant_id, sku_snapshot: i.sku_snapshot, quantity: i.quantity, unit_cost: i.unit_cost })));
    }
    if (q.startsWith('SELECT p.id, p.slug, p.name_vi, p.is_active, c.slug AS category_slug,')) {
      const want = q.includes('WHERE p.id IN (') ? ids(p, 'p') : [p.pid];
      return rs(d.products.filter(x => want.includes(x.id)).map(x => ({ ...x })));
    }
    if (q.startsWith('SELECT v.id, v.product_id, v.sku, v.size, v.color, v.stock, v.is_active, v.is_base, pc.id AS color_id,')) {
      const pick = q.includes('WHERE v.id IN (') ? (vids => v => vids.includes(v.id))(ids(p, 'v')) : v => v.product_id === p.pid;
      return rs(d.variants.filter(pick).map(v => {
        const c = d.colors.find(x => x.product_id === v.product_id && x.color_key === v.color);
        return { ...v, color_id: c ? c.id : null, color_label: c ? c.label : null, color_active: c ? c.is_active : null };
      }));
    }
    if (q.startsWith('INSERT INTO dbo.purchase_receipts (supplier_id, note, expected_date, created_by) OUTPUT INSERTED.id, INSERTED.code, INSERTED.status VALUES')) {
      needTx();
      const id = d.nextReceipt++, at = tick();
      const row = { id, code: 'PN-' + String(id).padStart(6, '0'), supplier_id: p.sid, status: 'draft', note: p.note,
        expected_date: p.expected_date, created_by: p.uid, created_at: at, updated_at: at, reject_reason: null, cancel_reason: null };
      for (const k of ACTORS.slice(1)) { row[k + '_by'] = null; row[k + '_at'] = null; }
      d.receipts.push(row);
      return rs([{ id, code: row.code, status: 'draft' }]);
    }
    if (q.startsWith('INSERT INTO dbo.purchase_receipt_items (receipt_id, product_id, variant_id, quantity, unit_cost, name_snapshot, sku_snapshot, size_snapshot, color_snapshot) VALUES')) {
      needTx();
      const n = ids(p, 'pid').length;
      for (let i = 0; i < n; i++) {
        if (d.items.some(x => x.receipt_id === p.rid && x.variant_id === p['vid' + i])) throw Object.assign(new Error('UQ'), { number: 2627 });
        d.items.push({ id: d.nextItem++, receipt_id: p.rid, product_id: p['pid' + i], variant_id: p['vid' + i], quantity: p['qty' + i],
          unit_cost: p['cost' + i], name_snapshot: p['name' + i], sku_snapshot: p['sku' + i], size_snapshot: p['size' + i], color_snapshot: p['color' + i] });
      }
      return rs([], undefined, n);
    }
    if (q.startsWith("UPDATE dbo.purchase_receipts SET supplier_id = @sid, note = @note, expected_date = @expected_date, updated_at = SYSUTCDATETIME() WHERE id = @id AND status = 'draft';")) {
      needTx();
      const r = d.receipts.find(x => x.id === p.id && x.status === 'draft');
      if (!r) return rs([], undefined, 0);
      Object.assign(r, { supplier_id: p.sid, note: p.note, expected_date: p.expected_date, updated_at: tick() });
      return rs([], undefined, 1);
    }
    if (q === 'DELETE FROM dbo.purchase_receipt_items WHERE receipt_id = @id;') {
      needTx();
      const n = d.items.length; d.items = d.items.filter(i => i.receipt_id !== p.id);
      return rs([], undefined, n - d.items.length);
    }
    const tr = q.match(/^UPDATE dbo\.purchase_receipts SET status = @to, (\w+)_by = @uid, \1_at = SYSUTCDATETIME\(\)(?:, (\w+) = @reason)?, updated_at = SYSUTCDATETIME\(\) WHERE id = @id AND status = @from;$/);
    if (tr) {
      needTx();
      const r = d.receipts.find(x => x.id === p.id && x.status === p.from);
      if (!r) return rs([], undefined, 0);
      const at = tick();
      Object.assign(r, { status: p.to, [tr[1] + '_by']: p.uid, [tr[1] + '_at']: at, updated_at: at });
      if (tr[2]) r[tr[2]] = p.reason;
      return rs([], undefined, 1);
    }
    const withJoins = r => {
      const s = d.suppliers.find(x => x.id === r.supplier_id);
      const row = { ...r, supplier_code: s.code, supplier_name: s.name, supplier_active: s.is_active };
      for (const k of ACTORS) {
        const u = d.users.find(x => x.id === r[k + '_by']);
        Object.assign(row, { [k + '_user']: u ? u.id : null, [k + '_name']: u ? u.display_name : null, [k + '_email']: u ? u.email : null });
      }
      const its = d.items.filter(i => i.receipt_id === r.id);
      return Object.assign(row, { item_count: its.length, total_quantity: String(its.reduce((a, i) => a + i.quantity, 0)),
        total_cost: String(its.reduce((a, i) => a + i.quantity * i.unit_cost, 0)) });
    };
    if (q.startsWith('SELECT r.id, r.code, r.status, r.supplier_id, s.code AS supplier_code, s.name AS supplier_name, s.is_active AS supplier_active, r.note,')) {
      const r = d.receipts.find(x => x.id === p.id);
      const items = r ? d.items.filter(i => i.receipt_id === r.id).sort((a, b) => a.id - b.id).map(i => ({ ...i })) : [];
      return rs([], [r ? [withJoins(r)] : [], items]);
    }
    // ---- nhận hàng (lib/purchase-receipt-receive.js) ----
    if (q.startsWith('SELECT i.id, i.product_id, i.variant_id, i.quantity FROM dbo.purchase_receipt_items i WHERE i.receipt_id = @id ORDER BY i.id;')) {
      return rs(d.items.filter(i => i.receipt_id === p.id).sort((a, b) => a.id - b.id)
        .map(i => ({ id: i.id, product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity })));
    }
    if (q.startsWith('SELECT p.id, p.slug, p.stock,') && q.includes('FROM dbo.products p WITH (UPDLOCK, HOLDLOCK) WHERE p.id = @pid;')) {
      needTx(); d.locks.push('product:' + p.pid);
      return rs(d.products.filter(x => x.id === p.pid).map(x => ({ ...x })));
    }
    if (q.startsWith('SELECT v.id, v.product_id, v.size, v.color, v.stock, v.is_base, pc.id AS color_id FROM dbo.product_variants v WITH (UPDLOCK, HOLDLOCK)')) {
      needTx(); d.locks.push('variant:' + p.vid);
      return rs(d.variants.filter(v => v.id === p.vid).map(v => {
        const c = d.colors.find(x => x.product_id === v.product_id && x.color_key === v.color);
        return { ...v, color_id: c ? c.id : null };
      }));
    }
    if (q.startsWith('UPDATE dbo.products SET stock = stock + @qty')) {
      needTx();
      const x = d.products.find(y => y.id === p.pid);
      if (!x || x.stock > 2147483647 - p.qty) return rs([], undefined, 0);
      x.stock += p.qty; return rs([], undefined, 1);
    }
    if (q.startsWith('UPDATE dbo.product_variants SET stock = stock + @qty')) {
      needTx();
      const v = d.variants.find(y => y.id === p.vid && y.product_id === p.pid);
      if (!v || v.stock > 2147483647 - p.qty) return rs([], undefined, 0);
      const before = v.stock; v.stock += p.qty;
      return rs([{ stock_before: before, stock_after: v.stock }]);
    }
    if (q.startsWith('INSERT INTO dbo.inventory_movements')) {
      needTx();
      assert.match(q, /receipt_id, movement_type/);
      if (d.movements.some(m => m.receipt_id === p.rid && m.variant_id === p.vid)) {
        throw Object.assign(new Error('Cannot insert duplicate key row ... UX_inventory_movements_receipt_variant'), { number: 2601 });
      }
      d.movements.push({ product_id: p.pid, variant_id: p.vid, receipt_id: p.rid, movement_type: p.type, quantity_delta: p.delta,
        stock_before: p.before, stock_after: p.after, reason: p.reason, actor_user_id: p.actor });
      return rs([], undefined, 1);
    }
    if (q.startsWith('DECLARE @total INT = (SELECT COUNT(*) FROM dbo.purchase_receipts r')) {
      let list = d.receipts.slice();
      if (q.includes('r.status = @status')) list = list.filter(r => r.status === p.status);
      if (q.includes('r.supplier_id = @supplier_id')) list = list.filter(r => r.supplier_id === p.supplier_id);
      if (q.includes('r.code LIKE @q')) list = list.filter(r => like(r.code, p.q));
      list.sort((a, b) => b.created_at - a.created_at || b.id - a.id);
      const total = list.length, page = total === 0 ? 1 : Math.min(p.page, Math.ceil(total / p.limit));
      const rows = list.slice((page - 1) * p.limit, page * p.limit).map(withJoins);
      return rs(rows, [[{ total, page }], rows]);
    }
    throw new Error('Unexpected SQL: ' + q);
  }
}
require.cache[require.resolve('../db')] = { exports: {
  sql: { ...realSql, Transaction, Request }, getPool: async () => ({ request: () => new Request(null) }),
} };
require.cache[require.resolve('../middleware/auth')] = { exports: {
  verifyFirebaseToken: (req, res, next) => { req.user = actor; next(); },
} };
const app = express();
app.use(require('../middleware/securityLogger').securityLogger);
app.use(express.json());
app.use('/api/admin', require('../routes/admin'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/api/admin/receipts';
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

const ADMIN = { id: 1, email: 'admin@example.test', role: 'admin' };
const STAFF = { id: 2, email: 'staff@example.test', role: 'staff' };
const CUSTOMER = { id: 3, email: 'khach@example.test', role: 'customer' };
const XSS = '<img src=x onerror=alert(1)>';
// Sản phẩm: 5 = áo theo size (S, M, L, XL; M đang tắt; có size lạ '42' và BASE); 6 = không biến thể (chỉ BASE, đang ẩn);
// 7 = áo theo màu (đen, trắng đang tắt; có biến thể màu đã xoá 'do'); 8 = áo size + màu.
const product = (id, over) => ({ id, slug: 'ao-' + id, name_vi: 'Áo ' + id, is_active: true, category_slug: 'sanpham-ao',
  size_configured: false, color_configured: false, ...over });
const variant = (id, productId, over) => ({ id, product_id: productId, sku: 'SKU-' + id, size: null, color: null, stock: 10,
  is_active: true, is_base: false, ...over });
beforeEach(() => {
  db = {
    audit: [], locks: [], nextReceipt: 1, nextItem: 1, receipts: [], items: [], movements: [],
    users: [{ id: 1, display_name: 'Quản trị', email: 'admin@example.test' }, { id: 2, display_name: 'Nhân viên', email: 'staff@example.test' }],
    suppliers: [{ id: 1, code: 'NCC-001', name: 'Vải SG', is_active: true }, { id: 2, code: 'NCC-002', name: 'Đã ngừng', is_active: false },
      { id: 3, code: 'NCC-003', name: 'Dệt BM', is_active: true }],
    products: [product(5, { size_configured: true, name_vi: 'Áo ' + XSS }), product(6, { is_active: false, category_slug: 'sanpham-khac' }),
      product(7, { color_configured: true }), product(8, { size_configured: true, color_configured: true })],
    variants: [variant(50, 5, { is_base: true, stock: 0 }), variant(51, 5, { size: 'L' }), variant(52, 5, { size: 'S', stock: 3 }),
      variant(53, 5, { size: 'M', is_active: false }), variant(54, 5, { size: '42' }), variant(55, 5, { size: 'XL' }),
      variant(60, 6, { is_base: true, stock: 7 }),
      variant(70, 7, { is_base: true }), variant(71, 7, { color: 'den' }), variant(72, 7, { color: 'trang' }), variant(73, 7, { color: 'do' }),
      variant(80, 8, { is_base: true }), variant(81, 8, { size: 'M', color: 'den' }), variant(82, 8, { size: 'S', color: 'den' }),
      variant(83, 8, { size: 'M' })],
    colors: [{ id: 1, product_id: 7, color_key: 'den', label: 'Đen', is_active: true }, { id: 2, product_id: 7, color_key: 'trang', label: 'Trắng', is_active: false },
      { id: 3, product_id: 8, color_key: 'den', label: 'Đen', is_active: true }],
  };
  // products.stock = tổng tồn các biến thể (bất biến kiểm lại sau khi nhận).
  for (const p of db.products) p.stock = db.variants.filter(v => v.product_id === p.id).reduce((s, v) => s + v.stock, 0);
  actor = ADMIN; events = []; failAudit = false; routeSql = []; security = []; clock = 0;
});
const call = async (method, path = '', body) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') };
};
const quiet = t => t.mock.method(console, 'error', () => {});
const line = (product_id, variant_id, quantity = 5, unit_cost = 100000) => ({ product_id, variant_id, quantity, unit_cost });
const draftBody = (over = {}) => ({ supplier_id: 1, note: 'Lô đông', expected_date: '2026-12-05',
  items: [line(5, 52, 10, 90000), line(7, 71, 4, 150000)], ...over });
const expectInvalid = (r, field, index) => {
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.deepEqual([r.body.code, r.body.field, r.body.index], ['RECEIPT_INVALID_INPUT', field, index]);
};
const reset = () => { db.audit = []; db.locks = []; events = []; routeSql = []; security = []; };
const logs = action => db.audit.filter(l => !action || l.action === action);
const oneLog = (action, id, who = ADMIN) => {
  assert.equal(db.audit.length, 1, 'đúng 1 dòng audit: ' + JSON.stringify(db.audit));
  const l = db.audit[0];
  assert.deepEqual([l.action, l.entity_type, l.entity_id, l.actor_user_id, l.actor_role], [action, 'receipt', String(id), who.id, who.role]);
  return l;
};
// Lập 1 phiếu nháp (admin mặc định), xoá vết để test sau đếm sạch.
async function makeDraft(body = draftBody(), who = ADMIN) {
  const saved = actor; actor = who;
  const r = await call('POST', '', body);
  actor = saved;
  assert.equal(r.status, 201, JSON.stringify(r.body));
  reset();
  return r.body.receipt;
}
async function advance(id, steps) {
  const saved = actor; actor = ADMIN;
  for (const s of steps) {
    const r = await call('POST', `/${id}/${s}`, s === 'reject' || s === 'cancel' ? { reason: 'test' } : undefined);
    assert.equal(r.status, 200, s + ' ' + JSON.stringify(r.body));
  }
  actor = saved; reset();
}
async function securityRows(expected) {
  for (let i = 0; i < 50 && security.length < expected; i++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 30));
  return security;
}

// ---------------- receivable-variants ----------------
test('receivable-variants: đúng biến thể lá theo 4 chế độ, gồm cả hàng đang tắt (kèm cờ), sắp theo size / màu; staff được', async () => {
  actor = STAFF;
  const get = async pid => (await call('GET', '/receivable-variants?product_id=' + pid)).body;
  const size = await get(5);
  assert.deepEqual(size.product, { id: 5, name_vi: 'Áo ' + XSS, slug: 'ao-5', is_active: true, mode: 'size' });
  assert.deepEqual(size.variants.map(v => [v.id, v.size, v.is_active]), [[52, 'S', true], [53, 'M', false], [51, 'L', true], [55, 'XL', true]],
    'bỏ BASE và size ngoài profile (42); M đang tắt vẫn có');
  assert.deepEqual(size.variants[0], { id: 52, sku: 'SKU-52', size: 'S', color_key: null, color_label: null, stock: 3, is_active: true, color_active: null });
  const plain = await get(6);
  assert.deepEqual([plain.product.mode, plain.product.is_active, plain.variants.map(v => [v.id, v.stock])], ['base', false, [[60, 7]]]);
  const color = await get(7);
  assert.deepEqual([color.product.mode, color.variants.map(v => [v.id, v.color_label, v.color_active])],
    ['color', [[71, 'Đen', true], [72, 'Trắng', false]]], 'bỏ BASE và màu không còn trong product_colors');
  const matrix = await get(8);
  assert.deepEqual([matrix.product.mode, matrix.variants.map(v => v.id)], ['size_color', [82, 81]]);
});

test('receivable-variants: product_id sai -> 400, không có -> 404; customer -> 403', async () => {
  for (const q of ['', '?product_id=', '?product_id=-1', '?product_id=abc', '?product_id=5&product_id=6']) {
    expectInvalid(await call('GET', '/receivable-variants' + q), 'product_id');
  }
  assert.deepEqual((await call('GET', '/receivable-variants?product_id=99')).body.code, 'RECEIPT_PRODUCT_NOT_FOUND');
  actor = CUSTOMER;
  assert.equal((await call('GET', '/receivable-variants?product_id=5')).status, 403);
});

// ---------------- tạo ----------------
test('POST / (staff): 201 nháp, snapshot tên / SKU / size / màu từ DB (không tin client), khoá NCC trong tx, 1 dòng RECEIPT_CREATE', async () => {
  actor = STAFF;
  const body = draftBody({ items: [{ ...line(5, 52, 10, 90000), name: 'GIẢ', sku: 'GIẢ', size: 'XXL' }, line(7, 71, 4, 150000)] });
  const r = await call('POST', '', body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.cache, 'no-store');
  const rc = r.body.receipt;
  assert.deepEqual([rc.id, rc.code, rc.status, rc.supplier, rc.note, rc.expected_date], [1, 'PN-000001', 'draft',
    { id: 1, code: 'NCC-001', name: 'Vải SG', is_active: true }, 'Lô đông', '2026-12-05']);
  assert.deepEqual(rc.items.map(i => [i.variant_id, i.name, i.sku, i.size, i.color, i.quantity, i.unit_cost, i.line_total]), [
    [52, 'Áo ' + XSS, 'SKU-52', 'S', null, 10, 90000, 900000], [71, 'Áo 7', 'SKU-71', null, 'Đen', 4, 150000, 600000]]);
  assert.deepEqual([rc.item_count, rc.total_quantity, rc.total_cost], [2, 14, 1500000]);
  assert.deepEqual(rc.actors.created, { id: 2, display_name: 'Nhân viên', email: null, deleted: false, at: rc.actors.created.at });
  assert.deepEqual([rc.actors.submitted, rc.actors.approved, rc.actors.cancelled], [null, null, null]);
  const l = oneLog('RECEIPT_CREATE', 1, STAFF);
  assert.equal(l.before, null);
  assert.deepEqual(l.after, { id: 1, code: 'PN-000001', supplier_id: 1, status: 'draft', note: 'Lô đông', expected_date: '2026-12-05',
    items: [{ product_id: 5, variant_id: 52, sku: 'SKU-52', quantity: 10, unit_cost: 90000 },
      { product_id: 7, variant_id: 71, sku: 'SKU-71', quantity: 4, unit_cost: 150000 }] });
  assert.deepEqual(events, ['begin', 'commit']);
  assert.deepEqual(db.locks, ['supplier:1']);
  assert.ok(routeSql.findIndex(x => x.q.includes('FROM dbo.suppliers s WITH (UPDLOCK, HOLDLOCK)')) <
    routeSql.findIndex(x => x.q.startsWith('INSERT INTO dbo.purchase_receipts')), 'khoá NCC trước khi INSERT');
});

test('POST /: NCC đã ngừng -> 409 RECEIPT_SUPPLIER_INACTIVE; không có -> 404; rollback, 0 dòng', async () => {
  const inactive = await call('POST', '', draftBody({ supplier_id: 2 }));
  assert.deepEqual([inactive.status, inactive.body.code, inactive.body.field], [409, 'RECEIPT_SUPPLIER_INACTIVE', 'supplier_id']);
  const missing = await call('POST', '', draftBody({ supplier_id: 99 }));
  assert.deepEqual([missing.status, missing.body.code], [404, 'RECEIPT_SUPPLIER_NOT_FOUND']);
  assert.deepEqual([events, db.audit.length, db.receipts.length, db.items.length], [['begin', 'rollback', 'begin', 'rollback'], 0, 0, 0]);
});

test('POST /: dòng không phải biến thể lá -> 409 RECEIPT_ITEMS_INVALID chỉ đúng các dòng sai; rollback', async () => {
  const r = await call('POST', '', draftBody({ items: [line(5, 52), line(5, 50), line(5, 54), line(6, 51), line(5, 999), line(7, 73), line(8, 83),
    line(6, 60)] }));
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { status: 'error', code: 'RECEIPT_ITEMS_INVALID', message: 'Có dòng hàng không còn là biến thể nhập kho hợp lệ', items: [
    { index: 1, product_id: 5, variant_id: 50, reason: 'NOT_LEAF' }, { index: 2, product_id: 5, variant_id: 54, reason: 'NOT_LEAF' },
    { index: 3, product_id: 6, variant_id: 51, reason: 'PRODUCT_MISMATCH' }, { index: 4, product_id: 5, variant_id: 999, reason: 'NOT_FOUND' },
    { index: 5, product_id: 7, variant_id: 73, reason: 'NOT_LEAF' }, { index: 6, product_id: 8, variant_id: 83, reason: 'NOT_LEAF' }] });
  assert.deepEqual([events, db.audit.length, db.receipts.length], [['begin', 'rollback'], 0, 0]);
});

test('POST /: body sai -> 400 trước khi mở transaction; hàng đang tắt / sản phẩm ẩn vẫn nhập được', async () => {
  for (const [b, field, index] of [[{ ...draftBody(), supplier_id: '1' }, 'supplier_id'], [{ ...draftBody(), items: [] }, 'items'],
    [draftBody({ items: [line(5, 52, 0)] }), 'quantity', 0], [draftBody({ items: [line(5, 52), line(5, 52)] }), 'variant_id', 1],
    [draftBody({ items: [line(5, 52, 1, -1)] }), 'unit_cost', 0], [draftBody({ expected_date: '2026-02-30' }), 'expected_date']]) {
    expectInvalid(await call('POST', '', b), field, index);
  }
  assert.deepEqual([events, routeSql], [[], []]);
  const ok = await call('POST', '', draftBody({ items: [line(5, 53), line(6, 60), line(7, 72)] }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test('POST /: audit() lỗi -> 500, rollback, không có phiếu / dòng hàng', async t => {
  quiet(t); failAudit = true;
  const r = await call('POST', '', draftBody());
  assert.deepEqual([r.status, r.body], [500, { status: 'error', code: 'RECEIPT_ADMIN_ERROR', message: 'Không xử lý được phiếu nhập. Vui lòng thử lại' }]);
  assert.deepEqual([events, db.receipts.length, db.items.length, db.audit.length], [['begin', 'rollback'], 0, 0, 0]);
});

// ---------------- sửa ----------------
test('PUT /:id: staff sửa phiếu nháp admin lập -> 200, thay toàn bộ dòng hàng, 1 dòng RECEIPT_UPDATE chỉ khoá đổi', async () => {
  const rc = await makeDraft();
  actor = STAFF;
  const r = await call('PUT', `/${rc.id}`, draftBody({ note: '', items: [line(5, 52, 12, 90000), line(8, 81, 1, 200000)] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.receipt.items.map(i => [i.variant_id, i.quantity, i.color]), [[52, 12, null], [81, 1, 'Đen']]);
  assert.equal(r.body.receipt.note, null);
  assert.deepEqual(db.items.filter(i => i.receipt_id === rc.id).map(i => i.variant_id), [52, 81], 'dòng cũ bị thay hết');
  const l = oneLog('RECEIPT_UPDATE', rc.id, STAFF);
  assert.deepEqual(Object.keys(l.before).sort(), ['items', 'note']);
  assert.deepEqual([l.before.note, l.after.note], ['Lô đông', null]);
  assert.deepEqual(l.after.items, [{ product_id: 5, variant_id: 52, sku: 'SKU-52', quantity: 12, unit_cost: 90000 },
    { product_id: 8, variant_id: 81, sku: 'SKU-81', quantity: 1, unit_cost: 200000 }]);
  assert.deepEqual(db.locks, ['receipt:' + rc.id], 'không đổi NCC -> không khoá NCC');
});

test('PUT /:id: không đổi gì -> 200, đúng 1 dòng RECEIPT_UPDATE {} / {}', async () => {
  const rc = await makeDraft();
  const r = await call('PUT', `/${rc.id}`, draftBody());
  assert.equal(r.status, 200);
  const l = oneLog('RECEIPT_UPDATE', rc.id);
  assert.deepEqual([l.before, l.after], [{}, {}]);
});

test('PUT /:id: giữ NCC cũ đã ngừng -> 200; đổi sang NCC đã ngừng -> 409; đổi sang NCC đang hợp tác -> 200 (có khoá NCC mới)', async () => {
  const rc = await makeDraft();
  db.suppliers.find(s => s.id === 1).is_active = false;
  const keep = await call('PUT', `/${rc.id}`, draftBody({ note: 'giữ NCC cũ' }));
  assert.equal(keep.status, 200, JSON.stringify(keep.body));
  assert.deepEqual([db.locks, logs('RECEIPT_UPDATE').length], [['receipt:' + rc.id], 1]);
  reset();
  const toInactive = await call('PUT', `/${rc.id}`, draftBody({ supplier_id: 2 }));
  assert.deepEqual([toInactive.status, toInactive.body.code, db.audit.length, events], [409, 'RECEIPT_SUPPLIER_INACTIVE', 0, ['begin', 'rollback']]);
  reset();
  const toActive = await call('PUT', `/${rc.id}`, draftBody({ supplier_id: 3, note: 'giữ NCC cũ' }));
  assert.equal(toActive.status, 200);
  assert.deepEqual(db.locks, ['receipt:' + rc.id, 'supplier:3']);
  const l = oneLog('RECEIPT_UPDATE', rc.id);
  assert.deepEqual([l.before, l.after], [{ supplier_id: 1 }, { supplier_id: 3 }]);
});

test('PUT /:id: phiếu không còn nháp -> 409 RECEIPT_INVALID_STATE (current_status); không có -> 404; dòng sai -> 409', async () => {
  const rc = await makeDraft();
  await advance(rc.id, ['submit']);
  const r = await call('PUT', `/${rc.id}`, draftBody());
  assert.deepEqual([r.status, r.body.code, r.body.current_status], [409, 'RECEIPT_INVALID_STATE', 'pending']);
  assert.deepEqual([events, db.audit.length], [['begin', 'rollback'], 0]);
  assert.equal((await call('PUT', '/99', draftBody())).status, 404);
  const other = await makeDraft();
  const bad = await call('PUT', `/${other.id}`, draftBody({ items: [line(5, 50)] }));
  assert.deepEqual([bad.status, bad.body.items], [409, [{ index: 0, product_id: 5, variant_id: 50, reason: 'NOT_LEAF' }]]);
  assert.deepEqual(db.items.filter(i => i.receipt_id === other.id).map(i => i.variant_id), [52, 71], 'dòng cũ còn nguyên');
});

// ---------------- gửi duyệt / duyệt / từ chối ----------------
test('submit: draft -> pending, ghi submitted_by; gửi lần 2 -> 409; NCC đã ngừng sau khi lập vẫn gửi được', async () => {
  const rc = await makeDraft();
  db.suppliers.find(s => s.id === 1).is_active = false;
  actor = STAFF;
  const r = await call('POST', `/${rc.id}/submit`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.receipt.status, r.body.receipt.actors.submitted.id, r.body.receipt.supplier.is_active], ['pending', 2, false]);
  const l = oneLog('RECEIPT_SUBMIT', rc.id, STAFF);
  assert.deepEqual([l.before, l.after], [{ status: 'draft' }, { status: 'pending' }]);
  assert.ok(!db.locks.some(x => x.startsWith('supplier')), 'không khoá / kiểm NCC');
  reset();
  const again = await call('POST', `/${rc.id}/submit`);
  assert.deepEqual([again.status, again.body.current_status, db.audit.length], [409, 'pending', 0]);
});

test('submit / approve: dòng không còn là biến thể lá -> 409 chỉ đúng dòng đó, trạng thái giữ nguyên, 0 dòng', async () => {
  const rc = await makeDraft();
  db.colors = db.colors.filter(c => !(c.product_id === 7 && c.color_key === 'den')); // màu bị xoá sau khi lập phiếu
  const s = await call('POST', `/${rc.id}/submit`);
  assert.deepEqual([s.status, s.body.code, s.body.items], [409, 'RECEIPT_ITEMS_INVALID', [{ index: 1, product_id: 7, variant_id: 71, reason: 'NOT_LEAF' }]]);
  assert.equal(db.receipts[0].status, 'draft');
  db.colors.push({ id: 9, product_id: 7, color_key: 'den', label: 'Đen', is_active: true });
  await advance(rc.id, ['submit']);
  db.products.find(p => p.id === 5).size_configured = false; // sản phẩm 5 quay về BASE: biến thể size không còn là lá
  const a = await call('POST', `/${rc.id}/approve`);
  assert.deepEqual([a.status, a.body.items], [409, [{ index: 0, product_id: 5, variant_id: 52, reason: 'NOT_LEAF' }]]);
  assert.deepEqual([db.receipts[0].status, db.audit.length, events], ['pending', 0, ['begin', 'rollback']]);
});

test('approve: staff -> 403 FORBIDDEN (middleware), không chạm SQL; admin duyệt phiếu chính mình lập, NCC đã ngừng vẫn duyệt được', async () => {
  const rc = await makeDraft();
  await advance(rc.id, ['submit']);
  db.suppliers.find(s => s.id === 1).is_active = false;
  actor = STAFF;
  for (const step of ['approve', 'reject']) {
    const r = await call('POST', `/${rc.id}/${step}`, { reason: 'x' });
    assert.deepEqual([r.status, r.body.code], [403, 'FORBIDDEN'], step);
  }
  assert.deepEqual([routeSql, db.audit.length], [[], 0]);
  actor = ADMIN;
  const ok = await call('POST', `/${rc.id}/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.receipt.status, ok.body.receipt.actors.approved.id, ok.body.receipt.actors.created.id], ['approved', 1, 1]);
  const l = oneLog('RECEIPT_APPROVE', rc.id);
  assert.deepEqual([l.before, l.after], [{ status: 'pending' }, { status: 'approved' }]);
  reset();
  assert.deepEqual(await call('POST', `/${rc.id}/approve`).then(x => [x.status, x.body.current_status]), [409, 'approved']);
});

test('reject: bắt buộc lý do (400, không mở tx); pending -> draft, lưu lý do + rejected_by; sửa và gửi lại được', async () => {
  const rc = await makeDraft();
  await advance(rc.id, ['submit']);
  for (const b of [undefined, {}, { reason: '  ' }, { reason: 'x'.repeat(251) }]) expectInvalid(await call('POST', `/${rc.id}/reject`, b), 'reason');
  assert.deepEqual(events, []);
  const r = await call('POST', `/${rc.id}/reject`, { reason: ' Sai giá ' + XSS });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.receipt.status, r.body.receipt.reject_reason, r.body.receipt.actors.rejected.id, r.body.receipt.actors.submitted.id],
    ['draft', 'Sai giá ' + XSS, 1, 1]);
  const l = oneLog('RECEIPT_REJECT', rc.id);
  assert.deepEqual([l.before, l.after], [{ status: 'pending' }, { status: 'draft', reject_reason: 'Sai giá ' + XSS }]);
  reset();
  assert.equal((await call('PUT', `/${rc.id}`, draftBody({ items: [line(5, 52, 1, 80000)] }))).status, 200);
  const again = await call('POST', `/${rc.id}/submit`);
  assert.deepEqual([again.status, again.body.receipt.status, again.body.receipt.reject_reason], [200, 'pending', 'Sai giá ' + XSS],
    'giữ lý do từ chối gần nhất');
  assert.equal((await call('POST', `/${rc.id}/reject`, { reason: 'x' })).status, 200);
  reset();
  assert.equal((await call('POST', `/${rc.id}/reject`, { reason: 'x' })).status, 409, 'đang nháp thì không từ chối được');
});

// ---------------- huỷ ----------------
test('cancel: staff huỷ nháp và phiếu chờ duyệt -> 200, mỗi lần 1 dòng RECEIPT_CANCEL kèm lý do', async () => {
  actor = STAFF;
  for (const steps of [[], ['submit']]) {
    const rc = await makeDraft();
    await advance(rc.id, steps);
    actor = STAFF;
    const r = await call('POST', `/${rc.id}/cancel`, { reason: 'Không cần nữa' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.receipt.status, r.body.receipt.cancel_reason, r.body.receipt.actors.cancelled.id], ['cancelled', 'Không cần nữa', 2]);
    const l = oneLog('RECEIPT_CANCEL', rc.id, STAFF);
    assert.deepEqual([l.before, l.after], [{ status: steps.length ? 'pending' : 'draft' }, { status: 'cancelled', cancel_reason: 'Không cần nữa' }]);
  }
});

test('cancel phiếu approved: staff -> 403 FORBIDDEN + 1 dòng SecurityEvents PERMISSION_DENIED, rollback, 0 dòng; admin -> 200', async () => {
  const rc = await makeDraft();
  await advance(rc.id, ['submit', 'approve']);
  actor = STAFF;
  const r = await call('POST', `/${rc.id}/cancel`, { reason: 'Huỷ' });
  assert.deepEqual([r.status, r.body], [403, { status: 'error', code: 'FORBIDDEN', message: 'Tài khoản không có quyền thực hiện thao tác này' }]);
  const rows = await securityRows(1);
  assert.deepEqual(rows.map(x => [x.event_type, x.status_code, x.method]), [['PERMISSION_DENIED', 403, 'POST']]);
  assert.deepEqual([events, db.audit.length, db.receipts[0].status], [['begin', 'rollback'], 0, 'approved']);
  actor = ADMIN; reset();
  const ok = await call('POST', `/${rc.id}/cancel`, { reason: 'Huỷ' });
  assert.equal(ok.status, 200);
  assert.deepEqual(oneLog('RECEIPT_CANCEL', rc.id).before, { status: 'approved' });
});

test('cancel: thiếu lý do -> 400; đã huỷ -> 409; audit() lỗi -> 500 rollback, trạng thái giữ nguyên', async t => {
  const rc = await makeDraft();
  expectInvalid(await call('POST', `/${rc.id}/cancel`, {}), 'reason');
  quiet(t); failAudit = true;
  const fail = await call('POST', `/${rc.id}/cancel`, { reason: 'x' });
  assert.deepEqual([fail.status, fail.body.code, db.receipts[0].status, events], [500, 'RECEIPT_ADMIN_ERROR', 'draft', ['begin', 'rollback']]);
  failAudit = false;
  await advance(rc.id, ['cancel']);
  for (const step of ['cancel', 'submit', 'approve', 'reject']) {
    const r = await call('POST', `/${rc.id}/${step}`, { reason: 'x' });
    assert.deepEqual([r.status, r.body.current_status], [409, 'cancelled'], step);
  }
  assert.equal((await call('PUT', `/${rc.id}`, draftBody())).status, 409);
  assert.equal(db.audit.length, 0);
});

// ---------------- xem ----------------
test('GET /:id: admin thấy email; staff -> email null ở mọi mốc; user đã xoá -> deleted true; 404 / 400', async () => {
  const rc = await makeDraft(draftBody(), STAFF);
  await advance(rc.id, ['submit']);
  db.users = db.users.filter(u => u.id !== 2); // người lập đã xoá tài khoản
  const a = (await call('GET', `/${rc.id}`)).body.receipt;
  assert.deepEqual(a.actors.created, { id: 2, display_name: null, email: null, deleted: true, at: a.actors.created.at });
  assert.deepEqual([a.actors.submitted.email, a.actors.submitted.display_name], ['admin@example.test', 'Quản trị']);
  actor = STAFF;
  const s = (await call('GET', `/${rc.id}`)).body.receipt;
  assert.deepEqual(s.actors.submitted, { id: 1, display_name: 'Quản trị', email: null, deleted: false, at: a.actors.submitted.at });
  assert.equal((await call('GET', '/99')).body.code, 'RECEIPT_NOT_FOUND');
  expectInvalid(await call('GET', '/abc'), 'id');
});

test('GET /: lọc status / supplier_id / q (mã phiếu); created_by: staff không thấy email; tổng số lượng / tiền', async () => {
  const a = await makeDraft(), b = await makeDraft(draftBody({ supplier_id: 3, items: [line(6, 60, 2, 1000)] }), STAFF), c = await makeDraft();
  await advance(b.id, ['submit']);
  await advance(c.id, ['cancel']);
  const list = async q => (await call('GET', q)).body;
  const all = await list('');
  assert.deepEqual([all.total, all.page, all.limit, all.totalPages, all.receipts.map(r => r.id)], [3, 1, 20, 1, [3, 2, 1]]);
  assert.deepEqual(all.receipts[1], { id: 2, code: 'PN-000002', status: 'pending', supplier: { id: 3, code: 'NCC-003', name: 'Dệt BM', is_active: true },
    item_count: 1, total_quantity: 2, total_cost: 2000, expected_date: '2026-12-05', created_at: all.receipts[1].created_at,
    updated_at: all.receipts[1].updated_at, created_by: { id: 2, display_name: 'Nhân viên', email: 'staff@example.test', deleted: false, at: all.receipts[1].created_at } });
  assert.deepEqual((await list('?status=pending')).receipts.map(r => r.id), [b.id]);
  assert.deepEqual((await list('?status=cancelled')).receipts.map(r => r.id), [c.id]);
  assert.deepEqual((await list('?supplier_id=1')).receipts.map(r => r.id), [c.id, a.id]);
  assert.deepEqual((await list('?q=pn-000002')).receipts.map(r => r.id), [b.id]);
  assert.deepEqual((await list('?q=000')).total, 3);
  assert.deepEqual((await list('?limit=2&page=9')).receipts.map(r => r.id), [a.id]);
  actor = STAFF;
  assert.ok((await list('')).receipts.every(r => r.created_by.email === null));
  for (const [q, field] of [['?status=rejected', 'status'], ['?limit=51', 'limit'], ['?supplier_id=x', 'supplier_id']]) expectInvalid(await call('GET', q), field);
});

test('tiền lớn: 1 dòng 100 cái × 25.000.000 -> total_cost 2.500.000.000 ở chi tiết và danh sách; SQL tính BIGINT', async () => {
  const rc = await makeDraft(draftBody({ items: [line(5, 52, 100, 25000000)] }));
  assert.deepEqual([rc.total_cost, rc.items[0].line_total, rc.total_quantity], [2500000000, 2500000000, 100]);
  const list = (await call('GET', '')).body.receipts.find(r => r.id === rc.id);
  assert.deepEqual([list.total_cost, list.total_quantity], [2500000000, 100]);
  const listSql = routeSql.find(x => x.q.startsWith('DECLARE @total INT = (SELECT COUNT(*) FROM dbo.purchase_receipts r')).q;
  assert.match(listSql, /SUM\(CAST\(i\.quantity AS BIGINT\) \* i\.unit_cost\)/, 'tiền nhân BIGINT, không INT * INT');
  assert.match(listSql, /SUM\(CAST\(i\.quantity AS BIGINT\)\)/);
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'admin-receipts.js'), 'utf8');
  assert.doesNotMatch(src, /SUM\(i\.quantity \* i\.unit_cost\)|i\.quantity \* i\.unit_cost/, 'không còn chỗ nhân INT * INT trong SQL');
});

// ---------------- nhận hàng ----------------
const stockOf = id => db.variants.find(v => v.id === id).stock;
const productStock = id => db.products.find(p => p.id === id).stock;
const variantSum = id => db.variants.filter(v => v.product_id === id).reduce((s, v) => s + v.stock, 0);
async function approvedReceipt(body = draftBody()) {
  const rc = await makeDraft(body);
  await advance(rc.id, ['submit', 'approve']);
  return rc;
}

test('receive (staff): approved -> received, cộng tồn biến thể + sản phẩm, sổ kho PURCHASE_RECEIPT có receipt_id, 1 dòng RECEIPT_RECEIVE', async () => {
  const rc = await approvedReceipt(draftBody({ items: [line(5, 52, 10, 90000), line(7, 71, 4, 150000), line(5, 53, 2, 1000)] }));
  const before = { 52: stockOf(52), 71: stockOf(71), 53: stockOf(53), p5: productStock(5), p7: productStock(7) };
  actor = STAFF;
  const r = await call('POST', `/${rc.id}/receive`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.receipt.status, r.body.receipt.actors.received.id], ['received', 2]);
  assert.deepEqual(r.body.stock_changes, [
    { product_id: 5, variant_id: 52, quantity: 10, stock_before: before[52], stock_after: before[52] + 10 },
    { product_id: 5, variant_id: 53, quantity: 2, stock_before: before[53], stock_after: before[53] + 2 },
    { product_id: 7, variant_id: 71, quantity: 4, stock_before: before[71], stock_after: before[71] + 4 }]);
  assert.deepEqual([productStock(5), productStock(7)], [before.p5 + 12, before.p7 + 4]);
  for (const pid of [5, 7]) assert.equal(productStock(pid), variantSum(pid), 'SUM(variants.stock) = products.stock của sản phẩm ' + pid);
  assert.deepEqual(db.movements.map(m => [m.movement_type, m.receipt_id, m.variant_id, m.quantity_delta, m.reason, m.actor_user_id]), [
    ['PURCHASE_RECEIPT', rc.id, 52, 10, null, 2], ['PURCHASE_RECEIPT', rc.id, 53, 2, null, 2], ['PURCHASE_RECEIPT', rc.id, 71, 4, null, 2]]);
  assert.equal(db.variants.find(v => v.id === 53).is_active, false, 'biến thể đang tắt vẫn nhận, không tự bật lại');
  const l = oneLog('RECEIPT_RECEIVE', rc.id, STAFF);
  assert.deepEqual([l.before, l.after], [{ status: 'approved' }, { status: 'received', stock: r.body.stock_changes }]);
  assert.deepEqual(db.locks, ['receipt:' + rc.id, 'product:5', 'product:7', 'variant:52', 'variant:53', 'variant:71'],
    'khoá phiếu -> sản phẩm tăng dần -> biến thể tăng dần');
  assert.deepEqual(events, ['begin', 'commit']);
});

test('receive: nhận lần 2 -> 409 current_status received, tồn / sổ kho không đổi; phiếu draft / pending / cancelled -> 409', async () => {
  const rc = await approvedReceipt();
  assert.equal((await call('POST', `/${rc.id}/receive`)).status, 200);
  reset();
  const snap = clone([db.variants, db.products, db.movements]);
  const again = await call('POST', `/${rc.id}/receive`);
  assert.deepEqual([again.status, again.body.code, again.body.current_status], [409, 'RECEIPT_INVALID_STATE', 'received']);
  assert.deepEqual([clone([db.variants, db.products, db.movements]), db.audit.length, events], [snap, 0, ['begin', 'rollback']]);
  for (const steps of [[], ['submit'], ['cancel']]) {
    const other = await makeDraft();
    await advance(other.id, steps);
    const x = await call('POST', `/${other.id}/receive`);
    assert.deepEqual([x.status, x.body.code], [409, 'RECEIPT_INVALID_STATE'], JSON.stringify(steps));
  }
  assert.deepEqual([clone([db.variants, db.products, db.movements]), db.audit.length], [snap, 0]);
});

test('receive: dòng không còn là biến thể lá -> 409 RECEIPT_ITEMS_INVALID, không cộng tồn, không sổ kho, vẫn approved', async () => {
  const rc = await approvedReceipt();
  db.colors = db.colors.filter(c => !(c.product_id === 7 && c.color_key === 'den'));
  const snap = clone([db.variants, db.products]);
  const r = await call('POST', `/${rc.id}/receive`);
  assert.deepEqual([r.status, r.body.code, r.body.items], [409, 'RECEIPT_ITEMS_INVALID', [{ index: 1, product_id: 7, variant_id: 71, reason: 'NOT_LEAF' }]]);
  assert.deepEqual([clone([db.variants, db.products]), db.movements.length, db.audit.length, db.receipts[0].status, events],
    [snap, 0, 0, 'approved', ['begin', 'rollback']]);
});

test('receive: tràn INT -> 409 RECEIPT_STOCK_OVERFLOW kèm dòng, rollback toàn bộ', async () => {
  const rc = await approvedReceipt();
  db.variants.find(v => v.id === 71).stock = 2147483647 - 3;
  db.products.find(p => p.id === 7).stock = 2147483647 - 3;
  const snap = clone([db.variants, db.products]);
  const r = await call('POST', `/${rc.id}/receive`);
  assert.deepEqual([r.status, r.body.code, r.body.items], [409, 'RECEIPT_STOCK_OVERFLOW', [{ index: 1, product_id: 7, variant_id: 71 }]]);
  assert.deepEqual([clone([db.variants, db.products]), db.movements.length, db.audit.length, db.receipts[0].status], [snap, 0, 0, 'approved']);
});

test('receive: audit() lỗi -> 500, rollback: tồn, sổ kho, trạng thái đều không đổi', async t => {
  const rc = await approvedReceipt();
  const snap = clone([db.variants, db.products]);
  quiet(t); failAudit = true;
  const r = await call('POST', `/${rc.id}/receive`);
  assert.deepEqual([r.status, r.body.code], [500, 'RECEIPT_ADMIN_ERROR']);
  assert.deepEqual([clone([db.variants, db.products]), db.movements.length, db.receipts[0].status, events],
    [snap, 0, 'approved', ['begin', 'rollback']]);
});

test('receive: chạm UNIQUE (receipt_id, variant_id) của sổ kho -> 409 RECEIPT_INVALID_STATE, rollback', async () => {
  const rc = await approvedReceipt();
  db.movements.push({ product_id: 7, variant_id: 71, receipt_id: rc.id, movement_type: 'PURCHASE_RECEIPT', quantity_delta: 4 });
  const snap = clone([db.variants, db.products]);
  const r = await call('POST', `/${rc.id}/receive`);
  assert.deepEqual([r.status, r.body.code, r.body.message, r.body.current_status], [409, 'RECEIPT_INVALID_STATE', 'Phiếu nhập đã được nhận hàng', 'approved']);
  assert.deepEqual([clone([db.variants, db.products]), db.movements.length, db.audit.length, db.receipts[0].status], [snap, 1, 0, 'approved']);
});

test('customer: mọi route -> 403 ở cổng chung, không chạm SQL', async () => {
  actor = CUSTOMER;
  for (const [m, p] of [['GET', ''], ['GET', '/1'], ['POST', ''], ['PUT', '/1'], ['POST', '/1/submit'], ['POST', '/1/approve'],
    ['POST', '/1/reject'], ['POST', '/1/cancel'], ['POST', '/1/receive']]) {
    assert.equal((await call(m, p, m === 'GET' ? undefined : {})).status, 403, m + p);
  }
  assert.deepEqual(routeSql, []);
});
