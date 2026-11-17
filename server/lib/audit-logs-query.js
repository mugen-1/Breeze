'use strict';
// GET /api/admin/audit-logs — phần thuần: kiểm tham số query + dựng câu SQL tham số hoá + đổi dòng DB ra JSON.
// Không chạm DB. Route: routes/admin-audit-logs.js.
//   parseAuditQuery(query, { canReadAdmin }) -> { ok: true, filters } | { ok: false, error }
//   buildAuditQuery(filters, { canReadAdmin }) -> { sql, params: [{ name, type, value }] }   (2 câu: COUNT rồi trang dữ liệu)
//   toLogDto(row, { canReadAdmin }) -> 1 phần tử của logs[]
// Ngày: from/to là 'YYYY-MM-DD' theo giờ Việt Nam (UTC+7), to tính hết ngày; created_at lưu UTC.
const { sql } = require('../db');
const { ACTIONS, ENTITY_TYPES } = require('./audit');

const PAGE_SIZE = 50;
const MAX_INT = 2147483647;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86400000;
const SQL_MIN = new Date('0001-01-01T00:00:00Z');
const SQL_MAX = new Date('9999-12-31T23:59:59.999Z');

// 'YYYY-MM-DD' -> mốc UTC lúc 00:00 giờ VN của ngày đó. Sai định dạng / ngày không tồn tại (vd 2026-02-30) -> null.
// Cùng kết quả với parseYMD(s) - VN_OFFSET_MS trong routes/admin.js (thống kê).
function vnDayStart(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return new Date(d.getTime() - VN_OFFSET_MS);
}
// Mốc UTC NGAY SAU ngày đó theo giờ VN (cận trên, không tính) — "to tính hết ngày".
function vnDayEnd(s) {
  const start = vnDayStart(s);
  return start && new Date(start.getTime() + DAY_MS);
}

// Chuỗi số nguyên dương thuần chữ số (không '+5', '05', '5.0', ' 5'), tối đa INT của SQL Server.
const positiveInt = s => (/^[1-9]\d*$/.test(s) && Number(s) <= MAX_INT ? Number(s) : null);

function parseAuditQuery(query, { canReadAdmin }) {
  const q = query || {};
  const fail = error => ({ ok: false, error });
  // Mỗi tham số: thiếu hoặc rỗng -> không lọc; lặp (mảng) / không phải chuỗi -> lỗi.
  const read = name => {
    const v = q[name];
    if (v === undefined || v === '') return { value: null };
    if (typeof v !== 'string') return { error: name + ' không hợp lệ' };
    return { value: v };
  };
  const f = { group: null, action: null, entityType: null, entityId: null, actorUserId: null, actorEmail: null,
    start: null, end: null, page: 1 };

  let r = read('group');
  if (r.error) return fail(r.error);
  if (r.value !== null) {
    if (!['admin', 'customer'].includes(r.value)) return fail('group không hợp lệ');
    f.group = r.value;
  }
  // Không có audit:read_admin (staff): LUÔN chỉ nhóm Khách hàng, kể cả khi gửi group=admin — không báo lỗi.
  if (!canReadAdmin) f.group = 'customer';

  r = read('action');
  if (r.error) return fail(r.error);
  if (r.value !== null) {
    if (!ACTIONS.includes(r.value)) return fail('action không hợp lệ');
    f.action = r.value;
  }

  r = read('entity_type');
  if (r.error) return fail(r.error);
  if (r.value !== null) {
    if (!ENTITY_TYPES.includes(r.value)) return fail('entity_type không hợp lệ');
    f.entityType = r.value;
  }

  r = read('entity_id');
  if (r.error) return fail(r.error);
  if (r.value !== null) {
    if (r.value.length > 50) return fail('entity_id không hợp lệ');
    if (f.entityType === null) return fail('entity_id cần đi kèm entity_type');
    f.entityId = r.value; // nguyên văn, không trim
  }

  r = read('actor_user_id');
  if (r.error) return fail(r.error);
  if (r.value !== null) {
    f.actorUserId = positiveInt(r.value);
    if (f.actorUserId === null) return fail('actor_user_id không hợp lệ');
  }

  r = read('actor_email');
  if (r.error) return fail(r.error);
  if (r.value !== null) {
    const email = r.value.trim();
    if (email.length > 255) return fail('actor_email không hợp lệ');
    f.actorEmail = email || null;
  }

  const from = read('from'), to = read('to');
  if (from.error) return fail(from.error);
  if (to.error) return fail(to.error);
  if (from.value !== null || to.value !== null) {
    const start = from.value === null ? null : vnDayStart(from.value);
    const end = to.value === null ? null : vnDayEnd(to.value);
    if ((from.value !== null && !start) || (to.value !== null && !end)) return fail('from/to phải đúng định dạng YYYY-MM-DD');
    if (start && end && start.getTime() >= end.getTime()) return fail('from phải nhỏ hơn hoặc bằng to');
    if ((start && start < SQL_MIN) || (end && end > SQL_MAX)) return fail('Ngày ngoài phạm vi SQL Server hỗ trợ');
    f.start = start; f.end = end;
  }

  r = read('page');
  if (r.error) return fail(r.error);
  if (r.value !== null) {
    f.page = positiveInt(r.value);
    if (f.page === null) return fail('page không hợp lệ');
  }
  return { ok: true, filters: f };
}

const FROM_SQL = 'FROM dbo.audit_logs l LEFT JOIN dbo.users u ON u.id = l.actor_user_id';

function buildAuditQuery(f, { canReadAdmin }) {
  const where = [], params = [];
  const add = (name, type, value) => params.push({ name, type, value });
  if (f.group === 'admin') where.push("l.actor_role IN ('admin', 'staff', 'cli')");
  if (f.group === 'customer' || !canReadAdmin) where.push("l.actor_role = 'customer'");
  if (f.action !== null) { where.push('l.action = @action'); add('action', sql.VarChar(50), f.action); }
  if (f.entityType !== null) { where.push('l.entity_type = @entity_type'); add('entity_type', sql.VarChar(30), f.entityType); }
  if (f.entityId !== null) {
    // Khớp NGUYÊN VĂN: '=' của SQL Server bỏ dấu cách cuối và theo collation (không phân biệt hoa/thường) -> thêm so
    // nhị phân + độ dài. Vế '=' đầu giữ để dùng được IX_audit_logs_entity.
    where.push('(l.entity_id = @entity_id AND l.entity_id COLLATE Latin1_General_BIN2 = @entity_id'
      + ' AND DATALENGTH(l.entity_id) = DATALENGTH(@entity_id))');
    add('entity_id', sql.VarChar(50), f.entityId);
  }
  if (f.actorUserId !== null) { where.push('l.actor_user_id = @actor_user_id'); add('actor_user_id', sql.Int, f.actorUserId); }
  if (f.actorEmail !== null) {
    // Nhóm Quản trị: email đã lưu trong log; khách: email HIỆN TẠI trong users (log khách không lưu email).
    where.push("((l.actor_role <> 'customer' AND LOWER(l.actor_email) = LOWER(@actor_email))"
      + " OR (l.actor_role = 'customer' AND LOWER(u.email) = LOWER(@actor_email)))");
    add('actor_email', sql.NVarChar(255), f.actorEmail);
  }
  if (f.start) { where.push('l.created_at >= @from_utc'); add('from_utc', sql.DateTime2(3), f.start); }
  if (f.end) { where.push('l.created_at < @to_utc'); add('to_utc', sql.DateTime2(3), f.end); }
  add('offset', sql.BigInt, (f.page - 1) * PAGE_SIZE);
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const columns = ['l.id', 'l.created_at', 'l.actor_role', 'l.actor_user_id',
    "CASE WHEN l.actor_role = 'customer' THEN u.email ELSE l.actor_email END AS actor_email",
    'CAST(CASE WHEN l.actor_user_id IS NOT NULL AND u.id IS NULL THEN 1 ELSE 0 END AS BIT) AS actor_deleted',
    'l.action', 'l.entity_type', 'l.entity_id', 'l.before_json', 'l.after_json',
    ...(canReadAdmin ? ['l.ip', 'l.user_agent'] : [])]; // staff: không đọc ip / user_agent từ DB
  return {
    sql: `SELECT COUNT(*) AS total ${FROM_SQL}${whereSql};
SELECT ${columns.join(', ')} ${FROM_SQL}${whereSql}
ORDER BY l.created_at DESC, l.id DESC OFFSET @offset ROWS FETCH NEXT ${PAGE_SIZE} ROWS ONLY;`,
    params,
  };
}

function toLogDto(row, { canReadAdmin }) {
  const log = {
    id: String(row.id),
    created_at: new Date(row.created_at).toISOString(),
    actor_role: row.actor_role,
    actor_user_id: row.actor_user_id == null ? null : row.actor_user_id,
    actor_email: row.actor_email == null ? null : row.actor_email,
    actor_deleted: !!row.actor_deleted,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id == null ? null : row.entity_id,
    before: row.before_json == null ? null : JSON.parse(row.before_json),
    after: row.after_json == null ? null : JSON.parse(row.after_json),
  };
  if (canReadAdmin) { log.ip = row.ip == null ? null : row.ip; log.user_agent = row.user_agent == null ? null : row.user_agent; }
  return log;
}

module.exports = { PAGE_SIZE, parseAuditQuery, buildAuditQuery, toLogDto, vnDayStart, vnDayEnd };
