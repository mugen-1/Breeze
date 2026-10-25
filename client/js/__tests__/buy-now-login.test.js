/* Real auth.js + cart.js + pending helper; Firebase/API are explicit fixtures. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { webcrypto } = require('crypto');
const row = (variant_id, quantity, product_id = 8) => ({ product_id, variant_id, quantity, unit_price: 500, name_vi: 'Test' });
const res = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const KEY = 'breeze_buy_now_intent', ID = 'a'.repeat(32);
async function setup(opts = {}) {
  const session = new Map(), local = new Map(), callbacks = [], calls = [];
  const pending = { version: 1, id: ID, productId: 8, variantId: 81, quantity: 1, createdAt: Date.now(), state: 'new' };
  if (opts.pending !== false) session.set(KEY, JSON.stringify(pending));
  local.set('bookstore_cart', JSON.stringify(opts.guest || []));
  const state = { user: null, items: (opts.items || []).map(it => ({ ...it })), loginError: null, role: opts.role || 'customer',
    firstGet: opts.firstGet, productAvailable: true, postReply: null, loginCount: 0 };
  let firstGet = true;
  const helper = { ready: true, getUser: () => state.user, isLoggedIn: () => !!state.user,
    onChange(fn) { callbacks.push(fn); fn(state.user); },
    apiFetch: async (url, options = {}) => {
      const call = { url, method: options.method || 'GET', body: options.body && JSON.parse(options.body), signal: options.signal };
      calls.push(call);
      if (options.signal && options.signal.aborted) throw Error('aborted');
      if (url === '/api/products/8') return res(200, { id: 8, size_configured: true, variants: [{ id: 81, size: 'M', available: state.productAvailable }] });
      if (url !== '/api/cart') throw Error('Unexpected API');
      if (!options.method && firstGet && state.firstGet) { firstGet = false; return state.firstGet.promise; }
      if (options.method === 'POST') {
        if (state.postReply) return state.postReply(call);
        const b = call.body, old = state.items.find(it => it.variant_id === b.variant_id);
        if (old) old.quantity += b.quantity; else state.items.push(row(b.variant_id, b.quantity, b.product_id));
      }
      return res(200, { items: state.items.map(it => ({ ...it })) });
    } };
  let r;
  function changeUser(user) {
    state.user = user; callbacks.forEach(fn => fn(user));
    if (r) r.doc.fire('authchange');
  }
  const i18n = load('i18n.js').win.__i18n; i18n.current = 'vi';
  r = load('auth.js', { deps: ['routes.js', 'utils-format.js', 'utils-i18n.js', 'cart.js', 'buy-now-intent.js'],
    globals: { sessionStorage: { getItem: k => session.get(k) || null, setItem: (k, v) => session.set(k, v), removeItem: k => session.delete(k) },
      localStorage: { getItem: k => local.get(k) || null, setItem: (k, v) => local.set(k, v), removeItem: k => local.delete(k) },
      fetch: async url => {
        if (url !== '/api/me') throw Error('Unexpected raw fetch');
        return res(200, Object.prototype.hasOwnProperty.call(opts, 'me') ? opts.me : { role: state.role });
      }, auth: { onAuthStateChanged() {}, signInWithEmailAndPassword: async () => {
        state.loginCount++;
        if (state.loginError) throw { code: state.loginError };
        const user = { uid: 'A', email: 'fixture@example.test', getIdToken: async () => 'test-token' };
        changeUser(user); return { user };
      } } },
    window: { AuthHelper: helper, crypto: webcrypto, __i18n: i18n, location: { pathname: '/login.html', href: 'original',
      search: opts.search === undefined ? '?redirect=cart&purchase=' + ID : opts.search },
      BreezeSupportSession: { prepare: async () => {} } } });
  r.doc.fire('DOMContentLoaded');
  const g = id => r.doc.getElementById(id);
  g('login-email').value = 'fixture@example.test'; g('login-password').value = 'test-fixture';
  return { ...r, state, session, local, calls, changeUser, g,
    login: () => r.sandbox.dangNhap(), posts: () => calls.filter(c => c.method === 'POST'),
    quantities: () => state.items.map(it => [it.product_id, it.variant_id, it.quantity]) };
}

(async () => {
  console.log('Task 3 — Login, guest merge and pending purchase integration fixtures');
  const gate = deferred();
  let r = await setup({ items: [row(81, 2), row(700, 1, 70)],
    guest: [{ id: 8, variant_id: 81, qty: 2 }, { id: 9, variant_id: 91, qty: 1 }], firstGet: gate });
  const first = r.login(), second = r.login();
  check('repeated submit shares the existing login operation', first === second);
  await wait(); eq('initial cart sync is awaited before any increment', r.posts().length, 0);
  eq('login stays on current page while guest merge is pending', r.win.location.href, 'original');
  gate.resolve(res(200, { items: r.state.items })); await first;
  eq('merge preserves old user and guest lines, then adds one pending unit', r.quantities(), [[8, 81, 5], [70, 700, 1], [9, 91, 1]]);
  eq('guest merge and pending use the same variant identity without double counting',
    r.posts().map(c => [c.body.variant_id, c.body.quantity, c.body.mode]), [[81, 2, 'add'], [91, 1, 'add'], [81, 1, 'add']]);
  eq('cart route reached only after completed operation', r.win.location.href, r.win.BreezeRoutes.to('cart'));
  eq('pending has been consumed', r.session.has(KEY), false);
  eq('existing guest cart merge clears only its own storage key', JSON.parse(r.local.get('bookstore_cart')), []);
  r.changeUser(r.state.user); r.changeUser(r.state.user); await wait();
  eq('repeated auth notifications do not repeat merge or pending purchase', r.posts().length, 3);
  eq('double submit does not repeat Firebase sign-in', r.state.loginCount, 1);

  r = await setup({ items: [row(82, 2)] }); await r.login();
  eq('different variant remains a separate row after Login', r.quantities(), [[8, 82, 2], [8, 81, 1]]);
  r = await setup(); r.state.loginError = 'auth/invalid-credential'; await r.login();
  eq('failed Login never mutates or navigates', [r.posts().length, r.win.location.href], [0, 'original']);
  eq('failed Login retains pending request', JSON.parse(r.session.get(KEY)).state, 'new');
  eq('failed Login retains normal translated error', r.g('login-msg').textContent, r.win.__i18n.t('au.eBadCred'));
  r.state.loginError = null; await r.login(); eq('retrying Login completes one purchase', r.quantities(), [[8, 81, 1]]);
  r = await setup(); r.state.productAvailable = false; await r.login();
  eq('variant sold out during Login does not add or navigate', [r.posts().length, r.win.location.href], [0, 'original']);
  check('unavailable variant offers a safe return link', r.g('login-msg').children.some(el => el.href === r.win.BreezeRoutes.product(8)));

  r = await setup({ pending: false, search: '' }); await r.login();
  eq('ordinary Login retains customer homepage redirect', r.win.location.href, r.win.BreezeRoutes.to('index'));
  eq('ordinary Login never adds a pending product', r.posts().length, 0);
  r = await setup({ pending: true, search: '' }); await r.login();
  eq('unrelated header Login cannot consume old pending data', [r.session.has(KEY), r.posts().length], [false, 0]);
  r = await setup({ pending: false, search: '?redirect=checkout' }); await r.login();
  eq('existing Checkout Login redirect is preserved', r.win.location.href, r.win.BreezeRoutes.to('checkout'));
  r = await setup({ pending: false, search: '', role: 'admin' }); await r.login();
  eq('ordinary Admin Login retains admin redirect', r.win.location.href, r.win.BreezeRoutes.to('admin'));
  r = await setup({ role: 'admin' }); await r.login();
  eq('Admin cannot resume a purchase as a customer', [r.posts().length, r.win.location.href], [0, 'original']);

  for (const me of [null, {}]) {
    r = await setup({ me }); await r.login();
    eq('unknown purchase role cannot add or navigate', [r.posts().length, r.win.location.href], [0, 'original']);
    check('unknown purchase role retains the pending request', r.session.has(KEY));
  }

  r = await setup(); r.state.postReply = () => res(409, { error: 'INSUFFICIENT_STOCK' }); await r.login();
  eq('backend stock rejection stays on Login', r.win.location.href, 'original');
  eq('backend stock rejection leaves existing cart unchanged', r.state.items.length, 0);
  eq('backend stock rejection keeps a retryable intent', JSON.parse(r.session.get(KEY)).state, 'failed');
  r.state.postReply = null; await r.login(); eq('explicit retry after rejection adds one unit', r.quantities(), [[8, 81, 1]]);
  r = await setup({ guest: [{ id: 9, variant_id: 91, qty: 1 }] });
  r.state.postReply = () => res(409, {}); await r.login();
  eq('failed guest merge prevents the pending product POST', r.posts().map(c => c.body.variant_id), [91]);
  eq('failed guest merge cannot navigate as a completed purchase', r.win.location.href, 'original');
  eq('failed guest merge has explicit recovery guidance', r.g('login-msg').textContent, r.win.__i18n.t('pd.purchaseSync'));
  r = await setup(); r.state.postReply = () => { r.state.items.push(row(81, 1)); return res(500, {}); }; await r.login();
  eq('post-commit error never navigates as success', r.win.location.href, 'original');
  eq('post-commit error retains unknown outcome', JSON.parse(r.session.get(KEY)).state, 'uncertain');
  await r.login(); eq('another Login cannot replay an uncertain mutation', r.posts().length, 1);
  check('unknown result offers cart inspection', r.g('login-msg').children.some(el => el.href === r.win.BreezeRoutes.to('cart')));

  const switchGate = deferred(); r = await setup({ guest: [{ id: 8, variant_id: 81, qty: 2 }], firstGet: switchGate });
  const changing = r.login(); await wait(); const oldRequest = r.calls[0];
  r.changeUser({ uid: 'B' }); check('account switch aborts the previous cart synchronization', oldRequest.signal.aborted);
  switchGate.resolve(res(200, { items: [] })); await changing; await wait();
  eq('old guest cart is never merged into another account', r.posts().length, 0);
  eq('old pending cannot navigate another account', r.win.location.href, 'original');
})().catch(e => { console.error(e); process.exitCode = 1; });
