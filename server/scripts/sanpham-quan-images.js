/*
 * Gán ảnh cho từng sản phẩm danh mục "sanpham-quan" (Quần).
 *
 * CÁCH DÙNG:
 *   1. Bỏ file ảnh vào thư mục:  client/img/
 *   2. Điền TÊN FILE ảnh vào ô trống bên dưới (chỉ cần tên, KHÔNG cần "img/").
 *        main  = ảnh chính (hiện mặc định)
 *        hover = ảnh hiện khi rê chuột (bỏ trống '' => dùng lại ảnh main)
 *   3. Chạy:  node scripts/sanpham-quan-images.js
 *
 * Ví dụ:  { id: 11, main: 'quan-nam-1.png', hover: 'quan-nam-1b.png' }
 */
require('dotenv').config();
const { getPool, sql } = require('../db');

const IMG_DIR = 'img/'; // đường dẫn thư mục ảnh (tính từ client/), thường không cần đổi

const PRODUCTS = [
  { id: 11, name: 'Quần Jeans Nam Fadeline',       main: 'quan-nam1.png', hover: 'quan-nam2.png' },
  { id: 13, name: 'Quần Kaki Nam',        main: 'quan-nam5.png', hover: 'quan-nam6.png' },
  { id: 14, name: 'Quần Jogger Nam',   main: 'quan-nam7.png', hover: 'quan-nam8.png' },
  { id: 15, name: 'Quần Jogger Nhẹ',       main: 'quan-nam9.png', hover: 'quan-nam10.png' },
  { id: 17, name: 'Quần Cargo Nhẹ',        main: 'quan-nam13.png', hover: 'quan-nam14.png' },
  { id: 18, name: 'Quần Tây Nam',      main: 'quan-nam15.png', hover: 'quan-nam16.png' },
  { id: 19, name: 'Quần Nam Ống Suông',       main: 'quan-nam17.png', hover: 'quan-nam18.png' },
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
