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
  { id: 26, vi: "Giày Chạy Bộ",        en: "Running Shoes" },
  { id: 27, vi: "Air Jordan 1 Mid SE", en: "Air Jordan 1 Mid SE" },
  { id: 28, vi: "Dép Đi Biển",         en: "Dép Đi Biển" },
  { id: 29, vi: "Dép Nam Easy Strap",  en: "Dép Nam Easy Strap" },
  { id: 30, vi: "Giày Air Max 90",     en: "Air Max 90 Shoes" },

  // ---------- handbags (Túi Xách) ---------- (id 32,35,39 = SP khuyến mãi)
  { id: 31, vi: "Túi Tote",            en: "Tote Bag" },
  { id: 32, vi: "Túi Đeo Chéo",        en: "Crossbody Bag" },
  { id: 33, vi: "Túi Tote Jean",       en: "Denim Tote Bag" },
  { id: 34, vi: "Túi Dây Rút Denim",   en: "Denim Drawstring Bag" },
  { id: 35, vi: "Túi Đựng Đồ",         en: "Storage Bag" },
  { id: 36, vi: "Túi Tote Hình In",    en: "Printed Tote Bag" },
  { id: 37, vi: "Túi Đeo Vai Mini",    en: "Mini Shoulder Bag" },
  { id: 38, vi: "Túi Móc Len",         en: "Crochet Bag" },
  { id: 39, vi: "Túi Dây Rút",         en: "Drawstring Bag" },
  { id: 40, vi: "Túi Chần Bông",       en: "Quilted Bag" },

  // ---------- gold-jewellery (Phụ Kiện) ---------- (id 42,45,48 = SP khuyến mãi)
  { id: 41, vi: "Mắt Kính",              en: "Sunglasses" },
  { id: 42, vi: "Mắt Kính Vuông",        en: "Square Sunglasses" },
  { id: 43, vi: "Vớ Crew",               en: "Crew Socks" },
  { id: 44, vi: "Thắt Lưng",             en: "Belt" },
  { id: 45, vi: "Mắt Kính Vuông Bản To", en: "Big Square Sunglasses" },
  { id: 46, vi: "Nón Lưỡi Trai",         en: "Baseball Cap" },
  { id: 47, vi: "Nón Life Work",         en: "Life Work Cap" },
  { id: 48, vi: "Nón Vành",              en: "Brim Hat" },
  { id: 49, vi: "Ví Dài Canvas",         en: "Long Canvas Wallet" },
  { id: 50, vi: "Ví Ngắn COACK",         en: "COACK Short Wallet" },
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
