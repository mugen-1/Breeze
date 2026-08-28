/*
 * Gán ảnh cho từng sản phẩm danh mục "sanpham-ao" (Áo).
 *
 * CÁCH DÙNG:
 *   1. Bỏ file ảnh vào thư mục:  client/img/
 *   2. Điền TÊN FILE ảnh vào ô trống bên dưới (chỉ cần tên, KHÔNG cần "img/").
 *        main  = ảnh chính (hiện mặc định)
 *        hover = ảnh hiện khi rê chuột (bỏ trống '' => dùng lại ảnh main)
 *   3. Chạy:  node scripts/sanpham-ao-images.js
 *
 * Ví dụ:  { id: 1, main: 'so-mi-lanh-trang.png', hover: 'so-mi-lanh-trang-2.png' }
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool, sql } = require('../db');

const IMG_DIR = 'img/'; // đường dẫn thư mục ảnh (tính từ client/), thường không cần đổi

const PRODUCTS = [
  { id: 1,  name: 'Áo Polo Cotton Basic',          main: 'ao1.png', hover: 'ao2.png' },
  { id: 3,  name: 'Áo Thun Nam Fishing',       main: 'ao5.png', hover: 'ao6.png' },
  { id: 4,  name: 'Áo Thun Nam Flux',        main: 'ao7.png', hover: 'ao8.png' },
  { id: 5,  name: 'Áo Thun Nam Golden',        main: 'ao9.png', hover: 'ao10.png' },
  { id: 7,  name: 'Áo Thun Nam Seminal',            main: 'ao13.png', hover: 'ao14.png' },
  { id: 8,  name: 'Áo Thun Nam Boston',          main: 'ao15.png', hover: 'ao16.png' },
  { id: 10, name: 'Áo Thun Nam Focus',        main: 'ao19.png', hover: 'ao20.png' },
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
