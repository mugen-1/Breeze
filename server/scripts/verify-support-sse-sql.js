'use strict';
// Real UI scripts -> streaming HTTP -> SQL in a disposable database.
// Only Firebase network I/O is substituted. No fixtures enter the configured store.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { execFileSync } = require('node:child_process');
const path = require('node:path'), assert = require('node:assert/strict'), express = require('express');
const db = require('../db'), { sql, config } = db;
const { setup, text } = require('../../client/js/__tests__/helpers/support-harness');
const dbName = 'BreezeSupportSseTest_' + process.pid + '_' + Date.now();
if (!/^BreezeSupportSseTest_[0-9]+_[0-9]+$/.test(dbName) || dbName.toLowerCase() === String(config.database).toLowerCase()) throw Error('Unsafe test database');
const quoted = '[' + dbName + ']', tokens = new Map(), revoked = new Set(), clients = [], browsers = [];
let pool, server, base, stream, created = false, checks = 0;
function adminSql(query) { execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' }); }
function same(label, actual, expected) { assert.deepEqual(actual, expected, label); checks++; console.log('PASS: ' + label); }
function check(label, value) { same(label, !!value, true); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition, label) {
    const end = Date.now() + 10000;
    while (Date.now() < end) { if (condition()) return; await sleep(20); }
    throw Error('Timed out: ' + label);
}
function browser() {
    const state = { cookie: '', calls: [], controllers: [], holdSend: null };
    state.fetch = async (url, options = {}) => {
        state.calls.push({ url, method: options.method || 'GET', headers: options.headers });
        const headers = { ...options.headers }, controller = new AbortController(); state.controllers.push(controller);
        if (options.signal) {
            if (options.signal.aborted) controller.abort();
            else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        if (state.cookie && url.startsWith('/api/support/')) headers.Cookie = state.cookie;
        const r = await fetch(base + url, { ...options, headers, signal: controller.signal });
        const cookie = r.headers.get('set-cookie');
        if (cookie) state.cookie = /Expires=Thu, 01 Jan 1970/i.test(cookie) ? '' : cookie.split(';')[0];
        if (state.holdSend && options.method === 'POST') await state.holdSend;
        return r;
    };
    browsers.push(state); return state;
}
function ui(kind, http, token, uid, role) {
    const r = setup(kind, { fetch: http.fetch, stream: true }); clients.push(r);
    r.state.token = token; r.login(uid ? { uid } : null, role); return r;
}
async function user(token, name, role = 'customer') {
    const uid = 'support-sse-' + token; tokens.set(token, uid);
    const id = (await pool.request().input('uid', sql.VarChar(128), uid).input('name', sql.NVarChar(150), name).input('role', sql.VarChar(20), role)
        .query(`INSERT INTO dbo.users(firebase_uid,email,display_name,role) OUTPUT INSERTED.id
            VALUES(@uid,@uid+'@example.test',@name,@role);`)).recordset[0].id;
    return { id, uid };
}
async function open(r) {
    r.byClass('breeze-support-launcher').click();
    await until(() => r.get('breeze-support-panel').getAttribute('aria-busy') === 'false', 'widget history');
}
async function send(r, value) {
    r.get('breeze-support-message').value = value; r.get('breeze-support-message').fire('input'); r.byClass('breeze-support-form').fire('submit');
    await until(() => r.get('breeze-support-message').value === '', 'widget confirmed send');
}
async function select(r, name) {
    await until(() => r.get('admin-support-list').children.some(el => text(el).includes(name)), 'inbox push ' + name);
    r.get('admin-support-list').children.find(el => text(el).includes(name)).click();
    await until(() => !r.get('admin-support-reply').disabled, 'Admin history');
}
async function reply(r, value) {
    await until(() => !r.get('admin-support-thread-refresh').disabled, 'Admin idle');
    const input = r.get('admin-support-reply'); input.value = value; input.fire('input'); r.get('admin-support-form').fire('submit');
    await until(() => input.value === '', 'Admin confirmed reply');
}
const transcript = r => text(r.byClass('breeze-support-transcript'));
const getCount = b => b.calls.filter(c => c.method === 'GET' && c.url.includes('/conversation') && !c.url.endsWith('/events')).length;
async function main() {
    try {
        adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
        adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
        console.log('Created disposable database:', dbName);
        execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 2 * 1024 * 1024 });
        pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
        require.cache[require.resolve('../db')].exports = { ...db, getPool: async () => pool };
        require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ verifyIdToken: async (token, checkRevoked) => {
            assert.equal(checkRevoked, true);
            if (!tokens.has(token) || revoked.has(token)) throw Error('Fixture token rejected');
            return { uid: tokens.get(token), exp: Math.floor(Date.now() / 1000) + 3600 };
        } }) } };
        const streams = require('../middleware/support-stream');
        stream = streams.createStream({ pingMs: 50, checkMs: 200, lifetimeMs: 60000 });
        require.cache[require.resolve('../middleware/support-stream')].exports = { ...streams, stream };
        process.env.ADMIN_EMAILS = '';
        const app = express(); app.use(express.json({ limit: '100kb' }));
        app.use('/api/me', require('../routes/me')); app.use('/api/support', require('../routes/support')); app.use('/api/admin', require('../routes/admin'));
        server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = 'http://127.0.0.1:' + server.address().port;
        const customer = await user('customer', 'Account Customer'), staff = await user('staff', 'Admin One', 'admin'), staffTwo = await user('staff-two', 'Admin Two', 'admin');
        async function status(url, token) {
            const r = await fetch(base + url, { headers: { Accept: 'text/event-stream', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
            await r.text(); return r.status;
        }
        same('guest cannot connect without session proof', await status('/api/support/events'), 401);
        same('customer cannot connect to Admin stream', await status('/api/admin/support/events', 'customer'), 403);
        same('Admin cannot use customer stream', await status('/api/support/events', 'staff'), 403);
        same('stream rejects URL parameters including tokens', await status('/api/admin/support/events?token=must-not-be-used', 'staff'), 400);

        const ab = browser(), admin = ui('admin', ab, 'staff', staff.uid, 'admin'); await admin.win.BreezeAdminSupport.load(1);
        await until(() => stream.size === 1, 'Admin stream');
        const gb = browser(), guest = ui('widget', gb, null); await open(guest);
        same('opening anonymous widget does not create a conversation or stream', [stream.size, (await pool.request().query('SELECT COUNT(*) AS n FROM dbo.support_conversations;')).recordset[0].n], [1, 0]);
        guest.get('breeze-support-name').value = 'Guest SSE'; guest.get('breeze-support-email').value = 'guest-sse@example.test';
        await send(guest, 'Khách hỏi 🌿');
        await select(admin, 'Guest SSE');
        check('new guest appears automatically in Admin inbox', text(admin.get('admin-support-messages')).includes('Khách hỏi 🌿'));
        const cid = (await pool.request().query("SELECT conversation_id FROM dbo.support_guest_sessions WHERE display_name=N'Guest SSE';")).recordset[0].conversation_id;
        const lease = async () => (await pool.request().input('cid', sql.BigInt, cid).query('SELECT expires_at FROM dbo.support_guest_sessions WHERE conversation_id=@cid;')).recordset[0].expires_at.toISOString();
        const expiry = await lease();
        await reply(admin, 'Phản hồi trực tiếp 🌿');
        await until(() => transcript(guest).includes('Phản hồi trực tiếp 🌿'), 'guest receives Admin push');
        same('POST acknowledgement and SSE produce no duplicate bubbles', guest.byClass('breeze-support-transcript').children.length, 3);
        same('transport ping, history reads and Admin reply do not renew guest activity', await lease(), expiry);

        const cb = browser(), account = ui('widget', cb, 'customer', customer.uid, 'customer');
        await until(() => !account.get('breeze-support').hidden, 'account role'); await open(account);
        await until(() => stream.size === 3, 'account stream before first message');
        const cb2 = browser(), device = ui('widget', cb2, 'customer', customer.uid, 'customer');
        await until(() => !device.get('breeze-support').hidden, 'second device role'); await open(device);
        await until(() => stream.size === 4, 'second account stream'); await sleep(350);
        const beforeGuest = getCount(gb);
        await send(account, 'Tin từ thiết bị A');
        await until(() => transcript(device).includes('Tin từ thiết bị A'), 'new conversation notification reaches another device');
        check('account can receive its first conversation created on another device', transcript(device).includes('Tin từ thiết bị A'));
        await sleep(350); same('another account activity does not refresh guest transcript', getCount(gb), beforeGuest);
        check('another account history is never shown to guest', !transcript(guest).includes('Tin từ thiết bị A'));
        await select(admin, 'Account Customer'); await reply(admin, 'Trả lời tài khoản');
        await until(() => transcript(account).includes('Trả lời tài khoản') && transcript(device).includes('Trả lời tài khoản'), 'two device reply');
        check('both authenticated devices receive the Admin reply', transcript(account).includes('Trả lời tài khoản') && transcript(device).includes('Trả lời tài khoản'));

        const a2b = browser(), adminTwo = ui('admin', a2b, 'staff-two', staffTwo.uid, 'admin'); await adminTwo.win.BreezeAdminSupport.load(1);
        const unreadRow = r => r.get('admin-support-list').children.find(el => text(el).includes('Guest SSE'));
        await send(guest, 'Tin chưa đọc dùng chung');
        await until(() => unreadRow(admin) && unreadRow(adminTwo) && unreadRow(admin).className.includes('is-unread') && unreadRow(adminTwo).className.includes('is-unread'), 'unselected shared unread rows');
        check('new message makes unopened thread bold in both Admin inboxes', unreadRow(admin).className.includes('is-unread') && unreadRow(adminTwo).className.includes('is-unread'));
        await select(admin, 'Guest SSE');
        await until(() => !unreadRow(admin).className.includes('is-unread') && !unreadRow(adminTwo).className.includes('is-unread'), 'shared read SSE sync');
        check('one Admin reading clears bold status on another Admin through SSE', !unreadRow(adminTwo).className.includes('is-unread'));
        await select(adminTwo, 'Guest SSE');
        admin.get('admin-support-reply').value = 'Draft survives incoming messages';
        await reply(adminTwo, 'Từ Admin thứ hai');
        await until(() => text(admin.get('admin-support-messages')).includes('Từ Admin thứ hai'), 'shared Admin thread push');
        same('realtime refresh preserves Admin draft and selected conversation', [admin.get('admin-support-reply').value, text(admin.get('admin-support-contact'))], ['Draft survives incoming messages', 'Guest SSE']);
        check('Admin thread retains actual replying staff name', text(admin.get('admin-support-messages')).includes('Admin Two'));

        // Commit a customer send while holding its HTTP acknowledgement; an Admin
        // reply arrives during the busy UI and must be drained afterwards.
        let release; gb.holdSend = new Promise(resolve => { release = resolve; });
        const pending = send(guest, 'Tin đang chờ xác nhận');
        await until(() => text(adminTwo.get('admin-support-messages')).includes('Tin đang chờ xác nhận'), 'committed pending send');
        await reply(adminTwo, 'Tin đến trong khi đang gửi'); release(); gb.holdSend = null; await pending;
        await until(() => transcript(guest).includes('Tin đến trong khi đang gửi'), 'deferred event drain');
        same('event arriving during POST is retained and SQL messages stay unique', guest.byClass('breeze-support-transcript').children.length,
            (await pool.request().input('cid', sql.BigInt, cid).query('SELECT COUNT(*) AS n FROM dbo.support_messages WHERE conversation_id=@cid;')).recordset[0].n);

        // Stop all streams; this reply is committed during the reconnect gap.
        stream.closeAll(); await reply(adminTwo, 'Đồng bộ sau mất kết nối');
        await until(() => transcript(guest).includes('Đồng bộ sau mất kết nối'), 'reconnect snapshot');
        check('reconnect recovers a message committed while disconnected', transcript(guest).includes('Đồng bộ sau mất kết nối'));
        same('reconnect does not duplicate persisted messages', guest.byClass('breeze-support-transcript').children.length,
            (await pool.request().input('cid', sql.BigInt, cid).query('SELECT COUNT(*) AS n FROM dbo.support_messages WHERE conversation_id=@cid;')).recordset[0].n);
        const beforeClose = gb.calls.filter(c => c.url.endsWith('/events')).length;
        guest.byClass('breeze-support-close').click(); await sleep(250);
        check('closing widget restores launcher and closes its connection', guest.get('breeze-support-panel').hidden && !guest.byClass('breeze-support-launcher').hidden);
        await sleep(1200); same('closed widget does not reconnect', gb.calls.filter(c => c.url.endsWith('/events')).length, beforeClose);
        await open(guest); await until(() => stream.size === 5, 'reopened stream');
        adminTwo.win.BreezeAdminSupport.hide(); await sleep(150);
        const hiddenCalls = a2b.calls.length; await send(guest, 'Tin sau khi ẩn Admin'); await sleep(350);
        same('leaving Admin inbox stops background stream and refreshes', a2b.calls.length, hiddenCalls);
        await adminTwo.win.BreezeAdminSupport.load(1);

        revoked.add('staff');
        await until(() => admin.get('admin-support-messages').children.length === 0, 'Firebase revoked stream');
        check('Firebase revocation clears connected Admin data', admin.get('admin-support-list').children.length === 0);
        await pool.request().input('uid', sql.Int, staffTwo.id).query("UPDATE dbo.users SET role='customer' WHERE id=@uid;");
        await until(() => adminTwo.get('admin-support-list').children.length === 0, 'SQL role revoked');
        check('SQL role change closes Admin stream and clears inbox', adminTwo.get('admin-support-messages').children.length === 0);
        await pool.request().input('cid', sql.BigInt, cid).query(`UPDATE dbo.support_guest_sessions SET created_at=DATEADD(minute,-10,SYSUTCDATETIME()),
            expires_at=DATEADD(second,-1,SYSUTCDATETIME()) WHERE conversation_id=@cid;`);
        await until(() => guest.byClass('breeze-support-transcript').children.length === 0, 'expired session stream');
        check('guest expiry clears live transcript and asks for profile again', !guest.byClass('breeze-support-guest').hidden);
        account.login(null); device.login(null);
        check('account change closes live history immediately', !transcript(account) && !transcript(device));
        check('visible Admin threads persist shared SQL read markers', (await pool.request().query('SELECT COUNT(*) AS n FROM dbo.support_conversations WHERE admin_read_message_id IS NOT NULL;')).recordset[0].n > 0);
        same('first wait remains unique per conversation through SSE and retry', (await pool.request().query("SELECT COUNT(*) AS n FROM dbo.support_messages WHERE sender_kind='system';")).recordset[0].n, 2);
        same('chat data is not persisted in browser storage', clients.flatMap(c => c.writes), []);
        check('SSE URLs never contain token, guest credential or query identity', browsers.every(b => b.calls.filter(c => c.url.endsWith('/events')).every(c => c.url === '/api/support/events' || c.url === '/api/admin/support/events')));
        console.log('Support SSE + UI + SQL verification:', checks, 'checks passed. Configured store unchanged.');
    } finally {
        for (const r of clients) { r.doc.hidden = true; r.doc.fire('visibilitychange'); }
        if (stream) stream.closeAll();
        for (const b of browsers) b.controllers.forEach(c => c.abort());
        try { if (server) await new Promise(resolve => server.close(resolve)); if (pool) await pool.close(); }
        finally { if (created) { adminSql('ALTER DATABASE ' + quoted + ' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + quoted + ';'); console.log('Removed disposable database:', dbName); } }
    }
}
main().catch(error => {
    console.error(error.stack || error.message);
    if (error.stdout) console.error(error.stdout.toString().split('\n').slice(-12).join('\n'));
    if (error.stderr) console.error(error.stderr.toString().split('\n').slice(-12).join('\n'));
    process.exitCode = 1;
});
