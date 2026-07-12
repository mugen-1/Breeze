/*
 * Gán ảnh cho từng sản phẩm danh mục "gold-jewellery" (Phụ Kiện: nón, balo).
 *
 * CÁCH DÙNG:
 *   1. Bỏ file ảnh vào thư mục:  client/img/
 *   2. Điền TÊN FILE ảnh vào ô trống bên dưới (chỉ cần tên, KHÔNG cần "img/").
 *        main  = ảnh chính (hiện mặc định)
 *        hover = ảnh hiện khi rê chuột (bỏ trống '' => dùng lại ảnh main)
 *   3. Chạy:  node scripts/set-goldjewellery-images.js
 *
 * Ví dụ:  { id: 41, main: 'phukien-1.png', hover: 'phukien-1b.png' }
 */
require('dotenv').config();
const { getPool, sql } = require('../db');

const IMG_DIR = 'img/'; // đường dẫn thư mục ảnh (tính từ client/), thường không cần đổi

const PRODUCTS = [
  { id: 41, name: 'Nón Rộng Vành Cói',    main: '', hover: '' },
  { id: 43, name: 'Nón Lưỡi Trai Basic',  main: '', hover: '' },
  { id: 44, name: 'Nón Kết Vải Lanh',     main: '', hover: '' },
  { id: 46, name: 'Balo Canvas Basic',    main: '', hover: '' },
  { id: 47, name: 'Balo Mini Đi Biển',    main: '', hover: '' },
  { id: 49, name: 'Balo Chống Nước',      main: '', hover: '' },
  { id: 50, name: 'Balo Vải Denim',       main: '', hover: '' },
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
