/* =====================================================================
   Migration 004 — Đổi tên danh mục "Giày" -> "Giày & Dép".
   - Chỉ đổi tên hiển thị (name_vi/name_en). GIỮ NGUYÊN slug='sanpham-giay'
     để không phá vỡ link, ảnh, và tham chiếu ở client/scripts.
   - Idempotent: chạy lại nhiều lần an toàn.
   Dùng: node db/run-sql.js db/migrations/004_rename_giay_giaydep.sql
   ===================================================================== */
UPDATE dbo.categories
SET name_vi = N'Giày & Dép',
    name_en = N'Shoes & Sandals'
WHERE slug = 'sanpham-giay';

IF @@ROWCOUNT > 0
    PRINT 'Renamed category sanpham-giay -> Giày & Dép';
ELSE
    PRINT 'sanpham-giay category not found — skipped';
GO
