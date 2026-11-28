'use strict';

// lib/suppliers.js (chuẩn hoá + kiểm dữ liệu khớp CHECK của 029, query danh sách) + lib/supplier-audit.js.
// Route + SQL giả: admin-suppliers-routes.test.js; SQL thật: scripts/verify-audit-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../lib/suppliers');
const A = require('../lib/supplier-audit');

const XSS = '<img src=x onerror=alert(1)>';
const create = body => S.parseSupplierCreate(body).values;
const fails = (fn, field, code = 'SUPPLIER_INVALID_INPUT') => assert.throws(fn, e => {
  assert.ok(e instanceof S.SupplierError, 'phải là SupplierError: ' + e);
  assert.deepEqual([e.status, e.code, e.field], [400, code, field]);
  assert.ok(typeof e.message === 'string' && e.message.length > 0);
  return true;
});
const bad = (body, field) => fails(() => S.parseSupplierCreate(body), field);
const base = (over = {}) => ({ code: 'NCC-001', name: 'Công ty A', ...over });

test('tạo: chỉ code + name -> tuỳ chọn đều null; code trim + chữ hoa; name trim', () => {
  assert.deepEqual(create({ code: '  ncc-001 ', name: '  Công ty A  ' }), { code: 'NCC-001', name: 'Công ty A',
    contact_name: null, phone: null, email: null, address: null, tax_code: null, note: null });
});

test('tạo: đủ trường hợp lệ; phone bỏ dấu cách; XSS lưu nguyên văn', () => {
  const v = create(base({ contact_name: ' Chị B ', phone: ' 090 123 4567 ', email: ' sale@ncc.vn ', address: XSS,
    tax_code: '0312345678-001', note: 'Giao thứ 2' }));
  assert.deepEqual(v, { code: 'NCC-001', name: 'Công ty A', contact_name: 'Chị B', phone: '0901234567', email: 'sale@ncc.vn',
    address: XSS, tax_code: '0312345678-001', note: 'Giao thứ 2' });
  assert.equal(create(base({ name: XSS })).name, XSS);
  assert.equal(create(base({ phone: '+84901234567' })).phone, '+84901234567');
});

test('tuỳ chọn để trống ("" / chỉ khoảng trắng / null / không gửi) -> null', () => {
  for (const empty of ['', '   ', null, undefined]) {
    const v = create(base({ contact_name: empty, phone: empty, email: empty, address: empty, tax_code: empty, note: empty }));
    assert.deepEqual([v.contact_name, v.phone, v.email, v.address, v.tax_code, v.note], [null, null, null, null, null, null], String(empty));
  }
});

test('code: ^[A-Z0-9-]{2,20}$ sau trim + chữ hoa; bắt buộc', () => {
  for (const ok of ['AB', 'ncc-1', 'A'.repeat(20), '12', '--']) assert.equal(create(base({ code: ok })).code, ok.toUpperCase());
  for (const v of ['A', 'A'.repeat(21), 'NCC 01', 'NCC_01', 'NCC.01', 'NCCĐ1']) bad(base({ code: v }), 'code');
  // Ký tự ngoài ASCII mà toUpperCase đổi thành ASCII ('ı' -> 'I', 'ß' -> 'SS', 'ſ' -> 'S') vẫn bị chặn.
  for (const v of ['ncc-ı', 'ncc-ß', 'ncc-ſ', 'ıd', 'ßß']) {
    assert.ok(/^[A-Z0-9-]{2,20}$/.test(v.trim().toUpperCase()), 'ca đối chứng: ' + v + ' viết hoa thì lọt regex');
    bad(base({ code: v }), 'code');
  }
  fails(() => S.parseSupplierUpdate({ code: 'ncc-ı' }), 'code');
  for (const v of ['', '   ', null, undefined]) bad(base({ code: v }), 'code');
});

test('name: 1–200 sau trim; bắt buộc', () => {
  assert.equal(create(base({ name: 'x'.repeat(200) })).name.length, 200);
  assert.equal(create(base({ name: ' ' + 'x'.repeat(200) + ' ' })).name.length, 200, 'đếm sau trim');
  bad(base({ name: 'x'.repeat(201) }), 'name');
  for (const v of ['', '   ', null, undefined]) bad(base({ name: v }), 'name');
});

test('độ dài tối đa: contact_name 120, email 255, address 300, note 500', () => {
  for (const [f, max] of [['contact_name', 120], ['address', 300], ['note', 500]]) {
    assert.equal(create(base({ [f]: 'x'.repeat(max) }))[f].length, max);
    bad(base({ [f]: 'x'.repeat(max + 1) }), f);
  }
  const long = 'a'.repeat(243) + '@example.com'; // 255
  assert.equal(create(base({ email: long })).email.length, 255);
  bad(base({ email: 'a' + long }), 'email');
});

test('phone: bỏ dấu cách rồi ^[0-9+]{8,20}$', () => {
  for (const ok of ['12345678', '1'.repeat(20), '+84 90 123 4567', '0901 234 567']) assert.match(create(base({ phone: ok })).phone, /^[0-9+]{8,20}$/);
  for (const v of ['1234567', '1'.repeat(21), '090-123-4567', '090.123.4567', '(090)1234567', '090123456a', '09012345\t67', '０９０１２３４５６７'])
    bad(base({ phone: v }), 'phone');
});

test('email: ASCII, không khoảng trắng, dạng a@b.c', () => {
  for (const ok of ['a@b.c', 'Sale.Team+1@NCC.com.vn']) assert.equal(create(base({ email: ok })).email, ok, 'giữ nguyên hoa/thường');
  for (const v of ['abc', 'a@b', '@b.c', 'a@.c', 'a@b.', 'a b@c.d', 'a@b@c.d', 'tú@ncc.vn', 'a@ncc.việt'])
    bad(base({ email: v }), 'email');
});

test('tax_code: ^[0-9-]{10,14}$', () => {
  for (const ok of ['0312345678', '0312345678-001', '1'.repeat(14)]) assert.equal(create(base({ tax_code: ok })).tax_code, ok);
  for (const v of ['031234567', '1'.repeat(15), '0312345678 001', '031234567A', '0312345678/01']) bad(base({ tax_code: v }), 'tax_code');
});

test('trường không phải chuỗi -> 400 đúng field; body không phải object -> 400', () => {
  for (const f of S.FIELDS) for (const v of [12345678901, true, ['a'], { a: 1 }]) bad(base({ [f]: v }), f);
  for (const body of [[], 'text', 5]) fails(() => S.parseSupplierCreate(body), undefined);
});

test('tạo có is_active -> 400 field is_active, báo dùng PATCH /:id/status', () => {
  for (const v of [true, false, 1]) bad(base({ is_active: v }), 'is_active');
  assert.throws(() => S.parseSupplierCreate(base({ is_active: false })), /PATCH \/api\/admin\/suppliers\/:id\/status/);
  assert.deepEqual(Object.keys(create(base({ id: 9, created_at: 'x', foo: 1 }))), S.FIELDS, 'khoá lạ khác bị bỏ qua');
});

test('sửa: chỉ trường có trong body; tuỳ chọn "" -> null; name / code "" -> 400; is_active -> 400', () => {
  assert.deepEqual(S.parseSupplierUpdate({ name: ' Mới ', phone: '', note: null }), { code: undefined, updates: { name: 'Mới', phone: null, note: null } });
  assert.deepEqual(S.parseSupplierUpdate({}), { code: undefined, updates: {} });
  assert.deepEqual(S.parseSupplierUpdate(undefined), { code: undefined, updates: {} });
  assert.deepEqual(S.parseSupplierUpdate({ code: ' ncc-001 ' }), { code: 'NCC-001', updates: {} });
  for (const v of ['', '  ', null]) {
    fails(() => S.parseSupplierUpdate({ name: v }), 'name');
    fails(() => S.parseSupplierUpdate({ code: v }), 'code');
  }
  fails(() => S.parseSupplierUpdate({ code: 'x y' }), 'code');
  fails(() => S.parseSupplierUpdate({ name: 'OK', is_active: false }), 'is_active');
  assert.throws(() => S.parseSupplierUpdate({ is_active: true }), /PATCH \/api\/admin\/suppliers\/:id\/status/);
  fails(() => S.parseSupplierUpdate({ email: 'sai' }), 'email');
  assert.deepEqual(S.parseSupplierUpdate({ id: 3, created_at: 'x', updated_at: 'y' }).updates, {}, 'khoá lạ bị bỏ qua');
});

test('is_active của PATCH: chỉ boolean thật', () => {
  assert.equal(S.parseStatusInput({ is_active: false }), false);
  assert.equal(S.parseStatusInput({ is_active: true }), true);
  for (const v of [1, 0, 'true', 'false', null, undefined]) fails(() => S.parseStatusInput({ is_active: v }), 'is_active');
  fails(() => S.parseStatusInput(undefined), 'is_active');
});

test('id: số nguyên dương thuần chữ số, tối đa INT', () => {
  assert.equal(S.parseId('5'), 5);
  assert.equal(S.parseId('2147483647'), 2147483647);
  for (const v of ['0', '-1', '05', '1.5', 'abc', '2147483648', ' 5', '', undefined]) fails(() => S.parseId(v), 'id');
});

test('query danh sách: mặc định page 1, limit 20, status all; limit > 50 -> 400; q trim, tối đa 100', () => {
  assert.deepEqual(S.parseListQuery({}), { page: 1, limit: 20, status: 'all', q: null });
  assert.deepEqual(S.parseListQuery(undefined), { page: 1, limit: 20, status: 'all', q: null });
  assert.deepEqual(S.parseListQuery({ page: '3', limit: '50', status: 'inactive', q: '  ncc ' }), { page: 3, limit: 50, status: 'inactive', q: 'ncc' });
  assert.equal(S.parseListQuery({ q: '   ' }).q, null);
  assert.equal(S.parseListQuery({ q: 'x'.repeat(100) }).q.length, 100);
  fails(() => S.parseListQuery({ q: 'x'.repeat(101) }), 'q');
  for (const limit of ['51', '0', '-1', 'abc', '1.5']) fails(() => S.parseListQuery({ limit }), 'limit');
  for (const page of ['0', '-1', 'x', '2147483648']) fails(() => S.parseListQuery({ page }), 'page');
  for (const status of ['ACTIVE', 'x', 'deleted']) fails(() => S.parseListQuery({ status }), 'status');
  for (const name of ['page', 'limit', 'status', 'q']) fails(() => S.parseListQuery({ [name]: ['a', 'b'] }), name);
});

test('mẫu tìm kiếm: thoát % _ [ để khớp nguyên văn; mẫu SĐT bỏ dấu cách', () => {
  assert.equal(S.searchPatterns(null), null);
  assert.deepEqual(S.searchPatterns('50%_[a]'), { text: '%50[%][_][[]a]%', phone: '%50[%][_][[]a]%' });
  assert.deepEqual(S.searchPatterns('090 123'), { text: '%090 123%', phone: '%090123%' });
  assert.equal(S.escapeLike("a'b"), "a'b", 'nháy đơn đi qua tham số, không thoát ở đây');
});

test('DTO: đủ cột, is_active boolean, thời điểm ISO', () => {
  const at = new Date('2026-11-27T01:02:03.004Z');
  assert.deepEqual(S.toSupplierDto({ id: 3, code: 'NCC-1', name: 'A', contact_name: null, phone: '0901234567', email: null,
    address: XSS, tax_code: null, note: null, is_active: 0, created_at: at, updated_at: at, extra: 'bỏ' }),
  { id: 3, code: 'NCC-1', name: 'A', contact_name: null, phone: '0901234567', email: null, address: XSS, tax_code: null,
    note: null, is_active: false, created_at: '2026-11-27T01:02:03.004Z', updated_at: '2026-11-27T01:02:03.004Z' });
});

test('supplier-audit: 9 cột nghiệp vụ, create có id, status chỉ is_active', () => {
  const row = { id: 4, code: 'NCC-1', name: 'A', contact_name: 'B', phone: '0901234567', email: 'a@b.c', address: '12 Test',
    tax_code: '0312345678', note: null, is_active: 1, created_at: new Date(), updated_at: new Date() };
  assert.deepEqual(A.SUPPLIER_COLUMNS, ['code', 'name', 'contact_name', 'phone', 'email', 'address', 'tax_code', 'note', 'is_active']);
  assert.deepEqual(A.supplierColumns(row), { code: 'NCC-1', name: 'A', contact_name: 'B', phone: '0901234567', email: 'a@b.c',
    address: '12 Test', tax_code: '0312345678', note: null, is_active: true });
  assert.deepEqual(A.createSnapshot(row), { id: 4, ...A.supplierColumns(row) });
  assert.deepEqual(A.statusChange(1, false), { before: { is_active: true }, after: { is_active: false } });
});

test('quy tắc kiểm khớp CHECK trong 029 (độ dài cột + mẫu ký tự)', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '029_suppliers_purchase_receipts.sql'), 'utf8');
  for (const [col, type] of [['code', 'VARCHAR\\(20\\)'], ['name', 'NVARCHAR\\(200\\)'], ['contact_name', 'NVARCHAR\\(120\\)'],
    ['phone', 'VARCHAR\\(20\\)'], ['email', 'VARCHAR\\(255\\)'], ['address', 'NVARCHAR\\(300\\)'], ['tax_code', 'VARCHAR\\(20\\)'],
    ['note', 'NVARCHAR\\(500\\)']]) assert.match(s, new RegExp('\\n\\s+' + col + '\\s+' + type), col);
  assert.match(s, /NOT LIKE '%\[\^A-Z0-9-\]%'/);
  assert.match(s, /LEN\(phone\) BETWEEN 8 AND 20[\s\S]*?NOT LIKE '%\[\^0-9\+\]%'/);
  assert.match(s, /LEN\(tax_code\) BETWEEN 10 AND 14[\s\S]*?NOT LIKE '%\[\^0-9-\]%'/);
  assert.match(s, /email LIKE '_%@_%\._%'/);
});
