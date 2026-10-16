'use strict';

// Real Express routers + middleware over HTTP. Only Firebase and SQL I/O are
// substituted; no credentials, production records or external services are used.
// SQL assertions check predicates/parameters, NOT SQL Server lock semantics.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realSql = require('mssql');

let state;
const customer = () => ({ id: 1, firebase_uid: 'user-a', email: 'a@example.test', role: 'customer' });
function result(rows = [], affected = rows.length) { return { recordset: rows, rowsAffected: [affected] }; }
class Transaction {
  async begin() { this.active = true; state.events.push('begin'); }
  async commit() { this.active = false; state.events.push('commit'); }
  async rollback() { this.active = false; state.events.push('rollback'); }
}
class Request {
  constructor(tx) { this.tx = tx; this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(query) {
    const q = query.replace(/\s+/g, ' ').trim();
    const p = this.params;
    state.queries.push({ q, p, tx: this.tx });
    if (q.startsWith('SELECT id FROM dbo.users WITH')) {
      assert.ok(this.tx.active);
      assert.match(q, /WITH \(UPDLOCK, HOLDLOCK\) WHERE firebase_uid = @uid/);
      state.events.push('user-lock');
      if (state.onUserLock) await state.onUserLock();
      return result(state.user ? [{ id: state.user.id }] : []);
    }
    if (q.startsWith('MERGE dbo.users')) {
      if (state.syncError) throw Object.assign(new Error('SQL private detail'), { code: 'EQUERY' });
      assert.equal(p.uid, state.decoded.uid);
      assert.equal(p.email, state.decoded.email || null);
      assert.ok(!Object.hasOwn(p, 'role'));
      state.events.push('upsert');
      if (!state.user) state.user = { ...customer(), firebase_uid: p.uid };
      return result([{ ...state.user }]);
    }
    if (q.startsWith("UPDATE dbo.users SET role = 'admin'")) {
      state.user.role = 'admin';
      return result([{ ...state.user }]);
    }
    if (state.routeQuery) return state.routeQuery(q, p, this.tx);
    throw new Error('Unexpected SQL in test: ' + q);
  }
}
const pool = { request: () => new Request() };
const firebase = {
  async verifyIdToken(token, checkRevoked) {
    state.verifications.push({ token, checkRevoked });
    state.events.push('verify');
    let code = state.tokenError || (state.deleted ? 'auth/user-not-found' : null);
    // Match the SDK boundary: signature/expiry errors always reject; account
    // state and revocation are only consulted when checkRevoked is enabled.
    if (['auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(code) && !checkRevoked) code = null;
    if (code) throw Object.assign(new Error('PRIVATE_TOKEN_OR_CREDENTIAL_DETAIL'), { code });
    return { ...state.decoded };
  },
  async deleteUser(uid) {
    assert.equal(uid, 'user-a');
    state.events.push('firebase-delete');
    if (state.deleteError) throw Object.assign(new Error('delete failed'), { code: 'auth/internal-error' });
    state.deleted = true;
  },
};

// Dependency substitution is confined to this isolated test process.
require.cache[require.resolve('../db')] = { exports: {
  getPool: async () => { state.poolCalls++; if (state.onPool) await state.onPool(); return pool; },
  sql: { ...realSql, Transaction, Request },
} };
require.cache[require.resolve('../firebase')] = { exports: {
  getAuth: () => firebase,
  verifyPassword: async (email, password) => {
    state.passwordChecks.push({ email, password });
    return { ok: state.passwordOK };
  },
} };

const app = express();
app.use(express.json());
for (const [url, file] of [
  ['/api/me', 'me'], ['/api/admin', 'admin'], ['/api/orders', 'orders'],
  ['/api/products', 'products'],
  ['/api/cart', 'cart'], ['/api/vouchers', 'vouchers'],
  ['/api/account/addresses', 'addresses'], ['/api/account/payment-methods', 'payments'],
  ['/api/account/privacy-settings', 'privacy'], ['/api/account', 'account'],
]) app.use(url, require('../routes/' + file));
let server, base;
const savedAdmins = process.env.ADMIN_EMAILS;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = savedAdmins;
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  process.env.ADMIN_EMAILS = '';
  state = {
    user: customer(), decoded: { uid: 'user-a', email: 'a@example.test', name: 'A', email_verified: true },
    queries: [], events: [], verifications: [], poolCalls: 0, passwordChecks: [], passwordOK: true,
  };
});
async function call(path, { method = 'GET', body, token = 'active-token', headers = {} } = {}) {
  const response = await fetch(base + path, {
    method, headers: { ...(token == null ? {} : { Authorization: 'Bearer ' + token }),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

for (const path of ['/api/me', '/api/admin/users', '/api/orders', '/api/cart',
  '/api/account/addresses', '/api/account/payment-methods', '/api/account/privacy-settings']) {
  test('missing token -> 401: ' + path, async () => {
    assert.equal((await call(path, { token: null })).status, 401);
    assert.equal(state.poolCalls, 0);
  });
}
test('cancel order requires Firebase ID token before SQL', async () => {
  const r = await call('/api/orders/7/cancel', { method: 'POST', token: null, body: { reason: 'wrong_item' } });
  assert.equal(r.status, 401);
  assert.equal(state.poolCalls, 0);
});
for (const code of ['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired',
  'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found']) {
  test(code + ' -> 401 before SQL, no internal details', async (t) => {
    const logs = [];
    t.mock.method(console, 'warn', (...args) => logs.push(args.join(' ')));
    t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
    state.tokenError = code;
    const r = await call('/api/me');
    assert.equal(r.status, 401);
    assert.equal(state.poolCalls, 0);
    assert.equal(state.verifications[0].checkRevoked, true);
    assert.doesNotMatch(JSON.stringify(r.body) + logs.join(' '), /PRIVATE_TOKEN|active-token/);
  });
}
test('active session continues with revocation checking and database role', async () => {
  const r = await call('/api/me');
  assert.equal(r.status, 200);
  assert.equal(r.body.id, 1);
  assert.equal(r.body.role, 'customer');
  assert.deepEqual(state.verifications, [{ token: 'active-token', checkRevoked: true }]);
  assert.deepEqual(state.events, ['verify', 'begin', 'user-lock', 'upsert', 'commit']);
});
test('new SQL user is checked again under a transaction lock before insertion', async () => {
  state.user = null;
  assert.equal((await call('/api/me')).status, 200);
  assert.deepEqual(state.events, ['verify', 'begin', 'user-lock', 'verify', 'upsert', 'commit']);
  assert.ok(state.verifications.every((v) => v.checkRevoked === true));
});
test('deletion between initial verification and SQL lock cannot recreate SQL user', async (t) => {
  t.mock.method(console, 'warn', () => {});
  state.onPool = () => { state.user = null; state.deleted = true; };
  assert.equal((await call('/api/me')).status, 401);
  assert.equal(state.user, null);
  assert.ok(!state.events.includes('upsert'));
  assert.equal(state.events.at(-1), 'rollback');
});
test('SQL failure fails closed without publishing identity or raw error', async (t) => {
  t.mock.method(console, 'error', () => {});
  state.syncError = true;
  const r = await call('/api/me');
  assert.equal(r.status, 500);
  assert.doesNotMatch(JSON.stringify(r.body), /SQL private|firebase_uid/);
  assert.equal(state.events.at(-1), 'rollback');
});

const forged = { role: 'admin', role_id: 1, admin: true, isAdmin: true, user_id: 2, firebase_uid: 'user-b' };
test('customer cannot call admin mutation with forged body/query/header role', async () => {
  const r = await call('/api/admin/products?role=admin&user_id=2', {
    method: 'POST', body: forged, headers: { 'X-Role': 'admin', 'X-User-Id': '2' },
  });
  assert.equal(r.status, 403);
  assert.equal(state.user.role, 'customer');
  assert.ok(state.queries.every((x) => x.q.includes('dbo.users')));
});
test('SQL admin is allowed into admin routes', async () => {
  state.user.role = 'admin';
  state.routeQuery = (q) => {
    if (q.includes('COUNT(*)')) return result([{ total: 0 }]);
    assert.match(q, /FROM dbo.users ORDER BY/);
    return result([]);
  };
  assert.equal((await call('/api/admin/users')).status, 200);
});
test('admin delete always archives even a product with no order references', async () => {
  state.user.role = 'admin';
  let archived = false;
  state.routeQuery = (q, p) => {
    assert.equal(p.id, 51);
    if (q.includes('FROM dbo.products p') && q.includes('WHERE p.id = @id')) {
      return result([{ id: 51, name_vi: 'Archived item' }]);
    }
    if (q.startsWith('UPDATE dbo.products SET is_active = 0')) {
      archived = true;
      return result([], 1);
    }
    if (q.startsWith('UPDATE dbo.product_variants SET is_active = 0')) return result([], 1);
    throw new Error('Unexpected product deletion SQL: ' + q);
  };
  const r = await call('/api/admin/products/51', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, 'soft');
  assert.equal(archived, true);
  assert.ok(state.queries.every(x => !x.q.startsWith('DELETE FROM dbo.products')));
});
test('inactive product detail is not returned to a customer', async () => {
  state.routeQuery = (q, p) => {
    assert.equal(p.id, 51);
    assert.match(q, /WHERE p.id = @id AND p.is_active = 1/);
    return result([]);
  };
  const r = await call('/api/products/51');
  assert.equal(r.status, 404);
});
test('customer catalog and category search select active products only', async () => {
  state.routeQuery = (q, p) => {
    assert.match(q, /WHERE p.is_active = 1/);
    assert.equal(p.category, 'nhan');
    return result([]);
  };
  const r = await call('/api/products?category=nhan');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, []);
});
test('unverified allowlisted email is not promoted, even with forged verified field', async () => {
  process.env.ADMIN_EMAILS = 'a@example.test';
  state.decoded.email_verified = false;
  const r = await call('/api/admin/products', { method: 'POST', body: { ...forged, email_verified: true } });
  assert.equal(r.status, 403);
});
test('verified server allowlisted email retains existing admin bootstrap', async () => {
  process.env.ADMIN_EMAILS = ' A@EXAMPLE.TEST ';
  const r = await call('/api/me');
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'admin');
});
test('profile update only writes allowed fields for verified UID', async () => {
  state.routeQuery = (q, p) => {
    assert.match(q, /WHERE firebase_uid = @uid/);
    assert.equal(p.uid, 'user-a');
    assert.deepEqual(Object.keys(p).sort(), ['country', 'dob', 'gender', 'phone', 'uid']);
    assert.doesNotMatch(q.split('WHERE')[0], /SET role|firebase_uid\s*=/);
    return result([state.user]);
  };
  const r = await call('/api/me', { method: 'PUT', body: { ...forged, phone: '0901234567' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'customer');
});
for (const own of [false, true]) {
  test('order detail ownership: ' + (own ? 'owner allowed' : 'other user rejected'), async () => {
    state.routeQuery = (q, p) => {
      if (q.includes('FROM dbo.orders')) {
        assert.match(q, /WHERE id = @id AND user_id = @uid/);
        assert.equal(p.uid, 1);
        assert.equal(p.id, 22);
        return result(own ? [{ id: 22, user_id: 1 }] : []);
      }
      assert.ok(own);
      assert.match(q, /FROM dbo.(order_items|payment_transactions)/);
      return result([]);
    };
    assert.equal((await call('/api/orders/22?user_id=2&firebase_uid=user-b')).status, own ? 200 : 404);
  });
}
for (const [resource, table, body] of [
  ['addresses', 'delivery_addresses', { recipient_name: 'A', phone: '0901234567', line1: 'Street', city: 'City' }],
  ['payment-methods', 'payment_methods', { holder_name: 'A', exp_month: 12, exp_year: 2099 }],
]) {
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    test(method + ' other user ' + resource + ' -> 404 before mutation', async () => {
      state.routeQuery = (q, p) => {
        assert.ok(q.includes('dbo.' + table));
        assert.match(q, /WHERE id = @id AND user_id = @uid/);
        assert.equal(p.uid, 1);
        assert.equal(p.id, 22);
        // SQL contract: no record matches (id=22, owner=1), since owner is 2.
        return result([], 0);
      };
      const r = await call('/api/account/' + resource + '/22' + (method === 'PATCH' ? '/default' : ''), {
        method, body: { ...body, ...forged },
      });
      assert.equal(r.status, 404);
      assert.equal(state.queries.filter((x) => x.q.includes('dbo.' + table)).length, 1);
    });
  }
}
test('privacy owner and fields cannot be overridden by request', async () => {
  state.routeQuery = (q, p) => {
    assert.match(q, /ON target.user_id = src.user_id/);
    assert.equal(p.uid, 1);
    assert.deepEqual(Object.keys(p).sort(), ['allow_marketing_email', 'show_profile_public', 'uid']);
    return result([{ show_profile_public: true }]);
  };
  assert.equal((await call('/api/account/privacy-settings', {
    method: 'PATCH', body: { ...forged, show_profile_public: true },
  })).status, 200);
});
test('cart quantity tampering is rejected before cart mutation', async () => {
  for (const quantity of [-1, 0, 100, 1.5, 2147483647]) {
    assert.equal((await call('/api/cart', { method: 'POST', body: { product_id: 5, quantity, ...forged } })).status, 400);
  }
  assert.ok(state.queries.every((x) => x.q.includes('dbo.users')));
});
test('admin cannot bypass checkout UI to place an order', async () => {
  state.user.role = 'admin';
  assert.equal((await call('/api/orders', { method: 'POST', body: { role: 'customer', paymentMethod: 'cod' } })).status, 403);
  assert.ok(state.queries.every((x) => x.q.includes('dbo.users')));
});
test('blacklist comes from SQL, not request privilege flags', async () => {
  state.user.is_blacklisted = true;
  for (const path of ['/api/orders', '/api/cart']) {
    assert.equal((await call(path, { method: 'POST', body: { ...forged, is_blacklisted: false, paymentMethod: 'cod' } })).status, 403);
  }
});
test('order prices, discount, stock, owner and status come from server data', async () => {
  const writes = [];
  state.routeQuery = (q, p) => {
    if (q.startsWith('UPDATE dbo.order_code_counter')) return result([{ order_code: 1001 }]);
    if (q.startsWith('SELECT') && q.includes('FROM dbo.cart_items')) {
      assert.match(q, /WITH \(UPDLOCK, HOLDLOCK, INDEX\(IX_cart_items_user\)\)/);
      assert.match(q, /WHERE ci.user_id = @uid/);
      assert.equal(p.uid, 1);
      return result([{ product_id: 5, variant_id: 50, quantity: 2 }]);
    }
    if (q.includes('FROM dbo.products p WITH')) {
      assert.match(q, /CASE WHEN p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END/);
      assert.equal(p.pid, 5);
      return result([{ name_vi: 'Product', is_active: true, unit_price: 100000 }]);
    }
    if (q.includes('FROM dbo.product_variants v WITH')) {
      assert.deepEqual(p, { pid: 5, vid: 50 });
      return result([{ stock: 10, is_active: true, is_base: true, size: null, color: null }]);
    }
    if (q.includes('SELECT COUNT(*)')) { assert.equal(p.uid, 1); return result([{ c: 0 }]); }
    if (q.startsWith('INSERT INTO dbo.orders')) {
      assert.match(q, /VALUES \(@uid, 'pending', @total/);
      writes.push({ q, p });
      return result([{ id: 9, status: 'pending', total_amount: p.total, VoucherCode: p.vcode, DiscountAmount: p.discount, PaymentMethod: p.pmethod }]);
    }
    if (q.startsWith('INSERT INTO dbo.payment_transactions')) {
      assert.match(q, /PaymentMethod, total_amount FROM dbo.orders WHERE id = @oid/);
      assert.deepEqual(p, { oid: 9 });
      return result([{ id: 1, order_id: 9, transaction_code: 'PAY-1001-001', payment_method: 'cod',
        amount: writes[0].p.total, status: 'pending', created_at: '2026-10-11T00:00:00Z', paid_at: null }]);
    }
    if (q.startsWith('INSERT INTO dbo.order_items')) { writes.push({ q, p }); return result([], 1); }
    if (q.startsWith('UPDATE dbo.products')) {
      assert.match(q, /stock = stock - @qty/);
      assert.match(q, /stock >= @qty/);
      assert.match(q, /is_active = 1/);
      assert.deepEqual(p, { pid: 5, qty: 2 });
      return result([], 1);
    }
    if (q.startsWith('UPDATE dbo.product_variants')) {
      assert.match(q, /stock = stock - @qty/);
      assert.deepEqual(p, { pid: 5, vid: 50, qty: 2 });
      return result([{ stock_before: 10, stock_after: 8 }], 1);
    }
    if (q.startsWith('INSERT INTO dbo.inventory_movements')) {
      assert.equal(p.type, 'ORDER_CHECKOUT');
      assert.equal(p.vid, 50);
      assert.deepEqual([p.delta, p.before, p.after, p.oid, p.actor], [-2, 10, 8, 9, 1]);
      return result([], 1);
    }
    assert.match(q, /DELETE FROM dbo.cart_items WHERE user_id = @uid/);
    assert.equal(p.uid, 1);
    return result([], 1);
  };
  const r = await call('/api/orders', { method: 'POST', body: {
    ...forged, ...require('./helpers/shipping'), paymentMethod: 'cod', voucherCode: 'GIAMGIALANDAU', price: 1, unit_price: 1,
    total: 1, total_amount: 1, discountAmount: 999999, stock: 999, status: 'paid',
    items: [{ product_id: 99, quantity: 99, price: 1 }],
  } });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.total_amount, 190000);
  assert.equal(r.body.order.discount_amount, 30000);
  assert.equal(writes[0].p.uid, 1);
  assert.equal(writes[1].p.uprice, 100000);
  assert.equal(writes[1].p.ltotal, 200000);
  assert.equal(writes[1].p.pid, 5);
  assert.equal(writes[1].p.vid, 50);
  assert.equal(writes[1].p.qty, 2);
});
test('voucher validation ignores browser supplied subtotal and discount', async () => {
  state.routeQuery = (q, p) => {
    assert.equal(p.uid, 1);
    if (q.includes('FROM dbo.cart_items')) {
      assert.match(q, /WHERE ci.user_id = @uid/);
      return result([{ subtotal: 200000, item_count: 2 }]);
    }
    assert.match(q, /FROM dbo.orders WHERE user_id = @uid/);
    return result([{ c: 0 }]);
  };
  const r = await call('/api/vouchers/validate', { method: 'POST', body: {
    ...forged, code: 'GIAMGIALANDAU', subtotal: 1, discount: 999999,
  } });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 170000);
});

function accountQueries(q, p) {
  assert.equal(p.uid, 1);
  if (q.includes('SELECT TOP 1')) return result([]);
  if (q.startsWith('DELETE FROM dbo.users')) {
    assert.equal(state.deleted, true, 'Firebase must be deleted BEFORE SQL user');
    state.user = null;
  }
  return result([], 1);
}
test('delete account then replay old token -> 401 and no SQL recreation', async (t) => {
  t.mock.method(console, 'warn', () => {});
  state.routeQuery = accountQueries;
  const r = await call('/api/account', { method: 'DELETE', body: { password: 'test-only', ...forged } });
  assert.equal(r.status, 200);
  assert.deepEqual(state.passwordChecks, [{ email: 'a@example.test', password: 'test-only' }]);
  assert.equal(state.user, null);
  const count = state.queries.length;
  assert.equal((await call('/api/me')).status, 401);
  assert.equal(state.queries.length, count);
  assert.equal(state.user, null);
});
test('Firebase deletion failure leaves SQL user intact', async (t) => {
  t.mock.method(console, 'error', () => {});
  state.deleteError = true;
  state.routeQuery = accountQueries;
  assert.equal((await call('/api/account', { method: 'DELETE', body: { password: 'test-only' } })).status, 500);
  assert.ok(state.user);
  assert.ok(!state.queries.some((x) => x.q.startsWith('DELETE')));
});
test('wrong password cannot delete account', async () => {
  state.passwordOK = false;
  assert.equal((await call('/api/account', { method: 'DELETE', body: { password: 'wrong' } })).status, 401);
  assert.ok(!state.deleted);
  assert.ok(!state.events.includes('firebase-delete'));
});


test('shipping status requires a valid Admin token; body cannot elevate a customer', async () => {
  const body = { shipping_status: 'delivered', role: 'admin', user_id: 99 };
  assert.equal((await call('/api/admin/orders/7/shipping-status', { method: 'PATCH', body, token: null })).status, 401);
  assert.equal((await call('/api/admin/orders/7/shipping-status', { method: 'PATCH', body })).status, 403);
  assert.ok(!state.queries.some(x => x.q.includes('dbo.orders')));
});
