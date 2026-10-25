const { check, eq } = require('./helpers/assert');
const { wait } = require('./helpers/sandbox');
const { setup, response, defer, text, navigation } = require('./helpers/support-harness');
const fs = require('node:fs'), path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../../..', file), 'utf8');
console.log('admin-support.js — Task 5 API integration');
const msg = (id, value, kind = 'customer') => ({ id, text: value, kind, createdAt: '2026-10-21T08:00:00Z', senderName: kind === 'admin' ? 'Actual admin' : 'Guest' });
const rows = [
    { id: '10', name: '<img src=x onerror=alert(1)>', email: 'guest@example.test', kind: 'guest', unread: true,
        preview: '<script>literal</script>', updatedAt: '2026-10-21T08:00:00Z' },
    { id: '20', name: 'Account', email: null, kind: 'customer', unread: false, preview: 'Account text', updatedAt: '2026-10-21T07:00:00Z' }
];
(async () => {
    const html = read('client/admin.html'), source = read('client/js/admin-support.js');
    eq('sidebar order remains intact', [...html.matchAll(/data-nav="([^"]+)"/g)].map(m => m[1]), navigation);
    check('all controls used by script exist in real markup', [...source.matchAll(/\$\('([^']+)'\)/g)].every(m => html.includes('id="' + m[1] + '"')));
    check('shared transport loads before Admin support', html.indexOf('js/support-api.js') < html.indexOf('js/admin-support.js'));
    const r = setup('admin', { shell: true });
    eq('unknown user makes no chat requests', r.calls.filter(c => c.url.includes('/support/')).length, 0);
    r.login({ uid: 'staff' }, 'admin'); await wait(40);
    check('existing Admin role gate still allows Admin', r.doc.body.classList.contains('adm-authed'));
    let list = rows, sendFailure = false, sendPending = null, aHistory = null, expires = false;
    r.state.handle = c => {
        if (c.url.endsWith('/read')) {
            list.find(row => row.id === c.url.split('/')[5]).unread = false;
            return response({ conversationId: c.url.split('/')[5], readMessageId: c.body.messageId, unread: false });
        }
        if (c.url.startsWith('/api/admin/support/conversations?')) {
            const page = Number(new URL(c.url, 'http://fixture.test').searchParams.get('page'));
            return response({ conversations: page === 2 ? [rows[1]] : list, page, totalPages: 2, total: 2 });
        }
        if (c.url.includes('/support/conversations/') && c.options.method === 'POST') {
            if (sendFailure) return Promise.reject(Error('offline'));
            if (sendPending) return sendPending.promise;
            return response({ conversationId: '10', message: msg('5', c.body.text, 'admin'), replayed: true }, 200);
        }
        if (c.url.startsWith('/api/admin/support/conversations/10/messages')) {
            if (expires) return response({ code: 'SUPPORT_NOT_FOUND' }, 404);
            if (aHistory) return aHistory.promise;
            return response({ messages: c.url.includes('before=2') ? [msg('1', 'Older'), msg('2', '<script>message</script>')] :
                [msg('2', '<script>message</script>'), msg('3', 'Real reply', 'admin')], nextBefore: c.url.includes('before=2') ? null : '2' });
        }
        if (c.url.startsWith('/api/admin/support/conversations/20/messages')) return response({ messages: [msg('4', 'Account text')], nextBefore: null });
    };
    r.navs[7].click(); await wait();
    check('feedback navigation still switches existing panels', r.get('view-feedback').style.display === 'block' && r.get('tab-products').style.display === 'none');
    eq('opening feedback fetches actual inbox endpoint', r.calls.filter(c => c.url.startsWith('/api/admin/support/conversations?')).length, 1);
    eq('real inbox response renders rows', r.get('admin-support-list').children.length, 2);
    check('only server unread state is bold', r.get('admin-support-list').children[0].className.includes('is-unread') && !r.get('admin-support-list').children[1].className.includes('is-unread'));
    eq('untrusted contact is literal text', r.get('admin-support-list').children[0].children[0].children[0].textContent, rows[0].name);
    eq('preview is not injected as HTML', r.get('admin-support-list').children[0].children[1].innerHTML, '');
    r.get('admin-support-list').children[0].click(); await wait();
    check('selection fetches selected thread history', r.calls.some(c => c.url === '/api/admin/support/conversations/10/messages'));
    eq('guest contact is displayed', r.get('admin-support-email').textContent, rows[0].email);
    eq('guest is distinguished from account', r.get('admin-support-kind').textContent, 'Khách vãng lai');
    check('selection opens mobile detail and focuses heading', r.get('admin-support').getAttribute('data-thread-open') === 'true' && r.doc.activeElement === r.get('admin-support-contact'));
    eq('history renders customer and Admin bubbles', r.get('admin-support-messages').children.map(el => el.className), ['adm-support-message adm-support-message--customer', 'adm-support-message adm-support-message--admin']);
    check('actual replying Admin name appears', text(r.get('admin-support-messages')).includes('Actual admin'));
    eq('message text stays escaped by textContent', r.get('admin-support-messages').children[0].children[0].textContent, '<script>message</script>');
    check('empty reply cannot send', r.get('admin-support-send').disabled);
    r.get('admin-support-older').click(); await wait();
    eq('older page merges without duplicate message', r.get('admin-support-messages').children.length, 3);
    check('confirmed read refreshes SQL unread state', !r.get('admin-support-list').children[0].className.includes('is-unread'));
    const input = r.get('admin-support-reply'); input.value = 'Reply draft'; input.fire('input');
    check('loaded thread enables nonblank reply', !r.get('admin-support-send').disabled);
    sendFailure = true; r.get('admin-support-form').fire('submit'); await wait();
    eq('failed send preserves draft', input.value, 'Reply draft');
    eq('failed send adds no fake reply', r.get('admin-support-messages').children.length, 3);
    const oldKey = r.calls.filter(c => c.options.method === 'POST' && c.url.endsWith('/messages')).slice(-1)[0].body.clientMessageId;
    sendFailure = false; sendPending = defer();
    r.get('admin-support-form').fire('submit'); r.get('admin-support-form').fire('submit'); await wait();
    eq('retry keeps request UUID', r.calls.filter(c => c.options.method === 'POST' && c.url.endsWith('/messages')).slice(-1)[0].body.clientMessageId, oldKey);
    eq('rapid double submit creates only one additional POST', r.calls.filter(c => c.options.method === 'POST' && c.url.endsWith('/messages')).length, 2);
    check('pending send disables composer', input.disabled && r.get('admin-support-send').disabled);
    sendPending.resolve(response({ conversationId: '10', message: msg('5', 'Reply draft', 'admin') }, 201)); await wait(); sendPending = null;
    eq('confirmed reply clears draft', input.value, '');
    eq('confirmed reply appears once', r.get('admin-support-messages').children.length, 4);
    const posts = r.calls.filter(c => c.options.method === 'POST' && c.url.endsWith('/messages'));
    check('reply API carries Bearer but no claimed sender fields', posts[0].options.headers.Authorization === 'Bearer staff' &&
        Object.keys(posts[0].body).sort().join(',') === 'clientMessageId,text');
    const callsBeforeLang = r.calls.length;
    r.win.__i18n.current = 'en'; r.doc.fire('langchange');
    eq('language switch does not fetch dashboard or chat data', r.calls.length, callsBeforeLang);
    eq('kind label switches language', r.get('admin-support-kind').textContent, 'Guest');
    r.get('admin-support-back').click();
    check('back restores row focus', r.doc.activeElement === r.get('admin-support-list').children[0]);
    r.get('admin-support-next').click(); await wait();
    eq('inbox next page uses API pagination', r.calls.filter(c => c.url.startsWith('/api/admin/support/conversations?')).slice(-1)[0].url, '/api/admin/support/conversations?page=2');
    eq('page indicator uses server metadata', r.get('admin-support-page').textContent, '2 / 2');
    r.get('admin-support-prev').click(); await wait();
    aHistory = defer(); r.get('admin-support-list').children[0].click(); await wait();
    r.get('admin-support-list').children[1].click(); await wait();
    aHistory.resolve(response({ messages: [msg('9', 'OLD PRIVATE THREAD')], nextBefore: null })); await wait(); aHistory = null;
    check('late history from A cannot replace selected B transcript', text(r.get('admin-support-messages')).includes('Account text') && !text(r.get('admin-support-messages')).includes('OLD PRIVATE THREAD'));
    check('registered customer hides missing email', r.get('admin-support-email').hidden);
    r.get('admin-support-list').children[0].click(); await wait(); expires = true;
    r.get('admin-support-thread-refresh').click(); await wait();
    check('expired thread is removed and transcript cleared', r.get('admin-support-messages').children.length === 0 && r.get('admin-support-list').children.length === 1);
    check('expired session visibly explains unavailability', !r.get('admin-support-unavailable').hidden);
    r.login(null); await wait();
    check('signout clears inbox, history and contact', r.get('admin-support-list').children.length === 0 && r.get('admin-support-messages').children.length === 0 && r.get('admin-support-email').textContent === '');
    const before = r.calls.length; await r.win.BreezeAdminSupport.load(1);
    eq('signed-out UI cannot load Admin API', r.calls.length, before);
    eq('no transcript or token is persisted', r.writes, []);
    check('no unsafe HTML, separate socket, polling or local persistence added', !/innerHTML|EventSource|WebSocket|setInterval|localStorage|sessionStorage/.test(source));
    check('markup has no inline handlers', !/\son\w+=|javascript:/i.test(html.slice(html.indexOf('id="view-feedback"'), html.indexOf('</main>'))));
})();
