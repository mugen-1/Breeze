/* =====================================================================
   BreezeShopDB — Seed dữ liệu (cấu trúc GỘP: chỉ mục "Sản phẩm")
   - 5 categories: Áo/Quần/Giày & Dép (sanpham-*), Túi Xách, Phụ Kiện.
   - 50 sản phẩm (id 1..50 theo thứ tự danh mục), giá VND, kèm ảnh hiện có.
   - KHÔNG seed users / orders / order_items.
   - Idempotent: xoá dữ liệu cũ trước khi seed lại.
   ===================================================================== */

/* Xoá dữ liệu cũ (con trước cha). RESEED identity về 0. */
DELETE FROM dbo.order_items;
DELETE FROM dbo.orders;
DELETE FROM dbo.cart_items;
DELETE FROM dbo.products;
DELETE FROM dbo.categories;
DBCC CHECKIDENT ('dbo.products',   RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.categories', RESEED, 0) WITH NO_INFOMSGS;
GO

/* ---------------------------- CATEGORIES ---------------------------- */
INSERT INTO dbo.categories (slug, name_vi, name_en) VALUES
(N'sanpham-ao', N'Áo', N'Shirts'),
(N'sanpham-quan', N'Quần', N'Pants'),
(N'sanpham-giay', N'Giày & Dép', N'Shoes & Sandals'),
(N'handbags', N'Túi Xách', N'Handbags'),
(N'gold-jewellery', N'Phụ Kiện', N'Accessories');
GO

/* ---------------------------- PRODUCTS ------------------------------ */
DECLARE @c_ao INT = (SELECT id FROM dbo.categories WHERE slug='sanpham-ao');
DECLARE @c_quan INT = (SELECT id FROM dbo.categories WHERE slug='sanpham-quan');
DECLARE @c_giay INT = (SELECT id FROM dbo.categories WHERE slug='sanpham-giay');
DECLARE @c_tui INT = (SELECT id FROM dbo.categories WHERE slug='handbags');
DECLARE @c_pk INT = (SELECT id FROM dbo.categories WHERE slug='gold-jewellery');

/* ===== ÁO (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
(N'ao-nam-linen-trang', N'Áo Polo Cotton Basic', N'Áo Polo Cotton Basic', N'Sơ mi vải lanh trắng thoáng mát, phom rộng thoải mái cho ngày hè.', N'Breathable white linen shirt, relaxed fit for hot summer days.', 349000, NULL, N'["img/ao1.png","img/ao2.png"]', @c_ao, 0),
(N'ao-nam-hoa-nhiet-doi', N'Áo Thun Basic', N'Áo Thun Basic', N'Sơ mi in họa tiết lá nhiệt đới, chất cotton mềm mại.', N'Cotton shirt with vibrant tropical leaf print.', 289000, 239000, N'["img/ao3.png","img/ao4.png"]', @c_ao, 0),
(N'ao-nam-polo-basic', N'Áo Thun Nam Fishing', N'Áo Thun Nam Fishing', N'Polo cotton piqué co giãn nhẹ, dễ phối đồ.', N'Stretch cotton piqué polo, easy to style.', 229000, NULL, N'["img/ao5.png","img/ao6.png"]', @c_ao, 55),
(N'ao-nam-thun-tron', N'Áo Thun Nam Flux', N'Áo Thun Nam Flux', N'Áo thun cotton 100% mềm mịn, form basic.', N'100% soft cotton tee, basic fit.', 159000, NULL, N'["img/ao7.png","img/ao8.png"]', @c_ao, 69),
(N'ao-nam-caro-ngan-tay', N'Áo Thun Nam Golden', N'Áo Thun Nam Golden', N'Sơ mi caro ngắn tay, thoáng mát dạo phố.', N'Short-sleeve check shirt, casual and airy.', 269000, NULL, N'["img/ao9.png","img/ao10.png"]', @c_ao, 35),
(N'ao-nam-soc-hai-quan', N'Áo Thun Nam Ice Field', N'Áo Thun Nam Ice Field', N'Áo thun sọc kiểu hải quân, phong cách biển.', N'Nautical stripe tee, beach-ready style.', 179000, 149000, N'["img/ao11.png","img/ao12.png"]', @c_ao, 45),
(N'ao-nam-denim-nhe', N'Áo Thun Nam Seminal', N'Áo Thun Nam Seminal', N'Sơ mi denim mỏng nhẹ, mặc thoải mái mùa hè.', N'Lightweight denim shirt, comfortable for summer.', 379000, NULL, N'["img/ao13.png","img/ao14.png"]', @c_ao, 23),
(N'ao-nam-ba-lo-the-thao', N'Áo Thun Nam Boston', N'Áo Thun Nam Boston', N'Áo ba lỗ thun co giãn, thấm hút mồ hôi tốt.', N'Stretch tank top with good moisture absorption.', 139000, NULL, N'["img/ao15.png","img/ao16.png"]', @c_ao, 48),
(N'ao-nam-satin-relax', N'Áo Thun Nam Insignia', N'Áo Thun Nam Insignia', N'Sơ mi lụa bóng nhẹ, phom rộng phóng khoáng.', N'Subtly glossy satin shirt, relaxed fit.', 359000, 299000, N'["img/ao17.png","img/ao18.png"]', @c_ao, 22),
(N'ao-nam-khoac-chong-nang', N'Áo Thun Nam Focus', N'Áo Thun Nam Focus', N'Áo khoác mỏng nhẹ chống tia UV, gấp gọn tiện lợi.', N'Lightweight UV-protection jacket, easy to fold.', 459000, NULL, N'["img/ao19.png","img/ao20.png"]', @c_ao, 18);

/* ===== QUẦN (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
(N'quan-nam-short-kaki', N'Quần Jeans Nam Fadeline', N'Quần Jeans Nam Fadeline', N'Quần short kaki basic, dễ phối mọi outfit hè.', N'Basic chino shorts, versatile for summer outfits.', 259000, NULL, N'["img/quan-nam1.png","img/quan-nam2.png"]', @c_quan, 42),
(N'quan-nam-jeans-dung', N'Quần Jeans Nam Cotton Offwhite', N'Quần Jeans Nam Cotton Offwhite', N'Jeans ống đứng, chất denim nhẹ thoáng.', N'Straight leg denim in lightweight fabric.', 379000, 319000, N'["img/quan-nam3.png","img/quan-nam4.png"]', @c_quan, 30),
(N'quan-nam-linen-rong', N'Quần Kaki Nam', N'Quần Kaki Nam', N'Quần lanh phom rộng thoáng mát, hợp mùa hè.', N'Relaxed breathable linen trousers for summer.', 349000, NULL, N'["img/quan-nam5.png","img/quan-nam6.png"]', @c_quan, 26),
(N'quan-nam-short-the-thao', N'Quần Jogger Nam', N'Quần Jogger Nam', N'Quần short thể thao co giãn 4 chiều.', N'4-way stretch sport shorts.', 199000, NULL, N'["img/quan-nam7.png","img/quan-nam8.png"]', @c_quan, 50),
(N'quan-nam-jogger-nhe', N'Quần Jogger Nhẹ', N'Lightweight Jogger', N'Jogger vải nhẹ, bo gấu thoải mái vận động.', N'Lightweight jogger with comfortable ribbed hem.', 289000, NULL, N'["img/quan-nam9.png","img/quan-nam10.png"]', @c_quan, 33),
(N'quan-nam-short-boi', N'Quần Short Bơi', N'Swim Shorts', N'Quần short bơi nhanh khô, họa tiết biển.', N'Quick-dry swim shorts with beach print.', 219000, 179000, N'["img/quan-nam11.png","img/quan-nam12.png"]', @c_quan, 38),
(N'quan-nam-cargo-nhe', N'Quần Cargo Nhẹ', N'Lightweight Cargo Pants', N'Quần cargo vải mỏng nhiều túi tiện dụng.', N'Lightweight utility cargo pants.', 329000, NULL, N'["img/quan-nam13.png","img/quan-nam14.png"]', @c_quan, 24),
(N'quan-nam-short-denim', N'Quần Tây Nam', N'Quần Tây Nam', N'Quần short denim form regular, bền đẹp.', N'Regular-fit denim shorts, durable wash.', 249000, NULL, N'["img/quan-nam15.png","img/quan-nam16.png"]', @c_quan, 36),
(N'quan-nam-chino-slim', N'Quần Nam Ống Suông', N'Quần Nam Ống Suông', N'Chino cotton phom slim, dễ mặc quanh năm.', N'Slim cotton chino, versatile year-round.', 299000, NULL, N'["img/quan-nam17.png","img/quan-nam18.png"]', @c_quan, 28),
(N'quan-nam-short-caro', N'Quần Tây Nam Ống Ôm', N'Quần Tây Nam Ống Ôm', N'Quần short caro phong cách nghỉ dưỡng.', N'Check-pattern shorts, resort style.', 239000, 199000, N'["img/quan-nam19.png","img/quan-nam20.png"]', @c_quan, 30);

/* ===== GIÀY (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
(N'giay-nam-slide', N'Dép Nam', N'Dép Nam', N'Sandal quai ngang đế êm, tiện lợi đi biển.', N'Comfy slide sandals, perfect for the beach.', 219000, NULL, N'["img/dep-nam1.png","img/dep-nam2.png"]', @c_giay, 48),
(N'giay-nam-sneaker-canvas', N'Air Jordan 1 Low', N'Air Jordan 1 Low', N'Sneaker canvas nhẹ, thoáng khí cả ngày.', N'Lightweight breathable canvas sneakers.', 349000, 289000, N'["img/giay-nam1.png","img/giay-nam2.png"]', @c_giay, 34),
(N'giay-nam-espadrille', N'Air Jordan 1 Low', N'Air Jordan 1 Low', N'Espadrille đế cói nhẹ, phong cách nghỉ dưỡng.', N'Light jute-sole espadrilles, resort style.', 299000, NULL, N'["img/giay-nam3.png","img/giay-nam4.png"]', @c_giay, 26),
(N'giay-nam-dep-lao', N'Dép Nam', N'Dép Nam', N'Dép lào basic bền nhẹ, giá tốt.', N'Durable lightweight basic flip-flops.', 99000, NULL, N'["img/dep-nam3.png","img/dep-nam4.png"]', @c_giay, 80),
(N'giay-nam-boat-da-lon', N'Air Jordan 1 Low SE', N'Air Jordan 1 Low SE', N'Giày boat da lộn thoáng khí, lịch lãm.', N'Breathable suede boat shoes, smart-casual.', 459000, NULL, N'["img/giay-nam5.png","img/giay-nam6.png"]', @c_giay, 18),
(N'giay-nam-sandal-da', N'Sandal Da Nam', N'Men''s Leather Sandals', N'Sandal da thật quai chắc chắn.', N'Genuine leather sandals with sturdy straps.', 389000, 329000, N'["img/giay-nam7.png","img/giay-nam8.png"]', @c_giay, 22),
(N'giay-nam-sneaker-mesh', N'Air Jordan 1 Mid SE', N'Air Jordan 1 Mid SE', N'Sneaker vải mesh siêu nhẹ, thoáng khí tối đa.', N'Ultra-light mesh sneakers, maximum breathability.', 329000, NULL, N'["img/giay-nam9.png","img/giay-nam10.png"]', @c_giay, 30),
(N'giay-nam-suc-di-bien', N'Dép Đi Biển', N'Dép Đi Biển', N'Dép sục nhựa nhẹ, chống trơn trượt.', N'Lightweight non-slip beach clogs.', 189000, NULL, N'["img/dep-nam5.png","img/dep-nam6.png"]', @c_giay, 40),
(N'giay-nam-loafer-vai', N'Dép Nam Easy Strap', N'Dép Nam Easy Strap', N'Giày lười vải canvas, dễ xỏ dễ mang.', N'Easy slip-on canvas loafers.', 269000, NULL, N'["img/giay-nam11.png","img/giay-nam12.png"]', @c_giay, 28),
(N'giay-nam-sandal-the-thao', N'Sandal Thể Thao', N'Sport Sandals', N'Sandal thể thao quai dán chắc chắn.', N'Sport sandals with secure velcro straps.', 239000, 199000, N'["img/giay-nam13.png","img/giay-nam14.png"]', @c_giay, 32);

/* ===== TÚI XÁCH (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
(N'handbag-coi-dan-tay', N'Túi Cói Đan Tay', N'Handwoven Straw Bag', N'Túi cói đan thủ công, phong cách đi biển.', N'Handwoven straw bag, beach-ready style.', 329000, NULL, N'[]', @c_tui, 26),
(N'handbag-canvas-tote', N'Túi Vải Canvas', N'Canvas Tote Bag', N'Túi tote canvas rộng rãi, dùng hằng ngày.', N'Spacious everyday canvas tote.', 279000, 229000, N'[]', @c_tui, 34),
(N'handbag-mini-cheo', N'Túi Đeo Chéo Mini', N'Mini Crossbody Bag', N'Túi đeo chéo mini gọn nhẹ, tiện lợi.', N'Compact and convenient mini crossbody bag.', 259000, NULL, N'[]', @c_tui, 30),
(N'handbag-tote-nhiet-doi', N'Túi Tote Họa Tiết Nhiệt Đới', N'Tropical Print Tote', N'Túi tote in họa tiết nhiệt đới rực rỡ.', N'Tote bag with vibrant tropical print.', 299000, NULL, N'[]', @c_tui, 24),
(N'handbag-day-rut-bien', N'Túi Dây Rút Đi Biển', N'Beach Drawstring Bag', N'Túi dây rút gọn nhẹ, mang đồ đi biển.', N'Lightweight drawstring bag for beach essentials.', 219000, 179000, N'[]', @c_tui, 32),
(N'handbag-luoi-bien', N'Túi Xách Tay Lưới', N'Mesh Beach Bag', N'Túi lưới thoáng, dễ rũ cát khi đi biển.', N'Breathable mesh bag, easy to shake off sand.', 249000, NULL, N'[]', @c_tui, 28),
(N'handbag-vai-bo', N'Túi Vải Bố', N'Canvas Shopper', N'Túi vải bố bền chắc, sức chứa lớn.', N'Durable canvas shopper with large capacity.', 269000, NULL, N'[]', @c_tui, 30),
(N'handbag-clutch-coi', N'Túi Clutch Cói', N'Straw Clutch', N'Clutch cói nhỏ gọn, điểm nhấn cho outfit hè.', N'Compact straw clutch, a chic summer accent.', 289000, NULL, N'[]', @c_tui, 20),
(N'handbag-denim-vai', N'Túi Đeo Vai Denim', N'Denim Shoulder Bag', N'Túi đeo vai denim cá tính, bền đẹp.', N'Edgy and durable denim shoulder bag.', 309000, 259000, N'[]', @c_tui, 22),
(N'handbag-chong-nuoc', N'Túi Chống Nước Đi Biển', N'Waterproof Beach Bag', N'Túi chống nước tiện lợi cho chuyến đi biển.', N'Convenient waterproof bag for beach trips.', 319000, NULL, N'[]', @c_tui, 25);

/* ===== PHỤ KIỆN (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
(N'non-rong-vanh-coi', N'Nón Rộng Vành Cói', N'Wide-Brim Straw Hat', N'Nón cói vành rộng, che nắng hiệu quả.', N'Wide-brim straw hat, effective sun protection.', 199000, NULL, N'[]', @c_pk, 40),
(N'non-bucket-vai', N'Nón Bucket Vải', N'Cotton Bucket Hat', N'Nón bucket vải cotton, phong cách trẻ trung.', N'Cotton bucket hat, youthful street style.', 149000, 119000, N'[]', @c_pk, 50),
(N'non-luoi-trai-basic', N'Nón Lưỡi Trai Basic', N'Basic Baseball Cap', N'Nón lưỡi trai basic dễ phối mọi trang phục.', N'Basic baseball cap, easy to pair with any outfit.', 129000, NULL, N'[]', @c_pk, 55),
(N'non-ket-linen', N'Nón Kết Vải Lanh', N'Linen Newsboy Cap', N'Nón kết vải lanh thoáng mát, phong cách cổ điển.', N'Breathable linen newsboy cap, classic style.', 179000, NULL, N'[]', @c_pk, 30),
(N'non-panama', N'Nón Rơm Panama', N'Panama Straw Hat', N'Nón rơm Panama thanh lịch, hợp mùa hè.', N'Elegant Panama straw hat, perfect for summer.', 229000, 189000, N'[]', @c_pk, 24),
(N'balo-canvas-basic', N'Balo Canvas Basic', N'Basic Canvas Backpack', N'Balo canvas basic, ngăn chứa rộng rãi.', N'Basic canvas backpack with spacious compartments.', 349000, NULL, N'[]', @c_pk, 28),
(N'balo-mini-di-bien', N'Balo Mini Đi Biển', N'Mini Beach Backpack', N'Balo mini gọn nhẹ, tiện lợi cho chuyến đi biển.', N'Compact mini backpack, convenient for beach trips.', 259000, NULL, N'[]', @c_pk, 32),
(N'balo-day-rut', N'Balo Dây Rút', N'Drawstring Backpack', N'Balo dây rút nhẹ, gấp gọn mang theo dễ dàng.', N'Lightweight drawstring backpack, easy to fold and carry.', 159000, 129000, N'[]', @c_pk, 45),
(N'balo-chong-nuoc', N'Balo Chống Nước', N'Waterproof Backpack', N'Balo chống nước bền bỉ, phù hợp mọi chuyến đi.', N'Durable waterproof backpack for any trip.', 389000, NULL, N'[]', @c_pk, 20),
(N'balo-denim', N'Balo Vải Denim', N'Denim Backpack', N'Balo denim cá tính, phối hợp dễ dàng.', N'Stylish denim backpack, easy to pair.', 329000, NULL, N'[]', @c_pk, 22);

GO
