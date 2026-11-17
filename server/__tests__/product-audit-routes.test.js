'use strict';

// log sản phẩm qua HTTP: POST/PUT/DELETE /api/admin/products, 1 route size (adjust), 1 route màu (update).
// Router + requireBackOffice/requirePermission + lib/audit.js THẬT; chỉ thay xác thực và SQL (SQL giả có transaction:
// begin chụp bản sao, commit ghi đè, rollback bỏ). INSERT dbo.audit_logs được ghi lại từ đúng tham số audit() gửi.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

const XSS = '<img src=x onerror=alert(1)>';
let db, actor, events, failAudit, onLoad;
const clone = x => structuredClone(x);
const rs = (recordset = [], affected = recordset.length) => ({ recordset, recordsets: [recordset], rowsAffected: [affected] });
class Transaction {
  async begin() { this.data = clone(db); events.push('begin'); }
  async commit() { db = this.data; events.push('commit'); }
  async rollback() { this.data = null; events.push('rollback'); }
}
class Request {
  constructor(tx) { this.tx = tx; this.p = {}; }
  input(name, type, value) { this.p[name] = value; return this; }
  async query(raw) { return handle(raw.replace(/\s+/g, ' ').trim(), this.p, this.tx ? this.tx.data : db, !!this.tx); }
}
const COLS = ['slug', 'name_vi', 'name_en', 'description_vi', 'description_en', 'price', 'sale_price', 'currency', 'images',
  'category_id', 'stock', 'is_active'];
const pickCols = (p, extra = []) => Object.fromEntries([...extra, ...COLS].map(c => [c, p[c]]));
const prod = (d, id) => d.products.find(x => x.id === id);
const configured = (d, p) => ({ size_configured: d.variants.some(v => v.product_id === p.id && !v.is_base && v.size != null) ? 1 : 0,
  color_configured: d.colors.some(c => c.product_id === p.id) ? 1 : 0 });
const catSlug = (d, p) => d.categories.find(c => c.id === p.category_id).slug;
function handle(q, p, d, inTx) {
  if (!d) throw new Error('SQL sau rollback');
  if (q.startsWith('INSERT INTO dbo.audit_logs')) {
    assert.ok(inTx, 'audit phải chạy trong transaction');
    if (failAudit) throw new Error('audit giả lỗi');
    const id = String(d.audit.length + 1);
    d.audit.push({ id, actor_user_id: p.actor_user_id, actor_email: p.actor_email, actor_role: p.actor_role, action: p.action,
      entity_type: p.entity_type, entity_id: p.entity_id, before: p.before_json && JSON.parse(p.before_json),
      after: p.after_json && JSON.parse(p.after_json), before_json: p.before_json, after_json: p.after_json, ip: p.ip });
    return rs([{ id }]);
  }
  // --- POST / PUT / DELETE /products ---
  if (q.startsWith('SELECT p.id, p.slug, p.category_id, c.slug AS category_slug')) { // loadProduct
    const x = prod(d, p.id), out = rs(x ? [{ ...clone(x), category_slug: catSlug(d, x), ...configured(d, x) }] : []);
    if (!inTx && onLoad) { const fn = onLoad; onLoad = null; fn(d); } // giả 1 request khác ghi xen giữa
    return out;
  }
  if (q.startsWith('SELECT 1 FROM dbo.categories')) return rs(d.categories.filter(c => c.id === p.cid).map(() => ({ 1: 1 })));
  if (q.startsWith('INSERT INTO dbo.products')) {
    assert.ok(inTx);
    if (d.products.some(x => x.slug === p.slug)) throw Object.assign(new Error('dup'), { number: 2627 });
    const x = { id: d.nextId++, ...pickCols(p), created_at: 'now', updated_at: 'now' };
    d.products.push(x); return rs([pickCols(x, ['id'])]);
  }
  if (q.startsWith('INSERT INTO dbo.product_variants (product_id, sku, stock, is_active, is_base)')) {
    const v = { id: d.nextId++, product_id: p.pid, sku: p.sku, size: null, color: null, stock: p.stock, is_active: !!p.active, is_base: true };
    d.variants.push(v); return rs([{ id: v.id }]);
  }
  if (q.startsWith('INSERT INTO dbo.inventory_movements')) { d.movements.push({ type: p.type, delta: p.delta }); return rs([], 1); }
  if (q.startsWith('SELECT slug, name_vi, name_en')) { // PUT: dòng khoá UPDLOCK
    assert.match(q, /WITH \(UPDLOCK, HOLDLOCK\)/);
    const x = prod(d, p.id); return rs(x ? [{ ...pickCols(x), ...configured(d, x) }] : []);
  }
  if (q.startsWith('SELECT id, stock FROM dbo.product_variants WITH')) {
    return rs(d.variants.filter(v => v.product_id === p.pid && v.is_base).map(v => ({ id: v.id, stock: v.stock })));
  }
  if (q.startsWith('UPDATE dbo.products SET') && q.includes('OUTPUT INSERTED.slug')) { // PUT: UPDATE động
    const x = prod(d, p.id);
    for (const part of q.slice('UPDATE dbo.products SET '.length, q.indexOf(' OUTPUT ')).split(', ')) {
      const m = part.match(/^(\w+) = @(\w+)$/);
      if (m) x[m[1]] = p[m[2]];
      else if (part === 'stock = stock + @delta') x.stock += p.delta;
    }
    return rs([pickCols(x)]);
  }
  if (q.startsWith('UPDATE dbo.products SET is_active = 0')) { // DELETE (ẩn)
    assert.match(q, /OUTPUT DELETED\.is_active AS was_active/);
    const x = prod(d, p.id); const was = x.is_active; x.is_active = false; return rs([{ was_active: was }]);
  }
  if (q.startsWith('UPDATE dbo.product_variants SET is_active = 0')) {
    for (const v of d.variants) if (v.product_id === p.id) v.is_active = false; return rs([], 1);
  }
  if (q.startsWith('UPDATE dbo.product_variants SET is_active = @active')) {
    for (const v of d.variants) if (v.product_id === p.pid && (!p.active || v.is_base)) v.is_active = !!p.active; return rs([], 1);
  }
  if (q.startsWith('UPDATE dbo.product_variants SET stock = @stock')) {
    const v = d.variants.find(x => x.id === p.vid), was = v.stock; v.stock = p.stock;
    return rs(q.includes('OUTPUT') ? [{ stock_before: was, stock_after: v.stock }] : [], 1);
  }
  // --- changeSizes / changeColors ---
  if (q.startsWith('SELECT p.id, p.slug, p.stock, p.is_active, c.slug AS category_slug')) {
    const x = prod(d, p.pid); return rs(x ? [{ id: x.id, slug: x.slug, stock: x.stock, is_active: x.is_active, category_slug: catSlug(d, x) }] : []);
  }
  if (q.startsWith('SELECT id, size, color, stock, is_active, is_base FROM dbo.product_variants WITH')) {
    return rs(d.variants.filter(v => v.product_id === p.pid).map(({ id, size, color, stock, is_active, is_base }) => ({ id, size, color, stock, is_active, is_base })));
  }
  if (q.startsWith('SELECT id, color_key, label, swatch_hex, is_active FROM dbo.product_colors')) {
    return rs(d.colors.filter(c => c.product_id === p.pid).map(({ product_id, ...c }) => c));
  }
  if (/^UPDATE dbo\.products SET stock ?= ?stock ?\+ ?@delta/.test(q)) { prod(d, p.pid).stock += p.delta; return rs([], 1); }
  if (q.startsWith('UPDATE dbo.product_colors SET label=@label')) {
    Object.assign(d.colors.find(c => c.id === p.cid), { label: p.label, swatch_hex: p.hex, is_active: !!p.active }); return rs([], 1);
  }
  if (q.startsWith('SELECT p.id, p.slug, p.name_vi, p.name_en, p.stock')) { // readSizes
    const x = prod(d, p.pid); return rs([{ id: x.id, slug: x.slug, name_vi: x.name_vi, name_en: x.name_en, stock: x.stock,
      is_active: x.is_active, category_slug: catSlug(d, x), ...configured(d, x) }]);
  }
  if (q.startsWith('SELECT v.id, v.sku, v.size, v.stock')) {
    return rs(d.variants.filter(v => v.product_id === p.pid && v.color == null)
      .map(({ id, sku, size, stock, is_active, is_base }) => ({ id, sku, size, stock, is_active, is_base, last_allocation_quantity: 0 })));
  }
  if (q.startsWith('SELECT p.id, p.name_vi, p.slug, p.stock')) { // readColors
    const x = prod(d, p.pid); return rs([{ id: x.id, name_vi: x.name_vi, slug: x.slug, stock: x.stock, is_active: x.is_active,
      category_slug: catSlug(d, x), ...configured(d, x) }]);
  }
  if (q.startsWith('SELECT v.id, v.sku, v.size, v.color, v.stock')) {
    return rs(d.variants.filter(v => v.product_id === p.pid).map(({ product_id, ...v }) => ({ ...v, last_allocation_quantity: 0 })));
  }
  if (q.startsWith('SELECT i.id, i.color_id, i.image_path')) return rs([]);
  throw new Error('Unexpected SQL: ' + q);
}
require.cache[require.resolve('../db')] = { exports: {
  sql: { ...realSql, Transaction, Request }, getPool: async () => ({ request: () => new Request(null) }),
} };
require.cache[require.resolve('../middleware/auth')] = { exports: {
  verifyFirebaseToken: (req, res, next) => { req.user = actor; next(); },
} };
const app = express();
app.use(express.json());
app.use('/api/admin', require('../routes/admin'));
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
const ADMIN = { id: 1, email: 'admin@example.test', role: 'admin' };
const STAFF = { id: 2, email: 'staff@example.test', role: 'staff' };
const product5 = { id: 5, slug: 'tui-den', category_id: 1, name_vi: 'Túi', name_en: null, description_vi: null, description_en: null,
  price: 100000, sale_price: null, currency: 'VND', images: '["img/ao1.png"]', stock: 7, is_active: true, created_at: 'c', updated_at: 'u' };
beforeEach(() => {
  db = { nextId: 100, audit: [], movements: [],
    categories: [{ id: 1, slug: 'tui-xach' }, { id: 2, slug: 'sanpham-ao' }],
    products: [clone(product5),
      { ...clone(product5), id: 6, slug: 'ao-size', category_id: 2, name_vi: 'Áo', stock: 10, images: null },
      { ...clone(product5), id: 7, slug: 'tui-mau', stock: 3, images: null }],
    variants: [{ id: 50, product_id: 5, sku: 'B5', size: null, color: null, stock: 7, is_active: true, is_base: true },
      { id: 60, product_id: 6, sku: 'B6', size: null, color: null, stock: 4, is_active: true, is_base: true },
      { id: 61, product_id: 6, sku: 'S6', size: 'S', color: null, stock: 6, is_active: true, is_base: false },
      { id: 70, product_id: 7, sku: 'B7', size: null, color: null, stock: 0, is_active: true, is_base: true },
      { id: 71, product_id: 7, sku: 'D7', size: null, color: 'den', stock: 3, is_active: true, is_base: false }],
    colors: [{ id: 3, product_id: 7, color_key: 'den', label: 'Đen', swatch_hex: '#000000', is_active: true }] };
  actor = ADMIN; events = []; failAudit = false; onLoad = null;
});
async function call(method, path, body) {
  const r = await fetch(base + '/api/admin' + path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
}
// mapProduct của routes/admin.js (hợp đồng JSON cũ — route không đổi phần này).
const mapped = (x, extra) => ({ id: x.id, slug: x.slug, category_id: x.category_id, category_slug: extra.category_slug,
  name_vi: x.name_vi, name_en: x.name_en, description_vi: x.description_vi, description_en: x.description_en, price: x.price,
  sale_price: x.sale_price, currency: x.currency, images: x.images ? JSON.parse(x.images) : [], stock: x.stock,
  size_configured: false, color_configured: false, size_kind: 'base-only', is_active: !!x.is_active, created_at: x.created_at, updated_at: x.updated_at });
const quiet = t => t.mock.method(console, 'error', () => {});
const oneRow = (action, who = ADMIN, entityId = '5') => {
  assert.equal(db.audit.length, 1, 'đúng 1 dòng log');
  const r = db.audit[0];
  assert.deepEqual([r.actor_user_id, r.actor_role, r.actor_email, r.action, r.entity_type, r.entity_id, r.ip],
    [who.id, who.role, who.email, action, 'product', entityId, '127.0.0.1']);
  return r;
};

// ---------------- PRODUCT_CREATE ----------------
const newBody = { slug: 'ao-moi', name_vi: XSS, price: 100000, category_id: 1, stock: 20, images: ['img/ao1.png', 'img/ao10.png'] };
for (const who of [ADMIN, STAFF]) {
  test(`PRODUCT_CREATE (${who.role}): 201 JSON như cũ, đúng 1 dòng, before null, after = cột vừa INSERT, XSS nguyên văn`, async () => {
    actor = who;
    const r = await call('POST', '/products', newBody);
    const created = db.products.find(x => x.slug === 'ao-moi');
    assert.deepEqual(r, { status: 201, body: { status: 'ok', product: mapped(created, { category_slug: 'tui-xach' }) } });
    const log = oneRow('PRODUCT_CREATE', who, String(created.id));
    assert.equal(log.before_json, null);
    assert.deepEqual(log.after, { id: created.id, slug: 'ao-moi', name_vi: XSS, name_en: null, description_vi: null, description_en: null,
      price: 100000, sale_price: null, currency: 'VND', category_id: 1, stock: 20, is_active: true, images_count: 2 });
    assert.ok(log.after_json.includes(XSS));
  });
}
test('PRODUCT_CREATE: 400 validate / 400 danh mục / 409 trùng slug / 403 khách -> 0 dòng', async () => {
  assert.equal((await call('POST', '/products', { ...newBody, name_vi: '' })).status, 400);
  assert.equal((await call('POST', '/products', { ...newBody, category_id: 99 })).status, 400);
  assert.deepEqual(await call('POST', '/products', { ...newBody, slug: 'tui-den' }), { status: 409, body: { status: 'error', message: 'slug đã tồn tại' } });
  actor = { id: 3, email: 'c@example.test', role: 'customer' };
  assert.equal((await call('POST', '/products', newBody)).status, 403);
  assert.equal(db.audit.length, 0);
});
test('PRODUCT_CREATE: audit() lỗi -> rollback, không có sản phẩm mới, 500 như cũ', async (t) => {
  quiet(t); failAudit = true; const count = db.products.length;
  assert.deepEqual(await call('POST', '/products', newBody), { status: 500, body: { status: 'error', message: 'Không tạo được sản phẩm' } });
  assert.equal(db.products.length, count); assert.equal(db.audit.length, 0); assert.equal(events.at(-1), 'rollback');
});

// ---------------- PRODUCT_UPDATE ----------------
for (const who of [ADMIN, STAFF]) {
  test(`PRODUCT_UPDATE (${who.role}): 200 JSON như cũ, before/after chỉ cột đổi, XSS nguyên văn`, async () => {
    actor = who;
    const r = await call('PUT', '/products/5', { name_vi: XSS, price: 120000, currency: 'VND' });
    assert.deepEqual(r, { status: 200, body: { status: 'ok', product: mapped(prod(db, 5), { category_slug: 'tui-xach' }) } });
    const log = oneRow('PRODUCT_UPDATE', who);
    assert.deepEqual([log.before, log.after], [{ name_vi: 'Túi', price: 100000 }, { name_vi: XSS, price: 120000 }]);
  });
}
test('PRODUCT_UPDATE: before lấy từ dòng KHOÁ trong tx, không từ lần đọc ngoài tx (có request khác sửa xen giữa)', async () => {
  onLoad = d => { prod(d, 5).name_vi = 'Túi (người khác vừa đổi)'; };
  assert.equal((await call('PUT', '/products/5', { price: 120000 })).status, 200);
  assert.deepEqual([db.audit[0].before, db.audit[0].after], [{ price: 100000 }, { price: 120000 }]);
});
test('PRODUCT_UPDATE: lưu không đổi gì -> vẫn 1 dòng {} / {}; đổi tồn -> có stock + stock_reason', async () => {
  assert.equal((await call('PUT', '/products/5', { name_vi: 'Túi' })).status, 200);
  assert.deepEqual([db.audit[0].before, db.audit[0].after], [{}, {}]);
  assert.equal((await call('PUT', '/products/5', { stock: 9, stock_reason: 'Nhập thêm' })).status, 200);
  assert.deepEqual([db.audit[1].before, db.audit[1].after], [{ stock: 7 }, { stock: 9, stock_reason: 'Nhập thêm' }]);
  assert.deepEqual(db.movements.map(m => m.type), ['ADMIN_ADJUSTMENT']);
});
test('PRODUCT_UPDATE: 404 / 400 (sale > giá, rollback) / 400 không trường hợp lệ -> 0 dòng', async () => {
  assert.equal((await call('PUT', '/products/99', { name_vi: 'x' })).status, 404);
  assert.deepEqual(await call('PUT', '/products/5', { sale_price: 999999 }),
    { status: 400, body: { status: 'error', message: 'sale_price không được lớn hơn price' } });
  assert.equal(events.at(-1), 'rollback');
  assert.equal((await call('PUT', '/products/5', { hack: 1 })).status, 400);
  assert.equal(db.audit.length, 0);
});
test('PRODUCT_UPDATE: audit() lỗi -> rollback, sản phẩm không đổi, 500 như cũ', async (t) => {
  quiet(t); failAudit = true; const original = clone(prod(db, 5));
  assert.deepEqual(await call('PUT', '/products/5', { name_vi: 'Đổi', stock: 1, stock_reason: 'x' }),
    { status: 500, body: { status: 'error', message: 'Không cập nhật được sản phẩm' } });
  assert.deepEqual(prod(db, 5), original); assert.equal(db.movements.length, 0); assert.equal(db.audit.length, 0);
});

// ---------------- PRODUCT_HIDE ----------------
test('PRODUCT_HIDE: 200 JSON như cũ, 1 dòng {is_active:true} -> {is_active:false}; ẩn lại -> 200 như cũ, 0 dòng mới', async () => {
  const ok = { status: 200, body: { status: 'ok', mode: 'soft', message: 'Đã ẩn sản phẩm', product_id: 5 } };
  assert.deepEqual(await call('DELETE', '/products/5'), ok);
  const log = oneRow('PRODUCT_HIDE');
  assert.deepEqual([log.before, log.after], [{ is_active: true }, { is_active: false }]);
  assert.deepEqual(await call('DELETE', '/products/5'), ok);
  assert.equal(db.audit.length, 1);
});
test('PRODUCT_HIDE: staff -> 403 (không có product:delete), 404 -> 0 dòng', async () => {
  actor = STAFF;
  const r = await call('DELETE', '/products/5');
  assert.equal(r.status, 403); assert.equal(r.body.code, 'FORBIDDEN');
  actor = ADMIN;
  assert.equal((await call('DELETE', '/products/99')).status, 404);
  assert.equal(db.audit.length, 0); assert.equal(prod(db, 5).is_active, true);
});
test('PRODUCT_HIDE: audit() lỗi -> rollback, sản phẩm vẫn hiện, 500 như cũ', async (t) => {
  quiet(t); failAudit = true;
  assert.deepEqual(await call('DELETE', '/products/5'), { status: 500, body: { status: 'error', message: 'Không xoá được sản phẩm' } });
  assert.equal(prod(db, 5).is_active, true); assert.ok(db.variants.filter(v => v.product_id === 5).every(v => v.is_active));
});

// ---------------- PRODUCT_VARIANT_CHANGE ----------------
const adjust = { stock: 8, expected_stock: 6, reason: XSS, hacker: 'x', password: 'p' };
for (const who of [ADMIN, STAFF]) {
  test(`PRODUCT_VARIANT_CHANGE size adjust (${who.role}): JSON như cũ, 1 dòng chỉ biến thể bị đụng + product.stock`, async () => {
    actor = who;
    const r = await call('PUT', '/products/6/sizes/61', adjust);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.variants.map(v => [v.id, v.stock]), [[60, 4], [61, 8]]);
    assert.equal(r.body.product.stock, 12);
    const log = oneRow('PRODUCT_VARIANT_CHANGE', who, '6');
    assert.deepEqual(log.before, { action: 'adjust', product: { stock: 10 },
      variants: [{ id: 61, size: 'S', color: null, stock: 6, is_active: true }] });
    assert.deepEqual(log.after, { action: 'adjust', product: { stock: 12 },
      variants: [{ id: 61, size: 'S', color: null, stock: 8, is_active: true }],
      request: { variant_id: 61, stock: 8, expected_stock: 6, reason: XSS } });
  });
}
test('PRODUCT_VARIANT_CHANGE: adjust delta 0 -> 200, 0 dòng; size không tồn tại 404 / sai expected 409 -> 0 dòng', async () => {
  assert.equal((await call('PUT', '/products/6/sizes/61', { stock: 6, expected_stock: 6 })).status, 200);
  assert.equal((await call('PUT', '/products/6/sizes/999', adjust)).status, 404);
  assert.equal((await call('PUT', '/products/6/sizes/61', { ...adjust, expected_stock: 1 })).status, 409);
  assert.equal(db.audit.length, 0);
});
test('PRODUCT_VARIANT_CHANGE size: audit() lỗi -> rollback, tồn không đổi, 500 như cũ', async (t) => {
  quiet(t); failAudit = true;
  assert.deepEqual(await call('PUT', '/products/6/sizes/61', adjust), { status: 500, body: { status: 'error', message: 'Không cập nhật được size' } });
  assert.deepEqual([prod(db, 6).stock, db.variants.find(v => v.id === 61).stock], [10, 6]);
});
test('PRODUCT_VARIANT_CHANGE màu update: 1 dòng chỉ màu bị đổi; audit lỗi -> 500 như cũ, nhãn không đổi', async (t) => {
  const r = await call('PUT', '/products/7/colors/3', { label: 'Đen nhám', note: 'x' });
  assert.equal(r.status, 200); assert.equal(r.body.colors[0].label, 'Đen nhám');
  const log = oneRow('PRODUCT_VARIANT_CHANGE', ADMIN, '7');
  assert.deepEqual([log.before, log.after], [
    { action: 'update', colors: [{ id: 3, label: 'Đen', swatch_hex: '#000000', is_active: true }] },
    { action: 'update', colors: [{ id: 3, label: 'Đen nhám', swatch_hex: '#000000', is_active: true }], request: { color_id: 3, label: 'Đen nhám' } }]);
  quiet(t); failAudit = true;
  assert.deepEqual(await call('PUT', '/products/7/colors/3', { label: 'Đỏ' }), { status: 500, body: { status: 'error', message: 'Không cập nhật được màu' } });
  assert.equal(db.colors[0].label, 'Đen nhám'); assert.equal(db.audit.length, 1);
});
