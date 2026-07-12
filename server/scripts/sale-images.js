/*
 * Gán ảnh cho các sản phẩm ĐANG GIẢM GIÁ (sale_price != null).
 *
 * LƯU Ý: Hàng giảm giá KHÔNG hiện ở trang danh mục thường (ao-nam, quan-nam, ...)
 *        vì trang danh mục ẩn hàng sale. Chúng chỉ hiện ở trang "Khuyến Mãi"
 *        (sale.html). Vì vậy ảnh của chúng được quản lý gom về ĐÂY,
 *        CHIA THEO TỪNG DANH MỤC cho dễ tra.
 *
 * CÁCH DÙNG:
 *   1. Bỏ file ảnh vào thư mục:  client/img/
 *   2. Điền TÊN FILE ảnh vào ô trống bên dưới (chỉ cần tên, KHÔNG cần "img/").
 *        main  = ảnh chính (hiện mặc định)
 *        hover = ảnh hiện khi rê chuột (bỏ trống '' => dùng lại ảnh main)
 *   3. Chạy:  node scripts/sale-images.js
 */
require('dotenv').config();
const { getPool, sql } = require('../db');

const IMG_DIR = 'img/'; // đường dẫn thư mục ảnh (tính từ client/), thường không cần đổi

const PRODUCTS = [
  // ---------- sanpham-ao (Áo) ----------
  { id: 2,  name: 'Áo Thun Basic',                  main: 'ao3.png',        hover: 'ao4.png'        },
  { id: 6,  name: 'Áo Thun Nam Ice Field',          main: 'ao11.png',       hover: 'ao12.png'       },
  { id: 9,  name: 'Áo Thun Nam Insignia',           main: 'ao17.png',       hover: 'ao18.png'       },

  // ---------- sanpham-quan (Quần) ----------
  { id: 12, name: 'Quần Jeans Nam Cotton Offwhite', main: 'quan-nam3.png',  hover: 'quan-nam4.png'  },
  { id: 16, name: 'Quần Short Bơi',                 main: 'quan-nam11.png', hover: 'quan-nam12.png' },
  { id: 20, name: 'Quần Tây Nam Ống Ôm',            main: 'quan-nam19.png', hover: 'quan-nam20.png' },

  // ---------- sanpham-giay (Giày) ----------
  { id: 22, name: 'Air Jordan 1 Low',               main: 'giay-nam1.png',  hover: 'giay-nam2.png'  },
  { id: 26, name: 'Sandal Da Nam',                  main: 'giay-nam7.png',  hover: 'giay-nam8.png'  },
  { id: 30, name: 'Sandal Thể Thao',                main: 'giay-nam13.png', hover: 'giay-nam14.png' },

  // ---------- handbags ----------
  { id: 32, name: 'Túi Vải Canvas',                 main: '', hover: '' },
  { id: 35, name: 'Túi Dây Rút Đi Biển',            main: '', hover: '' },
  { id: 39, name: 'Túi Đeo Vai Denim',              main: '', hover: '' },

  // ---------- gold-jewellery (Phụ Kiện) ----------
  { id: 42, name: 'Nón Bucket Vải',                 main: '', hover: '' },
  { id: 45, name: 'Nón Rơm Panama',                 main: '', hover: '' },
  { id: 48, name: 'Balo Dây Rút',                   main: '', hover: '' },

  // ---------- nhan ----------
  { id: 52, name: 'Nhẫn Đá Màu',                    main: '', hover: '' },
  { id: 55, name: 'Nhẫn Đính Đá Nhiệt Đới',         main: '', hover: '' },
  { id: 58, name: 'Nhẫn Resin Màu',                 main: '', hover: '' },
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
