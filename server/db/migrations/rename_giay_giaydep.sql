UPDATE dbo.categories
SET name_vi = N'Giày & Dép',
    name_en = N'Shoes & Sandals'
WHERE slug = 'sanpham-giay';

IF @@ROWCOUNT > 0
    PRINT 'Renamed category sanpham-giay -> Giày & Dép';
ELSE
    PRINT 'sanpham-giay category not found — skipped';
GO
