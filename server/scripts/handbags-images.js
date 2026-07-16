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
  { id: 31, name: 'TOTE BAG',              main: 'tui1.png', },
  { id: 33, name: 'Túi Tote Jean',            main: 'tui4.png', },
  { id: 34, name: 'Túi dây rút denim',  main: 'tui5.png', hover: 'tui6.png' },
  { id: 36, name: 'Túi tote hình in',            main: 'tui7.png', hover: 'tui8.png' },
  { id: 37, name: 'Mini Shoulder Bag',                   main: 'tui9.png', hover: 'tui10.png' },
  { id: 38, name: 'Crochet Bag',               main: 'tui11.png', hover: 'tui12.png' },
  { id: 40, name: 'Quilted Bag',       main: 'tui13.png', hover: 'tui14.png' },
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
