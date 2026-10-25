const { check, eq } = require('./helpers/assert');
const { wait } = require('./helpers/sandbox');
const { setup, response, defer, text } = require('./helpers/support-harness');
console.log('Support session — heartbeat, auth transfer and no browser persistence');
function fixture(active = false) {
    let n = 0; const timers = new Map(), packets = [], channels = [];
    const feed = { active, fail: 0, claim: null, creation: null };
    const r = setup('widget', { lifecycle: true,
        BroadcastChannel: class { constructor() { channels.push(this); } postMessage(p) { packets.push(p); } },
        globals: { setTimeout(fn, ms) { timers.set(++n, { fn, ms }); return n; }, clearTimeout(id) { timers.delete(id); } },
        fetch(url, options = {}) {
            if (url === '/api/me') return Promise.resolve(response({ role: 'customer', firebase_uid: 'A' }));
            if (url === '/api/support/session') {
                if (options.headers.Authorization) return feed.claim ? feed.claim.promise : Promise.resolve(response({ role: 'customer', active: false, merged: true }));
                return Promise.resolve(response({ role: 'guest', active: feed.active }));
            }
            if (url === '/api/support/heartbeat') return Promise.resolve(response({ active: feed.active }, feed.fail || 200));
            if (url === '/api/support/guest-session') return feed.creation.promise;
            if (url === '/api/support/conversation') return Promise.resolve(response({ conversation: feed.active ? { id: '10' } : null }));
            return Promise.resolve(response({ conversation: { id: '10' }, messages: [{ id: '1', kind: 'customer', text: 'Guest question' }], nextBefore: null }));
        } });
    return { ...r, feed, timers, packets, channels,
        async tick() { for (const [id, t] of [...timers]) if (t.ms === 30000) { timers.delete(id); t.fn(); } await wait(); },
        async close() { r.win._l.pagehide(); await wait(); },
        beats: () => r.calls.filter(c => c.url === '/api/support/heartbeat') };
}
(async () => {
    const r = fixture(true); r.login(null); await wait();
    eq('guest bootstrap checks cookie session without token in body or URL', r.calls[0].body, {});
    check('bootstrap always includes HttpOnly cookie credentials', r.calls[0].options.credentials === 'include');
    eq('active page schedules thirty-second heartbeat', [...r.timers.values()].filter(t => t.ms === 30000).length, 1);
    r.doc.hidden = true; await r.tick();
    eq('hidden living tab still sends session activity', r.beats().length, 1);
    check('heartbeat carries no claimed identity, tab ID, name or chat text', Object.keys(r.beats()[0].body).length === 0 && !r.beats()[0].options.headers.Authorization);
    await r.close();
    check('closing page sends a final keepalive activity signal', r.beats().slice(-1)[0].options.keepalive);
    const beats = r.beats().length; await r.tick();
    eq('closed page sends no further interval heartbeat', r.beats().length, beats);
    r.win._l.pageshow(); await wait();
    check('bfcache restore checks session again', r.calls.filter(c => c.url === '/api/support/session').length === 2);
    await r.close();
    const empty = fixture(); empty.login(null); await wait(); empty.feed.active = true; await empty.tick();
    eq('another tab can discover a newly created shared cookie without BroadcastChannel delivery', empty.beats().length, 1);
    empty.win.BreezeSupportSession.activate();
    eq('cross-tab message contains only a fixed lifecycle hint', empty.packets.slice(-1), [{ type: 'changed' }]);
    await empty.close();
    const expired = fixture(true); expired.login(null); await wait(); expired.byClass('breeze-support-launcher').click(); await wait();
    check('existing guest history restores before expiry', text(expired.byClass('breeze-support-transcript')).includes('Guest question'));
    expired.feed.active = false; expired.feed.fail = 401; await expired.tick();
    check('heartbeat expiry clears transcript and requests guest details', !expired.byClass('breeze-support-transcript').children.length && !expired.byClass('breeze-support-guest').hidden);
    await expired.close();
    const signed = fixture(true); signed.login(null); await wait(); signed.feed.claim = defer(); signed.login({ uid: 'A' }, 'customer'); await wait();
    check('account session synchronization carries fresh Bearer and cookie proof together', signed.calls.some(c => c.url === '/api/support/session' && c.options.headers.Authorization === 'Bearer A' && c.options.credentials === 'include'));
    const pendingGet = signed.win.BreezeSupportAPI.request('/api/support/conversation', {}, 'A'); await wait();
    eq('account chat API waits until guest transfer completes', signed.calls.filter(c => c.url === '/api/support/conversation').length, 0);
    signed.feed.claim.resolve(response({ role: 'customer', active: false, merged: true })); await pendingGet;
    eq('merged account resumes its own authorized chat API', signed.calls.filter(c => c.url === '/api/support/conversation').length, 1);
    const before = signed.beats().length; await signed.tick();
    eq('signed-in account never prolongs guest session', signed.beats().length, before);
    signed.login(null); await wait();
    eq('logout rechecks empty guest cookie instead of showing previous account history', signed.byClass('breeze-support-transcript').children.length, 0); await signed.close();
    const race = fixture(); race.login(null); await wait(); race.byClass('breeze-support-launcher').click(); await wait();
    race.get('breeze-support-name').value = 'Guest'; race.get('breeze-support-email').value = 'g@example.test'; race.get('breeze-support-message').value = 'In flight';
    race.feed.creation = defer(); race.byClass('breeze-support-form').fire('submit'); await wait(); race.login({ uid: 'A' }, 'customer'); await wait();
    eq('login waits for in-flight guest first-send response before claiming cookie', race.calls.filter(c => c.url === '/api/support/session' && c.options.headers.Authorization).length, 0);
    race.feed.creation.resolve(response({ conversationId: '10', message: { id: '1', kind: 'customer', text: 'In flight' } })); await wait(40);
    eq('guest response settles before authenticated transfer starts', race.calls.filter(c => c.url === '/api/support/session' && c.options.headers.Authorization).length, 1);
    check('late guest response cannot render as a new account message', !text(race.byClass('breeze-support-transcript')).includes('In flight')); await race.close();
    eq('lifecycle stores no credential, name, draft or transcript in browser storage', [r, empty, expired, signed, race].flatMap(c => c.writes), []);
})();
