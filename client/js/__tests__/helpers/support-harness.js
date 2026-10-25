// DOM/HTTP fixtures only. Also used to exercise real frontend scripts against a
// disposable SQL-backed Express server; does not claim browser layout coverage.
const { load } = require('./sandbox');
const { makeDoc, El } = require('./dom');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const all = el => [el, ...el.children.flatMap(all)];
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(data)) });
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const text = el => el.textContent + el.children.map(text).join('');
const i18n = () => { const value = load('i18n.js').win.__i18n; value.current = 'vi'; return value; };
const navigation = ['dashboard', 'products', 'orders', 'statistics', 'users', 'reviews', 'blacklist', 'feedback'];
function setup(kind, opts = {}) {
    const doc = makeDoc(), calls = [], writes = [], callbacks = [];
    const state = { user: null, role: 'admin', roleResult: null, handle: null, token: null, valid: true };
    const create = doc.createElement;
    doc.createElement = tag => {
        const el = create(tag); el.focus = () => { doc.activeElement = el; };
        el.contains = child => all(el).includes(child); el.reportValidity = () => state.valid;
        return el;
    };
    let navs = [];
    if (kind === 'widget') {
        doc.readyState = 'complete';
        doc.getElementById = id => all(doc.body).find(el => el.id === id) || null;
    } else {
        const html = fs.readFileSync(path.join(__dirname, '../../../admin.html'), 'utf8');
        [...html.matchAll(/id="([^"]+)"/g)].forEach(m => doc.getElementById(m[1]));
        const history = El('div'); history.scrollHeight = 500; history.scrollTop = 0;
        history.appendChild(doc.getElementById('admin-support-messages'));
        doc.getElementById('admin-support-contact').focus = () => { doc.activeElement = doc.getElementById('admin-support-contact'); };
        navs = navigation.map(key => { const el = El('button'); el.setAttribute('data-nav', key); return el; });
        doc._qsa['.adm-nav-item'] = navs;
        doc.querySelector = selector => selector === '.adm-nav-item.active' ? navs.find(el => el.classList.contains('active')) : null;
    }
    const auth = {
        ready: false, getUser: () => state.user,
        getToken: () => Promise.resolve(state.token === null ? state.user && state.user.uid : state.token),
        onChange: fn => { callbacks.push(fn); if (auth.ready) fn(state.user); },
        apiFetch: (url, options) => {
            calls.push({ url, options: options || {}, role: true });
            if (opts.fetch) return auth.getToken().then(token => http(url, { ...options, headers: { Authorization: 'Bearer ' + token } }));
            if (url !== '/api/me') return http(url, options);
            return Promise.resolve(state.roleResult || response({ firebase_uid: state.user && state.user.uid, role: state.role, email: 'admin@example.test' }));
        }
    };
    const http = (url, options = {}) => {
        const call = { url, options, body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
        if (opts.fetch) return opts.fetch(url, options);
        if (state.handle) { const result = state.handle(call); if (result !== undefined) return Promise.resolve(result); }
        if (url === '/api/support/conversation') return Promise.resolve(response({ conversation: null }));
        if (url.startsWith('/api/admin/support/conversations?')) return Promise.resolve(response({ conversations: [], page: 1, totalPages: 0, total: 0 }));
        if (/order-status|top-products/.test(url)) return Promise.resolve(response([]));
        return Promise.resolve(response({ orders: [], products: [], users: [], items: [], total: 0, total_pages: 1, current: {}, previous: {}, dailyRevenue: [] }));
    };
    const deps = ['support-api.js'];
    if (opts.lifecycle) deps.push('support-session.js');
    if (kind === 'admin' && opts.shell) deps.push('routes.js', 'utils-format.js', 'utils-i18n.js', 'order-shipping.js', 'order-payment.js', 'business-report-csv.js', 'admin-support.js');
    const r = load(kind === 'widget' ? 'customer-support.js' : opts.shell ? 'admin.js' : 'admin-support.js', {
        doc, deps,
        globals: { fetch: http, TextDecoder: opts.stream ? TextDecoder : undefined,
            localStorage: { getItem: () => null, setItem: (...args) => writes.push(args) }, sessionStorage: { setItem: (...args) => writes.push(args) }, ...opts.globals },
        window: { crypto: webcrypto, __i18n: i18n(), AuthHelper: auth,
            _l: {}, addEventListener(event, fn) { const previous = this._l[event]; this._l[event] = previous ? e => { previous(e); fn(e); } : fn; },
            BroadcastChannel: opts.BroadcastChannel,
            BreezeRoutes: { is: () => false },
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) }
    });
    if (kind === 'admin') doc.fire('DOMContentLoaded');
    return { ...r, state, calls, writes, navs, get: id => doc.getElementById(id),
        byClass: name => all(doc.body).find(el => el.className.split(' ').includes(name)),
        login(user, role) {
            state.user = user; if (role) state.role = role; auth.ready = true;
            callbacks.forEach(fn => fn(user));
            if (kind === 'admin' && !opts.shell) doc.body.classList.toggle('adm-authed', !!user && state.role === 'admin');
        }
    };
}
module.exports = { setup, response, defer, text, navigation };
