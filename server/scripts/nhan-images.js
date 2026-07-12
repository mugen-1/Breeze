/*
 * Gán ảnh cho từng sản phẩm danh mục "nhan" (Nhẫn).
 *
 * CÁCH DÙNG:
 *   1. Bỏ file ảnh vào thư mục:  client/img/
 *   2. Điền TÊN FILE ảnh vào ô trống bên dưới (chỉ cần tên, KHÔNG cần "img/").
 *        main  = ảnh chính (hiện mặc định)
 *        hover = ảnh hiện khi rê chuột (bỏ trống '' => dùng lại ảnh main)
 *   3. Chạy:  node scripts/set-nhan-images.js
 *
 * Ví dụ:  { id: 51, main: 'nhan-1.png', hover: 'nhan-1b.png' }
 */
require('dotenv').config();
const { getPool, sql } = require('../db');

const IMG_DIR = 'img/'; // đường dẫn thư mục ảnh (tính từ client/), thường không cần đổi

const PRODUCTS = [
  { id: 51, name: 'Nhẫn Vỏ Sò',                 main: '', hover: '' },
  { id: 53, name: 'Nhẫn Dây Kim Loại Mảnh',     main: '', hover: '' },
  { id: 54, name: 'Nhẫn Ngọc Trai Nhân Tạo',    main: '', hover: '' },
  { id: 56, name: 'Nhẫn Bạc Trơn',              main: '', hover: '' },
  { id: 57, name: 'Nhẫn Xếp Tầng',              main: '', hover: '' },
  { id: 59, name: 'Nhẫn Điều Chỉnh Size',       main: '', hover: '' },
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
