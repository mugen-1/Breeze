/*
 * Đổi TÊN sản phẩm (name_vi = tiếng Việt, name_en = tiếng Anh) cho TẤT CẢ danh mục.
 *
 * LƯU Ý: các file *-images.js CHỈ đổi ẢNH, KHÔNG đổi tên. Muốn đổi tên
 *        sản phẩm hiển thị trên web thì sửa Ở ĐÂY rồi chạy:
 *            node scripts/set-names.js
 *
 * - Web mặc định hiển thị tiếng Anh (name_en) => nên điền cả 2 cột.
 * - Để TRỐNG '' cột nào => GIỮ NGUYÊN tên cũ của cột đó trong DB.
 * - Các ô dưới đây đã điền sẵn TÊN HIỆN TẠI; chỉ cần sửa ô nào muốn đổi.
 */
require('dotenv').config();
const { getPool, sql } = require('../db');

const PRODUCTS = [
  // ---------- sanpham-ao (Áo) ----------
  { id: 1,  vi: "Áo Polo Cotton Basic",   en: "Áo Polo Cotton Basic" },
  { id: 2,  vi: "Áo Thun Basic",          en: "Áo Thun Basic" },
  { id: 3,  vi: "Áo Thun Nam Fishing",    en: "Áo Thun Nam Fishing" },
  { id: 4,  vi: "Áo Thun Nam Flux",       en: "Áo Thun Nam Flux" },
  { id: 5,  vi: "Áo Thun Nam Golden",     en: "Áo Thun Nam Golden" },
  { id: 6,  vi: "Áo Thun Nam Ice Field",  en: "Áo Thun Nam Ice Field" },
  { id: 7,  vi: "Áo Thun Nam Seminal",    en: "Áo Thun Nam Seminal" },
  { id: 8,  vi: "Áo Thun Nam Boston",     en: "Áo Thun Nam Boston" },
  { id: 9,  vi: "Áo Thun Nam Insignia",   en: "Áo Thun Nam Insignia" },
  { id: 10, vi: "Áo Thun Nam Focus",      en: "Áo Thun Nam Focus" },

  // ---------- sanpham-quan (Quần) ----------
  { id: 11, vi: "Quần Jeans Nam Fadeline",        en: "Quần Jeans Nam Fadeline" },
  { id: 12, vi: "Quần Jeans Nam Cotton Offwhite", en: "Quần Jeans Nam Cotton Offwhite" },
  { id: 13, vi: "Quần Kaki Nam",                  en: "Quần Kaki Nam" },
  { id: 14, vi: "Quần Jogger Nam",                en: "Quần Jogger Nam" },
  { id: 15, vi: "Quần Jogger Nhẹ",                en: "Lightweight Jogger" },
  { id: 16, vi: "Quần Short Bơi",                 en: "Swim Shorts" },
  { id: 17, vi: "Quần Cargo Nhẹ",                 en: "Lightweight Cargo Pants" },
  { id: 18, vi: "Quần Tây Nam",                   en: "Quần Tây Nam" },
  { id: 19, vi: "Quần Nam Ống Suông",             en: "Quần Nam Ống Suông" },
  { id: 20, vi: "Quần Tây Nam Ống Ôm",            en: "Quần Tây Nam Ống Ôm" },

  // ---------- sanpham-giay (Giày) ----------
  { id: 21, vi: "Dép Nam",             en: "Dép Nam" },
  { id: 22, vi: "Air Jordan 1 Low",    en: "Air Jordan 1 Low" },
  { id: 23, vi: "Air Jordan 1 Low",    en: "Air Jordan 1 Low" },
  { id: 24, vi: "Dép Nam",             en: "Dép Nam" },
  { id: 25, vi: "Air Jordan 1 Low SE", en: "Air Jordan 1 Low SE" },
  { id: 26, vi: "Sandal Da Nam",       en: "Men's Leather Sandals" },
  { id: 27, vi: "Air Jordan 1 Mid SE", en: "Air Jordan 1 Mid SE" },
  { id: 28, vi: "Dép Đi Biển",         en: "Dép Đi Biển" },
  { id: 29, vi: "Dép Nam Easy Strap",  en: "Dép Nam Easy Strap" },
  { id: 30, vi: "Sandal Thể Thao",     en: "Sport Sandals" },

  // ---------- handbags (Túi Xách) ----------
  { id: 31, vi: "Túi Cói Đan Tay",             en: "Handwoven Straw Bag" },
  { id: 32, vi: "Túi Vải Canvas",              en: "Canvas Tote Bag" },
  { id: 33, vi: "Túi Đeo Chéo Mini",           en: "Mini Crossbody Bag" },
  { id: 34, vi: "Túi Tote Họa Tiết Nhiệt Đới", en: "Tropical Print Tote" },
  { id: 35, vi: "Túi Dây Rút Đi Biển",         en: "Beach Drawstring Bag" },
  { id: 36, vi: "Túi Xách Tay Lưới",           en: "Mesh Beach Bag" },
  { id: 37, vi: "Túi Vải Bố",                  en: "Canvas Shopper" },
  { id: 38, vi: "Túi Clutch Cói",              en: "Straw Clutch" },
  { id: 39, vi: "Túi Đeo Vai Denim",           en: "Denim Shoulder Bag" },
  { id: 40, vi: "Túi Chống Nước Đi Biển",      en: "Waterproof Beach Bag" },

  // ---------- gold-jewellery (Phụ Kiện: nón, balo) ----------
  { id: 41, vi: "Nón Rộng Vành Cói",   en: "Wide-Brim Straw Hat" },
  { id: 42, vi: "Nón Bucket Vải",      en: "Cotton Bucket Hat" },
  { id: 43, vi: "Nón Lưỡi Trai Basic", en: "Basic Baseball Cap" },
  { id: 44, vi: "Nón Kết Vải Lanh",    en: "Linen Newsboy Cap" },
  { id: 45, vi: "Nón Rơm Panama",      en: "Panama Straw Hat" },
  { id: 46, vi: "Balo Canvas Basic",   en: "Basic Canvas Backpack" },
  { id: 47, vi: "Balo Mini Đi Biển",   en: "Mini Beach Backpack" },
  { id: 48, vi: "Balo Dây Rút",        en: "Drawstring Backpack" },
  { id: 49, vi: "Balo Chống Nước",     en: "Waterproof Backpack" },
  { id: 50, vi: "Balo Vải Denim",      en: "Denim Backpack" },

  // ---------- nhan (Nhẫn) ----------
  { id: 51, vi: "Nhẫn Vỏ Sò",              en: "Seashell Ring" },
  { id: 52, vi: "Nhẫn Đá Màu",             en: "Colored Stone Ring" },
  { id: 53, vi: "Nhẫn Dây Kim Loại Mảnh",  en: "Thin Metal Band Ring" },
  { id: 54, vi: "Nhẫn Ngọc Trai Nhân Tạo", en: "Faux Pearl Ring" },
  { id: 55, vi: "Nhẫn Đính Đá Nhiệt Đới",  en: "Tropical Stone Ring" },
  { id: 56, vi: "Nhẫn Bạc Trơn",           en: "Plain Silver Ring" },
  { id: 57, vi: "Nhẫn Xếp Tầng",           en: "Stackable Ring Set" },
  { id: 58, vi: "Nhẫn Resin Màu",          en: "Colorful Resin Ring" },
  { id: 59, vi: "Nhẫn Điều Chỉnh Size",    en: "Adjustable Ring" },
];
// ===================================

(async () => {
  const pool = await getPool();
  let updated = 0, skipped = 0;
  for (const p of PRODUCTS) {
    const sets = [];
    const req = pool.request().input('id', sql.Int, p.id);
    if (p.vi && p.vi.trim()) { sets.push('name_vi = @vi'); req.input('vi', sql.NVarChar(255), p.vi.trim()); }
    if (p.en && p.en.trim()) { sets.push('name_en = @en'); req.input('en', sql.NVarChar(255), p.en.trim()); }
    if (!sets.length) { skipped++; continue; }
    await req.query(`UPDATE dbo.products SET ${sets.join(', ')} WHERE id = @id;`);
    console.log(`✅ #${p.id} -> vi='${p.vi}' | en='${p.en}'`);
    updated++;
  }
  console.log(`\nXong. Cập nhật ${updated}, bỏ qua ${skipped}.`);
  process.exit(0);
})().catch(e => { console.error('Lỗi:', e.message); process.exit(1); });
