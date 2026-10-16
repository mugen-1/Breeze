/* Customer Detail through real Admin event handlers and the shared DOM harness. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const doc = makeDoc(), g = id => doc.getElementById(id);
const calls = [];
let auth, responseStatus = 200, deferred = null, rejectRequest = false;
const user = { id: 1, display_name: '<img src=x onerror=alert(1)>', email: 'customer@example.test',
  phone: '0901234567', dob: '2000-10-01', gender: 'male', country: 'VN', role: 'customer',
  created_at: '2026-10-01', last_login: null, is_blacklisted: false };
const stats = { total_orders: 12, completed_orders: 2, cancelled_orders: 1, total_spent: 1500000 };
const order = { id: 25, user_id: 1, created_at: '2026-10-10', total_amount: 1000000, status: 'completed',
  payment_method: 'cod', items: [{ product_name: 'Áo', size_snapshot: 'M', color_snapshot: 'Đen', quantity: 1, unit_price: 1000000, line_total: 1000000 }] };
const usersNav = El('button'), ordersNav = El('button');
usersNav.setAttribute('data-nav', 'users'); usersNav.classList.add('active');
ordersNav.setAttribute('data-nav', 'orders');
doc._qsa['.adm-nav-item'] = [usersNav, ordersNav];
doc._qs['.adm-nav-item[data-nav="orders"]'] = ordersNav;
const originalQS = doc.querySelector;
doc.querySelector = selector => selector === '.adm-nav-item.active'
  ? [usersNav, ordersNav].find(n => n.classList.contains('active')) : originalQS(selector);
const detailButton = id => {
  const b = El('button'); b.setAttribute('data-customer-detail', id);
  b._closest = { '[data-customer-detail]': b }; return b;
};
const detail1 = detailButton(1), detail2 = detailButton(2);
let blacklistButton, releaseButton;
g('user-body').querySelectorAll = selector => {
  if (selector !== '[data-blacklist]') return [];
  blacklistButton = El('button'); blacklistButton.setAttribute('data-blacklist', '1'); return [blacklistButton];
};
g('blacklist-body').querySelectorAll = selector => {
  if (selector !== '[data-release]') return [];
  releaseButton = El('button'); releaseButton.setAttribute('data-release', '2'); return [releaseButton];
};
const orderToggle = El('button');
g('order-body').querySelector = selector => selector === '[data-toggle="25"]' ? orderToggle : null;
function payload(id, page) {
  return { user: { ...user, id, is_blacklisted: id === 2 }, statistics: id === 2
    ? { total_orders: 0, completed_orders: 0, cancelled_orders: 0, total_spent: 0 } : stats,
    orders: id === 2 ? [] : [order], page, limit: 10, total: id === 2 ? 0 : 12, total_pages: id === 2 ? 0 : 2 };
}
const r = load('admin.js', { doc, deps: ['routes.js', 'utils-format.js', 'order-shipping.js', 'utils-i18n.js', 'order-payment.js'],
  globals: { setTimeout: () => 0, clearTimeout() {}, fetch: async () => ({ json: async () => [] }) },
  window: { __i18n: { current: 'vi', t: key => 'VI:' + key }, AuthHelper: {
    onChange(fn) { auth = fn; },
    apiFetch(url, opts) {
      calls.push({ url, method: opts && opts.method || 'GET' });
      const match = url.match(/\/users\/(\d+)\/detail\?page=(\d+)/);
      if (match) {
        if (deferred) return new Promise(resolve => { deferred.resolve = resolve; });
        if (rejectRequest) return Promise.reject(new Error('offline'));
        return Promise.resolve({ ok: responseStatus === 200, status: responseStatus,
          json: async () => payload(Number(match[1]), Number(match[2])) });
      }
      let data = {};
      if (url === '/api/me') data = { role: 'admin' };
      else if (url === '/api/categories') data = [];
      else if (url.startsWith('/api/admin/stats/order-status')) data = [];
      else if (url.startsWith('/api/admin/users?')) data = { users: [user], total: 21, total_pages: 2 };
      else if (url.startsWith('/api/admin/orders?')) data = { orders: url.includes('order_id=25') ? [order] : [], total: 1, total_pages: 1 };
      else if (url.startsWith('/api/admin/blacklist?')) data = { orders: [{ user_id: 2, order_id: null }], total: 1, total_pages: 1 };
      return Promise.resolve({ ok: true, status: 200, json: async () => data });
    }
  } }
});
const clickDetail = b => g('user-body').fire('click', { target: b });
(async function () {
  console.log('admin-customers.js');
  doc.fire('DOMContentLoaded'); auth({ uid: 'admin' }); await wait(50);
  check('existing user list adds a detail action per customer', g('user-body').innerHTML.includes('data-customer-detail="1"'));
  check('existing blacklist action remains present', g('user-body').innerHTML.includes('data-blacklist="1"'));
  g('user-pg-next').fire('click'); await wait();
  check('existing user pagination still requests page 2', calls.some(c => c.url === '/api/admin/users?page=2&limit=20'));

  clickDetail(detail1);
  check('detail action opens modal immediately', g('customer-modal').classList.contains('open'));
  eq('loading state is visible', g('customer-message').textContent, 'VI:com.loading');
  eq('loading is announced', g('customer-modal').getAttribute('aria-busy'), 'true');
  check('opening focuses close button and locks background scrolling', g('customer-close')._focused && doc.body.classList.contains('customer-detail-open'));
  await wait();
  check('selected user ID and default history page sent to API', calls.some(c => c.url === '/api/admin/users/1/detail?page=1&limit=10'));
  check('personal data is escaped', g('customer-info').innerHTML.includes('&lt;img') && !g('customer-info').innerHTML.includes('<img'));
  check('profile fields include phone, birthday, country and fallback for last login', g('customer-info').innerHTML.includes('0901234567') && g('customer-info').innerHTML.includes('01/10/2000') && g('customer-info').innerHTML.includes('VI:pf.cVN') && g('customer-info').innerHTML.includes('—'));
  eq('four KPIs rendered from server statistics', [g('customer-total-orders').textContent, g('customer-completed').textContent, g('customer-cancelled').textContent, g('customer-spent').textContent], [12, 2, 1, '1.500.000₫']);
  check('history contains view-order action and translated payment/status', g('customer-orders').innerHTML.includes('data-customer-order="25"') && g('customer-orders').innerHTML.includes('VI:pay.cod') && g('customer-orders').innerHTML.includes('VI:st.completed'));
  eq('first page disables previous', [g('customer-prev').disabled, g('customer-next').disabled], [true, false]);
  g('customer-next').fire('click'); await wait();
  check('next history page loads the same customer', calls.some(c => c.url === '/api/admin/users/1/detail?page=2&limit=10'));
  eq('last page disables next', [g('customer-prev').disabled, g('customer-next').disabled], [false, true]);
  eq('history does not modify user-list page', g('user-pager').innerHTML.includes(' 2 / 2'), true);
  g('customer-prev').fire('click'); await wait();

  r.win.__i18n.current = 'en'; r.win.__i18n.t = key => 'EN:' + key;
  doc.fire('langchange'); await wait();
  check('language change re-renders customer data and history', g('customer-info').innerHTML.includes('EN:adm.customerActive') && g('customer-orders').innerHTML.includes('EN:adm.customerViewOrder'));
  const translatedTrigger = detailButton(1);
  detail1.isConnected = false;
  g('user-body').querySelector = () => translatedTrigger;

  // Native keyboard behavior cannot be fully validated by the DOM harness.
  const close = g('customer-close'), last = g('customer-next');
  g('customer-modal').querySelectorAll = () => [close, last];
  doc.activeElement = last;
  let trapped = false;
  g('customer-modal').fire('keydown', { key: 'Tab', preventDefault() { trapped = true; } });
  check('Tab wraps back to close', trapped && close._focused);
  doc.activeElement = close; trapped = false;
  g('customer-modal').fire('keydown', { key: 'Tab', shiftKey: true, preventDefault() { trapped = true; } });
  check('Shift-Tab wraps to last control', trapped && last._focused);
  g('customer-modal').fire('keydown', { key: 'Escape' });
  check('Escape restores focus to the replacement trigger after a language change', !g('customer-modal').classList.contains('open') && translatedTrigger._focused);
  eq('close clears customer markup', g('customer-info').innerHTML + g('customer-orders').innerHTML, '');

  clickDetail(detail2); await wait();
  check('blacklist state is display-only', g('customer-info').innerHTML.includes('EN:adm.inBlacklist'));
  check('empty history has explicit empty state', g('customer-orders').innerHTML.includes('EN:adm.customerEmptyOrders'));
  eq('empty history hides pager and shows zero spent', [g('customer-pager').hidden, g('customer-spent').textContent], [true, '0₫']);
  g('customer-modal').fire('click');
  check('backdrop closes modal', !g('customer-modal').classList.contains('open'));

  responseStatus = 404; clickDetail(detail1); await wait();
  eq('404 message is translated', g('customer-message').textContent, 'EN:adm.customerNotFound');
  check('404 does not show stale data', g('customer-content').hidden);
  responseStatus = 500; clickDetail(detail1); await wait();
  eq('API error provides retry', [g('customer-message').textContent, g('customer-retry').hidden], ['EN:adm.customerLoadError', false]);
  responseStatus = 200; g('customer-retry').fire('click'); await wait();
  check('retry restores customer detail', !g('customer-content').hidden);
  rejectRequest = true; clickDetail(detail1); await wait();
  eq('network error is handled without unhandled rejection', g('customer-message').textContent, 'EN:adm.customerLoadError');
  rejectRequest = false;

  deferred = {}; clickDetail(detail1); const old = deferred; deferred = null;
  clickDetail(detail2); await wait();
  old.resolve({ ok: true, json: async () => payload(1, 1) }); await wait();
  check('late response cannot overwrite a newly selected customer', g('customer-info').innerHTML.includes('EN:adm.inBlacklist'));
  deferred = {}; clickDetail(detail1); const closed = deferred; deferred = null;
  g('customer-close').fire('click');
  closed.resolve({ ok: true, json: async () => payload(1, 1) }); await wait();
  check('response after close cannot restore private data', !g('customer-modal').classList.contains('open') && g('customer-info').innerHTML === '');
  const before = calls.length; clickDetail(detail1); await wait();
  eq('reopening causes exactly one detail request', calls.slice(before).filter(c => c.url.includes('/detail?')).length, 1);

  const view = El('button'); view.setAttribute('data-customer-order', '25'); view._closest = { '[data-customer-order]': view };
  g('order-status-filter').value = 'pending';
  g('customer-orders').fire('click', { target: view }); await wait();
  check('view-order navigates to existing Orders view', ordersNav.classList.contains('active') && !g('customer-modal').classList.contains('open'));
  check('view-order uses existing exact-ID search API', calls.some(c => c.url === '/api/admin/orders?order_id=25&limit=1'));
  eq('conflicting order status filter cleared', g('order-status-filter').value, '');
  eq('existing order detail expanded', g('oi-25').style.display, 'table-row');
  check('existing order renderer retains products, size, color and focus', g('order-body').innerHTML.includes('Áo') && g('order-body').innerHTML.includes('M') && g('order-body').innerHTML.includes('Đen') && orderToggle._focused);

  blacklistButton.fire('click');
  check('existing blacklist still requires confirmation', g('confirm-modal').classList.contains('open'));
  g('confirm-ok').fire('click'); await wait();
  check('existing blacklist endpoint unchanged', calls.some(c => c.method === 'POST' && c.url === '/api/admin/users/1/blacklist'));
  releaseButton.fire('click'); g('confirm-ok').fire('click'); await wait();
  check('existing release endpoint unchanged', calls.some(c => c.method === 'POST' && c.url === '/api/admin/blacklist/2/release'));
  clickDetail(detail1); await wait(); auth(null);
  check('sign-out clears customer modal data', !g('customer-modal').classList.contains('open') && g('customer-info').innerHTML === '');
  eq('no unexpected console errors in exercised flows', r.log.filter(entry => entry[0] === 'console.error'), []);
})();
