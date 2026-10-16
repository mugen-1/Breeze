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

/* MỐC RIÊNG TỪNG TRANG — cho trang đã đổi CÓ CHỦ Ý sau khi migrate.
   Những thay đổi đó làm lúc trang đã là EJS, nên không có bản .html nào chứa chúng: 18
   file .html bị xoá ngay trong b723d26. Mốc của các trang này vì vậy là EJS của một
   commit cố định, render lại từ git (xem renderAtRef): lấy server/views, pages-config,
   client-routes và client/js/routes.js của commit đó ra thư mục tạm rồi render y như
   routes/pages.js. Cùng quy tắc như BASELINE_REF: luôn là SHA cố định, không bao giờ
   HEAD hay tên nhánh.
     profile — modal đổi mật khẩu (Phase 2B) thêm sau 21ca387. So với 21ca387 là 222
               khác biệt đúng, không phải lỗi. */
const PAGE_BASELINE = {
  profile: { ejsRef: 'b723d26' },
};

const PAGES = [
  'chinhsachgiaohang', 'chinhsachdoitra', 'chinhsachbaomat',
  'sanpham-ao', 'sanpham-quan', 'sanpham-giay', 'handbags', 'gold-jewellery', 'sale',
  'product', 'search', 'index',
  'login', 'signup', 'forgot-password', 'profile', 'orders', 'cart',
];

const REPO = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'breeze-baseline-'));

function git(args) {
  return execFileSync('git', args, { cwd: REPO, maxBuffer: 32 * 1024 * 1024 });
}

/* Dựng lại đúng bộ file render trang của commit `ref` trong thư mục tạm (mỗi ref một
   lần): views, pages-config, client-routes (nó tự tìm client/js/routes.js theo đường
   dẫn tương đối — nên giữ nguyên cấu trúc thư mục). */
const refTrees = {};
function treeAt(ref) {
  if (refTrees[ref]) return refTrees[ref];
  const root = path.join(tmp, 'ref-' + ref);
  const files = git(['ls-tree', '-r', '--name-only', ref, '--',
    'server/views', 'server/lib/pages-config.js', 'server/lib/client-routes.js', 'client/js/routes.js'])
    .toString('utf8').split('\n').filter(Boolean);
  files.forEach((f) => {
    const out = path.join(root, f);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, git(['show', ref + ':' + f]));
  });
  refTrees[ref] = root;
  return root;
}

/* Render trang `key` bằng EJS của commit `ref`, mô phỏng routes/pages.js: locals =
   { page, pageKey } + mục PAGES của trang + R (res.locals). cspNonce truyền giá trị giả
   cho commit có dùng nó — domdiff bỏ qua thuộc tính nonce. */
function renderAtRef(ref, key) {
  const root = treeAt(ref);
  const ejs = require('ejs');
  const PAGES_AT = require(path.join(root, 'server', 'lib', 'pages-config.js'));
  const R_AT = require(path.join(root, 'server', 'lib', 'client-routes.js'));
  const cfg = PAGES_AT[key];
  if (!cfg) throw new Error('commit ' + ref + ' khong co trang ' + key + ' trong PAGES');
  const data = Object.assign({ page: cfg.view, pageKey: key }, cfg, { R: R_AT, cspNonce: 'baseline' });
  return new Promise((resolve, reject) => {
    ejs.renderFile(path.join(root, 'server', 'views', 'layouts', 'main.ejs'), data, (err, html) =>
      (err ? reject(err) : resolve(html)));
  });
}

async function baselineFile(key) {
  const p = path.join(tmp, key + '.html');
  const own = PAGE_BASELINE[key];
  if (own && own.ejsRef) {
    fs.writeFileSync(p, await renderAtRef(own.ejsRef, key), 'utf8');
    return { file: p, from: 'EJS @ ' + own.ejsRef };
  }
  /* Đọc ra Buffer, KHÔNG ép utf8 ở bước này rồi ghi lại — làm vậy có nguy cơ đổi byte
     của tiếng Việt và biến một phép so byte thành phép so đã bị chỉnh sửa. */
  fs.writeFileSync(p, git(['show', BASELINE_REF + ':client/' + key + '.html']));
  return { file: p, from: 'HTML @ ' + BASELINE_REF };
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

(async () => {
  console.log('');
  console.log('SO DOM 18 TRANG DA MIGRATE (moc rieng: ' +
    (Object.keys(PAGE_BASELINE).map((k) => k + ' -> EJS@' + PAGE_BASELINE[k].ejsRef).join(', ') || 'khong') + '):');
  let bad = 0;
  for (const k of PAGES) {
    let old;
    try {
      old = await baselineFile(k);
    } catch (e) {
      console.log('  FAIL ' + k + '.html — khong dung duoc ban goc: ' + e.message);
      bad++;
      continue;
    }
    if (old.from.startsWith('EJS')) console.log('  (' + k + ': moc ' + old.from + ')');
    const args = [path.join(__dirname, 'domdiff.js'), 'http://localhost:3000/' + k + '.html', old.file];
    try {
      process.stdout.write(execFileSync(process.execPath, args, { encoding: 'utf8' }));
    } catch (e) {
      process.stdout.write(e.stdout || '');
      bad++;
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('');
  console.log(bad === 0 ? 'TAT CA 18/18 TRANG KHOP DOM CONTRACT.' : bad + '/18 TRANG LECH — xem o tren.');
  process.exit(bad === 0 ? 0 : 1);
})();
