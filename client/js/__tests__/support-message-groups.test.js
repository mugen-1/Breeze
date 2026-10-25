const { check, eq } = require('./helpers/assert');
const { wait } = require('./helpers/sandbox');
const { setup, response, text } = require('./helpers/support-harness');

console.log('Support chat — waiting notice visibility and five-minute message groups');
const message = (id, kind, createdAt, senderUserId) => ({ id, kind, text: 'Message ' + id,
    createdAt: '2026-10-21T' + createdAt + 'Z', senderName: kind === 'admin' ? 'Staff' : 'Customer',
    ...(senderUserId ? { senderUserId } : {}) });
const messages = [
    message('1', 'customer', '08:00:00.000'),
    { ...message('2', 'system', '08:00:00.000'), text: 'quý khách vui lòng đợi ít phút' },
    message('3', 'customer', '08:00:30.000'),
    message('4', 'customer', '08:05:30.000'), // Exactly five minutes: same group.
    message('5', 'customer', '08:10:30.001'), // Five minutes plus one millisecond: new group.
    message('6', 'admin', '08:10:31.000', '10'),
    message('7', 'admin', '08:10:32.000', '20'), // Same display name, different Admin.
    message('8', 'admin', '08:11:00.000', '20')
];
const continued = row => row.className.split(' ').includes('is-continuation');

(async () => {
    const admin = setup('admin'); admin.login({ uid: 'staff' }, 'admin');
    admin.state.handle = c => {
        if (c.url.startsWith('/api/admin/support/conversations?')) return response({
            conversations: [{ id: '10', name: 'Customer', kind: 'customer' }], page: 1, totalPages: 1 });
        if (c.url.endsWith('/messages')) return response({ messages: messages.slice(2), nextBefore: '3' });
        if (c.url.endsWith('/messages?before=3')) return response({ messages: messages.slice(0, 3), nextBefore: null });
        if (c.url.endsWith('/read')) return response({ conversationId: '10', readMessageId: c.body.messageId });
    };
    await admin.win.BreezeAdminSupport.load(1);
    admin.get('admin-support-list').children[0].click(); await wait();
    admin.get('admin-support-older').click(); await wait();
    let rows = admin.get('admin-support-messages').children;
    eq('Admin retains all human bubbles across history pages', rows.map(row => row.children[0].textContent),
        ['Message 1', 'Message 3', 'Message 4', 'Message 5', 'Message 6', 'Message 7', 'Message 8']);
    check('waiting notice is absent from Admin transcript', !text(admin.get('admin-support-messages')).includes(messages[1].text));
    eq('adjacent customer messages group across the hidden waiting notice and page boundary', rows.map(continued),
        [false, true, true, false, false, false, true]);
    eq('only the last bubble of each group has a sender/time caption', rows.map(row => row.children.length), [1, 1, 2, 2, 2, 1, 2]);
    check('last group caption includes sender and time', rows[6].children[1].textContent.includes('Staff · '));

    const user = setup('widget'); user.login(null);
    user.state.handle = c => {
        if (c.url === '/api/support/conversation') return response({ conversation: { id: '10' } });
        if (c.url === '/api/support/conversation/messages') return response({ conversation: { id: '10' }, messages, nextBefore: null });
    };
    user.byClass('breeze-support-launcher').click(); await wait();
    rows = user.byClass('breeze-support-transcript').children;
    eq('User still sees every message including waiting notice', rows.length, messages.length);
    check('waiting notice is retained for User', text(rows[1]).includes(messages[1].text));
    eq('visible notice and sender changes separate User groups', rows.map(continued),
        [false, false, false, true, false, false, false, true]);
    eq('User sees one caption at the end of each group', rows.map(row => row.children[0].children.length), [2, 2, 1, 2, 2, 2, 1, 2]);
    user.doc.fire('langchange');
    eq('language redraw keeps grouping and waiting notice', user.byClass('breeze-support-transcript').children.map(continued),
        [false, false, false, true, false, false, false, true]);

    const sameGroup = user.win.BreezeSupportAPI.sameGroup;
    check('missing dates never merge', !sameGroup({ kind: 'customer' }, { kind: 'customer' }));
    check('invalid dates never merge', !sameGroup({ ...messages[0], createdAt: 'bad' }, messages[2]));
    check('reversed dates never merge', !sameGroup(messages[3], messages[2]));
})();
