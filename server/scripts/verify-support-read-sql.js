'use strict';
// Real HTTP authorization + SQL transactions. Only Firebase network I/O is substituted.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { execFileSync } = require('node:child_process'), { randomUUID } = require('node:crypto');
const path = require('node:path'), assert = require('node:assert/strict'), express = require('express');
const db = require('../db'), { sql, config } = db;
const dbName = 'BreezeSupportReadTest_' + process.pid + '_' + Date.now();
if (!/^BreezeSupportReadTest_[0-9]+_[0-9]+$/.test(dbName) || dbName.toLowerCase() === String(config.database).toLowerCase()) throw Error('Unsafe test database');
const quoted = '[' + dbName + ']', tokens = new Map(), notices = [];
let pool, server, base, unsubscribe, created = false, checks = 0;
function adminSql(query) { execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' }); }
function same(label, actual, expected) { assert.deepEqual(actual, expected, label); checks++; console.log('PASS: ' + label); }
function check(label, value) { same(label, !!value, true); }
const message = text => ({ text, clientMessageId: randomUUID() });
async function call(method, url, token, body, extraHeaders = {}) {
    const r = await fetch(base + '/api/' + url, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') };
}
async function user(token, role = 'customer') {
    const uid = 'support-read-' + token; tokens.set(token, uid);
    return (await pool.request().input('uid', sql.VarChar(128), uid).input('role', sql.VarChar(20), role)
        .query(`INSERT INTO dbo.users(firebase_uid,email,display_name,role) OUTPUT INSERTED.id
            VALUES(@uid,@uid+'@example.test',@uid,@role);`)).recordset[0].id;
}
const route = cid => 'admin/support/conversations/' + cid;
const read = (cid, mid, token = 'staff') => call('POST', route(cid) + '/read', token, { messageId: mid });
const unread = async cid => (await call('GET', 'admin/support/conversations', 'staff-two')).body.conversations.find(c => c.id === cid).unread;
const cursor = async cid => (await pool.request().input('cid', sql.BigInt, cid).query('SELECT admin_read_message_id AS id FROM dbo.support_conversations WHERE id=@cid;')).recordset[0].id;
async function state() {
    return (await pool.request().query(`SELECT * FROM dbo.support_conversations ORDER BY id; SELECT * FROM dbo.support_messages ORDER BY id;
        SELECT * FROM dbo.support_guest_sessions ORDER BY id; SELECT * FROM dbo.support_admin_actors ORDER BY id;`)).recordsets;
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
            assert.equal(revoked, true); if (!tokens.has(token)) throw Error('Rejected fixture token'); return { uid: tokens.get(token) };
        } }) } };
        process.env.ADMIN_EMAILS = '';
        const app = express(); app.use(express.json({ limit: '100kb' }));
        app.use('/api/support', require('../routes/support')); app.use('/api/admin', require('../routes/admin'));
        server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = 'http://127.0.0.1:' + server.address().port;
        await user('owner'); await user('other'); await user('staff', 'admin'); const staffTwo = await user('staff-two', 'admin');
        const first = (await call('POST', 'support/messages', 'owner', message('First unread'))).body;
        const cid = first.conversationId, m1 = first.message.id;
        const foreign = (await call('POST', 'support/messages', 'other', message('Another conversation'))).body;
        const initial = await state();
        same('new customer message is unread in shared inbox', await unread(cid), true);
        const history = await call('GET', route(cid) + '/messages', 'staff');
        same('reading GET reports SQL cursor without mutating it', history.body.readMessageId, null);
        same('list/history GET leave all chat state unchanged', await state(), initial);
        same('anonymous read acknowledgement is denied', (await read(cid, m1, null)).status, 401);
        same('invalid Firebase token is denied', (await read(cid, m1, 'invalid')).status, 401);
        same('customer cannot mark shared Admin inbox', (await read(cid, m1, 'owner')).status, 403);
        for (const body of [{}, { messageId: 1 }, { messageId: '0' }, { messageId: ['1'] }, { messageId: m1, userId: staffTwo }, { messageId: m1, unread: false }]) {
            same('invalid/forged read input ' + JSON.stringify(body), (await call('POST', route(cid) + '/read', 'staff', body)).status, 400);
        }
        same('foreign conversation message cannot be used as cursor', (await read(cid, foreign.message.id)).status, 400);
        same('missing message cannot be used as cursor', (await read(cid, '9223372036854775807')).status, 400);
        same('missing conversation cannot be marked read', (await read('9223372036854775807', m1)).status, 404);
        same('read endpoint rejects query identity fields', (await call('POST', route(cid) + '/read?messageId=' + m1, 'staff', { messageId: m1 })).status, 400);
        same('read endpoint rejects untrusted Origin', (await call('POST', route(cid) + '/read', 'staff', { messageId: m1 }, { Origin: 'https://untrusted.example' })).status, 403);
        same('read endpoint requires JSON', (await call('POST', route(cid) + '/read', 'staff', { messageId: m1 }, { 'Content-Type': 'text/plain' })).status, 415);
        same('all denied requests leave chat state unchanged', await state(), initial);
        const adminReply = (await call('POST', route(cid) + '/messages', 'staff', message('Reply does not imply read'))).body;
        same('Admin reply alone cannot clear unread', await unread(cid), true);
        same('Admin reply is not a customer read boundary', (await read(cid, adminReply.message.id)).status, 400);
        unsubscribe = require('../lib/support-events').hub.subscribe(n => notices.push(n));
        const beforeRead = await state();
        const acknowledged = await read(cid, m1);
        same('explicit read advances cursor exactly to requested message', acknowledged.body, { conversationId: cid, readMessageId: m1, unread: false });
        same('other Admin sees shared cleared unread state', await unread(cid), false);
        const afterRead = await state();
        same('read acknowledgement preserves inbox order timestamps', afterRead[0].map(r => r.updated_at), beforeRead[0].map(r => r.updated_at));
        same('read acknowledgement never inserts/changes messages, sessions or actors', afterRead.slice(1), beforeRead.slice(1));
        same('read post-commit event is scoped to Admin', notices, [{ audience: 'admin', conversationId: cid }]);
        await read(cid, m1, 'staff-two'); same('repeated acknowledgement emits no extra event', notices.length, 1);
        const second = (await call('POST', 'support/messages', 'owner', message('Unread again'))).body.message.id;
        same('customer new message restores unread after earlier read', await unread(cid), true);
        same('stale acknowledgement does not swallow newer message', (await read(cid, m1)).body.unread, true);
        same('new customer marker is not advanced by old acknowledgement', String(await cursor(cid)), m1);
        const parallel = await Promise.all([read(cid, second, 'staff-two'), read(cid, m1)]);
        same('concurrent Admin acknowledgements both succeed', parallel.map(r => r.status), [200, 200]);
        same('shared cursor never moves backwards under concurrent Admins', String(await cursor(cid)), second);
        same('shared unread clears once newest boundary acknowledged', await unread(cid), false);
        const third = (await call('POST', 'support/messages', 'owner', message('Third'))).body.message.id;
        const racing = await Promise.all([read(cid, third), call('POST', 'support/messages', 'owner', message('Arrives during acknowledgement'))]);
        same('send racing with read both commit', racing.map(r => r.status), [200, 201]);
        same('concurrent send remains unread after older read boundary', await unread(cid), true);
        same('cursor stops at third rather than querying current SQL MAX', String(await cursor(cid)), third);
        await pool.request().batch(`CREATE TRIGGER dbo.support_read_fixture_fail ON dbo.support_conversations AFTER UPDATE AS
            BEGIN IF UPDATE(admin_read_message_id) THROW 51000,'PRIVATE read fixture error',1; END;`);
        const beforeFailure = await state(), countBeforeFailure = notices.length;
        const failed = await read(cid, racing[1].body.message.id);
        same('failed SQL update returns safe server error', [failed.status, failed.body.code], [500, 'SUPPORT_ERROR']);
        check('SQL read failure does not disclose private error detail', !/PRIVATE|51000|stack/.test(JSON.stringify(failed.body)));
        same('SQL failure rolls back read cursor and all related state', await state(), beforeFailure);
        same('rolled-back acknowledgement publishes no SSE notification', notices.length, countBeforeFailure);
        await pool.request().query('DROP TRIGGER dbo.support_read_fixture_fail;');
        const guest = await call('POST', 'support/guest-session', null, { ...message('Guest unread'), name: 'Guest', email: 'guest@example.test' });
        const gcid = guest.body.conversationId, gmid = guest.body.message.id;
        const guestBefore = (await state())[2]; await read(gcid, gmid);
        same('reading guest conversation never extends activity lease', (await state())[2], guestBefore);
        await pool.request().input('cid', sql.BigInt, gcid).query(`UPDATE dbo.support_guest_sessions SET created_at=DATEADD(minute,-10,SYSUTCDATETIME()),expires_at=DATEADD(second,-1,SYSUTCDATETIME()) WHERE conversation_id=@cid;`);
        same('expired guest cannot be marked read by Admin', (await read(gcid, gmid)).status, 404);
        await pool.request().input('uid', sql.Int, staffTwo).query("UPDATE dbo.users SET role='customer' WHERE id=@uid;");
        same('current SQL role loss denies read acknowledgement', (await read(cid, third, 'staff-two')).status, 403);
        same('read history marker is not exposed on customer API', Object.hasOwn((await call('GET', 'support/conversation/messages', 'owner')).body, 'readMessageId'), false);
        console.log('Support read + SQL verification:', checks, 'checks passed. Configured store unchanged.');
    } finally {
        if (unsubscribe) unsubscribe();
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
