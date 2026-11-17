'use strict';
// Audit log — ghi 1 dòng dbo.audit_logs (migration 025, append-only) TRONG transaction của caller.
//   buildAuditRow(req, entry) : hàm thuần, không chạm DB -> object đúng các cột audit_logs.
//   audit(tx, req, entry)     : buildAuditRow + INSERT tham số hoá qua new sql.Request(tx) -> id vừa chèn.
// entry = { action, entityType, entityId, before, after, actor? }.
// Dữ liệu sai -> throw, KHÔNG nuốt lỗi: caller rollback => "ghi log lỗi thì huỷ cả thao tác".
//
// Actor: có req -> req.user do middleware/auth.js gắn (row DB: id, email, role) — không truy vấn thêm.
// req = null (script CLI) -> bắt buộc entry.actor = { role: 'cli', userId?, email? }.
// Khách (customer): không lưu email; lọc thêm khóa address/phone khỏi snapshot.
// Chuỗi như '<img src=x onerror=alert(1)>' lưu NGUYÊN VĂN — thoát ký tự là việc của giao diện.
const { sql } = require('../db');
const { clientIp } = require('../middleware/securityLogger');

const ACTIONS = Object.freeze([
  'PRODUCT_CREATE', 'PRODUCT_UPDATE', 'PRODUCT_HIDE', 'PRODUCT_VARIANT_CHANGE',
  'ORDER_STATUS_CHANGE', 'ORDER_SHIPPING_CHANGE', 'ORDER_DELETE',
  'USER_BLACKLIST', 'USER_UNBLACKLIST', 'REVIEW_VISIBILITY', 'ROLE_CHANGE',
  'ORDER_PLACE', 'ORDER_CANCEL_BY_CUSTOMER', 'REVIEW_CREATE', 'REVIEW_UPDATE', 'REVIEW_DELETE',
]);
const ENTITY_TYPES = Object.freeze(['order', 'product', 'user', 'review']);
const REQ_ROLES = Object.freeze(['admin', 'staff', 'customer']); // khớp CK_audit_logs_actor_role (+ 'cli')

// Khóa chứa các chuỗi này (không phân biệt hoa/thường) bị XOÁ HẲN, đệ quy qua object/mảng.
const ALWAYS_SECRET = Object.freeze(['password', 'passwd', 'token', 'secret', 'authorization', 'card', 'cvv', 'cvc', 'firebase_uid']);
const CUSTOMER_SECRET = Object.freeze([...ALWAYS_SECRET, 'address', 'phone']);

// Khóa CẤP NGOÀI CÙNG luôn giữ ở cả hai phía dù bằng nhau (vd loại thao tác con của PRODUCT_VARIANT_CHANGE).
// Chỉ cấp ngoài cùng: 'action' lồng bên trong một giá trị không đổi vẫn bị lọc cùng giá trị đó.
const DIFF_KEEP_KEY = 'action';
const MAX = Object.freeze({ entityId: 50, email: 255, ip: 45, userAgent: 400 });
const clip = (s, n) => (typeof s === 'string' && s !== '' ? s.slice(0, n) : null);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function resolveActor(req, entry) {
  if (req) {
    if (entry.actor !== undefined) throw new Error('audit: có req thì actor lấy từ req.user, không nhận entry.actor');
    const u = req.user;
    if (!u) throw new Error('audit: thiếu req.user (đặt audit() sau verifyFirebaseToken)');
    if (!REQ_ROLES.includes(u.role)) throw new Error('audit: actor role không hợp lệ: ' + u.role);
    if (!Number.isInteger(u.id) || u.id <= 0) throw new Error('audit: req.user.id không hợp lệ');
    return { userId: u.id, role: u.role, email: u.role === 'customer' ? null : clip(u.email, MAX.email) };
  }
  const a = entry.actor;
  if (!a || a.role !== 'cli') throw new Error("audit: req = null thì bắt buộc entry.actor.role = 'cli'");
  if (a.userId != null && (!Number.isInteger(a.userId) || a.userId <= 0)) throw new Error('audit: actor.userId không hợp lệ');
  return { userId: a.userId == null ? null : a.userId, role: 'cli', email: clip(a.email, MAX.email) };
}

function entityIdOf(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (!['string', 'number', 'bigint'].includes(typeof raw)) throw new Error('audit: entityId phải là chuỗi hoặc số');
  const s = String(raw);
  if (s.length > MAX.entityId) throw new Error('audit: entityId dài quá ' + MAX.entityId + ' ký tự');
  return s;
}

// Đưa về dữ liệu JSON thuần theo đúng ngữ nghĩa JSON.stringify (Date -> ISO qua toJSON; khóa có giá trị
// undefined/hàm bị bỏ, trong mảng thành null), thêm: BigInt -> chuỗi, vòng tham chiếu -> throw.
function toPlain(value, ancestors) {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value.toJSON === 'function') return toPlain(value.toJSON(), ancestors);
  if (ancestors.has(value)) throw new Error('audit: dữ liệu có vòng tham chiếu');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map(v => { const p = toPlain(v, ancestors); return p === undefined ? null : p; });
    const out = {};
    for (const k of Object.keys(value)) { const p = toPlain(value[k], ancestors); if (p !== undefined) out[k] = p; }
    return out;
  } finally { ancestors.delete(value); }
}

function stripSecrets(value, words) {
  if (Array.isArray(value)) return value.map(v => stripSecrets(v, words));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = k.toLowerCase();
    if (!words.some(w => key.includes(w))) out[k] = stripSecrets(v, words);
  }
  return out;
}

// before/after: null/undefined -> NULL; chỉ nhận object hoặc mảng (ISJSON của SQL Server trả 0 cho scalar).
function snapshot(raw, words, label) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') throw new Error('audit: ' + label + ' phải là object/mảng hoặc null');
  return stripSecrets(toPlain(raw, new Set()), words);
}

function buildAuditRow(req, entry) {
  if (!entry || typeof entry !== 'object') throw new Error('audit: thiếu entry');
  if (!ACTIONS.includes(entry.action)) throw new Error('audit: action không hợp lệ: ' + entry.action);
  if (!ENTITY_TYPES.includes(entry.entityType)) throw new Error('audit: entityType không hợp lệ: ' + entry.entityType);
  const entityId = entityIdOf(entry.entityId);
  const actor = resolveActor(req, entry);
  const words = actor.role === 'customer' ? CUSTOMER_SECRET : ALWAYS_SECRET;
  let before = snapshot(entry.before, words, 'before');
  let after = snapshot(entry.after, words, 'after');

  // Chỉ lưu cột thay đổi khi cả hai phía là object; một phía null (tạo mới / snapshot xoá) -> giữ nguyên phía kia.
  if (isPlainObject(before) && isPlainObject(after)) {
    const b = {}, a = {};
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (k !== DIFF_KEEP_KEY && JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
      if (Object.hasOwn(before, k)) b[k] = before[k];
      if (Object.hasOwn(after, k)) a[k] = after[k];
    }
    before = b; after = a;
  }

  const headers = (req && req.headers) || {};
  return {
    actor_user_id: actor.userId,
    actor_email: actor.email,
    actor_role: actor.role,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entityId,
    before_json: before === null ? null : JSON.stringify(before),
    after_json: after === null ? null : JSON.stringify(after),
    ip: req ? clip(clientIp(req), MAX.ip) : null,
    user_agent: req ? clip(headers['user-agent'], MAX.userAgent) : null,
  };
}

// opts.sql (tuỳ chọn): module mssql của caller khi caller nhận sql tiêm từ ngoài (db/create-staff.js) — dùng
// đúng sql.Request của transaction đó. Không truyền -> sql của ../db như cũ.
async function audit(tx, req, entry, { sql: injectedSql } = {}) {
  if (!tx) throw new Error('audit: bắt buộc truyền transaction của thao tác');
  const row = buildAuditRow(req, entry);
  const S = injectedSql || sql;
  const result = await new S.Request(tx)
    .input('actor_user_id', sql.Int, row.actor_user_id)
    .input('actor_email', sql.NVarChar(255), row.actor_email)
    .input('actor_role', sql.VarChar(20), row.actor_role)
    .input('action', sql.VarChar(50), row.action)
    .input('entity_type', sql.VarChar(30), row.entity_type)
    .input('entity_id', sql.VarChar(50), row.entity_id)
    .input('before_json', sql.NVarChar(sql.MAX), row.before_json)
    .input('after_json', sql.NVarChar(sql.MAX), row.after_json)
    .input('ip', sql.VarChar(45), row.ip)
    .input('user_agent', sql.NVarChar(400), row.user_agent)
    .query(`INSERT INTO dbo.audit_logs
      (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json, ip, user_agent)
      OUTPUT INSERTED.id
      VALUES (@actor_user_id, @actor_email, @actor_role, @action, @entity_type, @entity_id,
              @before_json, @after_json, @ip, @user_agent);`);
  return result.recordset[0].id;
}

module.exports = { audit, buildAuditRow, ACTIONS, ENTITY_TYPES, DIFF_KEEP_KEY };
