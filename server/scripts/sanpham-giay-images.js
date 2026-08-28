/*
 * Gán ảnh cho từng sản phẩm danh mục "sanpham-giay" (Giày).
 *
 * CÁCH DÙNG:
 *   1. Bỏ file ảnh vào thư mục:  client/img/
 *   2. Điền TÊN FILE ảnh vào ô trống bên dưới (chỉ cần tên, KHÔNG cần "img/").
 *        main  = ảnh chính (hiện mặc định)
 *        hover = ảnh hiện khi rê chuột (bỏ trống '' => dùng lại ảnh main)
 *   3. Chạy:  node scripts/sanpham-giay-images.js
 *
 * Ví dụ:  { id: 21, main: 'giay-nam-1.png', hover: 'giay-nam-1b.png' }
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool, sql } = require('../db');

const IMG_DIR = 'img/'; // đường dẫn thư mục ảnh (tính từ client/), thường không cần đổi

const PRODUCTS = [
  { id: 21, name: 'Dép Nam',    main: 'dep-nam1.png', hover: 'dep-nam2.png' },
  { id: 23, name: 'Air Jordan 1 Low',      main: 'giay-nam3.png', hover: 'giay-nam4.png' },
  { id: 24, name: 'Dép Nam',            main: 'dep-nam3.png', hover: 'dep-nam4.png' },
  { id: 25, name: 'Air Jordan 1 Low SE',         main: 'giay-nam5.png', hover: 'giay-nam6.png' },
  { id: 27, name: 'Air Jordan 1 Mid SE',  main: 'giay-nam9.png', hover: 'giay-nam10.png' },
  { id: 28, name: 'Dép Đi Biển',          main: 'dep-nam5.png', hover: 'dep-nam6.png' },
  { id: 29, name: 'Dép Nam Easy Strap',            main: 'giay-nam11.png', hover: 'giay-nam12.png' },
];
// ===================================

function buildImages(p) {
  const arr = [];
  if (p.main && p.main.trim()) arr.push(IMG_DIR + p.main.trim());
  if (p.hover && p.hover.trim()) arr.push(IMG_DIR + p.hover.trim());
  return arr;
}

(async () => {
  const pool = await getPool();
  let updated = 0, skipped = 0;
  for (const p of PRODUCTS) {
    const images = buildImages(p);
    if (!images.length) {
      console.log(`⏭️  Bỏ qua #${p.id} (${p.name}) — chưa điền tên ảnh`);
      skipped++;
      continue;
    }
    await pool.request()
      .input('id', sql.Int, p.id)
      .input('images', sql.NVarChar(sql.MAX), JSON.stringify(images))
      .query('UPDATE dbo.products SET images = @images WHERE id = @id;');
    console.log(`✅ #${p.id} ${p.name} -> ${JSON.stringify(images)}`);
    updated++;
  }
  console.log(`\nXong. Cập nhật ${updated}, bỏ qua ${skipped}.`);
  process.exit(0);
})().catch(e => { console.error('Lỗi:', e.message); process.exit(1); });
