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
  { id: 41, name: 'Mắt Kính',    main: 'phukien1.png', hover: 'phukien2.png' },
  { id: 43, name: 'Vớ Crew',  main: 'phukien3.png', hover: 'phukien4.png' },
  { id: 44, name: 'Thắt Lưng',     main: 'phukien5.png', hover: 'phukien6.png' },
  { id: 46, name: 'Nón Lưỡi Trai',    main: 'phukien7.png', hover: 'phukien8.png' },
  { id: 47, name: 'Nón Life Work',    main: 'phukien9.png', hover: 'phukien10.png' },
  { id: 49, name: 'Ví Dài Canvas',      main: 'phukien11.png', hover: 'phukien11.png' },
  { id: 50, name: 'Ví Ngắn COACK',       main: 'phukien13.png', hover: 'phukien14.png' },
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
