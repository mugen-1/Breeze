const { check, eq } = require('./helpers/assert');
const { wait } = require('./helpers/sandbox');
const { setup, response, defer } = require('./helpers/support-harness');
console.log('Admin support — shared read cursor and unseen message races');
const message = (id, kind = 'customer') => ({ id, text: 'Message ' + id, kind });
function fixture() {
    const r = setup('admin'), state = { unread: true, cursor: null, messages: [message('2'), message('3', 'admin')], gate: null, failure: false };
    const list = () => response({ conversations: [{ id: '10', name: 'Guest', kind: 'guest', unread: state.unread }], page: 1, totalPages: 1 });
    r.state.handle = c => {
        if (c.url.endsWith('/read')) {
            if (state.gate) return state.gate.promise;
            if (state.failure) return Promise.reject(Error('offline'));
            state.cursor = c.body.messageId; state.unread = false;
            return response({ conversationId: '10', readMessageId: state.cursor, unread: false });
        }
        if (c.url.includes('conversations?page=')) return list();
        return response({ messages: state.messages, readMessageId: state.cursor, nextBefore: null });
    };
    r.login({ uid: 'staff' }, 'admin');
    return { ...r, feed: state, reads: () => r.calls.filter(c => c.url.endsWith('/read')) };
}
async function start(r) { await r.win.BreezeAdminSupport.load(1); r.get('admin-support-list').children[0].click(); await wait(); }
const unread = r => r.get('admin-support-list').children[0].className.includes('is-unread');
(async () => {
    const r = fixture(); await r.win.BreezeAdminSupport.load(1); await wait();
    eq('listing and previewing unread inbox do not mark any conversation', r.reads().length, 0);
    check('unread remains bold before selected history is rendered', unread(r));
    r.feed.gate = defer(); r.get('admin-support-list').children[0].click(); await wait();
    eq('rendered selected thread acknowledges latest customer, not Admin reply', r.reads()[0].body, { messageId: '2' });
    check('read POST uses exact route and current Bearer', r.reads()[0].url === '/api/admin/support/conversations/10/read' && r.reads()[0].options.headers.Authorization === 'Bearer staff');
    check('UI does not optimistically clear unread before server confirmation', unread(r));
    r.feed.messages.push(message('4')); r.feed.unread = true;
    r.feed.gate.resolve(response({ conversationId: '10', readMessageId: '2', unread: false })); r.feed.gate = null; await wait();
    check('newer unread SQL state survives older acknowledgement response', unread(r));
    eq('new message is not marked before it is loaded into history', r.reads().length, 1);
    r.get('admin-support-thread-refresh').click(); await wait();
    eq('loading the newer visible message advances explicit read boundary', r.reads()[1].body.messageId, '4');
    check('confirmed latest read clears bold state using refreshed inbox', !unread(r));
    r.get('admin-support-thread-refresh').click(); await wait();
    eq('unchanged history does not keep posting the same read cursor', r.reads().length, 2);

    const old = fixture(); await start(old);
    const region = old.get('admin-support-messages').parentNode;
    region.clientHeight = 400; region.scrollHeight = 1600; region.scrollTop = 100;
    old.feed.messages.push(message('5')); old.feed.unread = true;
    // Explicit refresh intentionally opens the latest messages.
    old.win.BreezeAdminSupport.load(1, true); await wait();
    old.get('admin-support-thread-refresh').click(); await wait();
    const baseline = old.reads().length;
    region.scrollTop = 100; old.feed.messages.push(message('6'));
    region.fire('scroll'); await wait();
    eq('reading older scroll position never acknowledges unseen newer items', old.reads().length, baseline);
    region.scrollTop = region.scrollHeight - region.clientHeight; region.fire('scroll'); await wait();
    eq('scroll alone cannot acknowledge a message absent from loaded snapshot', old.reads().length, baseline);
    old.win.BreezeAdminSupport.hide(); old.feed.messages.push(message('7'));
    region.fire('scroll'); await wait();
    eq('leaving the inbox disables read writes', old.reads().length, baseline);

    const hidden = fixture(); hidden.doc.hidden = true; await start(hidden);
    eq('hidden tab history does not mark read', hidden.reads().length, 0);
    hidden.doc.hidden = false; hidden.get('admin-support-back').click();
    hidden.get('admin-support-messages').parentNode.fire('scroll'); await wait();
    eq('mobile back to inbox prevents hidden thread from marking read', hidden.reads().length, 0);
    hidden.get('admin-support-list').children[0].click(); await wait();
    eq('reopening visible thread can mark read', hidden.reads().length, 1);
    const failed = fixture(); failed.feed.failure = true; await start(failed);
    check('failed acknowledgement preserves server unread bold state', unread(failed));
    check('read failure has a visible translated retry message', failed.get('admin-support-unavailable').textContent.includes('trạng thái đã đọc'));
    const once = failed.reads().length; await wait(100);
    eq('network failure never creates an automatic POST retry loop', failed.reads().length, once);
    failed.feed.failure = false; failed.get('admin-support-thread-refresh').click(); await wait();
    check('manual history refresh retries failed acknowledgement successfully', !unread(failed));
    const committed = fixture(); committed.feed.gate = defer(); await start(committed);
    committed.feed.cursor = '2'; committed.feed.unread = false;
    committed.feed.gate.reject(Error('reply lost after SQL commit')); committed.feed.gate = null; await wait();
    check('lost acknowledgement response does not invent a successful local read', unread(committed));
    committed.get('admin-support-thread-refresh').click(); await wait();
    check('history SQL cursor recovers committed read when POST response was lost', !unread(committed));
    eq('recovered read does not resend POST for the same cursor', committed.reads().length, 1);
    const shared = fixture(); shared.feed.cursor = '9007199254740993'; shared.feed.messages = [message('9007199254740992')]; await start(shared);
    eq('another Admin cursor and BIGINT comparison prevent redundant/stale writes', shared.reads().length, 0);
    const lost = fixture(); lost.feed.gate = defer(); await start(lost); lost.login(null);
    lost.feed.gate.resolve(response({ conversationId: '10', readMessageId: '2', unread: false })); await wait();
    eq('late read confirmation after signout cannot reload private inbox', lost.get('admin-support-list').children.length, 0);
})();
