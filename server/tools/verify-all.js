/* verify-all.js — so DOM của 18 trang EJS với bản HTML tĩnh TRƯỚC khi migrate.

     node server/tools/verify-all.js

   18 file .html cũ đã bị xoá khỏi client/ ở commit dọn dẹp. Công cụ này KHÔNG chết
   theo chúng: nó lấy nội dung cũ thẳng từ git (`git show <ref>:client/<trang>.html`)
   rồi đổ ra thư mục tạm để domdiff.js so. Nhờ vậy vẫn đối chiếu được với bản gốc bất
   cứ lúc nào, mà client/ không phải chứa 18 file chết dễ mở nhầm.

   BASELINE_REF là commit CUỐI CÙNG còn đủ 18 file. Đừng đổi nó thành HEAD hay một
   nhánh di động — mốc so sánh phải đứng yên thì kết quả mới có nghĩa. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASELINE_REF = '21ca387';

const PAGES = [
  'chinhsachgiaohang', 'chinhsachdoitra', 'chinhsachbaomat',
  'sanpham-ao', 'sanpham-quan', 'sanpham-giay', 'handbags', 'gold-jewellery', 'sale',
  'product', 'search', 'index',
  'login', 'signup', 'forgot-password', 'profile', 'orders', 'cart',
];

const REPO = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'breeze-baseline-'));

function baselineFile(key) {
  /* Đọc ra Buffer, KHÔNG ép utf8 ở bước này rồi ghi lại — làm vậy có nguy cơ đổi byte
     của tiếng Việt và biến một phép so byte thành phép so đã bị chỉnh sửa. */
  const buf = execFileSync('git', ['show', BASELINE_REF + ':client/' + key + '.html'],
    { cwd: REPO, maxBuffer: 32 * 1024 * 1024 });
  const p = path.join(tmp, key + '.html');
  fs.writeFileSync(p, buf);
  return p;
}

console.log('Moc so sanh: git ' + BASELINE_REF + ' (commit cuoi con du 18 file .html)');
console.log('');
console.log('NEGATIVE CONTROL truoc — neu buoc nay hong thi moi ket qua duoi deu vo nghia:');
try {
  process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, 'domdiff.js'), '--selftest'], { encoding: 'utf8' }));
} catch (e) {
  process.stdout.write(e.stdout || '');
  console.log('DUNG: negative control hong.');
  process.exit(1);
}

console.log('');
console.log('SO DOM 18 TRANG DA MIGRATE:');
let bad = 0;
PAGES.forEach((k) => {
  let old;
  try {
    old = baselineFile(k);
  } catch (e) {
    console.log('  FAIL ' + k + '.html — khong lay duoc ban goc tu git ' + BASELINE_REF);
    bad++;
    return;
  }
  const args = [path.join(__dirname, 'domdiff.js'), 'http://localhost:3000/' + k + '.html', old];
  try {
    process.stdout.write(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  } catch (e) {
    process.stdout.write(e.stdout || '');
    bad++;
  }
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
console.log(bad === 0 ? 'TAT CA 18/18 TRANG KHOP DOM CONTRACT.' : bad + '/18 TRANG LECH — xem o tren.');
process.exit(bad === 0 ? 0 : 1);
