/* Chạy toàn bộ test của client. Không cần cài gì thêm:
     node client/js/__tests__/run-all.js
   Thoát với mã khác 0 nếu có file nào fail, để CI/script khác bắt được. */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname)
  .filter(function (f) { return f.endsWith('.test.js'); })
  .sort();

let failed = [];
files.forEach(function (f) {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
    process.stdout.write(out);
  } catch (e) {
    process.stdout.write(e.stdout || '');
    process.stderr.write(e.stderr || '');
    failed.push(f);
  }
  console.log('');
});

console.log('='.repeat(60));
if (failed.length) {
  console.log('FAIL: ' + failed.length + '/' + files.length + ' file test hong');
  failed.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('OK: ' + files.length + '/' + files.length + ' file test pass');
