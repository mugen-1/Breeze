'use strict';
// Real frontend scripts in a DOM fixture -> real HTTP middleware -> disposable SQL.
// Firebase network I/O is substituted; no real Firebase accounts or store chats.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { execFileSync } = require('node:child_process');
const path = require('node:path'), assert = require('node:assert/strict'), express = require('express');
const db = require('../db'), { sql, config } = db;
const { setup, text } = require('../../client/js/__tests__/helpers/support-harness');
const dbName = 'BreezeSupportUiTest_' + process.pid + '_' + Date.now();
if (!/^BreezeSupportUiTest_[0-9]+_[0-9]+$/.test(dbName) || dbName.toLowerCase() === String(config.database).toLowerCase()) throw Error('Unsafe test database');
const quoted = '[' + dbName + ']', tokens = new Map();
let pool, server, base, created = false, checks = 0;
function adminSql(query) { execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' }); }
function same(label, actual, expected) { assert.deepEqual(actual, expected, label); checks++; console.log('PASS: ' + label); }
function check(label, value) { same(label, !!value, true); }
async function until(condition, label) {
    const end = Date.now() + 10000;
    while (Date.now() < end) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw Error('Timed out: ' + label);
}
function browser() {
    const state = { cookie: '', loseNextSend: false, calls: [] };
    state.fetch = async (url, options = {}) => {
        state.calls.push({ url, method: options.method || 'GET' });
        const headers = { ...options.headers };
        if (state.cookie && url.startsWith('/api/support/')) headers.Cookie = state.cookie;
        const r = await fetch(base + url, { ...options, headers });
        const cookie = r.headers.get('set-cookie');
        if (cookie) state.cookie = /Expires=Thu, 01 Jan 1970/i.test(cookie) ? '' : cookie.split(';')[0];
        if (state.loseNextSend && options.method === 'POST' && url === '/api/support/messages' && r.ok) {
            state.loseNextSend = false; await r.text(); throw Error('Fixture: response lost after SQL commit');
        }
        return r;
    };
    return state;
}
async function user(token, name, role = 'customer') {
    const uid = 'support-ui-' + token; tokens.set(token, uid);
    const id = (await pool.request().input('uid', sql.VarChar(128), uid).input('name', sql.NVarChar(150), name).input('role', sql.VarChar(20), role)
        .query(`INSERT INTO dbo.users(firebase_uid,email,display_name,role) OUTPUT INSERTED.id
            VALUES(@uid,@uid+'@example.test',@name,@role);`)).recordset[0].id;
    return { id, uid };
}
async function open(r) {
    r.byClass('breeze-support-launcher').click();
    await until(() => r.get('breeze-support-panel').getAttribute('aria-busy') === 'false', 'widget history');
}
function compose(r, value) { r.get('breeze-support-message').value = value; r.get('breeze-support-message').fire('input'); }
async function sendWidget(r, value) {
    compose(r, value); r.byClass('breeze-support-form').fire('submit');
    await until(() => r.get('breeze-support-message').value === '', 'widget confirmed send');
}
async function refreshWidget(r) {
    r.byClass('breeze-support-refresh').click();
    await until(() => r.get('breeze-support-panel').getAttribute('aria-busy') === 'false', 'widget refresh');
}
async function select(r, name) {
    const row = r.get('admin-support-list').children.find(el => text(el).includes(name));
    assert.ok(row, 'conversation row ' + name); row.click();
    await until(() => !r.get('admin-support-reply').disabled, 'Admin history');
}
async function reply(r, value) {
    const input = r.get('admin-support-reply'); input.value = value; input.fire('input'); r.get('admin-support-form').fire('submit');
    await until(() => input.value === '', 'Admin confirmed reply');
}
async function main() {
    try {
        adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
        adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
        console.log('Created disposable database:', dbName);
        execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 2 * 1024 * 1024 });
        pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
        require.cache[require.resolve('../db')].exports = { ...db, getPool: async () => pool };
        require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ verifyIdToken: async (token, checkRevoked) => {
            assert.equal(checkRevoked, true); if (!tokens.has(token)) throw Error('Fixture token rejected'); return { uid: tokens.get(token) };
        } }) } };
        process.env.ADMIN_EMAILS = '';
        const app = express(); app.use(express.json({ limit: '100kb' }));
        app.use('/api/me', require('../routes/me')); app.use('/api/support', require('../routes/support')); app.use('/api/admin', require('../routes/admin'));
        server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = 'http://127.0.0.1:' + server.address().port;
        const customer = await user('customer', 'Account Customer'), adminUser = await user('admin', 'Actual Admin One', 'admin'), adminTwoUser = await user('admin-two', 'Actual Admin Two', 'admin');

        const guestBrowser = browser(), guest = setup('widget', { fetch: guestBrowser.fetch }); guest.login(null); await open(guest);
        same('opening guest widget creates no SQL conversation', (await pool.request().query('SELECT COUNT(*) AS n FROM dbo.support_conversations;')).recordset[0].n, 0);
        guest.get('breeze-support-name').value = 'Guest UI'; guest.get('breeze-support-email').value = 'guest-ui@example.test';
        await sendWidget(guest, 'Xin chào 🌿 <script>literal</script>');
        check('guest UI confirms and renders real persisted message', text(guest.byClass('breeze-support-transcript')).includes('Xin chào 🌿 <script>literal</script>'));
        check('browser session has HttpOnly credential cookie from API', guestBrowser.cookie.startsWith('breeze_support_guest='));
        const gCid = (await pool.request().query("SELECT conversation_id FROM dbo.support_guest_sessions WHERE display_name=N'Guest UI';")).recordset[0].conversation_id;
        same('guest session and first message belong to one conversation', (await pool.request().input('cid', sql.BigInt, gCid)
            .query('SELECT COUNT(*) AS n FROM dbo.support_messages WHERE conversation_id=@cid;')).recordset[0].n, 2);

        const accountBrowser = browser(), account = setup('widget', { fetch: accountBrowser.fetch }); account.state.token = 'customer';
        account.login({ uid: customer.uid }, 'customer'); await until(() => !account.get('breeze-support').hidden, 'customer SQL role'); await open(account);
        await sendWidget(account, 'Account question');
        same('account widget creates the SQL-owned conversation', (await pool.request().input('uid', sql.Int, customer.id)
            .query('SELECT COUNT(*) AS n FROM dbo.support_conversations WHERE user_id=@uid;')).recordset[0].n, 1);

        const adminBrowser = browser(), admin = setup('admin', { fetch: adminBrowser.fetch }); admin.state.token = 'admin'; admin.login({ uid: adminUser.uid }, 'admin');
        await admin.win.BreezeAdminSupport.load(1);
        same('Admin UI lists actual guest and account conversations', admin.get('admin-support-list').children.length, 2);
        await select(admin, 'Guest UI');
        check('Admin UI receives guest history from real HTTP API', text(admin.get('admin-support-messages')).includes('Xin chào 🌿'));
        await reply(admin, 'BREEZE đã nhận tin của bạn.');
        check('confirmed Admin reply displays actual author name', text(admin.get('admin-support-messages')).includes('Actual Admin One'));
        await refreshWidget(guest);
        check('guest manual refresh loads persisted Admin reply', text(guest.byClass('breeze-support-transcript')).includes('BREEZE đã nhận tin của bạn.'));
        check('guest transcript never discloses internal Admin identity', !text(guest.byClass('breeze-support-transcript')).includes('Actual Admin One'));

        const reopened = setup('widget', { fetch: guestBrowser.fetch }); reopened.login(null); await open(reopened);
        same('new page sharing browser cookie restores whole guest history', reopened.byClass('breeze-support-transcript').children.length, 3);
        check('restored session does not ask guest profile again', reopened.byClass('breeze-support-guest').hidden);
        const secondBrowser = browser(), adminTwo = setup('admin', { fetch: secondBrowser.fetch }); adminTwo.state.token = 'admin-two'; adminTwo.login({ uid: adminTwoUser.uid }, 'admin');
        await adminTwo.win.BreezeAdminSupport.load(1); await select(adminTwo, 'Account Customer'); await reply(adminTwo, 'Account response from Admin Two');
        await refreshWidget(account);
        check('account manual refresh receives its own Admin reply', text(account.byClass('breeze-support-transcript')).includes('Account response from Admin Two'));
        check('account transcript cannot include another guest history', !text(account.byClass('breeze-support-transcript')).includes('Xin chào 🌿'));
        same('real replying Admin IDs are stored', (await pool.request().query(`SELECT DISTINCT a.original_user_id FROM dbo.support_messages m
            JOIN dbo.support_admin_actors a ON a.id=m.admin_actor_id ORDER BY a.original_user_id;`)).recordset.map(r => r.original_user_id), [adminUser.id, adminTwoUser.id]);

        const beforeLoss = (await pool.request().input('cid', sql.BigInt, gCid).query('SELECT COUNT(*) AS n FROM dbo.support_messages WHERE conversation_id=@cid;')).recordset[0].n;
        guestBrowser.loseNextSend = true; compose(guest, 'Retry after server commit'); guest.byClass('breeze-support-form').fire('submit');
        await until(() => !guest.get('breeze-support-message').disabled, 'lost send response');
        same('network failure preserves unsent UI draft', guest.get('breeze-support-message').value, 'Retry after server commit');
        same('lost response did not fabricate a successful bubble', guest.byClass('breeze-support-transcript').children.length, beforeLoss);
        guest.byClass('breeze-support-form').fire('submit'); await until(() => guest.get('breeze-support-message').value === '', 'idempotent retry');
        same('UI retry after committed send does not duplicate SQL data', (await pool.request().input('cid', sql.BigInt, gCid)
            .query('SELECT COUNT(*) AS n FROM dbo.support_messages WHERE conversation_id=@cid;')).recordset[0].n, beforeLoss + 1);
        same('retry appends exactly one confirmed bubble', guest.byClass('breeze-support-transcript').children.length, beforeLoss + 1);

        await pool.request().input('cid', sql.BigInt, gCid).query(`UPDATE dbo.support_guest_sessions SET created_at=DATEADD(minute,-10,SYSUTCDATETIME()),
            expires_at=DATEADD(second,-1,SYSUTCDATETIME()) WHERE conversation_id=@cid;`);
        await refreshWidget(guest);
        check('expired guest UI clears private transcript and requests new profile', !guest.byClass('breeze-support-guest').hidden && guest.byClass('breeze-support-transcript').children.length === 0);
        await admin.win.BreezeAdminSupport.load(1);
        same('Admin refresh removes expired guest from list', admin.get('admin-support-list').children.length, 1);
        check('visible Admin histories persist shared read markers', (await pool.request().query('SELECT COUNT(*) AS n FROM dbo.support_conversations WHERE admin_read_message_id IS NOT NULL;')).recordset[0].n > 0);
        same('one automatic first wait exists per guest/account conversation', (await pool.request().query("SELECT COUNT(*) AS n FROM dbo.support_messages WHERE sender_kind='system';")).recordset[0].n, 2);
        same('no PII or message stored in client-side storage', guest.writes.concat(account.writes, admin.writes, reopened.writes, adminTwo.writes), []);
        admin.login(null); account.login(null);
        check('identity changes clear Admin and account histories', admin.get('admin-support-messages').children.length === 0 && account.byClass('breeze-support-transcript').children.length === 0);
        console.log('Support UI + SQL verification:', checks, 'checks passed. Configured store unchanged.');
    } finally {
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
