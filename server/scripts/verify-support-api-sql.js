'use strict';
// Real HTTP routes + Firebase middleware + SQL Server; only Firebase network I/O
// is substituted. Every fixture lives in the disposable database below.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { execFileSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const db = require('../db'), { sql, config } = db;
const dbName = 'BreezeSupportApiTest_' + process.pid + '_' + Date.now();
if (!/^BreezeSupportApiTest_[0-9]+_[0-9]+$/.test(dbName) || dbName.toLowerCase() === String(config.database).toLowerCase()) throw Error('Unsafe test database');
const quoted = '[' + dbName + ']';
let pool, server, base, created = false, checks = 0;
const tokens = new Map(), revoked = new Set();
function adminSql(query) { execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' }); }
function same(label, actual, expected) { assert.deepEqual(actual, expected, label); checks++; console.log('PASS: ' + label); }
function check(label, value) { same(label, !!value, true); }
const msg = text => ({ text, clientMessageId: randomUUID() });
async function call(method, route, { token, cookie, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token !== undefined) h.Authorization = 'Bearer ' + token;
  if (cookie) h.Cookie = cookie;
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  const r = await fetch(base + '/api/' + route, { method, headers: h, signal: AbortSignal.timeout(10000),
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie'), headers: r.headers };
}
function cookieOf(r) { assert.ok(r.cookie); return r.cookie.split(';')[0]; }
async function user(token, role = 'customer') {
  const uid = 'support-api-' + token; tokens.set(token, uid);
  return (await pool.request().input('uid', sql.VarChar(128), uid).input('role', sql.VarChar(20), role)
    .query(`INSERT INTO dbo.users(firebase_uid,email,display_name,role) OUTPUT INSERTED.id
      VALUES(@uid,@uid+'@example.test',@uid,@role);`)).recordset[0].id;
}
async function chatState() {
  return (await pool.request().query(`SELECT * FROM dbo.support_conversations ORDER BY id;
    SELECT * FROM dbo.support_messages ORDER BY id; SELECT * FROM dbo.support_guest_sessions ORDER BY id;
    SELECT * FROM dbo.support_admin_actors ORDER BY id;`)).recordsets;
}
async function businessState() {
  return (await pool.request().query(`SELECT * FROM dbo.orders ORDER BY id; SELECT * FROM dbo.order_items ORDER BY id;
    SELECT * FROM dbo.products ORDER BY id; SELECT * FROM dbo.product_variants ORDER BY id;
    SELECT * FROM dbo.inventory_movements ORDER BY id; SELECT * FROM dbo.payment_transactions ORDER BY id;`)).recordsets;
}
async function expire(cid, revoke = false) {
  await pool.request().input('cid', sql.BigInt, cid).query(revoke ?
    'UPDATE dbo.support_guest_sessions SET revoked_at=SYSUTCDATETIME() WHERE conversation_id=@cid;' :
    `UPDATE dbo.support_guest_sessions SET created_at=DATEADD(minute,-10,SYSUTCDATETIME()),
      last_seen_at=DATEADD(minute,-10,SYSUTCDATETIME()),expires_at=DATEADD(second,-1,SYSUTCDATETIME()) WHERE conversation_id=@cid;`);
}
async function main() {
  try {
    adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
    console.log('Created disposable database:', dbName);
    execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], { cwd: path.join(__dirname, '..'),
      env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 2 * 1024 * 1024 });
    pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    require.cache[require.resolve('../db')].exports = { ...db, getPool: async () => pool };
    require.cache[require.resolve('../firebase')] = { exports: { getAuth: () => ({ verifyIdToken: async (token, checkRevoked) => {
      assert.equal(checkRevoked, true);
      if (!tokens.has(token) || revoked.has(token)) throw Object.assign(Error('PRIVATE fixture token rejected'), { code: 'auth/id-token-revoked' });
      return { uid: tokens.get(token) };
    } }) } };
    // Avoid the developer's admin bootstrap affecting fixture customer roles.
    process.env.ADMIN_EMAILS = '';
    const app = express(); app.use(express.json({ limit: '100kb' }));
    app.use('/api/support', require('../routes/support')); app.use('/api/admin', require('../routes/admin'));
    app.use((err, req, res, next) => res.status(400).json({ status: 'error', message: 'Body request không hợp lệ hoặc quá lớn' }));
    app.use((req, res) => res.status(404).json({ status: 'error' }));
    server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port;
    const owner = await user('owner'), other = await user('other'), staff = await user('staff', 'admin'), staffTwo = await user('staff-two', 'admin');
    const initialBusiness = await businessState();
    same('Admin inbox is genuinely empty', (await call('GET', 'admin/support/conversations', { token: 'staff' })).body,
      { page: 1, limit: 30, total: 0, totalPages: 0, conversations: [] });
    same('guest opening widget does not create data', (await call('GET', 'support/conversation')).body, { conversation: null });
    same('account opening widget does not create a conversation', (await call('GET', 'support/conversation', { token: 'owner' })).body, { conversation: null });
    same('anonymous send requires a guest session', (await call('POST', 'support/messages', { body: msg('No identity') })).status, 401);
    same('guest history requires session proof', (await call('GET', 'support/conversation/messages')).status, 401);
    same('Admin cannot use the customer widget API', (await call('GET', 'support/conversation', { token: 'staff' })).status, 403);
    same('signed-in customer cannot create a guest identity', (await call('POST', 'support/guest-session', { token: 'owner', body: {} })).status, 403);
    for (const token of [undefined, 'invalid', 'owner']) {
      const expected = token === 'owner' ? 403 : 401;
      for (const [method, route, body] of [['GET', 'admin/support/conversations'], ['GET', 'admin/support/conversations/1/messages'],
        ['POST', 'admin/support/conversations/1/messages', msg('forged')]]) {
        same('Admin API rejects ' + String(token) + ' ' + method + ' ' + route,
          (await call(method, route, { token, body })).status, expected);
      }
    }

    const firstData = msg('Xin chào 🌿\n<script>fixture only</script>');
    const first = await call('POST', 'support/messages', { token: 'owner', body: firstData });
    same('customer first send creates a conversation', first.status, 201); const cid = first.body.conversationId;
    same('message stored without HTML alteration', first.body.message.text, firstData.text);
    same('customer sender comes from SQL account', first.body.message.senderName, 'support-api-owner');
    same('chat responses cannot be cached', first.headers.get('cache-control'), 'no-store');
    const retry = await call('POST', 'support/messages', { token: 'owner', body: firstData });
    same('retry returns original message', [retry.status, retry.body.message.id, retry.body.replayed], [200, first.body.message.id, true]);
    same('retry key with different content is rejected', (await call('POST', 'support/messages', {
      token: 'owner', body: { ...firstData, text: 'different' } })).status, 409);
    const duplicate = msg('Two concurrent identical sends');
    const concurrent = await Promise.all([call('POST', 'support/messages', { token: 'owner', body: duplicate }),
      call('POST', 'support/messages', { token: 'owner', body: duplicate })]);
    same('concurrent retry persists one message', concurrent.map(r => r.status).sort(), [200, 201]);
    same('concurrent retry returns same ID', concurrent[0].body.message.id, concurrent[1].body.message.id);
    const third = await call('POST', 'support/messages', { token: 'owner', body: msg('Third') });
    const ids = [first.body.message.id, concurrent[0].body.message.id, third.body.message.id];
    for (let i = 0; i < ids.length; i++) await pool.request().input('mid', sql.BigInt, ids[i]).input('stamp', sql.VarChar(40), '2026-01-01T00:00:00.123000' + (i + 1))
      .query('UPDATE dbo.support_messages SET created_at=CONVERT(DATETIME2,@stamp) WHERE id=@mid;');
    await pool.request().input('mid', sql.BigInt, first.body.systemMessage.id).query("UPDATE dbo.support_messages SET created_at=CONVERT(DATETIME2,'2026-01-01T00:00:00.1230001') WHERE id=@mid;");
    const page = await call('GET', 'support/conversation/messages?limit=2', { token: 'owner' });
    same('history uses exact SQL DATETIME2 chronology', page.body.messages.map(m => m.id), ids.slice(1));
    same('history provides stable older cursor', page.body.nextBefore, ids[1]);
    const older = await call('GET', 'support/conversation/messages?limit=2&before=' + page.body.nextBefore, { token: 'owner' });
    same('older history has no duplicates or omissions at sub-millisecond precision', older.body.messages.map(m => m.id), [ids[0], first.body.systemMessage.id]);
    same('end of history has no cursor', older.body.nextBefore, null);
    const otherMessage = await call('POST', 'support/messages', { token: 'other', body: msg('Other account') });
    const otherCid = otherMessage.body.conversationId;
    same('different customer has a different conversation', otherCid !== cid, true);
    same('customer cannot select another owner by query', (await call('GET', 'support/conversation?userId=' + owner, { token: 'other' })).status, 400);
    same('customer cannot inject a conversation ID into a send', (await call('POST', 'support/messages', {
      token: 'other', body: { ...msg('forged'), conversationId: cid } })).status, 400);
    same('another conversation message cannot be a history cursor', (await call('GET', 'support/conversation/messages?before=' + ids[0], { token: 'other' })).status, 400);
    same('arbitrary customer conversation URL does not exist', (await call('GET', 'support/conversations/' + cid + '/messages', { token: 'other' })).status, 404);
    same('another device with same account shares conversation', (await call('GET', 'support/conversation', { token: 'owner' })).body.conversation.id, cid);
    const replies = await Promise.all([call('POST', 'admin/support/conversations/' + cid + '/messages', { token: 'staff', body: msg('Reply one') }),
      call('POST', 'admin/support/conversations/' + cid + '/messages', { token: 'staff-two', body: msg('Reply two') })]);
    same('two Admins can reply to the same inbox thread', replies.map(r => r.status), [201, 201]);
    same('actual replying account is retained for Admin', replies.map(r => r.body.message.senderUserId), [staff, staffTwo]);
    const userHistory = await call('GET', 'support/conversation/messages', { token: 'owner' });
    same('customer sees Admin replies under BREEZE identity', userHistory.body.messages.filter(m => m.kind === 'admin').map(m => m.senderName), ['BREEZE', 'BREEZE']);
    check('customer DTO excludes internal Admin IDs and credentials', !/senderUserId|firebase|token_hash|original_user_id|@example/.test(JSON.stringify(userHistory.body)));
    const inboxBeforeRead = (await chatState())[0].find(c => String(c.id) === cid).admin_read_message_id;
    await call('GET', 'admin/support/conversations/' + cid + '/messages', { token: 'staff' });
    same('opening history does not mark read ahead of Task 7', (await chatState())[0].find(c => String(c.id) === cid).admin_read_message_id, inboxBeforeRead);
    const list = await call('GET', 'admin/support/conversations?limit=1&page=2147483647', { token: 'staff' });
    same('Admin inbox pagination is bounded and clamps final page', [list.body.page, list.body.limit, list.body.total, list.body.conversations.length], [2, 1, 2, 1]);
    check('unread derives from stored customer messages', list.body.conversations.every(c => c.unread));
    same('malformed history limit is rejected', (await call('GET', 'support/conversation/messages?limit=101', { token: 'owner' })).status, 400);
    same('repeated query field is rejected', (await call('GET', 'admin/support/conversations?page=1&page=2', { token: 'staff' })).status, 400);
    same('BIGINT injection is rejected', (await call('GET', 'admin/support/conversations/1%20OR%201=1/messages', { token: 'staff' })).status, 400);
    same('unknown conversation is not created by Admin reply', (await call('POST', 'admin/support/conversations/9223372036854775807/messages', {
      token: 'staff', body: msg('missing') })).status, 404);

    const gBody = { name: 'Guest A', email: 'support-api-owner@example.test', ...msg('First guest message') };
    const guestFirst = await call('POST', 'support/guest-session', { body: gBody });
    same('guest first send creates real message and session atomically', guestFirst.status, 201);
    const gCookie = cookieOf(guestFirst), gCid = guestFirst.body.conversationId;
    check('declared account email cannot claim an account conversation', gCid !== cid);
    check('credential cookie is HttpOnly, SameSite, host-only and session-scoped', /HttpOnly/i.test(guestFirst.cookie) && /SameSite=Lax/.test(guestFirst.cookie)
      && /Path=\/api\/support/.test(guestFirst.cookie) && !/Domain=|Max-Age=|Expires=/i.test(guestFirst.cookie));
    check('raw guest credential is absent from JSON', !JSON.stringify(guestFirst.body).includes(gCookie.split('=')[1]));
    const storedGuest = (await pool.request().input('cid', sql.BigInt, gCid).query(`SELECT token_hash,
      DATEDIFF(second,last_seen_at,expires_at) AS seconds FROM dbo.support_guest_sessions WHERE conversation_id=@cid;`)).recordset[0];
    same('SQL stores SHA-256 and approved five-minute expiry', [storedGuest.token_hash.toString('hex'), storedGuest.seconds],
      [createHash('sha256').update(gCookie.split('=')[1]).digest('hex'), 300]);
    same('guest first-send retry reuses session and original message', (await call('POST', 'support/guest-session', { cookie: gCookie, body: gBody })).body.message.id, guestFirst.body.message.id);
    same('another tab with same cookie keeps guest conversation', (await call('GET', 'support/conversation', { cookie: gCookie })).body.conversation.id, gCid);
    same('invalid Bearer never falls back to guest cookie', (await call('GET', 'support/conversation', { token: 'invalid', cookie: gCookie })).status, 401);
    const invalidCookie = 'breeze_support_guest=' + 'x'.repeat(43);
    same('guessed cookie cannot read history', (await call('GET', 'support/conversation/messages', { cookie: invalidCookie })).status, 401);
    same('duplicate credential cookies fail closed', (await call('GET', 'support/conversation', { cookie: gCookie + '; ' + gCookie })).status, 401);
    const guestSecond = await call('POST', 'support/guest-session', { body: { ...msg('Guest B'), name: 'Guest B', email: 'guest-b@example.test' } });
    const secondCookie = cookieOf(guestSecond), gTwo = guestSecond.body.conversationId;
    same('same declared email is not treated as account ownership', (await call('GET', 'support/conversation', { token: 'owner', cookie: gCookie })).body.conversation.id, cid);
    same('unrelated guest cannot use another thread cursor', (await call('GET', 'support/conversation/messages?before=' + guestFirst.body.message.id, { cookie: secondCookie })).status, 400);
    const linkedUser = await user('linked');
    await pool.request().input('cid', sql.BigInt, gTwo).input('uid', sql.Int, linkedUser)
      .query('UPDATE dbo.support_conversations SET user_id=@uid WHERE id=@cid;');
    same('old guest proof cannot access a conversation transferred to an account', (await call('GET', 'support/conversation/messages', { cookie: secondCookie })).status, 401);
    same('old guest proof cannot write into account-owned history', (await call('POST', 'support/messages', { cookie: secondCookie, body: msg('No access') })).status, 401);
    await pool.request().input('cid', sql.BigInt, gTwo).query('UPDATE dbo.support_conversations SET user_id=NULL WHERE id=@cid;');
    const guestReply = await call('POST', 'admin/support/conversations/' + gCid + '/messages', { token: 'staff', body: msg('Guest response') });
    same('Admin can reply while guest session is active', guestReply.status, 201);
    const expiryBefore = (await pool.request().input('cid', sql.BigInt, gCid).query('SELECT expires_at FROM dbo.support_guest_sessions WHERE conversation_id=@cid;')).recordset[0].expires_at;
    await call('GET', 'admin/support/conversations/' + gCid + '/messages', { token: 'staff' });
    same('Admin activity does not prolong guest session', (await pool.request().input('cid', sql.BigInt, gCid)
      .query('SELECT expires_at FROM dbo.support_guest_sessions WHERE conversation_id=@cid;')).recordset[0].expires_at, expiryBefore);
    await pool.request().input('cid', sql.BigInt, gCid).query('UPDATE dbo.support_guest_sessions SET expires_at=DATEADD(second,60,SYSUTCDATETIME()) WHERE conversation_id=@cid;');
    same('active guest can send a subsequent message', (await call('POST', 'support/messages', { cookie: gCookie, body: msg('Still here') })).status, 201);
    same('guest send refreshes its own five-minute activity lease', (await pool.request().input('cid', sql.BigInt, gCid)
      .query('SELECT DATEDIFF(second,last_seen_at,expires_at) AS seconds FROM dbo.support_guest_sessions WHERE conversation_id=@cid;')).recordset[0].seconds, 300);
    same('cross-origin cookie mutation is rejected', (await call('POST', 'support/messages', { cookie: gCookie,
      body: msg('CSRF'), headers: { Origin: 'https://untrusted.example.test' } })).status, 403);
    same('cross-site browser mutation is rejected', (await call('POST', 'support/messages', { cookie: gCookie,
      body: msg('CSRF'), headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    same('form/text mutation cannot bypass JSON requirement', (await call('POST', 'support/messages', { cookie: gCookie,
      body: 'text=CSRF', headers: { 'Content-Type': 'text/plain' } })).status, 415);
    same('malformed JSON has safe error', (await call('POST', 'support/messages', { body: '{bad' })).status, 400);
    same('oversized body is rejected', (await call('POST', 'support/messages', { token: 'owner', body: msg('x'.repeat(103000)) })).status, 400);

    await expire(gCid);
    same('expired guest cannot read', (await call('GET', 'support/conversation/messages', { cookie: gCookie })).status, 401);
    same('expired cookie is cleared on denial', (await call('GET', 'support/conversation', { cookie: gCookie })).cookie.includes('Expires='), true);
    same('expired guest cannot send or extend expiry', (await call('POST', 'support/messages', { cookie: gCookie, body: msg('Too late') })).status, 401);
    same('Admin cannot reopen expired guest history', (await call('GET', 'admin/support/conversations/' + gCid + '/messages', { token: 'staff' })).status, 404);
    same('Admin cannot reply into expired guest session', (await call('POST', 'admin/support/conversations/' + gCid + '/messages', { token: 'staff', body: msg('Too late') })).status, 404);
    check('expired guest disappears from Admin inbox', !(await call('GET', 'admin/support/conversations', { token: 'staff' })).body.conversations.some(c => c.id === gCid));
    await expire(gTwo, true);
    same('revoked guest credential is rejected', (await call('GET', 'support/conversation', { cookie: secondCookie })).status, 401);
    check('revoked guest disappears from Admin inbox', !(await call('GET', 'admin/support/conversations', { token: 'staff' })).body.conversations.some(c => c.id === gTwo));

    // Inject a real SQL failure AFTER conversation/session creation, BEFORE commit.
    await user('racing');
    const firstSends = await Promise.all([call('POST', 'support/messages', { token: 'racing', body: msg('First A') }),
      call('POST', 'support/messages', { token: 'racing', body: msg('First B') })]);
    same('simultaneous first sends both commit', firstSends.map(r => r.status), [201, 201]);
    same('simultaneous first sends create one account conversation', firstSends[0].body.conversationId, firstSends[1].body.conversationId);
    await user('rollback');
    await pool.request().batch(`CREATE TRIGGER dbo.support_fixture_fail ON dbo.support_messages AFTER INSERT AS
      BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE body=N'rollback-fixture') THROW 51000,'PRIVATE fixture failure',1; END;`);
    const beforeFailure = await chatState();
    const failed = await call('POST', 'support/messages', { token: 'rollback', body: msg('rollback-fixture') });
    same('SQL failure returns safe API error', [failed.status, failed.body.code], [500, 'SUPPORT_ERROR']);
    check('raw SQL error is not disclosed', !/PRIVATE|51000|stack|EREQUEST/.test(JSON.stringify(failed.body)));
    same('failed account first send rolls back newly created conversation', await chatState(), beforeFailure);
    const guestFailed = await call('POST', 'support/guest-session', { body: { ...msg('rollback-fixture'), name: 'Failure', email: 'failure@example.test' } });
    same('guest first-send failure issues no credential cookie', [guestFailed.status, guestFailed.cookie], [500, null]);
    same('guest failure rolls back session, conversation and message', await chatState(), beforeFailure);
    await pool.request().query('DROP TRIGGER dbo.support_fixture_fail;');
    const support = require('../lib/customer-support');
    let rejected;
    try { await support.send(pool, { kind: 'customer', userId: staff }, null, { text: 'role changed', key: randomUUID() }); }
    catch (e) { rejected = e.status; }
    same('storage rechecks SQL role inside write transaction', rejected, 403);
    revoked.add('owner');
    same('revoked Firebase session cannot read account chat', (await call('GET', 'support/conversation/messages', { token: 'owner' })).status, 401);
    check('API creates at most one first wait per conversation', !(await pool.request().query("SELECT conversation_id FROM dbo.support_messages WHERE system_code='first_wait' GROUP BY conversation_id HAVING COUNT(*)>1;")).recordset.length);
    same('support APIs leave orders, payments, products and inventory unchanged', await businessState(), initialBusiness);

    // One additional failed guest create exhausts the real 5/minute limiter for this IP.
    same('guest creation limiter counts invalid requests too', (await call('POST', 'support/guest-session', { body: {} })).status, 400);
    same('guest creation is rate limited', (await call('POST', 'support/guest-session', { body: {} })).status, 429);
    console.log('Support API SQL verification:', checks, 'checks passed. Configured store unchanged.');
  } finally {
    try { if (server) await new Promise(resolve => server.close(resolve)); if (pool) await pool.close(); }
    finally {
      if (created) { adminSql('ALTER DATABASE ' + quoted + ' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + quoted + ';'); console.log('Removed disposable database:', dbName); }
    }
  }
}
main().catch(error => {
  console.error(error.stack || error.message);
  if (error.stdout) console.error(error.stdout.toString().split('\n').slice(-12).join('\n'));
  if (error.stderr) console.error(error.stderr.toString().split('\n').slice(-12).join('\n'));
  process.exitCode = 1;
});
