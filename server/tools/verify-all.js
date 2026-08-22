/* verify-all.js — chạy domdiff cho CẢ 18 trang đã migrate, một lệnh.

     node server/tools/verify-all.js

   So bản EJS render với file .html cũ còn trong client/. CHỈ chạy được khi 18 file cũ
   vẫn còn — sau khi xoá chúng ở phase dọn dẹp thì công cụ này hết tác dụng, lúc đó
   dùng regression.js. Đây chính là bằng chứng để duyệt việc xoá. */
const { execFileSync } = require('child_process');
const path = require('path');

const PAGES = [
  'chinhsachgiaohang', 'chinhsachdoitra', 'chinhsachbaomat',
  'sanpham-ao', 'sanpham-quan', 'sanpham-giay', 'handbags', 'gold-jewellery', 'sale',
  'product', 'search', 'index',
  'login', 'signup', 'forgot-password', 'profile', 'orders', 'cart',
];

const CLIENT = process.env.BREEZE_CLIENT || path.join(__dirname, '..', '..', 'client');
let bad = 0;

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
PAGES.forEach((k) => {
  const args = [path.join(__dirname, 'domdiff.js'), 'http://localhost:3000/' + k + '.html', path.join(CLIENT, k + '.html')];
  try {
    process.stdout.write(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  } catch (e) {
    process.stdout.write(e.stdout || '');
    bad++;
  }
});

console.log('');
console.log(bad === 0 ? 'TAT CA 18/18 TRANG KHOP DOM CONTRACT.' : bad + '/18 TRANG LECH — xem o tren.');
process.exit(bad === 0 ? 0 : 1);
