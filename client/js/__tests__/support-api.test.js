const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { response, defer } = require('./helpers/support-harness');
const { webcrypto } = require('node:crypto');
console.log('support-api.js — identity, credentials and retry safety');
function setup(options = {}) {
    const state = { user: null, token: null, ready: true, handle: null }, calls = [];
    const auth = { get ready() { return state.ready; }, getUser: () => state.user, getToken: () => Promise.resolve(state.token) };
    const r = load('support-api.js', { globals: { ...options.globals, fetch(url, opts) { calls.push({ url, opts }); return Promise.resolve(state.handle ? state.handle() : response({ ok: true })); } },
        window: { AuthHelper: auth, crypto: options.crypto === undefined ? webcrypto : options.crypto } });
    return { ...r, state, calls, api: r.win.BreezeSupportAPI };
}
const rejected = promise => promise.then(() => null, e => e);
(async () => {
    const r = setup();
    await r.api.request('/api/support/conversation', {}, null);
    check('guest request sends cookie credentials without Bearer', r.calls[0].opts.credentials === 'include' && !r.calls[0].opts.headers.Authorization);
    eq('sensitive GET bypasses cache', r.calls[0].opts.cache, 'no-store');
    r.state.user = { uid: 'customer' }; r.state.token = 'signed-token';
    const body = { text: '<script>literal</script>', clientMessageId: r.api.uuid() };
    await r.api.request('/api/support/messages', { method: 'POST', body }, 'customer');
    eq('Firebase token is attached only as Bearer header', r.calls[1].opts.headers.Authorization, 'Bearer signed-token');
    eq('mutation serializes exact JSON', r.calls[1].opts.body, JSON.stringify(body));
    eq('mutation sets JSON content type', r.calls[1].opts.headers['Content-Type'], 'application/json');
    r.state.token = null;
    eq('missing account token never falls back to guest', (await rejected(r.api.request('/api/support/messages', { method: 'POST', body }, 'customer'))).status, 401);
    eq('missing token makes no HTTP request', r.calls.length, 2);
    r.state.ready = false;
    eq('unsettled auth cannot send an anonymous request', (await rejected(r.api.request('/api/support/conversation', {}, null))).code, 'SUPPORT_IDENTITY_CHANGED');
    const late = setup(), token = defer(); late.state.user = { uid: 'A' }; late.state.token = token.promise;
    const work = rejected(late.api.request('/api/support/messages', { method: 'POST', body }, 'A')); await wait();
    late.state.user = { uid: 'B' }; token.resolve('B-token');
    eq('account switch while awaiting token rejects operation', (await work).code, 'SUPPORT_IDENTITY_CHANGED');
    eq('old draft cannot be posted as new account', late.calls.length, 0);
    const stale = setup(), data = defer(); stale.state.user = { uid: 'A' }; stale.state.token = 'A-token'; stale.state.handle = () => data.promise;
    const oldHistory = rejected(stale.api.request('/api/support/conversation/messages', {}, 'A')); await wait();
    stale.state.user = null; data.resolve(response({ private: 'old account history' }));
    eq('response after signout is rejected before use', (await oldHistory).code, 'SUPPORT_IDENTITY_CHANGED');
    const failed = setup(); failed.state.handle = () => response({ code: 'SUPPORT_REQUEST_CONFLICT', message: 'PRIVATE raw details' }, 409);
    const error = await rejected(failed.api.request('/api/support/messages', { method: 'POST', body }, null));
    eq('HTTP failure keeps status and safe code', [error.status, error.code], [409, 'SUPPORT_REQUEST_CONFLICT']);
    check('raw server message is not copied to error text', !error.message.includes('PRIVATE'));
    eq('POST failure is never automatically retried', failed.calls.length, 1);
    eq('conflict has translated UI key', failed.api.errorKey(error), 'support.conflict');
    failed.state.handle = () => ({ ok: true, status: 200, json: () => Promise.reject(Error('HTML instead of JSON')) });
    eq('invalid JSON cannot appear as send success', (await rejected(failed.api.request('/api/support/messages', { method: 'POST', body }, null))).code, 'SUPPORT_BAD_RESPONSE');
    const uuid = r.api.uuid(); check('secure retry UUID is accepted by API shape', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid));
    const fallback = setup({ crypto: { getRandomValues: array => webcrypto.getRandomValues(array) } });
    check('secure getRandomValues fallback produces UUID', /^[0-9a-f-]{36}$/.test(fallback.api.uuid()));
    const none = setup({ crypto: null }); let insecure = false; try { none.api.uuid(); } catch (_) { insecure = true; }
    check('no insecure random fallback', insecure);
    eq('overlapping history pages deduplicate IDs in chronology', r.api.merge([{ id: '1' }, { id: '2' }], [{ id: '2' }, { id: '3' }]).map(x => x.id), ['1', '2', '3']);
    eq('snapshot restores chronological order when another sender committed before own POST ack', r.api.merge(
        [{ id: '1', createdAt: '2026-10-21T00:00:00.000Z' }, { id: '3', createdAt: '2026-10-21T00:00:02.000Z' }],
        [{ id: '2', createdAt: '2026-10-21T00:00:01.000Z' }, { id: '3', createdAt: '2026-10-21T00:00:02.000Z' }]
    ).map(m => m.id), ['1', '2', '3']);
    eq('same timestamp preserves exact SQL BIGINT ordering', r.api.merge([{ id: '9007199254740993' }], [{ id: '9007199254740992' }, { id: '10' }]).map(m => m.id), ['10', '9007199254740992', '9007199254740993']);
    let fire; const delayed = setup({ globals: { setTimeout(fn) { fire = fn; return 1; }, clearTimeout() {} } }), gate = defer();
    delayed.state.user = { uid: 'A' }; delayed.state.token = gate.promise;
    const timed = rejected(delayed.api.request('/api/support/messages', { method: 'POST', body }, 'A')); await wait(); fire();
    eq('request times out even while token is pending', (await timed).code, 'SUPPORT_TIMEOUT');
    gate.resolve('A-token'); await wait();
    eq('timed-out operation cannot send later in background', delayed.calls.length, 0);
})();
