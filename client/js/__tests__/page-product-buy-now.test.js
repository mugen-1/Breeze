/* Task 2: exercise the real product handler with controlled API responses.
   These fixtures verify client behavior, not a real Firebase/SQL purchase. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const { webcrypto } = require('crypto');

const P = { id: 17, name_vi: 'Áo', name_en: 'Shirt', price: 100000,
  category_slug: 'sanpham-ao', images: [], size_configured: true,
  variants: [{ id: 171, size: 'M', available: true }, { id: 172, size: 'L', available: true }] };
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const line = (variant_id, quantity, product_id = 17) => ({ product_id, variant_id, quantity });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function setup(options = {}) {
  const doc = makeDoc(), calls = [], notices = [], writes = [], session = new Map(), callbacks = [];
  const add = El('button'); doc._qs['.pd-add'] = add;
  const get = id => doc.getElementById(id), button = get('pd-buy-now'); button.disabled = true;
  const state = { user: options.guest ? null : { uid: 'A' }, ready: options.ready !== false,
    items: (options.items || []).map(item => ({ ...item })), reply: null };
  const helper = { get ready() { return state.ready; }, getUser: () => state.user,
    isLoggedIn: () => !!state.user, onChange(fn) { callbacks.push(fn); if (state.ready) fn(state.user); }, apiFetch: async (url, opts = {}) => {
      if (url !== '/api/cart') return response(200, { review: null, purchasedVariants: [] });
      calls.push({ method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body), signal: opts.signal });
      if (state.reply) return state.reply(opts);
      if (opts.method === 'POST') {
        const body = JSON.parse(opts.body), old = state.items.find(item => item.variant_id === body.variant_id);
        if (old) old.quantity += body.quantity;
        else state.items.push(line(body.variant_id, body.quantity, body.product_id));
      }
      return response(200, { items: state.items.map(item => ({ ...item })) });
    } };
  const i18n = load('i18n.js').win.__i18n; i18n.current = 'vi';
  const product = options.product || P;
  const deps = ['routes.js', 'utils-format.js', 'utils-i18n.js', 'cart.js'];
  if (options.continuation) deps.push('buy-now-intent.js');
  const r = load('page-product.js', { doc, deps,
    globals: { localStorage: { getItem: () => null, setItem: (...args) => writes.push(args) },
      sessionStorage: { getItem: k => session.get(k) || null, removeItem: k => session.delete(k),
        setItem(k, v) { if (options.storageBlocked) throw Error('denied'); session.set(k, v); } },
      fetch: async url => {
        if (options.loadError) throw new Error('offline');
        return response(200, /\/products\/17$/.test(url) ? product : []);
      } }, window: { AuthHelper: helper, crypto: webcrypto, __i18n: i18n, location: { search: '?id=17', href: 'original' } } });
  r.sandbox._cartToast = message => notices.push(message);
  let drawerOpens = 0; r.win.addToCart = () => { drawerOpens++; };
  r.win.CartDrawer = { open: () => { drawerOpens++; } };
  function choose(id = 171) {
    const target = El('button'); target.setAttribute('data-variant-id', id); target._closest = { '.pd-size': target };
    get('pd-sizes').fire('click', { target });
  }
  function color(key) {
    const target = El('button'); target.setAttribute('data-color-key', key); target._closest = { '.pd-color': target };
    get('pd-colors').fire('click', { target });
  }
  await wait();
  return { ...r, get, add, button, calls, notices, state, writes, choose, color, i18n, session,
    buy: () => button._l.click[0](), drawerOpens: () => drawerOpens,
    resolveAuth(user) { state.user = user; state.ready = true; callbacks.forEach(fn => fn(user)); doc.fire('authchange'); },
    switchUser(user) { state.user = user; doc.fire('authchange'); } };
}

(async () => {
  console.log('page-product.js — Buy now (authenticated API fixtures)');
  let r = await setup();
  eq('required size initially disables Buy now', r.button.disabled, true);
  await r.buy(); eq('forcing an unselected button sends no cart request', r.calls.length, 0);
  r.choose(); eq('valid variant enables Buy now', r.button.disabled, false);
  const pending = deferred(); r.state.reply = () => pending.promise;
  const first = r.buy(); await r.buy();
  eq('double-click sends one pending request', r.calls.length, 1);
  eq('loading is disabled and announced', [r.button.disabled, r.button.getAttribute('aria-busy')], [true, 'true']);
  eq('loading uses existing translation', r.button.textContent, 'Đang tải…');
  r.doc.fire('langchange'); eq('language re-render cannot unlock pending request', r.button.disabled, true);
  eq('no navigation before API confirmation', r.win.location.href, 'original');
  r.state.reply = null; pending.resolve(response(200, { items: [] })); await first;
  eq('POST adds exactly one selected variant', r.calls[1].body, { product_id: 17, variant_id: 171, quantity: 1, mode: 'add' });
  eq('successful confirmation navigates through existing route', r.win.location.href, r.win.BreezeRoutes.to('cart'));
  eq('success never opens mini-cart', r.drawerOpens(), 0);
  eq('success never writes guest storage', r.writes.length, 0);
  await r.buy(); eq('button stays locked until navigation completes', r.calls.length, 2);

  r = await setup({ items: [line(900, 2, 90), line(171, 2)] }); r.choose(); await r.buy();
  eq('same variant increments by one and preserves old products', r.state.items, [line(900, 2, 90), line(171, 3)]);
  r = await setup({ items: [line(171, 2)] }); r.choose(172); await r.buy();
  eq('different size retains separate cart line', r.state.items, [line(171, 2), line(172, 1)]);
  r = await setup({ product: { ...P, size_configured: false, variants: [{ id: 179, size: null, available: true }] } });
  await r.buy(); eq('size-free product uses its actual variant', r.calls[1].body.variant_id, 179);
  const colored = { ...P, color_configured: true, size_configured: false,
    colors: [{ key: 'black', label: 'Đen', available: true }, { key: 'white', label: 'Trắng', available: false }],
    variants: [{ id: 179, color: 'black', size: null, available: true }, { id: 180, color: 'white', size: null, available: false }] };
  r = await setup({ product: colored }); await r.buy(); eq('required color cannot be bypassed', r.calls.length, 0);
  r.color('black'); await r.buy(); eq('size-free colored product buys selected color', r.calls[1].body.variant_id, 179);
  r = await setup({ product: colored }); r.color('white'); await r.buy(); eq('unavailable color sends no request', r.calls.length, 0);

  for (const opts of [{ guest: true }, { ready: false }]) {
    r = await setup(opts); r.choose(); await r.buy();
    eq('guest/unresolved auth sends no request', r.calls.length, 0);
    eq('guest/unresolved auth stays on product page', r.win.location.href, 'original');
    eq('guest/unresolved auth receives safe notice', r.notices[0], 'Bạn chưa đăng nhập tài khoản');
    eq('guest/unresolved auth never stores a guest item', r.writes.length, 0);
  }
  r = await setup({ loadError: true }); await r.buy(); eq('failed product load cannot buy', r.calls.length, 0);
  r = await setup({ product: { ...P, variants: P.variants.map(v => ({ ...v, available: false })) } });
  await r.buy(); eq('sold-out product cannot buy', r.calls.length, 0);
  r = await setup(); r.choose(); r.get('pd-root').setAttribute('data-variant-id', '999'); await r.buy();
  eq('invalid selected variant cannot buy even when previously enabled', r.calls.length, 0);

  for (const [status, data, message] of [
    [409, { error: 'INSUFFICIENT_STOCK', message: 'private SQL data' }, 'Một số sản phẩm không đủ tồn kho'],
    [401, {}, 'Bạn chưa đăng nhập tài khoản'], [403, { error: 'BLACKLISTED' }, 'Không Thể Thực Hiện Hành Động'],
    [404, {}, 'Hết hàng'], [500, { message: 'private SQL data' }, 'Không thêm được vào giỏ']
  ]) {
    r = await setup(); r.choose(); r.state.reply = opts => opts.method === 'POST' ? response(status, data) : response(200, { items: [] });
    await r.buy(); eq(`HTTP ${status} does not navigate`, r.win.location.href, 'original');
    eq(`HTTP ${status} restores button`, [r.button.disabled, r.button.getAttribute('aria-busy')], [false, 'false']);
    eq(`HTTP ${status} retains variant`, r.get('pd-root').getAttribute('data-variant-id'), '171');
    eq(`HTTP ${status} displays a safe translated notice`, r.notices[0], message);
    eq(`HTTP ${status} leaves cart unchanged`, r.state.items.length, 0);
  }
  r = await setup({ items: [line(171, 99)] }); r.choose(); await r.buy();
  eq('quantity cap prevents POST', r.calls.length, 1);
  eq('quantity cap has clear notice', r.notices[0], 'Tối đa 99 sản phẩm cho mỗi mặt hàng');
  r = await setup(); r.choose(); r.state.reply = () => Promise.reject(new Error('sensitive transport details'));
  await r.buy(); eq('network error allows retry without navigation', [r.button.disabled, r.win.location.href], [false, 'original']);
  r.state.reply = null; await r.buy(); eq('manual retry succeeds', r.win.location.href, r.win.BreezeRoutes.to('cart'));
  r = await setup(); r.choose(); r.state.reply = () => ({ ok: true, status: 200, json: async () => { throw new Error('bad JSON'); } });
  await r.buy(); eq('invalid JSON never reports success', r.win.location.href, 'original');
  r = await setup(); r.choose(); r.state.reply = () => response(200, { items: [] });
  await r.buy(); eq('200 without the added variant never navigates', r.win.location.href, 'original');
  r = await setup({ items: [line(171, 2)] }); r.choose(); r.state.reply = () => response(200, { items: [line(171, 2)] });
  await r.buy(); eq('200 without a quantity increase never navigates', r.win.location.href, 'original');

  for (const changeDuringPost of [false, true]) {
    r = await setup(); r.choose(); const pending = deferred();
    r.state.reply = opts => changeDuringPost && !opts.method ? response(200, { items: [] }) : pending.promise;
    const work = r.buy(); await wait(); r.switchUser({ uid: 'B' });
    check('identity change aborts the pending authenticated fetch', r.calls[r.calls.length - 1].signal.aborted);
    pending.resolve(response(200, { items: [line(171, 1)] })); await work;
    eq('old identity response never navigates new account', r.win.location.href, 'original');
    eq('identity change never falls back to guest storage', r.writes.length, 0);
    eq('identity change before GET completion cannot start POST', r.calls.length, changeDuringPost ? 2 : 1);
  }
  r = await setup(); r.choose(); r.i18n.current = 'en'; r.doc.fire('langchange');
  eq('idle button follows English translation', r.button.textContent, 'Buy now');

  r = await setup({ guest: true, continuation: true }); r.choose(); await r.buy();
  const intent = JSON.parse(r.session.get('breeze_buy_now_intent'));
  eq('guest Buy now stores exact IDs and quantity', [intent.productId, intent.variantId, intent.quantity], [17, 171, 1]);
  eq('guest navigates through official login route', r.win.location.href,
    r.win.BreezeRoutes.to('login', { redirect: 'cart', purchase: intent.id }));
  eq('guest intent does not add to guest storage or API cart', [r.writes.length, r.calls.length], [0, 0]);
  await r.buy(); eq('double-click before login retains one intent', JSON.parse(r.session.get('breeze_buy_now_intent')).id, intent.id);
  eq('guest navigation never opens mini-cart', r.drawerOpens(), 0);
  r = await setup({ guest: true, continuation: true }); await r.buy();
  eq('missing required size cannot create an intent', r.session.size, 0);
  r = await setup({ guest: true, continuation: true, ready: false }); r.choose();
  let waiting = r.buy(); await wait();
  eq('unresolved Firebase is awaited without redirect or API', [r.win.location.href, r.calls.length, r.button.disabled], ['original', 0, true]);
  r.resolveAuth(null); await waiting;
  check('confirmed guest is then sent to Login', /purchase=/.test(r.win.location.href));
  r = await setup({ guest: true, continuation: true, ready: false }); r.choose();
  waiting = r.buy(); await wait(); r.resolveAuth({ uid: 'A' }); await waiting;
  eq('resolved authenticated user follows Task 2 directly', r.win.location.href, r.win.BreezeRoutes.to('cart'));
  eq('authenticated user does not store an intent', r.session.size, 0);
  r = await setup({ guest: true, continuation: true, storageBlocked: true }); r.choose(); await r.buy();
  eq('storage failure stays on product without an API mutation', [r.win.location.href, r.calls.length], ['original', 0]);
  eq('storage failure displays actionable notice', r.notices[0], r.i18n.t('pd.purchaseStorage'));
  r = await setup({ guest: true, continuation: true,
    product: { ...P, size_configured: false, variants: [{ id: 179, size: null, available: true }] } });
  await r.buy(); eq('size-free guest purchase saves the actual variant', JSON.parse(r.session.get('breeze_buy_now_intent')).variantId, 179);
})().catch(error => { console.error(error); process.exitCode = 1; });
