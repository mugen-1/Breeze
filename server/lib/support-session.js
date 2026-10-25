'use strict';
const { sql } = require('../db');
const { SupportError, GUEST_IDLE_SECONDS } = require('./customer-support');
const { hub } = require('./support-events');
const req = tx => new sql.Request(tx);
async function transaction(pool, fn) {
  const tx = new sql.Transaction(pool);
  try { await tx.begin(); const result = await fn(tx); await tx.commit(); return result; }
  catch (e) { try { await tx.rollback(); } catch (_) {} throw e; }
}
const expired = () => new SupportError(401, 'SUPPORT_SESSION_EXPIRED', 'Phiên chat đã hết hạn');
async function heartbeat(pool, hash) {
  return transaction(pool, async tx => {
    const found = (await req(tx).input('hash', sql.Binary(32), hash).query('SELECT conversation_id FROM dbo.support_guest_sessions WHERE token_hash=@hash;')).recordset[0];
    if (!found) throw expired();
    const owner = (await req(tx).input('cid', sql.BigInt, found.conversation_id)
      .query('SELECT user_id FROM dbo.support_conversations WITH (UPDLOCK,HOLDLOCK) WHERE id=@cid;')).recordset[0];
    if (!owner || owner.user_id != null) throw expired();
    const result = await req(tx).input('cid', sql.BigInt, found.conversation_id).input('hash', sql.Binary(32), hash).input('seconds', sql.Int, GUEST_IDLE_SECONDS)
      .query(`UPDATE dbo.support_guest_sessions WITH (UPDLOCK,HOLDLOCK) SET last_seen_at=SYSUTCDATETIME(),expires_at=DATEADD(second,@seconds,SYSUTCDATETIME())
        OUTPUT INSERTED.expires_at WHERE conversation_id=@cid AND token_hash=@hash AND revoked_at IS NULL AND expires_at>SYSUTCDATETIME();`);
    if (!result.recordset.length) throw expired();
    return { active: true };
  });
}
async function mergeGuest(pool, principal, hash) {
  if (principal.kind !== 'customer') throw new SupportError(403, 'SUPPORT_FORBIDDEN', 'Chỉ khách hàng được nhận hội thoại khách');
  let oldId, targetId;
  const result = await transaction(pool, async tx => {
    const user = (await req(tx).input('uid', sql.Int, principal.userId)
      .query('SELECT role FROM dbo.users WITH (UPDLOCK,HOLDLOCK) WHERE id=@uid;')).recordset[0];
    if (!user || user.role !== 'customer') throw new SupportError(403, 'SUPPORT_FORBIDDEN', 'Tài khoản không có quyền nhận hội thoại');
    const found = (await req(tx).input('hash', sql.Binary(32), hash).query('SELECT conversation_id FROM dbo.support_guest_sessions WHERE token_hash=@hash;')).recordset[0];
    if (!found) return { merged: false };
    const own = (await req(tx).input('uid', sql.Int, principal.userId).query('SELECT id FROM dbo.support_conversations WHERE user_id=@uid;')).recordset[0];
    const ids = [String(found.conversation_id), ...(own ? [String(own.id)] : [])].sort((a, b) => a.length - b.length || a.localeCompare(b));
    const rows = [];
    // All transfers lock conversation IDs in the same order; sends/heartbeat/GC
    // also lock the conversation before touching its guest credential.
    for (const id of ids) rows.push((await req(tx).input('cid', sql.BigInt, id)
      .query('SELECT * FROM dbo.support_conversations WITH (UPDLOCK,HOLDLOCK) WHERE id=@cid;')).recordset[0]);
    const source = rows.find(r => r && String(r.id) === String(found.conversation_id));
    if (!source || source.user_id != null) return { merged: false };
    const valid = (await req(tx).input('cid', sql.BigInt, source.id).input('hash', sql.Binary(32), hash)
      .query('SELECT id FROM dbo.support_guest_sessions WITH (UPDLOCK,HOLDLOCK) WHERE conversation_id=@cid AND token_hash=@hash AND revoked_at IS NULL AND expires_at>SYSUTCDATETIME();')).recordset[0];
    if (!valid) return { merged: false };
    oldId = String(source.id); targetId = own ? String(own.id) : oldId;
    if (!own) {
      await req(tx).input('cid', sql.BigInt, source.id).input('uid', sql.Int, principal.userId).query(`
        DELETE FROM dbo.support_guest_sessions WHERE conversation_id=@cid;
        UPDATE dbo.support_conversations SET user_id=@uid,history_revision=history_revision+1 WHERE id=@cid;`);
    } else {
      await req(tx).input('source', sql.BigInt, source.id).input('target', sql.BigInt, own.id).query(`
        -- One cursor cannot represent two disjoint read sets. Preserve every
        -- unread customer message, reopening previously read rows if necessary.
        DECLARE @unread BIGINT=(SELECT MIN(m.id) FROM dbo.support_messages m JOIN dbo.support_conversations c ON c.id=m.conversation_id
          WHERE c.id IN (@source,@target) AND m.sender_kind='customer' AND (c.admin_read_message_id IS NULL OR m.id>c.admin_read_message_id));
        DECLARE @cursor BIGINT=(SELECT MAX(id) FROM dbo.support_messages WHERE conversation_id IN (@source,@target)
          AND sender_kind='customer' AND (@unread IS NULL OR id<@unread));
        DECLARE @created DATETIME2=(SELECT MIN(created_at) FROM dbo.support_conversations WHERE id IN (@source,@target));
        DECLARE @updated DATETIME2=(SELECT MAX(updated_at) FROM dbo.support_conversations WHERE id IN (@source,@target));
        UPDATE dbo.support_conversations SET admin_read_message_id=NULL WHERE id IN (@source,@target);
        DECLARE @wait BIGINT=(SELECT TOP(1) id FROM dbo.support_messages WHERE conversation_id IN (@source,@target)
          AND system_code='first_wait' ORDER BY created_at,id);
        DELETE FROM dbo.support_messages WHERE conversation_id IN (@source,@target) AND system_code='first_wait' AND id<>@wait;
        -- UUIDs were scoped to separate conversations. Keep all human messages
        -- and IDs if their retry keys collide after the transfer.
        UPDATE s SET client_message_id=NULL FROM dbo.support_messages s WHERE s.conversation_id=@source AND s.client_message_id IS NOT NULL
          AND EXISTS(SELECT 1 FROM dbo.support_messages t WHERE t.conversation_id=@target AND t.sender_kind=s.sender_kind
            AND (t.admin_actor_id=s.admin_actor_id OR (t.admin_actor_id IS NULL AND s.admin_actor_id IS NULL)) AND t.client_message_id=s.client_message_id);
        UPDATE dbo.support_messages SET conversation_id=@target WHERE conversation_id=@source;
        DELETE FROM dbo.support_conversations WHERE id=@source;
        UPDATE dbo.support_conversations SET admin_read_message_id=@cursor,created_at=@created,updated_at=@updated,history_revision=history_revision+1 WHERE id=@target;`);
    }
    return { merged: true, conversationId: targetId };
  });
  if (result.merged) {
    hub.publish({ conversationId: oldId, customerId: null, reset: true });
    hub.publish({ conversationId: targetId, customerId: principal.userId, reset: true });
  }
  return result;
}
async function cleanupExpired(pool, limit = 100) {
  const ids = (await pool.request().input('limit', sql.Int, limit).input('seconds', sql.Int, GUEST_IDLE_SECONDS).query(`
    SELECT TOP(@limit) c.id FROM dbo.support_conversations c JOIN dbo.support_guest_sessions g ON g.conversation_id=c.id
    WHERE c.user_id IS NULL AND (g.revoked_at IS NOT NULL OR COALESCE(g.expires_at,DATEADD(second,@seconds,g.last_seen_at))<=SYSUTCDATETIME()) ORDER BY c.id;`)).recordset;
  let removed = 0;
  for (const candidate of ids) {
    const deleted = await transaction(pool, async tx => {
      const owner = (await req(tx).input('cid', sql.BigInt, candidate.id)
        .query('SELECT user_id FROM dbo.support_conversations WITH (UPDLOCK,HOLDLOCK) WHERE id=@cid;')).recordset[0];
      if (!owner || owner.user_id != null) return false;
      const session = (await req(tx).input('cid', sql.BigInt, candidate.id).input('seconds', sql.Int, GUEST_IDLE_SECONDS).query(`
        SELECT CAST(CASE WHEN revoked_at IS NOT NULL OR COALESCE(expires_at,DATEADD(second,@seconds,last_seen_at))<=SYSUTCDATETIME()
          THEN 1 ELSE 0 END AS BIT) AS expired FROM dbo.support_guest_sessions WITH (UPDLOCK,HOLDLOCK) WHERE conversation_id=@cid;`)).recordset[0];
      if (!session || !session.expired) return false;
      await req(tx).input('cid', sql.BigInt, candidate.id).query('DELETE FROM dbo.support_conversations WHERE id=@cid;');
      return true;
    });
    if (deleted) { removed++; hub.publish({ conversationId: String(candidate.id), customerId: null }); }
  }
  return { removed, scanned: ids.length };
}
async function discardGuest(pool, principal, hash) {
  if (principal.kind !== 'admin') throw new SupportError(403, 'SUPPORT_FORBIDDEN', 'Chỉ dùng khi đăng nhập Admin');
  const deleted = await transaction(pool, async tx => {
    const user = (await req(tx).input('uid', sql.Int, principal.userId).query('SELECT role FROM dbo.users WITH (UPDLOCK,HOLDLOCK) WHERE id=@uid;')).recordset[0];
    if (!user || user.role !== 'admin') throw new SupportError(403, 'SUPPORT_FORBIDDEN', 'Tài khoản không có quyền thực hiện thao tác này');
    const found = (await req(tx).input('hash', sql.Binary(32), hash).query('SELECT conversation_id FROM dbo.support_guest_sessions WHERE token_hash=@hash;')).recordset[0];
    if (!found) return null;
    const owner = (await req(tx).input('cid', sql.BigInt, found.conversation_id).query('SELECT user_id FROM dbo.support_conversations WITH (UPDLOCK,HOLDLOCK) WHERE id=@cid;')).recordset[0];
    if (!owner || owner.user_id != null) return null;
    const own = (await req(tx).input('cid', sql.BigInt, found.conversation_id).input('hash', sql.Binary(32), hash)
      .query('SELECT id FROM dbo.support_guest_sessions WITH (UPDLOCK,HOLDLOCK) WHERE conversation_id=@cid AND token_hash=@hash;')).recordset[0];
    if (!own) return null;
    await req(tx).input('cid', sql.BigInt, found.conversation_id).query('DELETE FROM dbo.support_conversations WHERE id=@cid;');
    return String(found.conversation_id);
  });
  if (deleted) hub.publish({ conversationId: deleted, customerId: null });
  return { discarded: !!deleted };
}
function startCleanup(getPool, options = {}) {
  let running = false, stopped = false;
  const clean = options.clean || cleanupExpired;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const pool = await getPool(); let result;
      do { result = await clean(pool); } while (!stopped && result.scanned === 100 && result.removed > 0);
    } catch (_) { console.error('[support] session cleanup failed'); }
    finally { running = false; }
  }
  const timer = setInterval(tick, options.intervalMs || 30000); if (timer.unref) timer.unref();
  tick();
  return { stop() { stopped = true; clearInterval(timer); }, tick };
}
module.exports = { heartbeat, mergeGuest, discardGuest, cleanupExpired, startCleanup };
