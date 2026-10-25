const { check, eq } = require('./helpers/assert');
const { wait } = require('./helpers/sandbox');
const { setup, response, text } = require('./helpers/support-harness');
console.log('Support realtime — snapshot continuity and UI lifecycle');
const msg = id => ({ id: String(id), text: 'Message ' + id, kind: 'customer', createdAt: '2026-10-21T00:00:00Z' });
const contact = { id: '10', name: 'Guest', kind: 'guest', email: 'guest@example.test', unread: true };
function fixture(kind) {
    const sockets = [], state = { messages: [msg(2), msg(3)], before: '2', rows: [contact], revision: '0' };
    const r = setup(kind, { stream: true, fetch(url, opts) {
        if (url.endsWith('/events')) {
            let channel; const body = new ReadableStream({ start(c) { channel = c; } });
            const socket = { closed: false, push() { channel.enqueue(new TextEncoder().encode('event: change\ndata: {}\n\n')); } };
            sockets.push(socket);
            opts.signal.addEventListener('abort', () => { socket.closed = true; try { channel.error(Error('closed')); } catch (_) {} });
            return Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body });
        }
        if (url.includes('conversations?page=')) return Promise.resolve(response({ conversations: state.rows, page: 1, totalPages: 2 }));
        if (url.endsWith('/read')) return Promise.resolve(response({ conversationId: '10', readMessageId: JSON.parse(opts.body).messageId, unread: false }));
        if (opts.method === 'POST') return Promise.resolve(response({ conversationId: '10', message: state.ack }));
        if (url.endsWith('/conversation')) return Promise.resolve(response({ conversation: { id: '10' } }));
        return Promise.resolve(response({ conversation: { id: '10' }, historyRevision: state.revision, messages: url.includes('before=') ? [msg(1), msg(2)] : state.messages,
            nextBefore: url.includes('before=') ? null : state.before }));
    } });
    return { ...r, feed: () => sockets[sockets.length - 1].push(), sockets, feedState: state };
}
const widgetIds = r => r.byClass('breeze-support-transcript').children.map(el => el.children[0].children[0].textContent);
(async () => {
    const r = fixture('widget'); r.login(null);
    eq('closed widget does not open SSE', r.sockets.length, 0);
    r.byClass('breeze-support-launcher').click(); await wait();
    eq('loaded open widget connects once', r.sockets.length, 1);
    r.byClass('breeze-support-older').click(); await wait();
    eq('older page is loaded before a live update', widgetIds(r), ['Message 1', 'Message 2', 'Message 3']);
    const scroll = r.byClass('breeze-support-messages'); scroll.scrollHeight = 1500; scroll.clientHeight = 500; scroll.scrollTop = 100;
    r.get('breeze-support-message').value = 'Unsent draft';
    r.feedState.messages = [msg(3), msg(4)]; r.feedState.before = '3'; r.feed(); await wait(160);
    eq('overlapping push preserves previously loaded older history', widgetIds(r), ['Message 1', 'Message 2', 'Message 3', 'Message 4']);
    eq('incoming push preserves reading scroll position', scroll.scrollTop, 100);
    eq('incoming push preserves customer draft', r.get('breeze-support-message').value, 'Unsent draft');
    check('already loaded history does not show an incorrect older cursor', r.byClass('breeze-support-older').hidden);
    r.feedState.revision = '1'; r.feed(); await wait(160);
    eq('SQL revision replaces stale cached pages even when merge SSE reset was missed', widgetIds(r), ['Message 3', 'Message 4']);
    check('structural refresh restores correct older cursor', !r.byClass('breeze-support-older').hidden);
    r.feedState.revision = '2'; r.byClass('breeze-support-older').click(); await wait(40);
    eq('revision changing during older-page load restarts from current latest snapshot', widgetIds(r), ['Message 3', 'Message 4']);

    // A POST ack can overlap a latest page despite fifty unseen incoming rows.
    r.feedState.ack = msg(109); r.byClass('breeze-support-form').fire('submit'); await wait();
    r.feedState.messages = Array.from({ length: 50 }, (_, i) => msg(60 + i)); r.feedState.before = '60'; r.feed(); await wait(160);
    eq('long reconnect gap uses the authoritative latest page', widgetIds(r).length, 50);
    eq('sparse own acknowledgement cannot hide missing middle history', widgetIds(r)[0], 'Message 60');
    check('long gap exposes SQL cursor to load skipped history', !r.byClass('breeze-support-older').hidden);
    eq('own POST bubble appears exactly once after snapshot', widgetIds(r).filter(x => x === 'Message 109').length, 1);
    r.doc.hidden = true; r.doc.fire('visibilitychange'); await wait();
    check('hidden tab closes live stream', r.sockets[0].closed);
    r.doc.hidden = false; r.doc.fire('visibilitychange'); await wait();
    eq('visible tab reconnects for a fresh snapshot', r.sockets.length, 2);
    r.byClass('breeze-support-close').click(); await wait();
    check('close restores launcher and releases stream', r.sockets[1].closed && !r.byClass('breeze-support-launcher').hidden);
    const calls = r.calls.length; await wait(180);
    eq('idle closed UI does not poll', r.calls.length, calls);

    const admin = fixture('admin'); admin.login({ uid: 'staff' }, 'admin'); await admin.win.BreezeAdminSupport.load(1); await wait();
    admin.get('admin-support-list').children[0].click(); await wait();
    const region = admin.get('admin-support-messages').parentNode;
    region.clientHeight = 400; region.scrollHeight = 1600; region.scrollTop = 100;
    const readsBeforePush = admin.calls.filter(c => c.url.endsWith('/read')).length;
    admin.get('admin-support-reply').value = 'Admin draft';
    admin.feedState.rows = [{ ...contact, id: '20', name: 'Different conversation' }];
    admin.feedState.messages = [msg(3), msg(4)]; admin.feed(); await wait(160);
    eq('inbox reorder does not remove selected off-page conversation', admin.get('admin-support-contact').textContent, 'Guest');
    eq('off-page selection retains unsent draft', admin.get('admin-support-reply').value, 'Admin draft');
    check('off-page selected history still receives incoming messages', text(admin.get('admin-support-messages')).includes('Message 4'));
    check('off-page thread remains replyable', !admin.get('admin-support-send').disabled);
    eq('incoming push while reading older history does not clear new unread message', admin.calls.filter(c => c.url.endsWith('/read')).length, readsBeforePush);
    region.scrollTop = region.scrollHeight - region.clientHeight; region.fire('scroll'); await wait();
    eq('scrolling to bottom acknowledges only the newly rendered customer message', admin.calls.filter(c => c.url.endsWith('/read')).slice(-1)[0].body.messageId, '4');
    admin.win.BreezeAdminSupport.hide(); await wait();
    check('leaving inbox closes Admin stream', admin.sockets[0].closed);
    await admin.win.BreezeAdminSupport.load(1); await wait();
    eq('returning to inbox opens one fresh stream', admin.sockets.length, 2);
    admin.login(null); await wait();
    check('sign-out closes stream and erases Admin data', admin.sockets[1].closed && !admin.get('admin-support-list').children.length && !admin.get('admin-support-messages').children.length);
})();
