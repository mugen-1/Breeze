/*
 * Gán ảnh cho từng sản phẩm danh mục "handbags" (Túi Xách).
 *
 * CÁCH DÙNG:
 *   1. Bỏ file ảnh vào thư mục:  client/img/
 *   2. Điền TÊN FILE ảnh vào ô trống bên dưới (chỉ cần tên, KHÔNG cần "img/").
 *        main  = ảnh chính (hiện mặc định)
 *        hover = ảnh hiện khi rê chuột (bỏ trống '' => dùng lại ảnh main)
 *   3. Chạy:  node scripts/set-handbags-images.js
 *
 * Ví dụ:  { id: 31, main: 'tui-1.png', hover: 'tui-1b.png' }
 */
require('dotenv').config();
const { getPool, sql } = require('../db');

const IMG_DIR = 'img/'; // đường dẫn thư mục ảnh (tính từ client/), thường không cần đổi

const PRODUCTS = [
  { id: 31, name: 'Túi Cói Đan Tay',              main: '', hover: '' },
  { id: 33, name: 'Túi Đeo Chéo Mini',            main: '', hover: '' },
  { id: 34, name: 'Túi Tote Họa Tiết Nhiệt Đới',  main: '', hover: '' },
  { id: 36, name: 'Túi Xách Tay Lưới',            main: '', hover: '' },
  { id: 37, name: 'Túi Vải Bố',                   main: '', hover: '' },
  { id: 38, name: 'Túi Clutch Cói',               main: '', hover: '' },
  { id: 40, name: 'Túi Chống Nước Đi Biển',       main: '', hover: '' },
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
