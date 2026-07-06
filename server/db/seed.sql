/* =====================================================================
   GucciShopDB — Seed dữ liệu (Phase 1)
   - 9 categories (slug khớp tên file HTML để Phase 2 fetch ?category=slug).
   - ~89 sản phẩm thời trang phong cách GUCCI (VI + EN), giá VND.
   - Ảnh dùng lại từ client/img (chỉ những file THỰC SỰ tồn tại).
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
('ao-nam',         N'Áo Nam',            N'Men''s Shirts'),
('ao-nu',          N'Áo Nữ',             N'Women''s Tops'),
('quan-nam',       N'Quần Nam',          N'Men''s Trousers'),
('quan-nu',        N'Quần Nữ',           N'Women''s Trousers'),
('giay-nam',       N'Giày Nam',          N'Men''s Shoes'),
('giay-nu',        N'Giày Nữ',           N'Women''s Shoes'),
('handbags',       N'Túi Xách',          N'Handbags'),
('gold-jewellery', N'Trang Sức Vàng',    N'Gold Jewellery'),
('nhan',           N'Nhẫn',              N'Rings');
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
('ao-nam-gg-monogram-cotton', N'Áo Sơ Mi Cotton GG Monogram', N'GG Monogram Cotton Shirt', N'Sơ mi cotton dệt họa tiết GG, phom cổ điển.', N'Cotton shirt with woven GG motif, classic fit.', 12500000, NULL, N'["img/gc40.png"]', @ao_nam, 25),
('ao-nam-silk-bowling',       N'Áo Bowling Lụa Họa Tiết',     N'Printed Silk Bowling Shirt', N'Áo bowling lụa cao cấp, họa tiết in thủ công.', N'Premium silk bowling shirt with hand-printed motif.', 18900000, 14900000, N'["img/gc41.png"]', @ao_nam, 18),
('ao-nam-oxford-classic',     N'Áo Sơ Mi Oxford Cổ Điển',      N'Classic Oxford Shirt', N'Sơ mi Oxford dệt chắc, dễ phối.', N'Sturdy woven Oxford shirt, easy to style.', 9800000, NULL, N'["img/gc42.png"]', @ao_nam, 40),
('ao-nam-web-stripe-polo',    N'Áo Polo Kẻ Web',               N'Web Stripe Polo Shirt', N'Polo cotton piqué viền kẻ Web đặc trưng.', N'Cotton piqué polo with signature Web stripe.', 11200000, NULL, N'["img/gc43.png"]', @ao_nam, 30),
('ao-nam-wool-cardigan',      N'Áo Cardigan Len Lông Cừu',     N'Wool Cardigan', N'Cardigan len lông cừu mềm, cúc sừng.', N'Soft wool cardigan with horn buttons.', 22500000, NULL, N'["img/gc44.png"]', @ao_nam, 15),
('ao-nam-jersey-tshirt',      N'Áo Thun Jersey Logo',          N'Logo Jersey T-Shirt', N'Áo thun jersey cotton, logo in mặt trước.', N'Cotton jersey T-shirt with front logo print.', 8500000, 6900000, N'["img/gc45.png"]', @ao_nam, 60),
('ao-nam-denim-jacket',       N'Áo Khoác Denim Eco-Wash',      N'Eco-Wash Denim Jacket', N'Áo khoác denim xử lý eco-wash thân thiện môi trường.', N'Denim jacket with eco-friendly wash treatment.', 24900000, NULL, N'["img/gc46.png"]', @ao_nam, 12),
('ao-nam-gg-knit-polo',       N'Áo Polo Dệt Kim GG',           N'GG Knit Polo', N'Polo dệt kim họa tiết GG tinh tế.', N'Fine knit polo with GG pattern.', 15600000, NULL, N'["img/gc47.png"]', @ao_nam, 22),
('ao-nam-linen-shirt',        N'Áo Sơ Mi Vải Lanh',            N'Linen Shirt', N'Sơ mi lanh thoáng mát cho mùa hè.', N'Breathable linen shirt for summer.', 10900000, NULL, N'["img/gc48.png"]', @ao_nam, 35),
('ao-nam-bomber-jacket',      N'Áo Bomber Vải Tech',           N'Tech Bomber Jacket', N'Bomber vải tech chống nước nhẹ, phom hiện đại.', N'Water-resistant tech bomber, modern fit.', 21000000, NULL, N'["img/gc49.png"]', @ao_nam, 16);

/* ===== ÁO NỮ (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('ao-nu-silk-blouse',      N'Áo Blouse Lụa',            N'Silk Blouse', N'Blouse lụa mềm rủ, thanh lịch.', N'Soft draped silk blouse, elegant.', 16900000, NULL, N'["img/gc50.png"]', @ao_nu, 24),
('ao-nu-gg-crop-top',      N'Áo Croptop GG',            N'GG Crop Top', N'Croptop dệt kim họa tiết GG trẻ trung.', N'GG knit crop top, youthful.', 9500000, 7500000, N'["img/gc51.png"]', @ao_nu, 33),
('ao-nu-tweed-jacket',     N'Áo Khoác Tweed',           N'Tweed Jacket', N'Áo khoác tweed dệt, cúc trang trí.', N'Woven tweed jacket with decorative buttons.', 28000000, NULL, N'["img/gc52.png"]', @ao_nu, 10),
('ao-nu-cashmere-sweater', N'Áo Len Cashmere',          N'Cashmere Sweater', N'Áo len cashmere mềm mịn, giữ ấm.', N'Soft warm cashmere sweater.', 21500000, NULL, N'["img/gc53.png"]', @ao_nu, 18),
('ao-nu-poplin-shirt',     N'Áo Sơ Mi Poplin',          N'Poplin Shirt', N'Sơ mi poplin cotton phom suông.', N'Relaxed cotton poplin shirt.', 11900000, NULL, N'["img/gc54.png"]', @ao_nu, 28),
('ao-nu-floral-blouse',    N'Áo Blouse Họa Tiết Hoa',   N'Floral Print Blouse', N'Blouse in họa tiết hoa Flora đặc trưng.', N'Blouse with signature Flora print.', 14200000, NULL, N'["img/gc55.png"]', @ao_nu, 21),
('ao-nu-ribbed-top',       N'Áo Dệt Kim Gân',           N'Ribbed Knit Top', N'Áo dệt kim gân ôm nhẹ, tôn dáng.', N'Slim ribbed knit top.', 8900000, NULL, N'["img/gc56.png"]', @ao_nu, 40),
('ao-nu-satin-shirt',      N'Áo Sơ Mi Satin',           N'Satin Shirt', N'Sơ mi satin bóng nhẹ, sang trọng.', N'Subtly glossy satin shirt, luxurious.', 13500000, 10900000, N'["img/gc57.png"]', @ao_nu, 19),
('ao-nu-wool-cape',        N'Áo Choàng Len',            N'Wool Cape', N'Áo choàng len dáng cape, ấm áp.', N'Warm cape-style wool coat.', 26900000, NULL, N'["img/gc58.png"]', @ao_nu, 9),
('ao-nu-logo-tee',         N'Áo Thun Logo Nữ',          N'Logo Cotton T-Shirt', N'Áo thun cotton logo, phom cropped.', N'Cotton logo T-shirt, cropped fit.', 8200000, NULL, N'["img/gc30.png"]', @ao_nu, 50);

/* ===== QUẦN NAM (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('quan-nam-wool-tailored', N'Quần Âu Len Tailored',   N'Tailored Wool Trousers', N'Quần âu len may đo, nếp ly sắc.', N'Tailored wool trousers with sharp pleats.', 15900000, NULL, N'["img/gc5.png"]', @quan_nam, 22),
('quan-nam-denim-straight',N'Quần Jeans Ống Đứng',    N'Straight Leg Denim', N'Jeans ống đứng, chất denim cứng cáp.', N'Straight leg denim in sturdy fabric.', 12900000, 9900000, N'["img/gc6.png"]', @quan_nam, 30),
('quan-nam-cargo-tech',    N'Quần Cargo Vải Tech',    N'Tech Cargo Trousers', N'Quần cargo vải tech nhiều túi tiện dụng.', N'Utility tech cargo trousers.', 14500000, NULL, N'["img/gc7.png"]', @quan_nam, 20),
('quan-nam-chino-slim',    N'Quần Chino Slim',        N'Slim Chino Trousers', N'Chino cotton phom slim, dễ mặc.', N'Slim cotton chino, versatile.', 10500000, NULL, N'["img/gc8.png"]', @quan_nam, 35),
('quan-nam-track-web',     N'Quần Jogger Kẻ Web',     N'Web Stripe Jogger', N'Jogger jersey viền kẻ Web hai bên.', N'Jersey jogger with side Web stripe.', 11900000, NULL, N'["img/gc21.png"]', @quan_nam, 28),
('quan-nam-linen-relaxed', N'Quần Lanh Rộng',         N'Relaxed Linen Trousers', N'Quần lanh phom rộng thoáng mát.', N'Relaxed breathable linen trousers.', 11200000, NULL, N'["img/gc23.png"]', @quan_nam, 26),
('quan-nam-gg-short',      N'Quần Short GG',          N'GG Canvas Shorts', N'Quần short canvas họa tiết GG.', N'GG canvas shorts.', 9900000, NULL, N'["img/gc24.png"]', @quan_nam, 32),
('quan-nam-pleated-formal',N'Quần Xếp Ly Trang Trọng',N'Pleated Formal Trousers', N'Quần xếp ly trang trọng cho sự kiện.', N'Pleated formal trousers for events.', 16800000, NULL, N'["img/gc25.gif"]', @quan_nam, 14),
('quan-nam-corduroy',      N'Quần Nhung Tăm',         N'Corduroy Trousers', N'Quần nhung tăm ấm, màu trầm.', N'Warm corduroy trousers in deep tones.', 13400000, 10400000, N'["img/gc26.png"]', @quan_nam, 17),
('quan-nam-leather-trim',  N'Quần Viền Da',           N'Leather Trim Trousers', N'Quần âu viền da tinh tế, cao cấp.', N'Trousers with refined leather trim.', 22000000, NULL, N'["img/gc27.png"]', @quan_nam, 11);

/* ===== QUẦN NỮ (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('quan-nu-high-waist-wool',N'Quần Âu Lưng Cao',       N'High-Waisted Wool Trousers', N'Quần âu lưng cao tôn dáng, chất len.', N'Figure-flattering high-waisted wool trousers.', 15500000, NULL, N'["img/gc31.png"]', @quan_nu, 20),
('quan-nu-wide-leg-denim', N'Quần Jeans Ống Rộng',    N'Wide-Leg Denim', N'Jeans ống rộng phong cách retro.', N'Retro-style wide-leg denim.', 13200000, 10500000, N'["img/gc32.png"]', @quan_nu, 27),
('quan-nu-silk-palazzo',   N'Quần Palazzo Lụa',       N'Silk Palazzo Trousers', N'Quần palazzo lụa rủ mềm, sang.', N'Softly draped silk palazzo trousers.', 17900000, NULL, N'["img/gc33.png"]', @quan_nu, 16),
('quan-nu-legging-gg',     N'Quần Legging GG',        N'GG Jersey Leggings', N'Legging jersey họa tiết GG co giãn.', N'Stretch GG jersey leggings.', 9200000, NULL, N'["img/gc34.png"]', @quan_nu, 38),
('quan-nu-tailored-crop',  N'Quần Âu Lửng',           N'Cropped Tailored Trousers', N'Quần âu lửng may đo hiện đại.', N'Modern cropped tailored trousers.', 14600000, NULL, N'["img/gc40.png"]', @quan_nu, 21),
('quan-nu-pleated-midi',   N'Quần Váy Xếp Ly',        N'Pleated Culottes', N'Quần váy xếp ly dáng midi thanh thoát.', N'Graceful pleated midi culottes.', 15900000, NULL, N'["img/gc41.png"]', @quan_nu, 18),
('quan-nu-skinny-denim',   N'Quần Skinny Denim',      N'Skinny Denim', N'Jeans skinny ôm dáng, co giãn nhẹ.', N'Slim-fit stretch skinny denim.', 11900000, NULL, N'["img/gc42.png"]', @quan_nu, 29),
('quan-nu-satin-short',    N'Quần Short Satin',       N'Satin Shorts', N'Quần short satin bóng nhẹ, nữ tính.', N'Feminine glossy satin shorts.', 8900000, 6900000, N'["img/gc43.png"]', @quan_nu, 34),
('quan-nu-flared-velvet',  N'Quần Loe Nhung',         N'Flared Velvet Trousers', N'Quần loe nhung mềm, sang trọng.', N'Soft flared velvet trousers.', 18500000, NULL, N'["img/gc44.png"]', @quan_nu, 13),
('quan-nu-linen-wide',     N'Quần Lanh Ống Suông',    N'Wide Linen Trousers', N'Quần lanh ống suông nhẹ nhàng.', N'Airy wide-leg linen trousers.', 10900000, NULL, N'["img/gc45.png"]', @quan_nu, 25);

/* ===== GIÀY NAM (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('giay-nam-ace-sneaker',    N'Giày Sneaker Ace Da',    N'Ace Leather Sneaker', N'Sneaker Ace da trắng, đế cao su bền.', N'White leather Ace sneaker, durable rubber sole.', 19900000, NULL, N'["img/gc5.png"]', @giay_nam, 24),
('giay-nam-horsebit-loafer',N'Giày Lười Horsebit',     N'Horsebit Loafer', N'Giày lười khóa Horsebit kim loại biểu tượng.', N'Loafer with iconic metal Horsebit.', 24500000, 19900000, N'["img/gc6.png"]', @giay_nam, 18),
('giay-nam-rhyton-chunky',  N'Giày Rhyton Đế Thô',     N'Rhyton Chunky Sneaker', N'Sneaker Rhyton đế thô, phom oversize.', N'Chunky Rhyton sneaker, oversized silhouette.', 26900000, NULL, N'["img/gc46.png"]', @giay_nam, 15),
('giay-nam-derby-leather',  N'Giày Derby Da',          N'Leather Derby Shoes', N'Giày Derby da bóng lịch lãm.', N'Polished leather Derby shoes.', 22000000, NULL, N'["img/gc47.png"]', @giay_nam, 16),
('giay-nam-jordaan-loafer', N'Giày Lười Jordaan',      N'Jordaan Leather Loafer', N'Giày lười Jordaan da mềm, viền Web.', N'Jordaan soft leather loafer with Web trim.', 21500000, NULL, N'["img/gc48.png"]', @giay_nam, 20),
('giay-nam-tennis-1977',    N'Giày Tennis 1977',       N'Tennis 1977 Sneaker', N'Sneaker Tennis 1977 canvas GG cổ điển.', N'Classic GG canvas Tennis 1977 sneaker.', 16900000, NULL, N'["img/gc49.png"]', @giay_nam, 30),
('giay-nam-chelsea-boot',   N'Giày Boot Chelsea',      N'Chelsea Leather Boot', N'Boot Chelsea da, chun hai bên.', N'Leather Chelsea boot with side elastic.', 28900000, NULL, N'["img/gc50.png"]', @giay_nam, 12),
('giay-nam-espadrille',     N'Giày Espadrille GG',     N'GG Espadrille', N'Espadrille GG đế cói nhẹ mùa hè.', N'GG espadrille with light jute sole.', 15500000, 12500000, N'["img/gc51.png"]', @giay_nam, 22),
('giay-nam-basket-hightop', N'Giày Basket Cổ Cao',     N'Basket High-Top Sneaker', N'Sneaker Basket cổ cao đế bơm hơi.', N'Basket high-top sneaker with air sole.', 23500000, NULL, N'["img/gc7.png"]', @giay_nam, 14),
('giay-nam-monk-strap',     N'Giày Monk Strap',        N'Monk Strap Shoes', N'Giày Monk Strap khóa da lịch lãm.', N'Elegant leather Monk Strap shoes.', 25900000, NULL, N'["img/gc8.png"]', @giay_nam, 13);

/* ===== GIÀY NỮ (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('giay-nu-marmont-pump',    N'Giày Cao Gót Marmont',   N'Marmont Leather Pump', N'Giày cao gót Marmont khóa Double G.', N'Marmont pump with Double G buckle.', 22900000, NULL, N'["img/gc52.png"]', @giay_nu, 20),
('giay-nu-horsebit-mule',   N'Giày Mule Horsebit',     N'Horsebit Mule', N'Giày mule Horsebit sục gót thấp.', N'Low-heel Horsebit mule.', 20500000, 16900000, N'["img/gc53.png"]', @giay_nu, 22),
('giay-nu-ace-embroidered', N'Giày Sneaker Ace Thêu',  N'Ace Embroidered Sneaker', N'Sneaker Ace thêu họa tiết ong.', N'Ace sneaker with bee embroidery.', 19900000, NULL, N'["img/gc54.png"]', @giay_nu, 24),
('giay-nu-platform-sandal', N'Giày Sandal Đế Xuồng',   N'Platform Sandal', N'Sandal đế xuồng quai bản to.', N'Platform sandal with wide straps.', 18900000, NULL, N'["img/gc55.png"]', @giay_nu, 19),
('giay-nu-ballet-flat',     N'Giày Búp Bê Da',         N'Leather Ballet Flat', N'Giày búp bê da mềm, nơ Horsebit.', N'Soft leather ballet flat with Horsebit bow.', 16500000, NULL, N'["img/gc56.png"]', @giay_nu, 28),
('giay-nu-block-heel-boot', N'Giày Boot Gót Vuông',    N'Block Heel Ankle Boot', N'Boot cổ ngắn gót vuông chắc chắn.', N'Ankle boot with sturdy block heel.', 27500000, NULL, N'["img/gc57.png"]', @giay_nu, 14),
('giay-nu-slingback',       N'Giày Slingback GG',      N'GG Slingback Pump', N'Giày slingback mũi nhọn họa tiết GG.', N'Pointed GG slingback pump.', 21900000, 17500000, N'["img/gc58.png"]', @giay_nu, 18),
('giay-nu-espadrille-wedge',N'Giày Đế Cói Espadrille', N'Espadrille Wedge', N'Espadrille đế xuồng cói mùa hè.', N'Summer jute espadrille wedge.', 15900000, NULL, N'["img/gc30.png"]', @giay_nu, 26),
('giay-nu-tennis-1977-w',   N'Giày Tennis 1977 Nữ',    N'Tennis 1977 Sneaker', N'Sneaker Tennis 1977 canvas GG phom nữ.', N'GG canvas Tennis 1977 sneaker, women fit.', 16900000, NULL, N'["img/gc31.png"]', @giay_nu, 30),
('giay-nu-knee-high-boot',  N'Giày Boot Cao Cổ',       N'Knee-High Leather Boot', N'Boot da cao cổ tới gối sang trọng.', N'Luxurious knee-high leather boot.', 29900000, NULL, N'["img/gc32.png"]', @giay_nu, 11);

/* ===== TÚI XÁCH (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('handbag-gg-marmont-medium',N'Túi GG Marmont Cỡ Vừa', N'GG Marmont Medium Bag', N'Túi GG Marmont chần trám, khóa Double G.', N'Quilted GG Marmont bag with Double G hardware.', 68000000, NULL, N'["img/gc21.png"]', @handbags, 12),
('handbag-dionysus-mini',    N'Túi Dionysus Mini',     N'Dionysus Mini Bag', N'Túi Dionysus mini khóa đầu hổ.', N'Dionysus mini bag with tiger head closure.', 55000000, 45000000, N'["img/gc23.png"]', @handbags, 10),
('handbag-jackie-1961',      N'Túi Jackie 1961',       N'Jackie 1961 Shoulder Bag', N'Túi Jackie 1961 dáng lưỡi liềm biểu tượng.', N'Iconic hobo-shaped Jackie 1961 bag.', 72000000, NULL, N'["img/gc24.png"]', @handbags, 9),
('handbag-bamboo-1947',      N'Túi Bamboo 1947',       N'Bamboo 1947 Top Handle', N'Túi Bamboo 1947 quai tre thủ công.', N'Bamboo 1947 bag with handcrafted bamboo handle.', 89000000, NULL, N'["img/gc25.gif"]', @handbags, 7),
('handbag-horsebit-1955',    N'Túi Horsebit 1955',     N'Horsebit 1955 Bag', N'Túi Horsebit 1955 khóa ngựa cổ điển.', N'Horsebit 1955 bag with classic hardware.', 78000000, NULL, N'["img/gc26.png"]', @handbags, 8),
('handbag-ophidia-gg',       N'Túi Ophidia GG',        N'Ophidia GG Tote', N'Túi tote Ophidia canvas GG viền Web.', N'Ophidia GG canvas tote with Web trim.', 49000000, 39000000, N'["img/gc27.png"]', @handbags, 15),
('handbag-gg-canvas-tote',   N'Túi Tote Canvas GG',    N'GG Canvas Tote', N'Túi tote canvas GG rộng rãi hằng ngày.', N'Spacious everyday GG canvas tote.', 35000000, NULL, N'["img/gc33.png"]', @handbags, 20),
('handbag-diana-medium',     N'Túi Diana Cỡ Vừa',      N'Diana Medium Tote', N'Túi Diana khóa quai tre đặc trưng.', N'Diana tote with signature bamboo handles.', 82000000, NULL, N'["img/gc34.png"]', @handbags, 8),
('handbag-attache-large',    N'Túi Attache Cỡ Lớn',    N'Attache Large Bag', N'Túi Attache dáng vintage cỡ lớn.', N'Large vintage-inspired Attache bag.', 64000000, NULL, N'["img/gucc1.png"]', @handbags, 10),
('handbag-blondie-shoulder', N'Túi Blondie Đeo Vai',   N'Blondie Shoulder Bag', N'Túi Blondie tròn khóa Interlocking G.', N'Round Blondie bag with Interlocking G.', 58000000, NULL, N'["img/gucci.png"]', @handbags, 11);

/* ===== TRANG SỨC VÀNG (10) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('jewel-interlocking-g-necklace',N'Dây Chuyền Interlocking G Vàng',N'Interlocking G Gold Necklace', N'Dây chuyền vàng mặt Interlocking G.', N'Gold necklace with Interlocking G pendant.', 32000000, NULL, N'["img/anh1.jpg"]', @jewel, 15),
('jewel-lion-head-bracelet',     N'Vòng Tay Đầu Sư Tử Vàng',       N'Lion Head Gold Bracelet', N'Vòng tay vàng đầu sư tử biểu tượng.', N'Gold bracelet with iconic lion head.', 58000000, 48000000, N'["img/anh2.png"]', @jewel, 10),
('jewel-flora-gold-earrings',    N'Bông Tai Flora Vàng',           N'Flora Gold Earrings', N'Bông tai vàng họa tiết Flora tinh xảo.', N'Gold earrings with delicate Flora motif.', 41000000, NULL, N'["img/anh3.png"]', @jewel, 12),
('jewel-link-to-love-bangle',    N'Vòng Link to Love Vàng',        N'Link to Love Gold Bangle', N'Vòng vàng Link to Love trơn hiện đại.', N'Sleek Link to Love gold bangle.', 62000000, NULL, N'["img/anh4.png"]', @jewel, 9),
('jewel-gg-running-pendant',     N'Mặt Dây GG Running Vàng',       N'GG Running Gold Pendant', N'Mặt dây vàng GG Running nhẹ nhàng.', N'Lightweight GG Running gold pendant.', 28000000, NULL, N'["img/anh5.png"]', @jewel, 18),
('jewel-bee-gold-brooch',        N'Ghim Cài Ong Vàng',             N'Bee Gold Brooch', N'Ghim cài áo hình ong mạ vàng.', N'Gold-plated bee brooch.', 36000000, NULL, N'["img/anh6.png"]', @jewel, 14),
('jewel-diamantissima-necklace', N'Dây Chuyền Diamantissima',      N'Diamantissima Gold Necklace', N'Dây chuyền Diamantissima họa tiết trám.', N'Diamantissima necklace with rhombus motif.', 45000000, 37000000, N'["img/anh7.png"]', @jewel, 11),
('jewel-horsebit-gold-cuff',     N'Vòng Cuff Horsebit Vàng',       N'Horsebit Gold Cuff', N'Vòng cuff vàng khóa Horsebit bản lớn.', N'Bold Horsebit gold cuff.', 74000000, NULL, N'["img/gucc1.png"]', @jewel, 7),
('jewel-icon-gold-band',         N'Vòng Icon Vàng Trơn',           N'Icon Gold Band', N'Vòng vàng Icon trơn tối giản.', N'Minimal Icon plain gold band.', 52000000, NULL, N'["img/gucci.png"]', @jewel, 10),
('jewel-double-g-gold-chain',    N'Dây Chuyền Double G Vàng',      N'Double G Gold Chain', N'Dây chuyền vàng mắt xích Double G.', N'Gold chain with Double G links.', 39000000, NULL, N'["img/gc55.png"]', @jewel, 13);

/* ===== NHẪN (9) ===== */
INSERT INTO dbo.products (slug, name_vi, name_en, description_vi, description_en, price, sale_price, images, category_id, stock) VALUES
('nhan-interlocking-g-ring', N'Nhẫn Interlocking G',   N'Interlocking G Ring', N'Nhẫn bạc/vàng họa tiết Interlocking G.', N'Ring with Interlocking G motif.', 22000000, NULL, N'["img/anh1.jpg"]', @nhan, 20),
('nhan-lion-head-ring',      N'Nhẫn Đầu Sư Tử',        N'Lion Head Ring', N'Nhẫn đầu sư tử đính đá màu.', N'Lion head ring with colored stones.', 34000000, 27000000, N'["img/anh2.png"]', @nhan, 15),
('nhan-gg-running-gold',     N'Nhẫn GG Running Vàng',  N'GG Running Gold Ring', N'Nhẫn vàng GG Running bản mảnh.', N'Slim GG Running gold ring.', 29000000, NULL, N'["img/anh3.png"]', @nhan, 18),
('nhan-flora-diamond',       N'Nhẫn Flora Kim Cương',  N'Flora Diamond Ring', N'Nhẫn Flora đính kim cương tinh xảo.', N'Flora ring set with diamonds.', 88000000, NULL, N'["img/anh4.png"]', @nhan, 6),
('nhan-icon-gold-band',      N'Nhẫn Icon Vàng Trơn',   N'Icon Gold Band Ring', N'Nhẫn Icon vàng trơn thanh lịch.', N'Elegant Icon plain gold band ring.', 25000000, NULL, N'["img/anh5.png"]', @nhan, 22),
('nhan-bee-gold',            N'Nhẫn Ong Vàng',         N'Bee Gold Ring', N'Nhẫn hình ong mạ vàng độc đáo.', N'Unique gold-plated bee ring.', 31000000, 25000000, N'["img/anh6.png"]', @nhan, 16),
('nhan-horsebit-signet',     N'Nhẫn Signet Horsebit',  N'Horsebit Signet Ring', N'Nhẫn signet khóa Horsebit nam tính.', N'Masculine Horsebit signet ring.', 42000000, NULL, N'["img/anh7.png"]', @nhan, 12),
('nhan-link-to-love-thin',   N'Nhẫn Link to Love Mảnh',N'Link to Love Thin Ring', N'Nhẫn Link to Love bản mảnh xếp tầng.', N'Stackable thin Link to Love ring.', 26000000, NULL, N'["img/gucc1.png"]', @nhan, 24),
('nhan-double-g-diamond',    N'Nhẫn Double G Kim Cương',N'Double G Diamond Ring', N'Nhẫn Double G đính kim cương cao cấp.', N'Premium Double G ring with diamonds.', 96000000, NULL, N'["img/gucci.png"]', @nhan, 5);
GO
