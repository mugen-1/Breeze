/* Real continuation code; controlled API/storage fixtures, no Firebase/SQL I/O. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { webcrypto } = require('crypto');
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const KEY = 'breeze_buy_now_intent';
const PRODUCT = { id: 8, size_configured: true, color_configured: false, variants: [{ id: 81, size: 'M', available: true }] };
const row = (variant_id, quantity, product_id = 8) => ({ product_id, variant_id, quantity });

function setup(opts = {}) {
  const storage = opts.storage || new Map(), calls = [], events = [];
  const state = { user: { uid: 'A' }, product: PRODUCT, items: (opts.items || []).map(it => ({ ...it })), reply: null,
    sync: () => Promise.resolve(), ready: true, authCallbacks: [], storageBlocked: false };
  const i18n = load('i18n.js').win.__i18n; i18n.current = 'vi';
  const r = load('buy-now-intent.js', { deps: ['routes.js'], globals: { CART_MAX_QTY: 99,
    sessionStorage: { getItem: k => storage.get(k) || null,
      setItem(k, value) { if (state.storageBlocked) throw Error('denied'); storage.set(k, value); }, removeItem: k => storage.delete(k) } },
    window: { crypto: webcrypto, __i18n: i18n, location: { pathname: opts.pathname || '/product.html', search: opts.search || '' },
      whenCartReady: async uid => { events.push('merge:' + uid); await state.sync(); },
      AuthHelper: { get ready() { return state.ready; }, getUser: () => state.user, isLoggedIn: () => !!state.user,
        onChange(fn) { state.authCallbacks.push(fn); if (state.ready) fn(state.user); },
        apiFetch: async (url, options = {}) => {
          calls.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body), signal: options.signal });
          if (state.reply) { const reply = state.reply(url, options); if (reply !== undefined) return reply; }
          if (url === '/api/products/8') return response(200, state.product);
          if (url === '/api/cart') {
            if (options.method === 'POST') {
              const payload = JSON.parse(options.body), old = state.items.find(it => it.variant_id === payload.variant_id);
              if (old) old.quantity += payload.quantity;
              else state.items.push(row(payload.variant_id, payload.quantity, payload.product_id));
            }
            return response(200, { items: state.items.map(it => ({ ...it })) });
          }
          throw Error('unexpected API');
        } } } });
  const purchase = r.win.BreezePurchase;
  return { ...r, state, storage, calls, events, purchase,
    begin() { const id = purchase.create(8, 81); r.win.location.pathname = '/login.html'; r.win.location.search = '?redirect=cart&purchase=' + id; return id; },
    read: () => JSON.parse(storage.get(KEY)),
    posts: () => calls.filter(c => c.method === 'POST'),
    async rejected(work, key) { let caught; try { await work; } catch (e) { caught = e; }
      check('rejects with ' + key, !!caught && caught.purchaseKey === key); },
    switchUser(user) { state.user = user; r.doc.fire('authchange'); } };
}

(async () => {
  console.log('buy-now-intent.js — pending continuation API fixtures');
  let r = setup({ items: [row(700, 2, 70), row(81, 2)] }); const id = r.begin();
  eq('pending contains only required intent data', Object.keys(r.read()).sort(), ['createdAt', 'id', 'productId', 'quantity', 'state', 'variantId', 'version']);
  check('pending has a random correlation ID', /^[a-f0-9]{32}$/.test(id));
  eq('creating pending sends no request and does not touch guest cart', r.calls.length, 0);
  const merge = deferred(); r.state.sync = () => merge.promise;
  const first = r.purchase.resume('A', 'customer'), second = r.purchase.resume('A', 'customer');
  check('concurrent login callbacks share one operation', first === second);
  await wait(); eq('waits for guest merge before product/cart API', r.calls.length, 0);
  merge.resolve(); await first;
  eq('adds exactly one using existing mode:add API', r.posts()[0].body, { product_id: 8, variant_id: 81, quantity: 1, mode: 'add' });
  eq('existing products and quantities are preserved', r.state.items, [row(700, 2, 70), row(81, 3)]);
  eq('pending removed only after server confirms', r.storage.has(KEY), false);
  await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseExpired');
  eq('completed intent cannot add again on callback/reload', r.posts().length, 1);

  r = setup({ items: [row(82, 2)] }); r.begin(); await r.purchase.resume('A', 'customer');
  eq('different variant is a separate line', r.state.items, [row(82, 2), row(81, 1)]);
  r = setup(); r.begin(); r.state.product = { ...PRODUCT, size_configured: false, variants: [{ id: 81, size: null, available: true }] };
  await r.purchase.resume('A', 'customer'); eq('size-free variant is valid', r.posts().length, 1);
  r = setup(); r.begin(); r.state.product = { ...PRODUCT, size_configured: false, color_configured: true,
    colors: [{ key: 'black', available: true }], variants: [{ id: 81, size: null, color: 'black', available: true }] };
  await r.purchase.resume('A', 'customer'); eq('size-free color selection preserves exact variant', r.posts()[0].body.variant_id, 81);

  for (const product of [
    { ...PRODUCT, variants: [] }, { ...PRODUCT, is_active: false }, { ...PRODUCT, id: 9 },
    { ...PRODUCT, variants: [{ id: 81, size: 'M', available: false }] },
    { ...PRODUCT, variants: [{ id: 81, size: 'M', available: true, is_active: false }] },
    { ...PRODUCT, variants: [{ id: 81, size: null, available: true }] },
    { ...PRODUCT, color_configured: true, colors: [], variants: [{ id: 81, size: 'M', available: true, color: 'black' }] }
  ]) {
    r = setup(); r.begin(); r.state.product = product;
    await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseUnavailable');
    eq('invalid/changed variant never submits cart POST', r.posts().length, 0);
  }
  r = setup(); r.begin(); r.state.reply = url => url.startsWith('/api/products/') ? response(404, {}) : undefined;
  await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseUnavailable');
  eq('deleted product never submits cart POST', r.posts().length, 0);
  r = setup({ items: [row(81, 99)] }); r.begin();
  await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseMax'); eq('quantity limit cannot be mistaken for success', r.posts().length, 0);
  r = setup(); r.begin(); r.state.sync = () => Promise.reject(Error('sync failed'));
  await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseSync'); eq('merge failure prevents pending mutation', r.posts().length, 0);
  eq('merge failure retains a retryable intent', r.read().state, 'failed');

  for (const status of [400, 401, 403, 404, 409, 429]) {
    r = setup(); r.begin(); r.state.reply = (_url, options) => options.method === 'POST' ? response(status, {}) : undefined;
    try { await r.purchase.resume('A', 'customer'); } catch (_) {}
    eq('definite rejection ' + status + ' retains retryable intent', r.read().state, 'failed');
    eq('definite rejection never retries automatically', r.posts().length, 1);
    r.state.reply = null; await r.purchase.resume('A', 'customer');
    eq('explicit retry after definite rejection adds exactly once', r.state.items, [row(81, 1)]);
  }
  for (const failure of ['network', '500', 'invalid JSON', 'missing cart line']) {
    r = setup(); r.begin(); r.state.reply = (_url, options) => {
      if (options.method !== 'POST') return undefined;
      if (failure === 'network') return Promise.reject(Error('transport lost'));
      if (failure === '500') { r.state.items.push(row(81, 1)); return response(500, {}); }
      if (failure === 'invalid JSON') return { ok: true, status: 200, json: async () => { throw Error('broken JSON'); } };
      return response(200, { items: [] });
    };
    await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseUnknown');
    eq('ambiguous ' + failure + ' is persisted as uncertain', r.read().state, 'uncertain');
    await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseUnknown');
    eq('ambiguous request never sends another increment', r.posts().length, 1);
    let blocked = false; try { r.purchase.create(8, 81); } catch (e) { blocked = e.purchaseKey === 'pd.purchaseUnknown'; }
    check('new click cannot silently overwrite an uncertain purchase', blocked);
  }

  r = setup(); r.begin(); const pendingPost = deferred();
  r.state.reply = (_url, options) => options.method === 'POST' ? pendingPost.promise : undefined;
  const work = r.purchase.resume('A', 'customer'); await wait();
  eq('processing marker is durable before POST finishes', r.read().state, 'processing');
  const reloaded = setup({ storage: r.storage, pathname: '/login.html', search: r.win.location.search });
  await reloaded.rejected(reloaded.purchase.resume('A', 'customer'), 'pd.purchaseUnknown');
  eq('reload during POST sends no second request', reloaded.posts().length, 0);
  r.switchUser({ uid: 'B' }); check('account switch aborts outstanding request', r.posts()[0].signal.aborted);
  pendingPost.resolve(response(200, { items: [row(81, 1)] }));
  await r.rejected(work, 'pd.purchaseUnknown');
  await r.rejected(r.purchase.resume('B', 'customer'), 'au.notLoggedIn');
  eq('another account cannot reuse a bound pending purchase', r.posts().length, 1);

  r = setup(); r.begin(); const productGate = deferred(); r.state.reply = url => url.startsWith('/api/products/') ? productGate.promise : undefined;
  const beforePost = r.purchase.resume('A', 'customer'); await wait(); r.switchUser(null);
  productGate.resolve(response(200, PRODUCT)); await r.rejected(beforePost, 'au.notLoggedIn');
  eq('logout during validation prevents cart POST', r.posts().length, 0);
  r = setup(); r.begin(); await r.rejected(r.purchase.resume('A', 'admin'), 'acc.adminBlocked');
  eq('admin continuation cannot mutate the cart', r.calls.length, 0);

  for (const edit of [p => { p.quantity = 2; }, p => { p.variantId = -1; }, p => { p.createdAt -= 15 * 60 * 1000 + 1; }]) {
    r = setup(); r.begin(); const stored = r.read(); edit(stored); r.storage.set(KEY, JSON.stringify(stored));
    await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseExpired');
    eq('tampered/expired pending sends no request', r.calls.length, 0);
  }
  r = setup(); r.begin(); r.win.location.search = '?redirect=https://evil.test&purchase=' + r.read().id;
  await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseExpired');
  eq('untrusted redirect never performs a purchase', r.calls.length, 0);
  r = setup(); r.begin(); const duplicatedQuery = r.win.location.search + '&purchase=' + r.read().id; r.win.location.search = duplicatedQuery;
  await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseExpired');
  r = setup(); r.begin(); const ordinary = setup({ storage: r.storage, pathname: '/login.html', search: '' });
  eq('ordinary login discards stale continuation', ordinary.storage.has(KEY), false);
  eq('ordinary login sends no cart API', ordinary.calls.length, 0);
  r = setup(); r.state.storageBlocked = true;
  let storageError; try { r.begin(); } catch (e) { storageError = e.purchaseKey; }
  eq('unavailable storage prevents starting a pending flow', storageError, 'pd.purchaseStorage');
  r = setup(); r.begin(); r.purchase.cancel();
  await r.rejected(r.purchase.resume('A', 'customer'), 'pd.purchaseExpired');
  eq('cancel prevents any mutation', r.posts().length, 0);
})().catch(e => { console.error(e); process.exitCode = 1; });
