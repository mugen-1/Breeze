'use strict';
// Real SQL constraints, isolated from the configured store and Firebase.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sql, config } = require('../db');
const serverDir = path.join(__dirname, '..');
const dbName = 'BreezeSupportTest_' + process.pid + '_' + Date.now();
if (!/^BreezeSupportTest_[0-9]+_[0-9]+$/.test(dbName) || dbName === config.database) throw Error('Unsafe test database');
const quoted = '[' + dbName + ']';
const migration = fs.readFileSync(path.join(serverDir, 'db/migrations/020_customer_support.sql'), 'utf8');
const waitText = 'quý khách vui lòng đợi ít phút';
let pool, created = false, checks = 0;

function adminSql(query) {
  execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' });
}
function same(label, actual, expected) {
  assert.deepEqual(actual, expected, label); checks++; console.log('PASS: ' + label);
}
async function rejects(label, run, numbers = [547]) {
  await assert.rejects(run, err => numbers.includes(err.number), label);
  checks++; console.log('PASS: ' + label);
}
function fresh() {
  execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], {
    cwd: serverDir, env: { ...process.env, DB_NAME: dbName }, stdio: 'pipe', maxBuffer: 2 * 1024 * 1024,
  });
}
async function user(name, role = 'customer') {
  return (await pool.request().input('uid', sql.VarChar(128), 'support-fixture-' + name)
    .input('role', sql.VarChar(20), role).query(`INSERT INTO dbo.users(firebase_uid,email,display_name,role)
      OUTPUT INSERTED.id VALUES(@uid,@uid+'@example.test',N'SQL fixture',@role);`)).recordset[0].id;
}
async function conversation(uid = null) {
  return (await pool.request().input('uid', sql.Int, uid).query(`INSERT INTO dbo.support_conversations(user_id)
    OUTPUT INSERTED.id VALUES(@uid);`)).recordset[0].id;
}
async function actor(uid, original = uid) {
  return (await pool.request().input('uid', sql.Int, uid).input('original', sql.Int, original)
    .query(`INSERT INTO dbo.support_admin_actors(user_id,original_user_id)
      OUTPUT INSERTED.id VALUES(@uid,@original);`)).recordset[0].id;
}
async function message(cid, { kind = 'customer', aid = null, body = 'Tin nhắn kiểm thử', code = null, key = null } = {}) {
  return (await pool.request().input('cid', sql.BigInt, cid).input('kind', sql.VarChar(20), kind)
    .input('aid', sql.Int, aid).input('body', sql.NVarChar(sql.MAX), body)
    .input('code', sql.VarChar(30), code).input('key', sql.UniqueIdentifier, key)
    .query(`INSERT INTO dbo.support_messages(conversation_id,sender_kind,admin_actor_id,body,system_code,client_message_id)
      OUTPUT INSERTED.id VALUES(@cid,@kind,@aid,@body,@code,@key);`)).recordset[0].id;
}
async function guest(cid, token, { name = 'Khách kiểm thử', email = 'guest@example.test' } = {}) {
  return pool.request().input('cid', sql.BigInt, cid)
    .input('hash', sql.Binary(32), createHash('sha256').update(token).digest())
    .input('name', sql.NVarChar(150), name).input('email', sql.NVarChar(254), email)
    .query(`INSERT INTO dbo.support_guest_sessions(conversation_id,token_hash,display_name,email)
      OUTPUT INSERTED.id VALUES(@cid,@hash,@name,@email);`);
}
async function read(cid, mid) {
  return pool.request().input('cid', sql.BigInt, cid).input('mid', sql.BigInt, mid)
    .query('UPDATE dbo.support_conversations SET admin_read_message_id=@mid WHERE id=@cid;');
}
async function counts() {
  return (await pool.request().query(`SELECT
    (SELECT COUNT(*) FROM dbo.support_conversations) AS conversations,
    (SELECT COUNT(*) FROM dbo.support_messages) AS messages,
    (SELECT COUNT(*) FROM dbo.support_guest_sessions) AS guests,
    (SELECT COUNT(*) FROM dbo.support_admin_actors) AS actors;`)).recordset[0];
}
async function snapshot() {
  return (await pool.request().query(`SELECT * FROM dbo.support_conversations ORDER BY id;
    SELECT * FROM dbo.support_messages ORDER BY id; SELECT * FROM dbo.support_guest_sessions ORDER BY id;
    SELECT * FROM dbo.support_admin_actors ORDER BY id;`)).recordsets;
}
async function deleteConversation(cid) {
  return pool.request().input('cid', sql.BigInt, cid).query('DELETE FROM dbo.support_conversations WHERE id=@cid;');
}
async function deleteUser(uid) {
  return pool.request().input('uid', sql.Int, uid).query('DELETE FROM dbo.users WHERE id=@uid;');
}

async function main() {
  try {
    adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
    console.log('Created disposable database:', dbName);
    fresh();
    pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    same('full migration chain seeds no chat data', await counts(), { conversations: 0, messages: 0, guests: 0, actors: 0 });
    await pool.request().batch(migration);
    same('second migration run remains empty', await counts(), { conversations: 0, messages: 0, guests: 0, actors: 0 });

    const owner = await user('owner'), other = await user('other');
    const admin = await user('admin', 'admin'), secondAdmin = await user('admin-two', 'admin');
    const cid = await conversation(owner), otherCid = await conversation(other);
    await rejects('one continuous conversation per account', () => conversation(owner), [2601, 2627]);
    await rejects('unknown account cannot own conversation', () => conversation(2147483647));
    const racing = await user('racing');
    const owners = await Promise.allSettled([conversation(racing), conversation(racing)]);
    same('concurrent account creation has exactly one winner', owners.filter(r => r.status === 'fulfilled').length, 1);
    same('losing account creation is a uniqueness violation', owners.find(r => r.status === 'rejected').reason.number === 2601 ||
      owners.find(r => r.status === 'rejected').reason.number === 2627, true);

    const aid = await actor(admin), secondAid = await actor(secondAdmin);
    await rejects('admin account has one actor identity', () => actor(admin), [2601, 2627]);
    await rejects('actor cannot impersonate a different numeric account', () => actor(owner, other));
    await rejects('live actor must reference an existing account', () => actor(2147483647));
    const key = randomUUID();
    const first = await message(cid, { key, body: '<script>fixture only</script>\nTiếng Việt & emoji 🌿' });
    same('Unicode and raw message text are preserved', (await pool.request().input('mid', sql.BigInt, first)
      .query('SELECT body FROM dbo.support_messages WHERE id=@mid;')).recordset[0].body,
    '<script>fixture only</script>\nTiếng Việt & emoji 🌿');
    await rejects('customer retry key cannot duplicate a message', () => message(cid, { key }), [2601, 2627]);
    await message(otherCid, { key });
    await message(cid, { kind: 'admin', aid, key });
    await message(cid, { kind: 'admin', aid: secondAid, key });
    checks++; console.log('PASS: request keys are scoped to conversation and sender');
    await rejects('same admin retry key cannot duplicate a reply', () => message(cid, { kind: 'admin', aid, key }), [2601, 2627]);
    await rejects('admin reply requires an actor', () => message(cid, { kind: 'admin' }));
    await rejects('customer message cannot claim an admin actor', () => message(cid, { aid }));
    await rejects('unknown actor cannot send a reply', () => message(cid, { kind: 'admin', aid: 2147483647 }));
    await rejects('unknown sender kind is rejected', () => message(cid, { kind: 'robot' }));
    await rejects('blank message is rejected', () => message(cid, { body: '   ' }));
    await rejects('orphan message is rejected', () => message('9223372036854775807'));
    await rejects('human message cannot claim system code', () => message(cid, { code: 'first_wait' }));
    await rejects('system message requires its explicit code', () => message(cid, { kind: 'system', body: waitText }));
    await rejects('unsupported system code is rejected', () => message(cid, { kind: 'system', body: waitText, code: 'online' }));
    await rejects('wait message must preserve approved wording', () => message(cid, { kind: 'system', body: 'Please wait', code: 'first_wait' }));
    await rejects('wait message rejects trailing text/space', () => message(cid, { kind: 'system', body: waitText + ' ', code: 'first_wait' }));
    const waits = await Promise.allSettled([message(cid, { kind: 'system', body: waitText, code: 'first_wait' }),
      message(cid, { kind: 'system', body: waitText, code: 'first_wait' })]);
    same('concurrent first-wait inserts persist exactly once', waits.filter(r => r.status === 'fulfilled').length, 1);
    same('second first-wait fails with unique constraint', [2601, 2627].includes(waits.find(r => r.status === 'rejected').reason.number), true);
    await message(otherCid, { kind: 'system', body: waitText, code: 'first_wait' });

    same('Admin read state starts unset', (await pool.request().input('cid', sql.BigInt, cid)
      .query('SELECT admin_read_message_id FROM dbo.support_conversations WHERE id=@cid;')).recordset[0].admin_read_message_id, null);
    await read(cid, first);
    same('Admin read state is shared on conversation', (await pool.request().input('cid', sql.BigInt, cid)
      .query('SELECT admin_read_message_id FROM dbo.support_conversations WHERE id=@cid;')).recordset[0].admin_read_message_id, first);
    await rejects('read cursor cannot reference another conversation', () => read(otherCid, first));
    await rejects('read cursor cannot reference missing message', () => read(cid, '9223372036854775807'));

    const guestCid = await conversation(), anotherGuest = await conversation();
    await guest(guestCid, 'test-secret-one');
    await rejects('one guest credential per conversation', () => guest(guestCid, 'test-secret-two'), [2601, 2627]);
    await rejects('session token hash is globally unique', () => guest(anotherGuest, 'test-secret-one'), [2601, 2627]);
    await rejects('guest name cannot be blank', () => guest(anotherGuest, 'test-secret-two', { name: ' ' }));
    await rejects('guest email cannot be blank', () => guest(anotherGuest, 'test-secret-two', { email: ' ' }));
    await rejects('guest cannot attach to missing conversation', () => guest('9223372036854775807', 'orphan-secret'));
    const session = (await pool.request().input('cid', sql.BigInt, guestCid)
      .query('SELECT token_hash,expires_at FROM dbo.support_guest_sessions WHERE conversation_id=@cid;')).recordset[0];
    same('stored credential is SHA-256 bytes only', session.token_hash, createHash('sha256').update('test-secret-one').digest());
    same('no unapproved expiry is silently selected', session.expires_at, null);
    await rejects('expiry cannot precede session creation', () => pool.request().input('cid', sql.BigInt, guestCid)
      .query("UPDATE dbo.support_guest_sessions SET expires_at=DATEADD(second,-1,created_at) WHERE conversation_id=@cid;"));
    const guestMessage = await message(guestCid);
    await message(guestCid, { kind: 'admin', aid });
    await read(guestCid, guestMessage);

    const before = await snapshot();
    await pool.request().batch(migration);
    same('rerun preserves messages, authors, guest credentials and read state', await snapshot(), before);
    await rejects('author identity cannot be deleted while replies reference it', () => pool.request().input('aid', sql.Int, aid)
      .query('DELETE FROM dbo.support_admin_actors WHERE id=@aid;'));
    const adminCid = await conversation(admin);
    const adminMessage = await message(adminCid, { kind: 'admin', aid });
    await read(adminCid, adminMessage);
    await deleteUser(admin);
    same('deleting admin detaches live account but retains actual numeric sender',
      (await pool.request().input('aid', sql.Int, aid).query('SELECT user_id,original_user_id FROM dbo.support_admin_actors WHERE id=@aid;')).recordset[0],
      { user_id: null, original_user_id: admin });
    same('admin deletion preserves replies in other customer conversations',
      (await pool.request().input('cid', sql.BigInt, cid).input('aid', sql.Int, aid)
        .query('SELECT COUNT(*) AS n FROM dbo.support_messages WHERE conversation_id=@cid AND admin_actor_id=@aid;')).recordset[0].n, 1);
    same('admin account own conversation is physically deleted',
      (await pool.request().input('cid', sql.BigInt, adminCid).query('SELECT COUNT(*) AS n FROM dbo.support_conversations WHERE id=@cid;')).recordset[0].n, 0);

    await deleteConversation(guestCid);
    same('guest conversation deletion removes messages and credentials including read cursor',
      (await pool.request().input('cid', sql.BigInt, guestCid).query(`SELECT
        (SELECT COUNT(*) FROM dbo.support_conversations WHERE id=@cid) AS conversations,
        (SELECT COUNT(*) FROM dbo.support_messages WHERE conversation_id=@cid) AS messages,
        (SELECT COUNT(*) FROM dbo.support_guest_sessions WHERE conversation_id=@cid) AS guests;`)).recordset[0],
      { conversations: 0, messages: 0, guests: 0 });
    await deleteUser(owner);
    same('customer account deletion removes all their chat with read cursor populated',
      (await pool.request().input('cid', sql.BigInt, cid).query(`SELECT
        (SELECT COUNT(*) FROM dbo.support_conversations WHERE id=@cid) AS conversations,
        (SELECT COUNT(*) FROM dbo.support_messages WHERE conversation_id=@cid) AS messages;`)).recordset[0],
      { conversations: 0, messages: 0 });
    same('deleting one customer leaves another conversation intact',
      (await pool.request().input('cid', sql.BigInt, otherCid).query('SELECT COUNT(*) AS n FROM dbo.support_messages WHERE conversation_id=@cid;')).recordset[0].n, 2);

    await pool.close(); pool = null;
    fresh();
    pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    same('explicit fresh setup can rebuild existing CSKH foreign keys and seeds no chats', await counts(),
      { conversations: 0, messages: 0, guests: 0, actors: 0 });
    console.log('Customer support SQL verification:', checks, 'checks passed. Configured store unchanged.');
  } finally {
    if (pool) await pool.close();
    if (created) {
      // dbName is generated and validated above; never drop config.database.
      adminSql('ALTER DATABASE ' + quoted + ' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + quoted + ';');
      console.log('Removed disposable database:', dbName);
    }
  }
}
main().catch(err => {
  console.error(err.stack || err.message);
  if (err.stdout) console.error(err.stdout.toString().split('\n').slice(-12).join('\n'));
  if (err.stderr) console.error(err.stderr.toString().split('\n').slice(-12).join('\n'));
  process.exitCode = 1;
});
