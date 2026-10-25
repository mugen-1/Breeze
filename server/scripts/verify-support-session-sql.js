'use strict';
// Lifecycle verification: actual SQL/HTTP/frontend, fixture Firebase I/O only.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { execFileSync } = require('node:child_process'), { randomUUID } = require('node:crypto');
const path = require('node:path'), assert = require('node:assert/strict'), express = require('express');
const db = require('../db'), { sql, config } = db;
const { setup, text } = require('../../client/js/__tests__/helpers/support-harness');
const dbName = 'BreezeSupportSessionTest_' + process.pid + '_' + Date.now();
if (!/^BreezeSupportSessionTest_[0-9]+_[0-9]+$/.test(dbName) || dbName.toLowerCase() === String(config.database).toLowerCase()) throw Error('Unsafe test database');
const quoted = '[' + dbName + ']', tokens = new Map(), uids = new Map(), clients = [], controllers = [], notices = [];
let pool, server, base, support, sessions, created = false, checks = 0, unsubscribe;
function adminSql(query) { execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' }); }
function same(label, actual, expected) { assert.deepEqual(actual, expected, label); checks++; console.log('PASS: ' + label); }
function check(label, value) { same(label, !!value, true); }
const message = (text, key = randomUUID()) => ({ text, clientMessageId: key });
async function call(method, url, { token, cookie, body, headers = {} } = {}) {
    const r = await fetch(base + '/api/' + url, { method, headers: { ...(token !== undefined ? { Authorization: 'Bearer ' + token } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') };
}
const sync = (token, cookie) => call('POST', 'support/session', { token, cookie, body: {} });
async function user(token, role = 'customer') {
    const uid = 'support-session-' + token; tokens.set(token, uid); uids.set(token, uid);
    return (await pool.request().input('uid', sql.VarChar(128), uid).input('role', sql.VarChar(20), role)
        .query(`INSERT INTO dbo.users(firebase_uid,email,display_name,role) OUTPUT INSERTED.id VALUES(@uid,@uid+'@example.test',@uid,@role);`)).recordset[0].id;
}
async function guest(name = 'Guest', key = randomUUID()) {
    const profile = { name, email: 'support-session-owner@example.test', ...message(name + ' question', key) };
    const r = await support.startGuest(pool, support.guestInput(profile));
    return { ...r, profile, cookie: 'breeze_support_guest=' + r.token, hash: support.hashToken(r.token) };
}
async function rows(cid) {
    return (await pool.request().input('cid', sql.BigInt, cid).query('SELECT id,sender_kind,admin_actor_id,body,system_code,client_message_id,created_at FROM dbo.support_messages WHERE conversation_id=@cid ORDER BY created_at,id;')).recordset;
}
async function state() { return (await pool.request().query('SELECT * FROM dbo.support_conversations ORDER BY id; SELECT * FROM dbo.support_messages ORDER BY id; SELECT * FROM dbo.support_guest_sessions ORDER BY id;')).recordsets; }
async function exists(cid) { return (await pool.request().input('cid', sql.BigInt, cid).query('SELECT COUNT(*) AS n FROM dbo.support_conversations WHERE id=@cid;')).recordset[0].n; }
async function expire(cid) {
    await pool.request().input('cid', sql.BigInt, cid).query(`UPDATE dbo.support_guest_sessions SET created_at=DATEADD(minute,-10,SYSUTCDATETIME()),
        last_seen_at=DATEADD(minute,-10,SYSUTCDATETIME()),expires_at=DATEADD(second,-1,SYSUTCDATETIME()) WHERE conversation_id=@cid;`);
}
async function until(fn, label) {
    const end = Date.now() + 10000;
    while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); }
    throw Error('Timed out: ' + label);
}
async function main() {
    try {
        adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
        adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
        console.log('Created disposable database:', dbName);
        execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 2 * 1024 * 1024 });
        pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
        require.cache[require.resolve('../db')].exports = { ...db, getPool: async () => pool };
        require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ verifyIdToken: async (token, revoked) => {
            assert.equal(revoked, true); if (!tokens.has(token)) throw Error('Fixture token rejected'); return { uid: tokens.get(token) };
        } }) } };
        support = require('../lib/customer-support'); sessions = require('../lib/support-session');
        unsubscribe = require('../lib/support-events').hub.subscribe(n => notices.push(n));
        process.env.ADMIN_EMAILS = '';
        const app = express(); app.use(express.json({ limit: '100kb' }));
        app.use('/api/me', require('../routes/me')); app.use('/api/support', require('../routes/support')); app.use('/api/admin', require('../routes/admin'));
        server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port;
        const owner = await user('owner'), empty = await user('empty'), staff = await user('staff', 'admin');
        await user('race-a'); await user('race-b'); await user('ui');
        same('anonymous bootstrap without cookie creates no chat', (await sync()).body, { role: 'guest', active: false });
        same('heartbeat without cookie creates no session', (await call('POST', 'support/heartbeat', { body: {} })).body, { active: false });
        same('empty bootstrap has no SQL chat rows', (await state())[0].length, 0);
        const emptyState = await state(), emptyNotices = notices.length;
        await pool.request().batch(`CREATE TRIGGER dbo.support_wait_fixture_fail ON dbo.support_messages AFTER INSERT AS
          BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE sender_kind='system') THROW 51000,'PRIVATE wait fixture failure',1; END;`);
        const failedWait = await call('POST', 'support/guest-session', { body: { name: 'Wait rollback', email: 'rollback@example.test', ...message('Cannot commit wait') } });
        same('wait insertion failure does not issue a successful guest credential', [failedWait.status, failedWait.cookie], [500, null]);
        same('wait failure rolls back first human, session and conversation atomically', await state(), emptyState);
        same('failed first wait emits no SSE notification', notices.length, emptyNotices);
        await pool.request().query('DROP TRIGGER dbo.support_wait_fixture_fail;');
        const g = await guest('Heartbeat guest');
        same('first human message and exactly one wait commit together', (await rows(g.conversationId)).map(r => [r.sender_kind, r.body]), [['customer', g.profile.text], ['system', 'quý khách vui lòng đợi ít phút']]);
        same('first-send response includes persisted wait for immediate UI rendering', g.systemMessage.text, 'quý khách vui lòng đợi ít phút');
        const replay = await support.startGuest(pool, support.guestInput(g.profile), g.token);
        same('retry reuses the same system message ID', replay.systemMessage.id, g.systemMessage.id);
        same('retry does not create another human or system message', (await rows(g.conversationId)).length, 2);
        await call('POST', 'support/messages', { cookie: g.cookie, body: message('More from guest') });
        same('subsequent send never repeats the first wait', (await rows(g.conversationId)).filter(r => r.system_code).length, 1);
        await pool.request().input('cid', sql.BigInt, g.conversationId).query('UPDATE dbo.support_guest_sessions SET expires_at=DATEADD(second,30,SYSUTCDATETIME()) WHERE conversation_id=@cid;');
        same('cookie-authenticated heartbeat succeeds', (await call('POST', 'support/heartbeat', { cookie: g.cookie, body: {} })).status, 200);
        same('heartbeat renews approved five-minute lease', (await pool.request().input('cid', sql.BigInt, g.conversationId).query('SELECT DATEDIFF(second,last_seen_at,expires_at) AS seconds FROM dbo.support_guest_sessions WHERE conversation_id=@cid;')).recordset[0].seconds, 300);
        same('another tab can renew same shared browser session', (await sync(undefined, g.cookie)).body.active, true);
        same('heartbeat rejects extra/forged identity', (await call('POST', 'support/heartbeat', { cookie: g.cookie, body: { userId: owner } })).status, 400);
        same('heartbeat rejects cross-site requests', (await call('POST', 'support/heartbeat', { cookie: g.cookie, body: {}, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
        same('signed-in customer never falls back to guest heartbeat', (await call('POST', 'support/heartbeat', { token: 'owner', cookie: g.cookie, body: {} })).status, 403);
        const beforeBad = await state();
        same('invalid Firebase token cannot claim valid guest credential', (await sync('invalid', g.cookie)).status, 401);
        same('failed proof changes no chat data', await state(), beforeBad);
        same('valid account with malformed cookie is not locked out', (await sync('empty', 'breeze_support_guest=bad')).status, 200);
        same('matching email without cookie proves no guest ownership', (await sync('owner')).body.merged, false);
        same('guest remains unattached without cookie proof', (await state())[0].find(c => String(c.id) === g.conversationId).user_id, null);

        const reply = (await call('POST', 'admin/support/conversations/' + g.conversationId + '/messages', { token: 'staff', body: message('Staff before account transfer') })).body;
        await call('POST', 'admin/support/conversations/' + g.conversationId + '/read', { token: 'staff', body: { messageId: g.message.id } });
        const original = await rows(g.conversationId);
        const adopted = await sync('empty', g.cookie);
        same('new account adopts existing guest conversation', [adopted.body.merged, adopted.body.conversationId], [true, g.conversationId]);
        same('transfer preserves all message IDs, text, chronology and staff actor', await rows(g.conversationId), original);
        check('successful transfer expires shared browser guest cookie', /Expires=Thu, 01 Jan 1970/i.test(adopted.cookie));
        same('transfer physically revokes guest credential row', (await state())[2].some(s => String(s.conversation_id) === g.conversationId), false);
        same('old cookie from another tab cannot read transferred account history', (await call('GET', 'support/conversation/messages', { cookie: g.cookie })).status, 401);
        same('old cookie cannot heartbeat transferred history back into guest ownership', (await call('POST', 'support/heartbeat', { cookie: g.cookie, body: {} })).status, 401);
        same('account sees actual adopted conversation', (await call('GET', 'support/conversation', { token: 'empty' })).body.conversation.id, g.conversationId);
        same('transfer retry after committed response loss is harmless', (await sync('empty', g.cookie)).body.merged, false);

        const collision = randomUUID();
        const account = (await call('POST', 'support/messages', { token: 'owner', body: message('Account original', collision) })).body;
        const other = await guest('Merge guest', collision);
        await call('POST', 'admin/support/conversations/' + other.conversationId + '/messages', { token: 'staff', body: message('Guest Admin response') });
        // Make guest wait earlier without relying on JavaScript timestamp rounding.
        await pool.request().input('cid', sql.BigInt, other.conversationId).query("UPDATE dbo.support_messages SET created_at=DATEADD(minute,-1,created_at) WHERE conversation_id=@cid AND system_code='first_wait';");
        await call('POST', 'admin/support/conversations/' + account.conversationId + '/read', { token: 'staff', body: { messageId: account.message.id } });
        const humans = (await rows(account.conversationId)).concat(await rows(other.conversationId)).filter(r => r.sender_kind !== 'system')
            .map(({ client_message_id, ...r }) => r).sort((a, b) => String(a.id).length - String(b.id).length || String(a.id).localeCompare(String(b.id)));
        const merged = await sync('owner', other.cookie);
        same('existing account keeps its one conversation', [merged.body.merged, merged.body.conversationId], [true, account.conversationId]);
        const mergedRows = await rows(account.conversationId);
        same('merge keeps every human message with original ID, staff, text and time', mergedRows.filter(r => r.sender_kind !== 'system').map(({ client_message_id, ...r }) => r)
            .sort((a, b) => String(a.id).length - String(b.id).length || String(a.id).localeCompare(String(b.id))), humans);
        same('merge keeps only earliest wait across both histories', mergedRows.filter(r => r.system_code).map(r => String(r.id)), [other.systemMessage.id]);
        same('colliding retry UUID preserves source human by clearing only its retry key', mergedRows.find(r => String(r.id) === other.message.id).client_message_id, null);
        same('target retry key remains usable', (await call('POST', 'support/messages', { token: 'owner', body: message('Account original', collision) })).body.message.id, account.message.id);
        same('old guest conversation and credential are physically removed after merge', [await exists(other.conversationId), (await state())[2].some(s => String(s.conversation_id) === other.conversationId)], [0, false]);
        check('unread from source is preserved after merge', (await call('GET', 'admin/support/conversations', { token: 'staff' })).body.conversations.find(c => c.id === account.conversationId).unread);
        const repeated = await sync('owner', other.cookie); same('repeat merge cannot duplicate messages', repeated.body.merged, false);
        const expiring = await guest('Expiring unread'); await expire(expiring.conversationId);
        same('expired heartbeat cannot revive a session', (await call('POST', 'support/heartbeat', { cookie: expiring.cookie, body: {} })).status, 401);
        const inactiveMerge = await sync('owner', expiring.cookie); same('expired guest cannot be claimed into permanent account history', inactiveMerge.body.merged, false);
        check('cleanup physically deletes unread expired conversation', (await sessions.cleanupExpired(pool)).removed >= 1);
        same('cleanup removes all messages and guest session rows', [await exists(expiring.conversationId), (await rows(expiring.conversationId)).length, (await state())[2].some(s => String(s.conversation_id) === expiring.conversationId)], [0, 0, false]);
        same('cleanup never deletes a transferred account conversation', await exists(g.conversationId), 1);
        const readExpired = await guest('Read expired'); await support.markRead(pool, { kind: 'admin', userId: staff }, readExpired.conversationId, readExpired.message.id); await expire(readExpired.conversationId);
        const worker = sessions.startCleanup(async () => pool, { intervalMs: 20 });
        try { for (let i = 0; i < 100 && await exists(readExpired.conversationId); i++) await new Promise(r => setTimeout(r, 20)); }
        finally { worker.stop(); }
        same('cleanup also deletes read conversations despite composite read FK', [await exists(readExpired.conversationId), (await rows(readExpired.conversationId)).length], [0, 0]);
        const race = await guest('Racing claims');
        const claims = await Promise.all([sync('race-a', race.cookie), sync('race-b', race.cookie)]);
        same('two accounts racing for one cookie both complete safely', claims.map(r => r.status), [200, 200]);
        same('only one account can adopt the same guest proof', claims.filter(r => r.body.merged).length, 1);
        const sender = await guest('Send during transfer');
        const sendRace = await Promise.all([sync('owner', sender.cookie), call('POST', 'support/messages', { cookie: sender.cookie, body: message('Concurrent guest send') })]);
        same('transfer racing a guest send commits transfer', sendRace[0].status, 200);
        check('concurrent guest send either commits before transfer or is denied afterwards', [201, 401].includes(sendRace[1].status));
        if (sendRace[1].status === 201) check('successfully acknowledged racing message is retained in account', (await rows(account.conversationId)).some(m => String(m.id) === sendRace[1].body.message.id));

        const rollback = await guest('Rollback transfer'); const beforeFailure = await state(), beforeNotices = notices.length;
        await pool.request().batch(`CREATE TRIGGER dbo.support_transfer_fixture_fail ON dbo.support_messages AFTER UPDATE AS BEGIN THROW 51000,'PRIVATE merge fixture failure',1; END;`);
        const failed = await sync('owner', rollback.cookie);
        same('merge SQL failure is a safe API error', [failed.status, failed.body.code], [500, 'SUPPORT_ERROR']);
        same('failed merge rolls back wait deletion, cursor, credentials and moved messages', await state(), beforeFailure);
        same('rolled-back merge emits no post-commit notice', notices.length, beforeNotices);
        same('failed merge does not clear proof needed for retry', failed.cookie, null);
        await pool.request().query('DROP TRIGGER dbo.support_transfer_fixture_fail;');
        await pool.request().input('cid', sql.BigInt, rollback.conversationId).query('UPDATE dbo.support_guest_sessions SET revoked_at=SYSUTCDATETIME() WHERE conversation_id=@cid;');
        same('revoked guest cannot renew with heartbeat', (await call('POST', 'support/heartbeat', { cookie: rollback.cookie, body: {} })).status, 401);
        await sessions.cleanupExpired(pool);
        same('cleanup physically removes revoked sessions too', await exists(rollback.conversationId), 0);
        const adminGuest = await guest('Admin discard');
        await call('POST', 'admin/support/conversations/' + adminGuest.conversationId + '/messages', { token: 'staff', body: message('Guest reply to remove') });
        const discarded = await sync('staff', adminGuest.cookie);
        same('Admin login discards guest instead of receiving it', [discarded.body.role, discarded.body.discarded, discarded.body.merged], ['admin', true, false]);
        same('Admin discard physically deletes guest messages and credentials', [await exists(adminGuest.conversationId), (await rows(adminGuest.conversationId)).length], [0, 0]);
        same('Admin cookie is expired after discard', /Expires=Thu, 01 Jan 1970/i.test(discarded.cookie), true);
        same('Admin still has no customer conversation', (await state())[0].some(c => c.user_id === staff), false);
        check('discard does not remove actual Admin reply in other account history', (await rows(g.conversationId)).some(m => String(m.id) === reply.message.id));

        // Real frontend: two pages share the HTTP cookie jar. One signs in;
        // the other guest stream must close and erase its old private transcript.
        const cachedSource = await guest('Merge into open account');
        const jar = { cookie: '' };
        async function browserFetch(url, options = {}) {
            const controller = new AbortController(); controllers.push(controller);
            if (options.signal) options.signal.addEventListener('abort', () => controller.abort(), { once: true });
            const r = await fetch(base + url, { ...options, headers: { ...options.headers, ...(jar.cookie && url.startsWith('/api/support/') ? { Cookie: jar.cookie } : {}) }, signal: controller.signal });
            const cookie = r.headers.get('set-cookie'); if (cookie) jar.cookie = /Expires=Thu, 01 Jan 1970/i.test(cookie) ? '' : cookie.split(';')[0];
            return r;
        }
        const ui = setup('widget', { lifecycle: true, stream: true, fetch: browserFetch }); clients.push(ui); ui.login(null);
        await ui.win.BreezeSupportSession.prepare(null); ui.byClass('breeze-support-launcher').click();
        await until(() => ui.get('breeze-support-panel').getAttribute('aria-busy') === 'false', 'UI first load');
        ui.get('breeze-support-name').value = 'UI guest'; ui.get('breeze-support-email').value = 'ui@example.test'; ui.get('breeze-support-message').value = 'UI first question'; ui.byClass('breeze-support-form').fire('submit');
        await until(() => ui.get('breeze-support-message').value === '', 'UI send');
        check('UI first POST renders persisted wait immediately', text(ui.byClass('breeze-support-transcript')).includes('quý khách vui lòng đợi ít phút'));
        const pageTwo = setup('widget', { lifecycle: true, stream: true, fetch: browserFetch }); clients.push(pageTwo); pageTwo.login(null); await pageTwo.win.BreezeSupportSession.prepare(null); pageTwo.byClass('breeze-support-launcher').click();
        await until(() => text(pageTwo.byClass('breeze-support-transcript')).includes('UI first question'), 'second tab history');
        ui.state.token = 'ui'; ui.login({ uid: uids.get('ui') }, 'customer'); await ui.win.BreezeSupportSession.prepare(uids.get('ui'));
        await until(() => !ui.get('breeze-support').hidden, 'customer role'); ui.byClass('breeze-support-launcher').click();
        await until(() => text(ui.byClass('breeze-support-transcript')).includes('UI first question'), 'adopted UI history');
        check('UI login automatically preserves guest history under account', text(ui.byClass('breeze-support-transcript')).includes('UI first question'));
        await until(() => pageTwo.byClass('breeze-support-transcript').children.length === 0, 'old guest stream access loss');
        check('other tab cannot retain private guest history after transfer', !pageTwo.byClass('breeze-support-guest').hidden);
        same('frontend transfer clears shared guest cookie', jar.cookie, '');
        const uiCid = (await call('GET', 'support/conversation', { token: 'ui' })).body.conversation.id;
        const snapshot = (await call('GET', 'admin/support/conversations/' + uiCid + '/messages', { token: 'staff' })).body;
        await sync('ui', cachedSource.cookie);
        const staleRead = await call('POST', 'admin/support/conversations/' + uiCid + '/read', { token: 'staff',
            body: { messageId: snapshot.messages.find(m => m.kind === 'customer').id, messageCount: snapshot.messageCount } });
        same('pre-merge read snapshot cannot acknowledge newly merged history', [staleRead.status, staleRead.body.code], [409, 'SUPPORT_HISTORY_CHANGED']);
        await until(() => text(ui.byClass('breeze-support-transcript')).includes('Merge into open account question'), 'open account reset after merge');
        same('open account replaces deleted cached wait instead of showing two waits', ui.byClass('breeze-support-transcript').children.filter(el => el.className.endsWith('--system')).length, 1);
        same('no lifecycle chat, name or token is persisted in browser storage', clients.flatMap(c => c.writes), []);
        check('all surviving conversations have at most one automatic wait', !(await pool.request().query("SELECT conversation_id FROM dbo.support_messages WHERE system_code='first_wait' GROUP BY conversation_id HAVING COUNT(*)>1;")).recordset.length);
        console.log('Support lifecycle + SQL verification:', checks, 'checks passed. Configured store unchanged.');
    } finally {
        for (const c of clients) { c.doc.hidden = true; if (c.win._l.pagehide) c.win._l.pagehide(); }
        if (unsubscribe) unsubscribe(); require('../middleware/support-stream').stream.closeAll(); controllers.forEach(c => c.abort());
        try { if (server) await new Promise(r => server.close(r)); if (pool) await pool.close(); }
        finally { if (created) { adminSql('ALTER DATABASE ' + quoted + ' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + quoted + ';'); console.log('Removed disposable database:', dbName); } }
    }
}
main().catch(error => {
    console.error(error.stack || error.message);
    if (error.stdout) console.error(error.stdout.toString().split('\n').slice(-12).join('\n'));
    if (error.stderr) console.error(error.stderr.toString().split('\n').slice(-12).join('\n'));
    process.exitCode = 1;
});
