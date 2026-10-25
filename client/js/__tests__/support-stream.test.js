const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { defer } = require('./helpers/support-harness');
console.log('support-api.js — SSE transport');
function setup(options = {}) {
    const calls = [], sockets = [], callbacks = [], changes = [], states = [], errors = [];
    const state = { user: options.user === undefined ? { uid: 'A' } : options.user, token: 'A-token', response: null };
    const r = load('support-api.js', { globals: { TextDecoder, fetch(url, opts) {
        calls.push({ url, opts }); if (state.response) return Promise.resolve(state.response);
        let push; const body = new ReadableStream({ start(c) { push = c; } });
        opts.signal.addEventListener('abort', () => { try { push.error(Error('aborted')); } catch (_) {} });
        sockets.push({ push: value => push.enqueue(typeof value === 'string' ? new TextEncoder().encode(value) : value), end: () => push.close() });
        return Promise.resolve({ status: 200, ok: true, headers: new Headers({ 'content-type': 'text/event-stream; charset=utf-8' }), body });
    } }, window: { AuthHelper: { ready: true, getUser: () => state.user, getToken: () => Promise.resolve(state.token), onChange: fn => callbacks.push(fn) } } });
    return { ...r, calls, sockets, changes, states, errors, state,
        start(uid = 'A') { return r.win.BreezeSupportAPI.watch('/api/support/events', uid, { onState: s => states.push(s), onError: e => errors.push(e), onChange: (d, k) => changes.push({ d, k }) }); },
        login(user) { state.user = user; callbacks.forEach(fn => fn(user)); }
    };
}
(async () => {
    const r = setup(), stream = r.start(); await wait();
    eq('SSE request uses Bearer without putting token in URL', [r.calls[0].url, r.calls[0].opts.headers.Authorization], ['/api/support/events', 'Bearer A-token']);
    check('SSE includes cookies and correct Accept type', r.calls[0].opts.credentials === 'include' && r.calls[0].opts.headers.Accept === 'text/event-stream');
    r.sockets[0].push(': keep-alive\r\n\r\nevent: ready\r\ndata: {}\r\n\r\n'); await wait();
    eq('ready event changes actual transport state to live', r.states.slice(-1)[0], 'live');
    eq('ready event requests authoritative snapshot sync', r.changes.map(x => x.k), ['ready']);
    const packet = new TextEncoder().encode('event: change\r\ndata: {"note":\r\ndata: "Tiếng Việt 🌿"}\r\n\r\n');
    for (let i = 0; i < packet.length; i++) r.sockets[0].push(packet.slice(i, i + 1)); await wait();
    eq('SSE parser handles UTF-8, CRLF split and multiline data', r.changes[1], { d: { note: 'Tiếng Việt 🌿' }, k: 'change' });
    const count = r.changes.length; r.sockets[0].push(': another ping\n\n'); await wait();
    eq('transport keep-alive is not a chat message or activity write', r.changes.length, count);
    r.login({ uid: 'B' }); await wait();
    eq('account switch closes stream immediately', r.states.slice(-1)[0], 'closed');
    eq('account switch does not reconnect using another account token', r.calls.length, 1);
    stream.close();
    const pending = setup(), gate = defer(); pending.state.token = gate.promise;
    const closed = pending.start(); await wait(); closed.close(); gate.resolve('A-token'); await wait();
    eq('closing while token is pending prevents late HTTP connect', pending.calls.length, 0);
    const denied = setup(); denied.state.response = { ok: false, status: 403, headers: new Headers() }; denied.start(); await wait();
    eq('HTTP permission denial stops auto reconnect', denied.states.slice(-1)[0], 'closed');
    eq('HTTP permission denial reports role loss', denied.errors[0].status, 403);
    const expired = setup(), expiredStream = expired.start(); await wait(); expired.sockets[0].push('event: auth-lost\ndata: {"status":401}\n\n'); await wait();
    eq('server session expiry permanently closes connection', expired.states.slice(-1)[0], 'closed');
    eq('session expiry reaches UI error handler', expired.errors[0].status, 401); expiredStream.close();
    const guest = setup({ user: null }); guest.state.token = null; const gs = guest.start(null); await wait();
    check('guest stream never invents a Bearer token', !guest.calls[0].opts.headers.Authorization); gs.close();
    const reconnect = setup(), rs = reconnect.start(); await wait(); reconnect.sockets[0].push('event: ready\ndata: {}\n\n'); await wait();
    reconnect.sockets[0].end(); await wait();
    eq('socket EOF reports reconnecting', reconnect.states.slice(-1)[0], 'reconnecting');
    reconnect.state.token = 'refreshed-token'; rs.retry(); await wait();
    eq('reconnect obtains a fresh Firebase token', reconnect.calls[1].opts.headers.Authorization, 'Bearer refreshed-token');
    reconnect.sockets[1].push('event: ready\ndata: {}\n\n'); await wait();
    eq('every reconnect requests a SQL snapshot, covering missed notices', reconnect.changes.map(x => x.k), ['ready', 'ready']); rs.close();
    const oversized = setup(), os = oversized.start(); await wait(); oversized.sockets[0].push('data: ' + 'x'.repeat(70000)); await wait();
    eq('malformed oversized frame does not grow an unbounded buffer', oversized.states.slice(-1)[0], 'reconnecting'); os.close();
})();
