'use strict';

// Phân quyền /api/admin: requireBackOffice (cổng chung) + requirePermission (từng route),
// ghi SecurityEvents 1 dòng/lần chặn, /api/me trả permissions. Router + middleware thật qua
// HTTP; chỉ thay Firebase và SQL (cùng kiểu admin-reviews.test.js).
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

let state;
const result = (rows = [], affected = rows.length) => ({ recordset: rows, rowsAffected: [affected] });
class Transaction { async begin() {} async commit() {} async rollback() {} }
class Request {
  constructor() { this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(raw) {
    const q = raw.replace(/\s+/g, ' ').trim(), p = this.params;
    if (q.startsWith('SELECT id FROM dbo.users WITH')) return result([{ id: 99 }]);
    if (q.startsWith('MERGE dbo.users')) {
      return result([{ id: 99, firebase_uid: 'perm-test', email: 'staff@example.test', display_name: 'NV',
        role: state.role, created_at: null, last_login: null, phone: null, dob: null, gender: null,
        country: null, avatar_url: null, is_blacklisted: false }]);
    }
    if (q.startsWith('INSERT INTO dbo.SecurityEvents')) { state.security.push({ ...p }); return result([]); }
    state.routeQueries.push(q);
    if (q.startsWith('SELECT COUNT(*) AS total FROM dbo.orders o')) return result([{ total: 0 }]);
    if (q.startsWith('SELECT o.id, o.order_code')) return result([]);
    if (q.startsWith('SELECT id, role FROM dbo.users WHERE id = @uid')) {
      return result(state.target ? [{ id: p.uid, role: state.target }] : []);
    }
    if (q.startsWith("SELECT TOP 1 id FROM dbo.orders WHERE user_id = @uid AND status = 'cancelled'")) return result([]);
    // GET /users/:id/detail: hồ sơ theo state.people[id], rồi thống kê + lịch sử đơn (rỗng).
    if (q.startsWith('SELECT id, email, display_name, phone, dob, gender, country, role,')) {
      const person = (state.people || {})[p.uid];
      return result(person ? [{ id: p.uid, email: 'u' + p.uid + '@example.test', display_name: 'U' + p.uid, phone: null, dob: null,
        gender: null, country: null, role: person, created_at: null, last_login: null, is_blacklisted: false }] : []);
    }
    if (q.startsWith('SELECT COUNT(*) AS total_orders')) return result([{ total_orders: 0, completed_orders: 0, cancelled_orders: 0, total_spent: 0 }]);
    if (q.startsWith('SELECT id, order_code, created_at, total_amount')) return result([]);
    throw new Error('Unexpected SQL in test: ' + q);
  }
}
require.cache[require.resolve('../db')] = { exports: {
  sql: { ...realSql, Request, Transaction }, getPool: async () => ({ request: () => new Request() }),
} };
require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ async verifyIdToken(token, revoked) {
  assert.equal(revoked, true);
  if (token !== 'active') throw Object.assign(Error('PRIVATE_TOKEN'), { code: 'auth/invalid-id-token' });
  return { uid: 'perm-test', email: 'staff@example.test', email_verified: false };
} }) } };

const { PERMISSIONS, setPermissionsForTest } = require('../lib/permissions');
const { requireBackOffice, requirePermission } = require('../middleware/requirePermission');
const { verifyFirebaseToken } = require('../middleware/auth');
const adminRouter = require('../routes/admin');
const SUB_ROUTERS = new Map([
  [require('../routes/admin-reviews'), '/reviews'],
  [require('../routes/admin-support'), '/support'],
]);

const app = express();
app.use(require('../middleware/securityLogger').securityLogger);
app.use(express.json());
app.use('/api/admin', adminRouter);
app.use('/api/me', require('../routes/me'));
let server, base;
const savedAdmins = process.env.ADMIN_EMAILS;
before(async () => {
  process.env.ADMIN_EMAILS = '';
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = savedAdmins;
  await new Promise(r => server.close(r));
});
beforeEach(() => { state = { role: 'staff', routeQueries: [], security: [], target: null }; });
afterEach(() => setPermissionsForTest());

async function call(method, path, { token = 'active', body } = {}) {
  const hasBody = !['GET', 'HEAD', 'DELETE'].includes(method);
  const r = await fetch(base + path, { method, headers: {
    ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  }, ...(hasBody ? { body: JSON.stringify(body || {}) } : {}) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) { /* không phải JSON */ }
  return { status: r.status, body: json };
}
// securityLogger ghi fire-and-forget: đợi tới khi đủ số dòng rồi chờ thêm để chắc không có dòng thừa.
async function securityRows(expected) {
  for (let i = 0; i < 50 && state.security.length < expected; i++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 30));
  return state.security;
}

// ---- Liệt kê route của router admin (cả sub-router) và quyền thực tế áp lên từng route ----
function guardOf(fn) { return fn && typeof fn.permission === 'string' ? fn.permission : null; }
function listRoutes(router, prefix = '', inherited = null) {
  const out = [];
  let perm = inherited;
  for (const layer of router.stack) {
    if (layer.route) {
      const own = layer.route.stack.map(l => guardOf(l.handle)).filter(Boolean);
      for (const m of Object.keys(layer.route.methods)) {
        out.push({ method: m.toUpperCase(), path: prefix + layer.route.path, perm: own[0] || perm, own });
      }
    } else if (Array.isArray(layer.handle && layer.handle.stack)) {
      assert.ok(SUB_ROUTERS.has(layer.handle), 'sub-router lạ trong router admin — thêm vào test này');
      out.push(...listRoutes(layer.handle, prefix + SUB_ROUTERS.get(layer.handle), perm));
    } else if (guardOf(layer.handle)) {
      perm = guardOf(layer.handle); // router.use(requirePermission(...)) áp cho các layer phía sau
    }
  }
  return out;
}
const ROUTES = listRoutes(adminRouter);
const key = r => r.method + ' ' + r.path;

// Bảng quyền của plan Phase A — đổi quyền một route phải sửa CẢ route lẫn bảng này.
const EXPECTED = {
  'GET /products': 'product:read',
  'GET /products/:id/inventory-movements': 'product:read',
  'GET /products/:id/sizes': 'product:read',
  'GET /products/:id/colors': 'product:read',
  // 11 route size/màu đăng ký bằng vòng lặp — ngoài bảng plan, đã duyệt: product:write.
  'POST /products/:id/sizes': 'product:write',
  'POST /products/:id/size-allocation': 'product:write',
  'PUT /products/:id/sizes/:variantId': 'product:write',
  'POST /products/:id/colors': 'product:write',
  'PUT /products/:id/colors/:colorId': 'product:write',
  'POST /products/:id/color-sizes': 'product:write',
  'POST /products/:id/color-allocation': 'product:write',
  'PUT /products/:id/color-variants/:variantId': 'product:write',
  'POST /products/:id/colors/:colorId/images': 'product:write',
  'PUT /products/:id/colors/:colorId/images/:imageId': 'product:write',
  'DELETE /products/:id/colors/:colorId/images/:imageId': 'product:write',
  'POST /products': 'product:write',
  'PUT /products/:id': 'product:write',
  'DELETE /products/:id': 'product:delete',
  'GET /orders': 'order:read',
  'PUT /orders/:id/status': 'order:update_status',
  'PATCH /orders/:id/shipping-status': 'order:update_status',
  'DELETE /orders/:id': 'order:delete',
  'GET /blacklist': 'user:read',
  'POST /blacklist/:userId/release': 'user:blacklist_release',   // Phase C: tách khỏi user:blacklist (thêm)
  'GET /stats/anchor': 'dashboard:read',
  'GET /stats': 'dashboard:read',
  'GET /stats/business-report': 'dashboard:read',
  'GET /stats/top-products': 'dashboard:read',
  'GET /stats/order-status': 'dashboard:read',
  'GET /statistics': 'dashboard:read',
  'GET /users': 'user:read',
  'GET /users/:userId/detail': 'user:read',
  'POST /users/:userId/blacklist': 'user:blacklist',
  'GET /reviews/': 'review:moderate',
  'GET /reviews/:reviewId': 'review:moderate',
  'PATCH /reviews/:reviewId/visibility': 'review:moderate',
  'GET /support/events': 'support:reply',
  'GET /support/conversations': 'support:reply',
  'GET /support/conversations/:conversationId/messages': 'support:reply',
  'POST /support/conversations/:conversationId/read': 'support:reply',
  'POST /support/conversations/:conversationId/messages': 'support:reply',
};

test('cổng chung của router admin: verifyFirebaseToken rồi requireBackOffice, trước mọi route', () => {
  const [a, b] = adminRouter.stack;
  assert.equal(a.handle, verifyFirebaseToken);
  assert.equal(b.handle, requireBackOffice);
  assert.ok(!a.route && !b.route);
});

test('MỌI route trong router admin (gồm reviews/support) đều có requirePermission', () => {
  assert.ok(ROUTES.length >= 41, 'liệt kê được ' + ROUTES.length + ' route');
  const missing = ROUTES.filter(r => !r.perm).map(key);
  assert.deepEqual(missing, [], 'route thiếu requirePermission: ' + missing.join(', '));
  for (const r of ROUTES) assert.ok(r.own.length <= 1, key(r) + ' gắn nhiều requirePermission');
});

test('quyền từng route khớp đúng bảng của plan', () => {
  assert.deepEqual(Object.fromEntries(ROUTES.map(r => [key(r), r.perm])), EXPECTED);
});

test('route /products*: GET -> product:read, ghi -> product:write, chỉ DELETE /products/:id -> product:delete', () => {
  const products = ROUTES.filter(r => r.path === '/products' || r.path.startsWith('/products/'));
  assert.equal(products.filter(r => /\/(sizes|size-allocation|colors|color-sizes|color-allocation|color-variants)/.test(r.path)
    && r.method !== 'GET').length, 11, '11 route ghi size/màu');
  for (const r of products) {
    const want = r.method === 'GET' ? 'product:read'
      : key(r) === 'DELETE /products/:id' ? 'product:delete' : 'product:write';
    assert.ok(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method), key(r));
    assert.equal(r.perm, want, key(r));
  }
});

test('negative control: bộ liệt kê bắt được route thiếu quyền và sub-router không gắn quyền', () => {
  const r = express.Router(), sub = express.Router();
  r.use(verifyFirebaseToken, requireBackOffice);
  r.get('/ok', requirePermission('order:read'), (q, s) => s.end());
  r.get('/quen', (q, s) => s.end());
  sub.get('/x', (q, s) => s.end());
  SUB_ROUTERS.set(sub, '/sub');
  try {
    r.use('/sub', sub);
    assert.deepEqual(listRoutes(r).filter(x => !x.perm).map(key), ['GET /quen', 'GET /sub/x']);
  } finally { SUB_ROUTERS.delete(sub); }
});

const concrete = path => '/api/admin' + path.replace(/:[A-Za-z]+/g, '1').replace(/\/$/, '');

for (const r of ROUTES) {
  test('customer -> 403 ở cổng chung, không chạm SQL: ' + key(r), async () => {
    state.role = 'customer';
    const res = await call(r.method, concrete(r.path));
    assert.equal(res.status, 403);
    assert.equal(res.body.status, 'error');
    assert.deepEqual(state.routeQueries, []);
  });
  test('staff thiếu đúng quyền ' + r.perm + ' -> 403 FORBIDDEN, không chạm SQL: ' + key(r), async () => {
    setPermissionsForTest({ admin: PERMISSIONS, staff: PERMISSIONS.filter(p => p !== r.perm) });
    const res = await call(r.method, concrete(r.path));
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { status: 'error', code: 'FORBIDDEN', message: 'Tài khoản không có quyền thực hiện thao tác này' });
    assert.deepEqual(state.routeQueries, []);
  });
}

test('không token / token sai -> 401 trước khi xét quyền', async () => {
  for (const token of [null, 'expired']) assert.equal((await call('GET', '/api/admin/orders', { token })).status, 401);
  assert.deepEqual(state.routeQueries, []);
});

test('customer gọi GET /api/admin/orders -> 403', async () => {
  state.role = 'customer';
  const r = await call('GET', '/api/admin/orders');
  assert.equal(r.status, 403);
  assert.equal(r.body.message, 'Chỉ tài khoản quản trị mới được phép thao tác này');
});

test('staff gọi GET /api/admin/orders -> 200 (ma trận mặc định); admin cũng 200', async () => {
  for (const role of ['staff', 'admin']) {
    state.role = role;
    const r = await call('GET', '/api/admin/orders');
    assert.equal(r.status, 200, role);
    assert.deepEqual([r.body.total, r.body.orders], [0, []]);
  }
});

test('role lạ trong DB (vd "Admin") -> 403, không coi là admin', async () => {
  for (const role of ['Admin', 'STAFF', 'guest', '']) {
    state.role = role;
    assert.equal((await call('GET', '/api/admin/orders')).status, 403, role);
  }
});

test('ma trận quyết định: bỏ order:read của staff -> GET /api/admin/orders 403, admin vẫn 200', async () => {
  setPermissionsForTest({ admin: PERMISSIONS, staff: PERMISSIONS.filter(p => p !== 'order:read') });
  assert.equal((await call('GET', '/api/admin/orders')).status, 403);
  state.role = 'admin';
  assert.equal((await call('GET', '/api/admin/orders')).status, 200);
});

test('route cần user:manage_role: staff 403, admin 200; đổi ma trận thì staff qua được', async () => {
  // Phase A chưa có route nào cần user:manage_role -> dựng route giả bằng middleware thật.
  const fake = express();
  fake.get('/role', (req, res, next) => { req.user = { id: 1, role: req.query.as }; next(); },
    requireBackOffice, requirePermission('user:manage_role'), (req, res) => res.json({ ok: true }));
  const srv = fake.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const url = as => fetch('http://127.0.0.1:' + srv.address().port + '/role?as=' + as).then(r => r.status);
  try {
    assert.equal(await url('staff'), 403);
    assert.equal(await url('admin'), 200);
    assert.equal(await url('customer'), 403);
    setPermissionsForTest({ admin: PERMISSIONS, staff: ['user:manage_role'] });
    assert.equal(await url('staff'), 200);
  } finally { await new Promise(r => srv.close(r)); }
});

test('requirePermission từ chối tên quyền không tồn tại ngay lúc khai báo route', () => {
  assert.throws(() => requirePermission('order:raed'), /permission không tồn tại/);
  assert.throws(() => requirePermission(undefined), /permission không tồn tại/);
});

test('thiếu req.user (sai thứ tự middleware) -> 401, không next()', () => {
  for (const mw of [requireBackOffice, requirePermission('order:read')]) {
    let code = null, nexted = false;
    const res = { locals: {}, status(c) { code = c; return this; }, json() { return this; } };
    const saved = console.error; console.error = () => {};
    try { mw({}, res, () => { nexted = true; }); } finally { console.error = saved; }
    assert.equal(code, 401);
    assert.equal(nexted, false);
  }
});

test('SecurityEvents: bị chặn do thiếu quyền -> đúng 1 dòng PERMISSION_DENIED/medium', async () => {
  setPermissionsForTest({ admin: PERMISSIONS, staff: PERMISSIONS.filter(p => p !== 'order:delete') });
  assert.equal((await call('DELETE', '/api/admin/orders/5')).status, 403);
  const rows = await securityRows(1);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].event_type, rows[0].severity, rows[0].status_code, rows[0].method, rows[0].path],
    ['PERMISSION_DENIED', 'medium', 403, 'DELETE', '/api/admin/orders/5']);
});

test('SecurityEvents: customer bị cổng chung chặn -> đúng 1 dòng FORBIDDEN như cũ', async () => {
  state.role = 'customer';
  assert.equal((await call('GET', '/api/admin/orders')).status, 403);
  const rows = await securityRows(1);
  assert.deepEqual(rows.map(r => [r.event_type, r.severity, r.status_code]), [['FORBIDDEN', 'medium', 403]]);
});

test('SecurityEvents: request được phép -> không ghi gì', async () => {
  assert.equal((await call('GET', '/api/admin/orders')).status, 200);
  assert.equal((await securityRows(0)).length, 0);
});

test('blacklist: chặn cả staff lẫn admin (400), customer đi tiếp kiểm tra đơn đã hủy', async () => {
  for (const target of ['staff', 'admin']) {
    state.target = target; state.routeQueries = [];
    const r = await call('POST', '/api/admin/users/7/blacklist');
    assert.equal(r.status, 400, target);
    assert.equal(r.body.message, 'Không thể đưa tài khoản quản trị vào danh sách đen');
    assert.equal(state.routeQueries.length, 1, 'dừng ngay sau khi đọc role');
  }
  state.target = 'customer'; state.routeQueries = [];
  const r = await call('POST', '/api/admin/users/7/blacklist');
  assert.equal(r.body.message, 'Hành Động Không Thành Công');
  assert.equal(state.routeQueries.length, 2);
});

test('GET /api/me trả permissions theo role (đúng thứ tự khai báo)', async () => {
  const expected = {
    admin: [...PERMISSIONS],
    staff: PERMISSIONS.filter(p => !['product:delete', 'order:delete', 'user:view_admin_detail',
      'user:blacklist_release', 'user:manage_role'].includes(p)),
    customer: [],
  };
  for (const [role, perms] of Object.entries(expected)) {
    state.role = role;
    const r = await call('GET', '/api/me');
    assert.equal(r.status, 200);
    assert.equal(r.body.role, role);
    assert.deepEqual(r.body.permissions, perms, role);
  }
});

// ---- Phase C: giới hạn quyền staff — chặn ở BACKEND (gọi thẳng API cũng bị chặn) ----
// "Không bị chặn bởi quyền" = không ra 403 FORBIDDEN và handler đã chạy tới SQL của route.
const blockedByPermission = r => r.status === 403 && r.body && r.body.code === 'FORBIDDEN';

for (const [method, path] of [['DELETE', '/api/admin/products/5'], ['DELETE', '/api/admin/orders/5']]) {
  test('Phase C: staff ' + method + ' ' + path + ' -> 403 FORBIDDEN, không chạm SQL; admin không bị chặn bởi quyền', async () => {
    const r = await call(method, path);
    assert.ok(blockedByPermission(r), JSON.stringify(r));
    assert.deepEqual(state.routeQueries, []);
    state.role = 'admin'; state.routeQueries = [];
    const saved = console.error; console.error = () => {};
    try {
      const a = await call(method, path);
      assert.ok(!blockedByPermission(a), 'admin bị chặn bởi quyền: ' + JSON.stringify(a));
      assert.ok(state.routeQueries.length > 0, 'admin phải chạy tới SQL của route');
    } finally { console.error = saved; }
  });
}

test('Phase C: staff THÊM blacklist không bị chặn bởi quyền; GỠ blacklist -> 403', async () => {
  state.target = 'customer';
  const add = await call('POST', '/api/admin/users/7/blacklist');
  assert.ok(!blockedByPermission(add));
  assert.equal(add.body.message, 'Hành Động Không Thành Công', 'đi tới bước kiểm đơn đã hủy của route');
  state.routeQueries = [];
  const release = await call('POST', '/api/admin/blacklist/7/release');
  assert.ok(blockedByPermission(release), JSON.stringify(release));
  assert.deepEqual(state.routeQueries, []);
});
test('Phase C: admin GỠ blacklist không bị chặn bởi quyền', async () => {
  state.role = 'admin';
  const saved = console.error; console.error = () => {};
  try {
    const r = await call('POST', '/api/admin/blacklist/7/release');
    assert.ok(!blockedByPermission(r));
    assert.ok(state.routeQueries.some(q => q.startsWith('UPDATE dbo.users SET IsBlacklisted = 0')));
  } finally { console.error = saved; }
});

test('Phase C: staff xem chi tiết tài khoản ADMIN -> 404 giống hệt id không tồn tại, dừng trước thống kê/đơn', async () => {
  state.people = { 1: 'admin', 3: 'customer' };
  const denied = await call('GET', '/api/admin/users/1/detail');
  const missing = await call('GET', '/api/admin/users/999/detail');
  assert.deepEqual([denied.status, denied.body], [404, { status: 'error', message: 'Không tìm thấy người dùng' }]);
  assert.deepEqual([denied.status, denied.body], [missing.status, missing.body], 'không phân biệt được admin với id không tồn tại');
  assert.ok(!state.routeQueries.some(q => q.startsWith('SELECT COUNT(*) AS total_orders') || q.startsWith('SELECT id, order_code')),
    'không đọc thống kê/lịch sử đơn của admin');
});
test('Phase C: staff xem chi tiết customer/staff -> 200; admin xem chi tiết admin -> 200', async () => {
  state.people = { 1: 'admin', 3: 'customer', 4: 'staff' };
  for (const id of [3, 4]) {
    const r = await call('GET', '/api/admin/users/' + id + '/detail');
    assert.equal(r.status, 200, 'staff xem id ' + id);
    assert.equal(r.body.user.id, id);
  }
  state.role = 'admin';
  const a = await call('GET', '/api/admin/users/1/detail');
  assert.deepEqual([a.status, a.body.user.role], [200, 'admin']);
});
test('Phase C: role lạ gọi chi tiết admin cũng 404 (chỉ ai có user:view_admin_detail mới xem được)', async () => {
  state.people = { 1: 'admin' };
  setPermissionsForTest({ admin: PERMISSIONS, staff: [...PERMISSIONS] });
  assert.equal((await call('GET', '/api/admin/users/1/detail')).status, 200, 'staff được cấp quyền thì xem được — quyền quyết định, không phải tên role');
  setPermissionsForTest({ admin: PERMISSIONS.filter(p => p !== 'user:view_admin_detail'), staff: [] });
  state.role = 'admin';
  assert.equal((await call('GET', '/api/admin/users/1/detail')).status, 404, 'admin bị rút quyền cũng 404');
});
test('Phase C: SecurityEvents — 404 che chi tiết admin ghi đúng 1 dòng PERMISSION_DENIED/medium', async () => {
  state.people = { 1: 'admin' };
  assert.equal((await call('GET', '/api/admin/users/1/detail')).status, 404);
  const rows = await securityRows(1);
  assert.deepEqual(rows.map(r => [r.event_type, r.severity, r.status_code, r.path]),
    [['PERMISSION_DENIED', 'medium', 404, '/api/admin/users/1/detail']]);
});
test('Phase C: SecurityEvents — 404 bình thường (id không tồn tại) vẫn là NOT_FOUND/low', async () => {
  state.people = { 1: 'admin' };
  assert.equal((await call('GET', '/api/admin/users/999/detail')).status, 404);
  const rows = await securityRows(1);
  assert.deepEqual(rows.map(r => [r.event_type, r.severity, r.status_code]), [['NOT_FOUND', 'low', 404]]);
});
test('Phase C: SecurityEvents — admin xem chi tiết admin (200) không ghi gì', async () => {
  state.people = { 1: 'admin' }; state.role = 'admin';
  assert.equal((await call('GET', '/api/admin/users/1/detail')).status, 200);
  assert.equal((await securityRows(0)).length, 0);
});
