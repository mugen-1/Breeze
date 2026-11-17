'use strict';
// GET /api/admin/audit-logs — CHỈ ĐỌC, không có route ghi / sửa / xoá log.
// Gắn dưới router /api/admin (đã qua verifyFirebaseToken + requireBackOffice). Cần ÍT NHẤT 1 trong 2 quyền:
//   audit:read_admin    (admin)        -> mọi nhóm, có ip / user_agent;
//   audit:read_customer (admin, staff) -> thiếu audit:read_admin thì server LUÔN lọc actor_role = 'customer'
//                                          và bỏ hẳn khoá ip / user_agent.
// Kiểm tham số + SQL tham số hoá: lib/audit-logs-query.js. Đọc log không ghi thêm dòng audit nào.
const router = require('express').Router();
const { getPool } = require('../db');
const { requireAnyPermission } = require('../middleware/requirePermission');
const { can } = require('../lib/permissions');
const { PAGE_SIZE, parseAuditQuery, buildAuditQuery, toLogDto } = require('../lib/audit-logs-query');

router.get('/', requireAnyPermission('audit:read_admin', 'audit:read_customer'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const opts = { canReadAdmin: can(req.user.role, 'audit:read_admin') };
  const parsed = parseAuditQuery(req.query, opts);
  if (!parsed.ok) return res.status(400).json({ status: 'error', message: parsed.error });
  try {
    const { sql: text, params } = buildAuditQuery(parsed.filters, opts);
    const request = (await getPool()).request();
    for (const p of params) request.input(p.name, p.type, p.value);
    const result = await request.query(text);
    res.json({ status: 'ok', page: parsed.filters.page, page_size: PAGE_SIZE, total: result.recordsets[0][0].total,
      logs: result.recordsets[1].map(row => toLogDto(row, opts)) });
  } catch (err) {
    console.error('[admin-audit-logs] list failed:', err.code || 'database-error');
    res.status(500).json({ status: 'error', message: 'Không tải được audit log' });
  }
});

module.exports = router;
