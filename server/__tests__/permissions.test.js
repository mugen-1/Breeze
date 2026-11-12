'use strict';

// lib/roles.js + lib/permissions.js (ma trận quyền) + đăng ký migration role trong setup-db.js.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROLES, isBackOffice } = require('../lib/roles');
const { PERMISSIONS, permsFor, can, setPermissionsForTest } = require('../lib/permissions');

afterEach(() => setPermissionsForTest());

test('ROLES đúng 3 giá trị, khớp CHECK của migration 023', () => {
  assert.deepEqual([...ROLES], ['customer', 'staff', 'admin']);
  assert.ok(Object.isFrozen(ROLES));
  const sqlText = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '023_staff_role.sql'), 'utf8');
  for (const r of ROLES) {
    assert.match(sqlText, new RegExp("CHECK \\(role COLLATE Latin1_General_CS_AS IN \\([^)]*'" + r + "'"));
  }
});

test('isBackOffice: chỉ admin và staff, so khớp chính xác', () => {
  assert.equal(isBackOffice('admin'), true);
  assert.equal(isBackOffice('staff'), true);
  for (const r of ['customer', 'Admin', 'STAFF', ' admin', 'guest', '', null, undefined, 1, {}]) {
    assert.equal(isBackOffice(r), false, JSON.stringify(r));
  }
});

test('danh sách permission đúng 14 mục (Phase C thêm view_admin_detail, blacklist_release)', () => {
  assert.deepEqual([...PERMISSIONS], ['dashboard:read', 'product:read', 'product:write', 'product:delete',
    'order:read', 'order:update_status', 'order:delete', 'user:read', 'user:view_admin_detail',
    'user:blacklist', 'user:blacklist_release', 'user:manage_role', 'review:moderate', 'support:reply']);
});

// Ma trận Phase C — bảng này cũng là bảng đưa vào khoá luận; đổi quyền phải sửa cả đây.
const STAFF_DENIED = ['product:delete', 'order:delete', 'user:view_admin_detail', 'user:blacklist_release', 'user:manage_role'];
test('admin có tất cả; staff = tất cả trừ 5 quyền Phase C; customer rỗng', () => {
  assert.deepEqual([...permsFor('admin')].sort(), [...PERMISSIONS].sort());
  assert.deepEqual([...permsFor('staff')].sort(), PERMISSIONS.filter(p => !STAFF_DENIED.includes(p)).sort());
  assert.equal(permsFor('customer').size, 0);
  for (const p of STAFF_DENIED) {
    assert.equal(can('admin', p), true, 'admin ' + p);
    assert.equal(can('staff', p), false, 'staff ' + p);
  }
  for (const p of ['dashboard:read', 'product:read', 'product:write', 'order:read', 'order:update_status',
    'user:read', 'user:blacklist', 'review:moderate', 'support:reply']) {
    assert.equal(can('staff', p), true, 'staff vẫn giữ ' + p);
  }
  assert.equal(can('customer', 'order:read'), false);
});

test('quyền staff khai bằng danh sách RÕ (không suy ra từ "tất cả trừ")', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'permissions.js'), 'utf8');
  const staffBlock = src.slice(src.indexOf('staff: Object.freeze(['), src.indexOf('customer: []'));
  assert.ok(staffBlock.length > 0, 'staff khai bằng Object.freeze([...])');
  assert.doesNotMatch(staffBlock, /\.filter\(/, 'không dùng PERMISSIONS.filter — quyền mới phải mặc định staff KHÔNG có');
});

test('role lạ / permission lạ -> không có quyền (đóng mặc định)', () => {
  for (const r of ['guest', 'Admin', '__proto__', 'constructor', '', null, undefined]) {
    assert.equal(permsFor(r).size, 0, String(r));
    assert.equal(can(r, 'dashboard:read'), false, String(r));
  }
  assert.equal(can('admin', 'unknown:perm'), false);
  assert.equal(can('admin', undefined), false);
});

test('permsFor trả Set mới — sửa bản trả về không đổi ma trận', () => {
  const s = permsFor('staff');
  assert.ok(s instanceof Set);
  s.add('user:manage_role');
  permsFor('customer').add('order:read');
  assert.equal(can('staff', 'user:manage_role'), false);
  assert.equal(can('customer', 'order:read'), false);
});

test('setPermissionsForTest thay ma trận, gọi rỗng trả về mặc định', () => {
  setPermissionsForTest({ staff: ['order:read'] });
  assert.equal(can('staff', 'order:read'), true);
  assert.equal(can('staff', 'order:update_status'), false);
  assert.equal(can('admin', 'order:read'), false, 'role không có trong map -> rỗng');
  setPermissionsForTest();
  assert.equal(can('staff', 'order:update_status'), true);
  assert.equal(can('admin', 'user:manage_role'), true);
});

test('setPermissionsForTest từ chối role/permission gõ sai, giữ nguyên ma trận cũ', () => {
  assert.throws(() => setPermissionsForTest({ staf: ['order:read'] }), /role không hợp lệ/);
  assert.throws(() => setPermissionsForTest({ staff: ['order:raed'] }), /permission không hợp lệ/);
  assert.equal(can('staff', 'order:update_status'), true);
});

test('setPermissionsForTest bị chặn khi NODE_ENV=production', () => {
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => setPermissionsForTest({ staff: [] }), /production/);
    assert.equal(can('staff', 'order:read'), true);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved;
  }
});

test('migration 023 idempotent, có SET XACT_ABORT + TRY/CATCH như 022', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '023_staff_role.sql'), 'utf8');
  assert.match(s, /^SET XACT_ABORT ON;$/m);
  assert.match(s, /BEGIN TRY\s+BEGIN TRANSACTION;/);
  assert.match(s, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;\s+END CATCH;/);
  // Kiểm tra trước và CHECK phải cùng điều kiện (phân biệt hoa/thường + không dấu cách cuối),
  // không thì dữ liệu bẩn lọt qua bước kiểm rồi mới vỡ ở ALTER.
  assert.match(s, /IF EXISTS \(SELECT 1 FROM dbo\.users\s+WHERE role COLLATE Latin1_General_CS_AS NOT IN \('customer', 'staff', 'admin'\)\s+OR DATALENGTH\(role\) <> LEN\(role\)\)\s+THROW/);
  assert.match(s, /CHECK \(role COLLATE Latin1_General_CS_AS IN \('customer', 'staff', 'admin'\)\s+AND DATALENGTH\(role\) = LEN\(role\)\);/);
  assert.match(s, /IF NOT EXISTS \(SELECT 1 FROM sys\.check_constraints\s+WHERE name = 'CK_users_role'/);
  assert.doesNotMatch(s, /\bUPDATE\b|\bDELETE\b|\bDROP\b/i, 'không sửa/xoá dữ liệu');
});

test('setup-db --before-variants bỏ qua 012..023 (chain test chạy riêng), vẫn chạy 011', () => {
  const setup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');
  const m = setup.match(/if \(BEFORE_VARIANTS && (\/.+\/)\.test\(step\.file\)\)/);
  assert.ok(m, 'không tìm thấy regex BEFORE_VARIANTS');
  const re = new RegExp(m[1].slice(1, -1));
  for (let n = 12; n <= 23; n++) {
    assert.ok(re.test(`db/migrations/0${n}_x.sql`), `0${n} phải bị bỏ qua`);
  }
  for (const f of ['001_cart_items', '010_product_order_integrity', '011_inventory_movements']) {
    assert.ok(!re.test(`db/migrations/${f}.sql`), f + ' vẫn phải chạy');
  }
});

test('setup-db.js đăng ký MỌI migration đánh số (gồm 022, 023), đúng thứ tự', () => {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const setup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');
  const numbered = fs.readdirSync(dir).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();
  assert.ok(numbered.includes('022_security_events.sql') && numbered.includes('023_staff_role.sql'));
  const positions = numbered.map(f => {
    const at = setup.indexOf(`file: 'db/migrations/${f}'`);
    assert.ok(at >= 0, 'setup-db.js thiếu ' + f);
    return at;
  });
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'migration đánh số phải theo thứ tự tăng');
});

test('set-role.js lấy danh sách role hợp lệ từ lib/roles.js (gồm staff)', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'db', 'set-role.js'), 'utf8');
  assert.match(s, /const \{ ROLES: VALID_ROLES \} = require\('\.\.\/lib\/roles'\);/);
  assert.doesNotMatch(s, /VALID_ROLES = \[/, 'không chép lại danh sách role');
});
