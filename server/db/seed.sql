/* =====================================================================
   BreezeShopDB — Seed dữ liệu (Phase 2 — Summer Collection)
   - 9 categories (slug khớp tên file HTML để Phase 2 fetch ?category=slug).
   - 89 sản phẩm thời trang mùa hè phong cách BREEZE (VI + EN), giá VND.
   - Chưa có ảnh thật: images để mảng rỗng, frontend tự fallback img/breeze.png.
   - KHÔNG seed users / orders / order_items.
   - Idempotent: xóa dữ liệu cũ trước khi seed lại.
   ===================================================================== */

/* Xóa dữ liệu cũ (con trước cha). RESEED identity về 0. */
DELETE FROM dbo.order_items;
DELETE FROM dbo.orders;
DELETE FROM dbo.products;
DELETE FROM dbo.categories;
DBCC CHECKIDENT ('dbo.products',   RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.categories', RESEED, 0) WITH NO_INFOMSGS;
GO

/* ---------------------------- CATEGORIES ---------------------------- */
INSERT INTO dbo.categories (slug, name_vi, name_en) VALUES
('ao-nam',         N'Áo Nam',    N'Men''s Shirts'),
('ao-nu',          N'Áo Nữ',     N'Women''s Tops'),
('quan-nam',       N'Quần Nam',  N'Men''s Trousers'),
('quan-nu',        N'Quần Nữ',   N'Women''s Trousers'),
('giay-nam',       N'Giày Nam',  N'Men''s Shoes'),
('giay-nu',        N'Giày Nữ',   N'Women''s Shoes'),
('handbags',       N'Túi Xách',  N'Handbags'),
('gold-jewellery', N'Phụ Kiện',  N'Accessories'),
('nhan',           N'Nhẫn',      N'Rings');
GO

/* ---------------------------- PRODUCTS ------------------------------ */
DECLARE @ao_nam INT = (SELECT id FROM dbo.categories WHERE slug='ao-nam');
DECLARE @ao_nu  INT = (SELECT id FROM dbo.categories WHERE slug='ao-nu');
DECLARE @quan_nam INT = (SELECT id FROM dbo.categories WHERE slug='quan-nam');
DECLARE @quan_nu  INT = (SELECT id FROM dbo.categories WHERE slug='quan-nu');
DECLARE @giay_nam INT = (SELECT id FROM dbo.categories WHERE slug='giay-nam');
DECLARE @giay_nu  INT = (SELECT id FROM dbo.categories WHERE slug='giay-nu');
DECLARE @handbags INT = (SELECT id FROM dbo.categories WHERE slug='handbags');
DECLARE @jewel    INT = (SELECT id FROM dbo.categories WHERE slug='gold-jewellery');
DECLARE @nhan     INT = (SELECT id FROM dbo.categories WHERE slug='nhan');

/* ===== ÁO NAM (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('ao-nam-linen-trang',      N'Sơ Mi Lanh Trắng',        N'White Linen Shirt', N'Sơ mi vải lanh trắng thoáng mát, phom rộng thoải mái cho ngày hè.', N'Breathable white linen shirt, relaxed fit for hot summer days.', 349000, NULL, N'[]', @ao_nam, 40),
('ao-nam-hoa-nhiet-doi',    N'Sơ Mi Họa Tiết Nhiệt Đới', N'Tropical Print Shirt', N'Sơ mi in họa tiết lá nhiệt đới, chất cotton mềm mại.', N'Cotton shirt with vibrant tropical leaf print.', 289000, 239000, N'[]', @ao_nam, 35),
('ao-nam-polo-basic',       N'Áo Polo Cotton Basic',    N'Cotton Basic Polo', N'Polo cotton piqué co giãn nhẹ, dễ phối đồ.', N'Stretch cotton piqué polo, easy to style.', 229000, NULL, N'[]', @ao_nam, 55),
('ao-nam-thun-tron',        N'Áo Thun Cotton Trơn',     N'Plain Cotton Tee', N'Áo thun cotton 100% mềm mịn, form basic.', N'100% soft cotton tee, basic fit.', 159000, NULL, N'[]', @ao_nam, 70),
('ao-nam-caro-ngan-tay',    N'Sơ Mi Caro Ngắn Tay',     N'Short-Sleeve Check Shirt', N'Sơ mi caro ngắn tay, thoáng mát dạo phố.', N'Short-sleeve check shirt, casual and airy.', 269000, NULL, N'[]', @ao_nam, 38),
('ao-nam-soc-hai-quan',     N'Áo Thun Sọc Hải Quân',    N'Nautical Stripe Tee', N'Áo thun sọc kiểu hải quân, phong cách biển.', N'Nautical stripe tee, beach-ready style.', 179000, 149000, N'[]', @ao_nam, 45),
('ao-nam-denim-nhe',        N'Sơ Mi Denim Nhẹ',         N'Lightweight Denim Shirt', N'Sơ mi denim mỏng nhẹ, mặc thoải mái mùa hè.', N'Lightweight denim shirt, comfortable for summer.', 379000, NULL, N'[]', @ao_nam, 26),
('ao-nam-ba-lo-the-thao',   N'Áo Ba Lỗ Thể Thao',       N'Sport Tank Top', N'Áo ba lỗ thun co giãn, thấm hút mồ hôi tốt.', N'Stretch tank top with good moisture absorption.', 139000, NULL, N'[]', @ao_nam, 50),
('ao-nam-satin-relax',      N'Sơ Mi Lụa Nam Phom Rộng',  N'Men''s Relaxed Satin Shirt', N'Sơ mi lụa bóng nhẹ, phom rộng phóng khoáng.', N'Subtly glossy satin shirt, relaxed fit.', 359000, 299000, N'[]', @ao_nam, 22),
('ao-nam-khoac-chong-nang', N'Áo Khoác Chống Nắng',     N'UV Protection Jacket', N'Áo khoác mỏng nhẹ chống tia UV, gấp gọn tiện lợi.', N'Lightweight UV-protection jacket, easy to fold.', 459000, NULL, N'[]', @ao_nam, 18);

/* ===== ÁO NỮ (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('ao-nu-hai-day-lua',    N'Áo Hai Dây Lụa',         N'Silk Cami Top', N'Áo hai dây lụa mềm rủ, thanh lịch cho ngày hè.', N'Soft draped silk cami, elegant for summer.', 259000, NULL, N'[]', @ao_nu, 32),
('ao-nu-hoa-nhi',        N'Áo Kiểu Hoa Nhí',        N'Floral Print Blouse', N'Áo kiểu họa tiết hoa nhí nữ tính, chất voan nhẹ.', N'Feminine ditsy floral blouse in light chiffon.', 279000, 229000, N'[]', @ao_nu, 30),
('ao-nu-croptop-cotton', N'Áo Croptop Cotton',      N'Cotton Crop Top', N'Croptop cotton trẻ trung, dễ phối cùng chân váy.', N'Youthful cotton crop top, easy to style with skirts.', 189000, NULL, N'[]', @ao_nu, 44),
('ao-nu-off-shoulder',   N'Áo Trễ Vai Trơn',        N'Solid Off-Shoulder Top', N'Áo trễ vai basic, khoe vai gợi cảm.', N'Basic off-shoulder top, elegant and breezy.', 219000, NULL, N'[]', @ao_nu, 28),
('ao-nu-linen',          N'Sơ Mi Lanh Nữ',          N'Women''s Linen Shirt', N'Sơ mi lanh nữ phom suông, thoáng mát cả ngày.', N'Relaxed women''s linen shirt, cool all day.', 329000, NULL, N'[]', @ao_nu, 34),
('ao-nu-co-vuong',       N'Áo Kiểu Cổ Vuông',       N'Square-Neck Top', N'Áo kiểu cổ vuông tôn dáng, chất thun mềm.', N'Flattering square-neck top in soft jersey.', 199000, NULL, N'[]', @ao_nu, 36),
('ao-nu-ren-tank',       N'Áo Ba Lỗ Phối Ren',      N'Lace-Trim Tank Top', N'Áo ba lỗ phối viền ren tinh tế.', N'Tank top with delicate lace trim.', 179000, 149000, N'[]', @ao_nu, 40),
('ao-nu-tay-bong',       N'Áo Kiểu Tay Bồng',       N'Puff-Sleeve Blouse', N'Áo kiểu tay bồng điệu đà, chất cotton pha.', N'Playful puff-sleeve blouse in cotton blend.', 249000, NULL, N'[]', @ao_nu, 25),
('ao-nu-basic-tee',      N'Áo Thun Basic Nữ',       N'Women''s Basic Tee', N'Áo thun cotton basic form ôm nhẹ.', N'Basic cotton tee, slightly fitted.', 149000, NULL, N'[]', @ao_nu, 60),
('ao-nu-choang-bien',    N'Áo Choàng Chống Nắng Đi Biển', N'Beach Cover-Up', N'Áo choàng voan mỏng nhẹ, mặc ngoài đồ bơi.', N'Lightweight chiffon cover-up for the beach.', 229000, NULL, N'[]', @ao_nu, 27);

/* ===== QUẦN NAM (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('quan-nam-short-kaki',   N'Quần Short Kaki',        N'Chino Shorts', N'Quần short kaki basic, dễ phối mọi outfit hè.', N'Basic chino shorts, versatile for summer outfits.', 259000, NULL, N'[]', @quan_nam, 42),
('quan-nam-jeans-dung',   N'Quần Jeans Ống Đứng',    N'Straight Leg Denim', N'Jeans ống đứng, chất denim nhẹ thoáng.', N'Straight leg denim in lightweight fabric.', 379000, 319000, N'[]', @quan_nam, 30),
('quan-nam-linen-rong',   N'Quần Lanh Rộng',         N'Relaxed Linen Trousers', N'Quần lanh phom rộng thoáng mát, hợp mùa hè.', N'Relaxed breathable linen trousers for summer.', 349000, NULL, N'[]', @quan_nam, 26),
('quan-nam-short-the-thao', N'Quần Short Thể Thao',  N'Sport Shorts', N'Quần short thể thao co giãn 4 chiều.', N'4-way stretch sport shorts.', 199000, NULL, N'[]', @quan_nam, 50),
('quan-nam-jogger-nhe',   N'Quần Jogger Nhẹ',        N'Lightweight Jogger', N'Jogger vải nhẹ, bo gấu thoải mái vận động.', N'Lightweight jogger with comfortable ribbed hem.', 289000, NULL, N'[]', @quan_nam, 33),
('quan-nam-short-boi',    N'Quần Short Bơi',         N'Swim Shorts', N'Quần short bơi nhanh khô, họa tiết biển.', N'Quick-dry swim shorts with beach print.', 219000, 179000, N'[]', @quan_nam, 38),
('quan-nam-cargo-nhe',    N'Quần Cargo Nhẹ',         N'Lightweight Cargo Pants', N'Quần cargo vải mỏng nhiều túi tiện dụng.', N'Lightweight utility cargo pants.', 329000, NULL, N'[]', @quan_nam, 24),
('quan-nam-short-denim',  N'Quần Short Denim',       N'Denim Shorts', N'Quần short denim form regular, bền đẹp.', N'Regular-fit denim shorts, durable wash.', 249000, NULL, N'[]', @quan_nam, 36),
('quan-nam-chino-slim',   N'Quần Chino Slim',        N'Slim Chino Trousers', N'Chino cotton phom slim, dễ mặc quanh năm.', N'Slim cotton chino, versatile year-round.', 299000, NULL, N'[]', @quan_nam, 28),
('quan-nam-short-caro',   N'Quần Short Caro',        N'Check Shorts', N'Quần short caro phong cách nghỉ dưỡng.', N'Check-pattern shorts, resort style.', 239000, 199000, N'[]', @quan_nam, 30);

/* ===== QUẦN NỮ (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('quan-nu-short-denim',   N'Quần Short Denim Nữ',    N'Women''s Denim Shorts', N'Short denim lưng cao, tôn dáng.', N'High-waisted denim shorts, flattering fit.', 259000, NULL, N'[]', @quan_nu, 40),
('quan-nu-vay-chu-a',     N'Chân Váy Chữ A',         N'A-Line Skirt', N'Chân váy chữ A vải cotton, nhẹ nhàng nữ tính.', N'A-line skirt in cotton, light and feminine.', 229000, NULL, N'[]', @quan_nu, 32),
('quan-nu-linen-suong',   N'Quần Lanh Ống Suông',    N'Wide Linen Trousers', N'Quần lanh ống suông thoáng mát, sang trọng.', N'Airy wide-leg linen trousers, effortlessly chic.', 339000, 279000, N'[]', @quan_nu, 26),
('quan-nu-short-kaki',    N'Quần Short Kaki Nữ',     N'Women''s Chino Shorts', N'Short kaki nữ phom regular dễ phối.', N'Regular-fit chino shorts, easy to style.', 249000, NULL, N'[]', @quan_nu, 35),
('quan-nu-vay-xep-ly',    N'Chân Váy Xếp Ly',        N'Pleated Skirt', N'Chân váy xếp ly midi thanh thoát.', N'Graceful pleated midi skirt.', 279000, NULL, N'[]', @quan_nu, 24),
('quan-nu-culottes-nhe',  N'Quần Culottes Nhẹ',      N'Light Culottes', N'Quần culottes vải nhẹ, form rộng thoải mái.', N'Lightweight culottes, relaxed silhouette.', 289000, NULL, N'[]', @quan_nu, 22),
('quan-nu-legging',       N'Quần Legging Thể Thao',  N'Sport Leggings', N'Legging co giãn 4 chiều, thoáng khí.', N'4-way stretch, breathable sport leggings.', 199000, 169000, N'[]', @quan_nu, 46),
('quan-nu-jean-rong',     N'Quần Jean Ống Rộng',     N'Wide-Leg Denim', N'Jeans ống rộng phong cách retro hè.', N'Retro-style wide-leg denim for summer.', 359000, NULL, N'[]', @quan_nu, 27),
('quan-nu-vay-ren',       N'Chân Váy Ren',           N'Lace Skirt', N'Chân váy ren mỏng nhẹ, điệu đà.', N'Delicate lightweight lace skirt.', 269000, NULL, N'[]', @quan_nu, 20),
('quan-nu-short-vai-tho', N'Quần Short Vải Thô',     N'Canvas Shorts', N'Short vải thô bền chắc, năng động.', N'Durable canvas shorts, sporty look.', 219000, NULL, N'[]', @quan_nu, 33);

/* ===== GIÀY NAM (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('giay-nam-slide',          N'Dép Sandal Quai Ngang', N'Slide Sandals', N'Sandal quai ngang đế êm, tiện lợi đi biển.', N'Comfy slide sandals, perfect for the beach.', 219000, NULL, N'[]', @giay_nam, 48),
('giay-nam-sneaker-canvas', N'Giày Sneaker Canvas',   N'Canvas Sneakers', N'Sneaker canvas nhẹ, thoáng khí cả ngày.', N'Lightweight breathable canvas sneakers.', 349000, 289000, N'[]', @giay_nam, 34),
('giay-nam-espadrille',     N'Giày Espadrille Nam',   N'Men''s Espadrilles', N'Espadrille đế cói nhẹ, phong cách nghỉ dưỡng.', N'Light jute-sole espadrilles, resort style.', 299000, NULL, N'[]', @giay_nam, 26),
('giay-nam-dep-lao',        N'Dép Lào Basic',         N'Basic Flip-Flops', N'Dép lào basic bền nhẹ, giá tốt.', N'Durable lightweight basic flip-flops.', 99000, NULL, N'[]', @giay_nam, 80),
('giay-nam-boat-da-lon',    N'Giày Boat Da Lộn',      N'Suede Boat Shoes', N'Giày boat da lộn thoáng khí, lịch lãm.', N'Breathable suede boat shoes, smart-casual.', 459000, NULL, N'[]', @giay_nam, 18),
('giay-nam-sandal-da',      N'Sandal Da Nam',         N'Men''s Leather Sandals', N'Sandal da thật quai chắc chắn.', N'Genuine leather sandals with sturdy straps.', 389000, 329000, N'[]', @giay_nam, 22),
('giay-nam-sneaker-mesh',   N'Giày Sneaker Thoáng Khí', N'Breathable Mesh Sneakers', N'Sneaker vải mesh siêu nhẹ, thoáng khí tối đa.', N'Ultra-light mesh sneakers, maximum breathability.', 329000, NULL, N'[]', @giay_nam, 30),
('giay-nam-suc-di-bien',    N'Dép Sục Đi Biển',       N'Beach Clogs', N'Dép sục nhựa nhẹ, chống trơn trượt.', N'Lightweight non-slip beach clogs.', 189000, NULL, N'[]', @giay_nam, 40),
('giay-nam-loafer-vai',     N'Giày Lười Vải',         N'Canvas Loafers', N'Giày lười vải canvas, dễ xỏ dễ mang.', N'Easy slip-on canvas loafers.', 269000, NULL, N'[]', @giay_nam, 28),
('giay-nam-sandal-the-thao', N'Sandal Thể Thao',      N'Sport Sandals', N'Sandal thể thao quai dán chắc chắn.', N'Sport sandals with secure velcro straps.', 239000, 199000, N'[]', @giay_nam, 32);

/* ===== GIÀY NỮ (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('giay-nu-sandal-quai-manh', N'Sandal Quai Mảnh',      N'Strappy Sandals', N'Sandal quai mảnh tôn dáng chân, đế êm.', N'Slim strappy sandals, comfortable cushioned sole.', 259000, NULL, N'[]', @giay_nu, 36),
('giay-nu-dep-xo-ngon',      N'Dép Xỏ Ngón Nữ',        N'Women''s Flip-Flops', N'Dép xỏ ngón nhẹ, họa tiết mùa hè.', N'Lightweight flip-flops with summery print.', 109000, NULL, N'[]', @giay_nu, 70),
('giay-nu-espadrille-wedge', N'Giày Espadrille Đế Xuồng', N'Espadrille Wedge', N'Espadrille đế xuồng cói, tăng chiều cao nhẹ nhàng.', N'Jute wedge espadrilles, subtle height boost.', 319000, 269000, N'[]', @giay_nu, 24),
('giay-nu-sneaker-canvas',   N'Giày Sneaker Canvas Nữ', N'Women''s Canvas Sneakers', N'Sneaker canvas nữ trẻ trung, nhiều màu.', N'Youthful women''s canvas sneakers, multiple colors.', 339000, NULL, N'[]', @giay_nu, 33),
('giay-nu-sandal-de-bet',    N'Sandal Đế Bệt',         N'Flat Sandals', N'Sandal đế bệt êm chân, dễ phối đồ.', N'Comfortable flat sandals, easy to style.', 229000, NULL, N'[]', @giay_nu, 38),
('giay-nu-dep-le-long',      N'Dép Lê Lông',           N'Fuzzy Slides', N'Dép lê lông mềm êm, mang trong nhà & đi chơi.', N'Soft fuzzy slides for home and outings.', 189000, 159000, N'[]', @giay_nu, 30),
('giay-nu-bup-be-vai',       N'Giày Búp Bê Vải',       N'Fabric Ballet Flats', N'Giày búp bê vải mềm, phong cách nhẹ nhàng.', N'Soft fabric ballet flats, effortlessly sweet.', 249000, NULL, N'[]', @giay_nu, 27),
('giay-nu-sandal-coi',       N'Sandal Cói Đan',        N'Woven Jute Sandals', N'Sandal cói đan thủ công, phong cách boho.', N'Handwoven jute sandals, boho style.', 279000, NULL, N'[]', @giay_nu, 22),
('giay-nu-mule-vai',         N'Giày Mule Vải',         N'Fabric Mules', N'Giày mule vải hở gót, thoáng mát dễ mang.', N'Open-heel fabric mules, cool and easy to wear.', 269000, 229000, N'[]', @giay_nu, 26),
('giay-nu-got-vuong-thap',   N'Sandal Gót Vuông Thấp', N'Low Block Heel Sandals', N'Sandal gót vuông thấp, chắc chân cả ngày.', N'Low block heel sandals, stable all day.', 299000, NULL, N'[]', @giay_nu, 20);

/* ===== TÚI XÁCH (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('handbag-coi-dan-tay',   N'Túi Cói Đan Tay',        N'Handwoven Straw Bag', N'Túi cói đan thủ công, phong cách đi biển.', N'Handwoven straw bag, beach-ready style.', 329000, NULL, N'[]', @handbags, 26),
('handbag-canvas-tote',   N'Túi Vải Canvas',         N'Canvas Tote Bag', N'Túi tote canvas rộng rãi, dùng hằng ngày.', N'Spacious everyday canvas tote.', 279000, 229000, N'[]', @handbags, 34),
('handbag-mini-cheo',     N'Túi Đeo Chéo Mini',      N'Mini Crossbody Bag', N'Túi đeo chéo mini gọn nhẹ, tiện lợi.', N'Compact and convenient mini crossbody bag.', 259000, NULL, N'[]', @handbags, 30),
('handbag-tote-nhiet-doi',N'Túi Tote Họa Tiết Nhiệt Đới', N'Tropical Print Tote', N'Túi tote in họa tiết nhiệt đới rực rỡ.', N'Tote bag with vibrant tropical print.', 299000, NULL, N'[]', @handbags, 24),
('handbag-day-rut-bien',  N'Túi Dây Rút Đi Biển',    N'Beach Drawstring Bag', N'Túi dây rút gọn nhẹ, mang đồ đi biển.', N'Lightweight drawstring bag for beach essentials.', 219000, 179000, N'[]', @handbags, 32),
('handbag-luoi-bien',     N'Túi Xách Tay Lưới',      N'Mesh Beach Bag', N'Túi lưới thoáng, dễ rũ cát khi đi biển.', N'Breathable mesh bag, easy to shake off sand.', 249000, NULL, N'[]', @handbags, 28),
('handbag-vai-bo',        N'Túi Vải Bố',             N'Canvas Shopper', N'Túi vải bố bền chắc, sức chứa lớn.', N'Durable canvas shopper with large capacity.', 269000, NULL, N'[]', @handbags, 30),
('handbag-clutch-coi',    N'Túi Clutch Cói',         N'Straw Clutch', N'Clutch cói nhỏ gọn, điểm nhấn cho outfit hè.', N'Compact straw clutch, a chic summer accent.', 289000, NULL, N'[]', @handbags, 20),
('handbag-denim-vai',     N'Túi Đeo Vai Denim',      N'Denim Shoulder Bag', N'Túi đeo vai denim cá tính, bền đẹp.', N'Edgy and durable denim shoulder bag.', 309000, 259000, N'[]', @handbags, 22),
('handbag-chong-nuoc',    N'Túi Chống Nước Đi Biển', N'Waterproof Beach Bag', N'Túi chống nước tiện lợi cho chuyến đi biển.', N'Convenient waterproof bag for beach trips.', 319000, NULL, N'[]', @handbags, 25);

/* ===== PHỤ KIỆN — Nón & Balo (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('non-rong-vanh-coi',  N'Nón Rộng Vành Cói',   N'Wide-Brim Straw Hat', N'Nón cói vành rộng, che nắng hiệu quả.', N'Wide-brim straw hat, effective sun protection.', 199000, NULL, N'[]', @jewel, 40),
('non-bucket-vai',      N'Nón Bucket Vải',      N'Cotton Bucket Hat', N'Nón bucket vải cotton, phong cách trẻ trung.', N'Cotton bucket hat, youthful street style.', 149000, 119000, N'[]', @jewel, 50),
('non-luoi-trai-basic', N'Nón Lưỡi Trai Basic', N'Basic Baseball Cap', N'Nón lưỡi trai basic dễ phối mọi trang phục.', N'Basic baseball cap, easy to pair with any outfit.', 129000, NULL, N'[]', @jewel, 55),
('non-ket-linen',       N'Nón Kết Vải Lanh',    N'Linen Newsboy Cap', N'Nón kết vải lanh thoáng mát, phong cách cổ điển.', N'Breathable linen newsboy cap, classic style.', 179000, NULL, N'[]', @jewel, 30),
('non-panama',          N'Nón Rơm Panama',      N'Panama Straw Hat', N'Nón rơm Panama thanh lịch, hợp mùa hè.', N'Elegant Panama straw hat, perfect for summer.', 229000, 189000, N'[]', @jewel, 24),
('balo-canvas-basic',   N'Balo Canvas Basic',   N'Basic Canvas Backpack', N'Balo canvas basic, ngăn chứa rộng rãi.', N'Basic canvas backpack with spacious compartments.', 349000, NULL, N'[]', @jewel, 28),
('balo-mini-di-bien',   N'Balo Mini Đi Biển',   N'Mini Beach Backpack', N'Balo mini gọn nhẹ, tiện lợi cho chuyến đi biển.', N'Compact mini backpack, convenient for beach trips.', 259000, NULL, N'[]', @jewel, 32),
('balo-day-rut',        N'Balo Dây Rút',        N'Drawstring Backpack', N'Balo dây rút nhẹ, gấp gọn mang theo dễ dàng.', N'Lightweight drawstring backpack, easy to fold and carry.', 159000, 129000, N'[]', @jewel, 45),
('balo-chong-nuoc',     N'Balo Chống Nước',     N'Waterproof Backpack', N'Balo chống nước bền bỉ, phù hợp mọi chuyến đi.', N'Durable waterproof backpack for any trip.', 389000, NULL, N'[]', @jewel, 20),
('balo-denim',          N'Balo Vải Denim',      N'Denim Backpack', N'Balo denim cá tính, phối hợp dễ dàng.', N'Stylish denim backpack, easy to pair.', 329000, NULL, N'[]', @jewel, 22);

/* ===== NHẪN (9) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('nhan-vo-so',        N'Nhẫn Vỏ Sò',            N'Seashell Ring', N'Nhẫn hình vỏ sò dễ thương, gợi nhắc mùa hè.', N'Cute seashell-shaped ring, a summer memento.', 89000, NULL, N'[]', @nhan, 40),
('nhan-da-mau',        N'Nhẫn Đá Màu',           N'Colored Stone Ring', N'Nhẫn đính đá màu tươi sáng, nổi bật.', N'Ring with bright colored stone accent.', 109000, 89000, N'[]', @nhan, 34),
('nhan-day-kim-loai',  N'Nhẫn Dây Kim Loại Mảnh', N'Thin Metal Band Ring', N'Nhẫn dây kim loại mảnh, đơn giản tinh tế.', N'Thin metal band ring, simple and refined.', 79000, NULL, N'[]', @nhan, 45),
('nhan-ngoc-trai',     N'Nhẫn Ngọc Trai Nhân Tạo', N'Faux Pearl Ring', N'Nhẫn đính ngọc trai nhân tạo, nữ tính.', N'Faux pearl ring, delicate and feminine.', 99000, NULL, N'[]', @nhan, 30),
('nhan-da-nhiet-doi',  N'Nhẫn Đính Đá Nhiệt Đới', N'Tropical Stone Ring', N'Nhẫn đính đá màu phong cách nhiệt đới rực rỡ.', N'Vibrant tropical-style stone ring.', 119000, 99000, N'[]', @nhan, 26),
('nhan-bac-tron',      N'Nhẫn Bạc Trơn',         N'Plain Silver Ring', N'Nhẫn bạc trơn tối giản, dễ phối mọi lúc.', N'Minimal plain silver ring, easy to wear anytime.', 129000, NULL, N'[]', @nhan, 36),
('nhan-xep-tang',      N'Nhẫn Xếp Tầng',         N'Stackable Ring Set', N'Bộ nhẫn xếp tầng nhiều kiểu, phối linh hoạt.', N'Stackable ring set, mix and match freely.', 149000, NULL, N'[]', @nhan, 28),
('nhan-resin-mau',     N'Nhẫn Resin Màu',        N'Colorful Resin Ring', N'Nhẫn resin nhiều màu sắc tươi vui.', N'Playful colorful resin ring.', 69000, 59000, N'[]', @nhan, 42),
('nhan-dieu-chinh-size', N'Nhẫn Điều Chỉnh Size', N'Adjustable Ring', N'Nhẫn thiết kế điều chỉnh size linh hoạt, vừa mọi ngón tay.', N'Adjustable-size ring design, fits any finger.', 89000, NULL, N'[]', @nhan, 38);
GO
