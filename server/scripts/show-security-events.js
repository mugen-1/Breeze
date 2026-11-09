// In 50 sự kiện bảo mật mới nhất từ dbo.SecurityEvents (dùng cho báo cáo).
// Dùng: node server/scripts/show-security-events.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool } = require('../db');
(async () => {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT TOP 50 id, created_at, ip, method, path, status_code, event_type, severity
    FROM dbo.SecurityEvents ORDER BY id DESC;`);
  console.table(r.recordset);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
