// Chạy một file .sql vào SQL Server bằng package mssql (config từ .env).
// Tách file theo separator "GO" (không phải T-SQL, chỉ là ngăn batch) rồi
// chạy từng batch. Dùng: node db/run-sql.js db/schema.sql
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { getPool } = require('../db');

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node db/run-sql.js <path-to-.sql>');
    process.exit(1);
  }
  // Đường dẫn tương đối tính theo server/ (thư mục cha của db/), giống hệt cách nạp
  // .env ở trên — nhờ vậy `node server/db/run-sql.js db/schema.sql` chạy từ gốc repo
  // hay từ server/ đều ra cùng một file. Đường dẫn tuyệt đối thì giữ nguyên.
  const filePath = path.isAbsolute(fileArg)
    ? fileArg
    : path.join(__dirname, '..', fileArg);
  const sqlText = fs.readFileSync(filePath, 'utf8');

  // Tách batch theo dòng chỉ chứa "GO".
  const batches = sqlText
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  console.log(`[run-sql] File: ${filePath}`);
  console.log(`[run-sql] Số batch: ${batches.length}`);

  const pool = await getPool();
  for (let i = 0; i < batches.length; i++) {
    try {
      await pool.request().batch(batches[i]);
      process.stdout.write(`  batch ${i + 1}/${batches.length} OK\n`);
    } catch (err) {
      console.error(`  batch ${i + 1}/${batches.length} FAILED: ${err.message}`);
      console.error('  --- batch content (đầu) ---');
      console.error('  ' + batches[i].split('\n').slice(0, 6).join('\n  '));
      throw err;
    }
  }
  console.log('[run-sql] Hoàn tất.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[run-sql] LỖI:', err.message);
    process.exit(1);
  });
