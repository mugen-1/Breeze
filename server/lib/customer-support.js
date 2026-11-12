'use strict';
const { randomBytes, createHash } = require('node:crypto');
const { sql } = require('../db');
const { hub } = require('./support-events');
const { isBackOffice } = require('./roles');
const GUEST_IDLE_SECONDS = 5 * 60;
const FIRST_WAIT_TEXT = 'quý khách vui lòng đợi ít phút';
class SupportError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function invalid() { throw new SupportError(400, 'SUPPORT_INVALID_INPUT', 'Dữ liệu chat không hợp lệ'); }
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) invalid();
}
function id(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) invalid();
  return value;
}
function messageInput(value) {
  fields(value, ['text', 'clientMessageId']);
  // Match the existing 100kb JSON request ceiling; do not silently truncate text.
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.includes('\0') || value.text.length > 100000 ||
      typeof value.clientMessageId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.clientMessageId)) invalid();
  return { text: value.text, key: value.clientMessageId.toLowerCase() };
}
function guestInput(value) {
  fields(value, ['name', 'email', 'text', 'clientMessageId']);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 150 || /[\x00-\x1f\x7f]/.test(value.name) ||
      typeof value.email !== 'string' || value.email.trim().length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.email.trim()) || /[\x00-\x1f\x7f]/.test(value.email)) invalid();
  return { name: value.name.trim(), email: value.email.trim(), message: messageInput({ text: value.text, clientMessageId: value.clientMessageId }) };
}
function historyInput(query = {}) {
  fields(query, ['limit', 'before']);
  const limit = query.limit === undefined ? 50 : integer(query.limit, 100);
  return { limit, before: query.before === undefined ? null : id(query.before) };
}
function integer(value, maximum) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value) || Number(value) > maximum) invalid();
  return Number(value);
}
function inboxInput(query = {}) {
  fields(query, ['page', 'limit']);
  return { page: query.page === undefined ? 1 : integer(query.page, 2147483647),
    limit: query.limit === undefined ? 30 : integer(query.limit, 100) };
}
function readInput(value) {
  fields(value, ['messageId', 'messageCount']);
  if (value.messageCount !== undefined && (typeof value.messageCount !== 'string' || !/^[1-9]\d{0,18}$/.test(value.messageCount) || BigInt(value.messageCount) > 9223372036854775807n)) invalid();
  return { messageId: id(value.messageId), ...(value.messageCount !== undefined ? { messageCount: value.messageCount } : {}) };
}
function hashToken(token) { return createHash('sha256').update(token).digest(); }
function unauthorized() { return new SupportError(401, 'SUPPORT_SESSION_EXPIRED', 'Phiên chat không hợp lệ hoặc đã hết hạn'); }
function missing() { return new SupportError(404, 'SUPPORT_NOT_FOUND', 'Không tìm thấy hội thoại'); }
function request(tx) { return new sql.Request(tx); }
async function transaction(pool, work) {
  const tx = new sql.Transaction(pool);
  try { await tx.begin(); const value = await work(tx); await tx.commit(); return value; }
  catch (error) { try { await tx.rollback(); } catch (_) { /* SQL may already have rolled back. */ } throw error; }
}
async function lockUser(tx, principal) {
  const row = (await request(tx).input('uid', sql.Int, principal.userId)
    .query('SELECT role FROM dbo.users WITH (UPDLOCK,HOLDLOCK) WHERE id=@uid;')).recordset[0];
  if (!row) throw unauthorized();
  if (!roleMatches(principal.kind, row.role)) {
    throw new SupportError(403, 'SUPPORT_FORBIDDEN', 'Tài khoản không có quyền thực hiện thao tác này');
  }
}
// principal.kind 'admin' = phía quản trị (role admin HOẶC staff); 'customer' = đúng role customer.
// Đọc role SQL hiện tại trong transaction: mất quyền giữa chừng thì bị chặn ngay.
function roleMatches(kind, role) {
  return kind === 'admin' ? isBackOffice(role) : kind === 'customer' && role === 'customer';
}
function conversationDTO(row) {
  return { id: String(row.id), kind: row.user_id == null ? 'guest' : 'customer', createdAt: row.created_at, updatedAt: row.updated_at };
}
const MESSAGE_SELECT = `SELECT m.id,m.sender_kind,m.body,m.created_at,m.admin_actor_id,a.original_user_id,
  au.display_name AS admin_name,COALESCE(cu.display_name,g.display_name) AS customer_name
  FROM dbo.support_messages m
  JOIN dbo.support_conversations c ON c.id=m.conversation_id
  LEFT JOIN dbo.users cu ON cu.id=c.user_id
  LEFT JOIN dbo.support_guest_sessions g ON g.conversation_id=c.id
  LEFT JOIN dbo.support_admin_actors a ON a.id=m.admin_actor_id
  LEFT JOIN dbo.users au ON au.id=a.user_id`;
function messageDTO(row, admin) {
  const value = { id: String(row.id), kind: row.sender_kind, text: row.body, createdAt: row.created_at,
    senderName: row.sender_kind === 'admin' ? (admin ? row.admin_name : 'BREEZE') :
      row.sender_kind === 'customer' ? row.customer_name : null };
  if (admin && row.sender_kind === 'admin') value.senderUserId = row.original_user_id;
  return value;
}
async function activeGuest(tx, cid, hash) {
  const result = await request(tx).input('cid', sql.BigInt, cid).input('hash', sql.Binary(32), hash || null)
    .query(`SELECT display_name,email FROM dbo.support_guest_sessions WITH (UPDLOCK,HOLDLOCK)
      WHERE conversation_id=@cid AND (@hash IS NULL OR token_hash=@hash)
        AND revoked_at IS NULL AND expires_at>SYSUTCDATETIME();`);
  return result.recordset[0];
}
async function inConversation(pool, principal, cid, create, work) {
  return transaction(pool, async tx => {
    if (principal.kind !== 'guest') await lockUser(tx, principal);
    if (principal.kind === 'guest') {
      const found = (await request(tx).input('hash', sql.Binary(32), principal.hash)
        .query('SELECT conversation_id FROM dbo.support_guest_sessions WHERE token_hash=@hash;')).recordset[0];
      if (!found) throw unauthorized(); cid = found.conversation_id;
    }
    let row;
    if (principal.kind === 'customer') {
      row = (await request(tx).input('uid', sql.Int, principal.userId)
        .query('SELECT * FROM dbo.support_conversations WITH (UPDLOCK,HOLDLOCK) WHERE user_id=@uid;')).recordset[0];
      if (!row && create) row = (await request(tx).input('uid', sql.Int, principal.userId)
        .query('INSERT INTO dbo.support_conversations(user_id) OUTPUT INSERTED.* VALUES(@uid);')).recordset[0];
      if (!row) return null;
    } else {
      row = (await request(tx).input('cid', sql.BigInt, cid)
        .query('SELECT * FROM dbo.support_conversations WITH (UPDLOCK,HOLDLOCK) WHERE id=@cid;')).recordset[0];
      if (!row) throw principal.kind === 'guest' ? unauthorized() : missing();
    }
    if (row.user_id == null) {
      if (!await activeGuest(tx, row.id, principal.kind === 'guest' ? principal.hash : null)) {
        throw principal.kind === 'guest' ? unauthorized() : missing();
      }
    } else if (principal.kind === 'guest') throw unauthorized();
    return work(tx, row);
  });
}
async function adminActor(tx, uid) {
  let row = (await request(tx).input('uid', sql.Int, uid)
    .query('SELECT id FROM dbo.support_admin_actors WITH (UPDLOCK,HOLDLOCK) WHERE original_user_id=@uid;')).recordset[0];
  if (!row) row = (await request(tx).input('uid', sql.Int, uid)
    .query('INSERT INTO dbo.support_admin_actors(user_id,original_user_id) OUTPUT INSERTED.id VALUES(@uid,@uid);')).recordset[0];
  return row.id;
}
async function writeMessage(tx, row, principal, data) {
  const admin = principal.kind === 'admin', kind = admin ? 'admin' : 'customer';
  const aid = admin ? await adminActor(tx, principal.userId) : null;
  let stored = (await request(tx).input('cid', sql.BigInt, row.id).input('kind', sql.VarChar(20), kind)
    .input('aid', sql.Int, aid).input('key', sql.UniqueIdentifier, data.key)
    .query(`SELECT id,body FROM dbo.support_messages WHERE conversation_id=@cid AND sender_kind=@kind
      AND (admin_actor_id=@aid OR (admin_actor_id IS NULL AND @aid IS NULL)) AND client_message_id=@key;`)).recordset[0];
  const replayed = !!stored;
  if (stored && stored.body !== data.text) throw new SupportError(409, 'SUPPORT_REQUEST_CONFLICT', 'Mã gửi lại đã được dùng cho nội dung khác');
  if (!stored) {
    stored = (await request(tx).input('cid', sql.BigInt, row.id).input('kind', sql.VarChar(20), kind)
      .input('aid', sql.Int, aid).input('key', sql.UniqueIdentifier, data.key).input('text', sql.NVarChar(sql.MAX), data.text)
      .query(`INSERT INTO dbo.support_messages(conversation_id,sender_kind,admin_actor_id,body,client_message_id)
        OUTPUT INSERTED.id VALUES(@cid,@kind,@aid,@text,@key);
        UPDATE dbo.support_conversations SET updated_at=SYSUTCDATETIME() WHERE id=@cid;`)).recordset[0];
  }
  if (principal.kind === 'guest') await request(tx).input('cid', sql.BigInt, row.id).input('seconds', sql.Int, GUEST_IDLE_SECONDS)
    .query(`UPDATE dbo.support_guest_sessions SET last_seen_at=SYSUTCDATETIME(),
      expires_at=DATEADD(second,@seconds,SYSUTCDATETIME()) WHERE conversation_id=@cid;`);
  if (!admin && !replayed) await request(tx).input('cid', sql.BigInt, row.id).input('text', sql.NVarChar(sql.MAX), FIRST_WAIT_TEXT)
    .query(`INSERT INTO dbo.support_messages(conversation_id,sender_kind,body,system_code)
      SELECT @cid,'system',@text,'first_wait'
      WHERE (SELECT COUNT_BIG(*) FROM dbo.support_messages WHERE conversation_id=@cid AND sender_kind='customer')=1
        AND NOT EXISTS(SELECT 1 FROM dbo.support_messages WHERE conversation_id=@cid AND system_code='first_wait');`);
  const message = (await request(tx).input('mid', sql.BigInt, stored.id).query(MESSAGE_SELECT + ' WHERE m.id=@mid;')).recordset[0];
  const wait = !admin && (await request(tx).input('cid', sql.BigInt, row.id).input('mid', sql.BigInt, stored.id).query(MESSAGE_SELECT + `
    WHERE m.conversation_id=@cid AND m.system_code='first_wait'
      AND NOT EXISTS(SELECT 1 FROM dbo.support_messages WHERE conversation_id=@cid AND sender_kind='customer' AND id<@mid);`)).recordset[0];
  return { conversationId: String(row.id), message: messageDTO(message, admin), replayed,
    ...(wait ? { systemMessage: messageDTO(wait, false) } : {}) };
}
async function startGuest(pool, profile, token) {
  // Repeated first-send after the browser received its cookie reuses the active session.
  if (token) {
    const found = (await pool.request().input('hash', sql.Binary(32), hashToken(token)).query(`SELECT g.conversation_id
      FROM dbo.support_guest_sessions g JOIN dbo.support_conversations c ON c.id=g.conversation_id
      WHERE g.token_hash=@hash AND c.user_id IS NULL AND g.revoked_at IS NULL AND g.expires_at>SYSUTCDATETIME();`)).recordset[0];
    if (found) {
      const result = await inConversation(pool, { kind: 'guest', hash: hashToken(token) }, null, false, async (tx, row) => {
        const current = await activeGuest(tx, row.id, hashToken(token));
        if (current.display_name !== profile.name || current.email !== profile.email) {
          throw new SupportError(409, 'SUPPORT_SESSION_EXISTS', 'Phiên chat hiện tại đã có thông tin khách');
        }
        return writeMessage(tx, row, { kind: 'guest' }, profile.message);
      });
      if (!result.replayed) hub.publish({ conversationId: result.conversationId, customerId: null });
      return { ...result, token };
    }
  }
  token = randomBytes(32).toString('base64url');
  const result = await transaction(pool, async tx => {
    const row = (await request(tx).query('INSERT INTO dbo.support_conversations DEFAULT VALUES; SELECT * FROM dbo.support_conversations WHERE id=SCOPE_IDENTITY();')).recordset[0];
    await request(tx).input('cid', sql.BigInt, row.id).input('hash', sql.Binary(32), hashToken(token))
      .input('name', sql.NVarChar(150), profile.name).input('email', sql.NVarChar(254), profile.email)
      .input('seconds', sql.Int, GUEST_IDLE_SECONDS)
      .query(`INSERT INTO dbo.support_guest_sessions(conversation_id,token_hash,display_name,email,expires_at)
        VALUES(@cid,@hash,@name,@email,DATEADD(second,@seconds,SYSUTCDATETIME()));`);
    return writeMessage(tx, row, { kind: 'guest' }, profile.message);
  });
  hub.publish({ conversationId: result.conversationId, customerId: null });
  return { ...result, token };
}
async function currentConversation(pool, principal) {
  return inConversation(pool, principal, null, false, async (_tx, row) => ({ conversation: conversationDTO(row) }));
}
async function history(pool, principal, cid, options) {
  return inConversation(pool, principal, cid, false, async (tx, row) => {
    let cursor = null;
    if (options.before) {
      cursor = (await request(tx).input('cid', sql.BigInt, row.id).input('mid', sql.BigInt, options.before)
        .query('SELECT created_at,id FROM dbo.support_messages WHERE conversation_id=@cid AND id=@mid;')).recordset[0];
      if (!cursor) invalid();
    }
    // Compare DATETIME2 in SQL, not a JS Date rounded to milliseconds.
    const rows = (await request(tx).input('cid', sql.BigInt, row.id).input('mid', sql.BigInt, cursor ? cursor.id : null)
      .input('limit', sql.Int, options.limit + 1).query(MESSAGE_SELECT.replace('SELECT m.id', 'SELECT TOP (@limit) m.id') + `
        WHERE m.conversation_id=@cid AND (@mid IS NULL OR m.created_at < (SELECT created_at FROM dbo.support_messages WHERE id=@mid)
          OR (m.created_at=(SELECT created_at FROM dbo.support_messages WHERE id=@mid) AND m.id<@mid))
        ORDER BY m.created_at DESC,m.id DESC;`)).recordset;
    const more = rows.length > options.limit; rows.length = Math.min(rows.length, options.limit);
    const nextBefore = more ? String(rows[rows.length - 1].id) : null;
    const count = principal.kind === 'admin' && (await request(tx).input('cid', sql.BigInt, row.id)
      .query('SELECT CONVERT(varchar(20),COUNT_BIG(*)) AS n FROM dbo.support_messages WHERE conversation_id=@cid;')).recordset[0].n;
    return { conversation: conversationDTO(row), messages: rows.reverse().map(m => messageDTO(m, principal.kind === 'admin')), nextBefore, historyRevision: String(row.history_revision),
      ...(principal.kind === 'admin' ? { readMessageId: row.admin_read_message_id == null ? null : String(row.admin_read_message_id), messageCount: count } : {}) };
  });
}
async function markRead(pool, principal, cid, messageId, messageCount) {
  if (principal.kind !== 'admin') throw new SupportError(403, 'SUPPORT_FORBIDDEN', 'Chỉ Admin được cập nhật trạng thái đã đọc');
  let changed = false;
  const result = await inConversation(pool, principal, cid, false, async (tx, row) => {
    if (messageCount !== undefined) {
      const count = (await request(tx).input('cid', sql.BigInt, row.id).query('SELECT CONVERT(varchar(20),COUNT_BIG(*)) AS n FROM dbo.support_messages WHERE conversation_id=@cid;')).recordset[0].n;
      if (count !== messageCount) throw new SupportError(409, 'SUPPORT_HISTORY_CHANGED', 'Lịch sử đã thay đổi, vui lòng đồng bộ lại trước khi đánh dấu đã đọc');
    }
    const target = (await request(tx).input('cid', sql.BigInt, row.id).input('mid', sql.BigInt, messageId)
      .query("SELECT id FROM dbo.support_messages WHERE conversation_id=@cid AND id=@mid AND sender_kind='customer';")).recordset[0];
    if (!target) invalid();
    // The conversation lock serializes sends and all Admin read acknowledgements.
    // Never mark a newer, concurrently arriving message using the current SQL MAX.
    changed = row.admin_read_message_id == null || BigInt(messageId) > BigInt(row.admin_read_message_id);
    if (changed) await request(tx).input('cid', sql.BigInt, row.id).input('mid', sql.BigInt, messageId)
      .query('UPDATE dbo.support_conversations SET admin_read_message_id=@mid WHERE id=@cid;');
    const readMessageId = changed ? messageId : String(row.admin_read_message_id);
    const unread = (await request(tx).input('cid', sql.BigInt, row.id).input('mid', sql.BigInt, readMessageId)
      .query("SELECT CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.support_messages WHERE conversation_id=@cid AND sender_kind='customer' AND id>@mid) THEN 1 ELSE 0 END AS BIT) AS unread;")).recordset[0].unread;
    return { conversationId: String(row.id), readMessageId, unread };
  });
  if (changed) hub.publish({ audience: 'admin', conversationId: result.conversationId });
  return result;
}
async function send(pool, principal, cid, data) {
  let owner;
  const result = await inConversation(pool, principal, cid, true, (tx, row) => {
    owner = row.user_id;
    return writeMessage(tx, row, principal, data);
  });
  if (result && !result.replayed) hub.publish({ conversationId: result.conversationId, customerId: owner });
  return result;
}
async function streamAccess(pool, principal) {
  if (principal.kind === 'guest') {
    const row = (await pool.request().input('hash', sql.Binary(32), principal.hash).query(`
      SELECT c.id,DATEDIFF_BIG(millisecond,SYSUTCDATETIME(),g.expires_at) AS lease_ms
      FROM dbo.support_guest_sessions g JOIN dbo.support_conversations c ON c.id=g.conversation_id
      WHERE g.token_hash=@hash AND c.user_id IS NULL AND g.revoked_at IS NULL AND g.expires_at>SYSUTCDATETIME();`)).recordset[0];
    if (!row) throw unauthorized();
    return { kind: 'guest', conversationId: String(row.id), leaseMs: Number(row.lease_ms) };
  }
  const row = (await pool.request().input('uid', sql.Int, principal.userId).input('firebaseUid', sql.VarChar(128), principal.firebaseUid)
    .query(`SELECT u.id,u.role,c.id AS conversation_id FROM dbo.users u
      LEFT JOIN dbo.support_conversations c ON c.user_id=u.id WHERE u.id=@uid AND u.firebase_uid=@firebaseUid;`)).recordset[0];
  if (!row) throw unauthorized();
  if (!roleMatches(principal.kind, row.role)) throw new SupportError(403, 'SUPPORT_FORBIDDEN', 'Tài khoản không có quyền truy cập luồng chat');
  return { kind: principal.kind, userId: row.id, conversationId: row.conversation_id == null ? null : String(row.conversation_id) };
}
async function inbox(pool, principal, options) {
  return transaction(pool, async tx => {
    await lockUser(tx, principal);
    const result = await request(tx).input('page', sql.Int, options.page).input('limit', sql.Int, options.limit).query(`
      DECLARE @items TABLE(id BIGINT PRIMARY KEY);
      INSERT INTO @items SELECT c.id FROM dbo.support_conversations c
      WHERE EXISTS (SELECT 1 FROM dbo.support_messages m WHERE m.conversation_id=c.id)
        AND (c.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM dbo.support_guest_sessions g
          WHERE g.conversation_id=c.id AND g.revoked_at IS NULL AND g.expires_at>SYSUTCDATETIME()));
      DECLARE @total INT=(SELECT COUNT(*) FROM @items);
      DECLARE @last INT=CASE WHEN @total=0 THEN 1 ELSE ((@total-1)/@limit)+1 END;
      DECLARE @actual INT=CASE WHEN @page>@last THEN @last ELSE @page END;
      SELECT @total AS total,@actual AS page;
      SELECT c.id,c.user_id,c.created_at,c.updated_at,COALESCE(u.display_name,g.display_name) AS name,
        COALESCE(u.email,g.email) AS email,last_message.body AS preview,
        CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.support_messages m WHERE m.conversation_id=c.id
          AND m.sender_kind='customer' AND (c.admin_read_message_id IS NULL OR m.id>c.admin_read_message_id)) THEN 1 ELSE 0 END AS BIT) AS unread
      FROM @items selected JOIN dbo.support_conversations c ON c.id=selected.id
      LEFT JOIN dbo.users u ON u.id=c.user_id LEFT JOIN dbo.support_guest_sessions g ON g.conversation_id=c.id
      CROSS APPLY (SELECT TOP(1) body FROM dbo.support_messages WHERE conversation_id=c.id AND sender_kind<>'system' ORDER BY created_at DESC,id DESC) last_message
      ORDER BY c.updated_at DESC,c.id DESC OFFSET (CONVERT(BIGINT,@actual)-1)*@limit ROWS FETCH NEXT @limit ROWS ONLY;`);
    const meta = result.recordsets[0][0];
    return { page: meta.page, limit: options.limit, total: meta.total, totalPages: Math.ceil(meta.total / options.limit),
      conversations: result.recordsets[1].map(row => ({ ...conversationDTO(row), name: row.name, email: row.email, preview: row.preview, unread: row.unread })) };
  });
}
module.exports = { SupportError, GUEST_IDLE_SECONDS, id, messageInput, guestInput, historyInput, inboxInput, readInput,
  hashToken, startGuest, currentConversation, history, send, inbox, streamAccess, markRead };
