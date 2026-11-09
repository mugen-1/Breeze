// Lớp PHÁT HIỆN: ghi request đáng ngờ/bị chặn vào dbo.SecurityEvents (migration 022).
// Không bao giờ làm hỏng hay làm chậm request: insert chạy fire-and-forget, mọi lỗi
// ghi log đều nuốt bằng .catch. Mount ngay sau cspNonce trong server.js để
// res.on('finish') thấy status cuối cùng, kể cả 403 do CORS chặn.
const { getPool, sql } = require('../db');

// Dấu hiệu SQLi/XSS/path traversal kinh điển trên URL (query string).
const SUSPICIOUS = /(union\s+select|'\s*or\s*'?\d|;?\s*drop\s+table|<script|%3cscript|\.\.\/|\.\.%2f|benchmark\(|sleep\()/i;

function clientIp(req) {
  return (req.ip || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
}

function record(ev) {
  getPool()
    .then((pool) =>
      pool.request()
        .input('ip', sql.VarChar(45), ev.ip || null)
        .input('method', sql.VarChar(10), ev.method || null)
        .input('path', sql.NVarChar(500), (ev.path || '').slice(0, 500))
        .input('status_code', sql.Int, ev.status_code != null ? ev.status_code : null)
        .input('event_type', sql.VarChar(40), ev.event_type)
        .input('severity', sql.VarChar(10), ev.severity)
        .input('detail', sql.NVarChar(1000), (ev.detail || '').slice(0, 1000) || null)
        .input('user_agent', sql.NVarChar(400), (ev.user_agent || '').slice(0, 400) || null)
        .query(`INSERT INTO dbo.SecurityEvents
          (ip, method, path, status_code, event_type, severity, detail, user_agent)
          VALUES (@ip, @method, @path, @status_code, @event_type, @severity, @detail, @user_agent);`)
    )
    .catch((err) => console.error('[securityLogger] ghi log that bai:', err.message));
}

function securityLogger(req, res, next) {
  const ip = clientIp(req);
  const ua = req.headers['user-agent'] || '';
  let url = req.originalUrl || req.url || '';
  try { url = decodeURIComponent(url); } catch (e) { /* URL ma hoa hong: giu nguyen */ }

  let injectionLogged = false;
  if (SUSPICIOUS.test(url)) {
    injectionLogged = true;
    record({ ip, method: req.method, path: req.originalUrl, status_code: null,
      event_type: 'INJECTION_ATTEMPT', severity: 'high',
      detail: 'Payload nghi SQLi/XSS tren URL', user_agent: ua });
  }

  res.on('finish', () => {
    const code = res.statusCode;
    let type = null, sev = 'low';
    if (code === 429) { type = 'RATE_LIMIT'; sev = 'medium'; }
    else if (code === 403) { type = 'FORBIDDEN'; sev = 'medium'; }
    else if (code === 404) { type = 'NOT_FOUND'; sev = 'low'; }
    else if (code === 400) { type = 'BAD_REQUEST'; sev = 'low'; }
    if (!type) return;
    if (type === 'BAD_REQUEST' && injectionLogged) return;
    record({ ip, method: req.method, path: req.originalUrl, status_code: code,
      event_type: type, severity: sev, detail: null, user_agent: ua });
  });

  next();
}

module.exports = { securityLogger };
