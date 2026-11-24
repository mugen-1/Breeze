/* Thống kê tính sẵn theo ngày (giờ Việt Nam, cùng quy ước DATEADD(MINUTE,420) của lib/business-report.js).
   Ghi bởi job stats.recompute_day (lib/stats-snapshot.js); Dashboard đọc ở JOBS_MODE=async.
   - stats_snapshots: chỉ số cộng dồn được theo ngày. Số khách (COUNT DISTINCT) KHÔNG lưu: không cộng
     được qua nhiều ngày, luôn đếm trực tiếp.
   - stats_snapshot_products: doanh thu sản phẩm sau phân bổ voucher, lưu CHƯA làm tròn ở DECIMAL(38,7)
     (đúng kiểu của biểu thức phân bổ) để cộng nhiều ngày rồi mới ROUND ra đúng từng đồng như truy vấn
     trực tiếp. product_name + last_order_at: tên lấy theo đơn mới nhất trong khoảng, như báo cáo hiện có.
   - Không FOREIGN KEY: dữ liệu suy ra, tính lại được bất cứ lúc nào từ orders/order_items.
   - IX_orders_created: lọc theo created_at cho mọi truy vấn thống kê theo khoảng ngày (gồm đếm khách và
     order-status vẫn chạy trực tiếp). IX_order_items_order: nối order_items theo order_id khi tính một ngày.
   Idempotent: phần nào đã có thì bỏ qua; không xoá/sửa dữ liệu. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.stats_snapshots', 'U') IS NULL
        CREATE TABLE dbo.stats_snapshots (
            day           DATE          NOT NULL CONSTRAINT PK_stats_snapshots PRIMARY KEY,
            revenue       DECIMAL(19,2) NOT NULL,
            orders        INT           NOT NULL,
            completed     INT           NOT NULL,
            cancelled     INT           NOT NULL,
            products_sold BIGINT        NOT NULL,
            computed_at   DATETIME2(3)  NOT NULL CONSTRAINT DF_stats_snapshots_computed_at DEFAULT SYSUTCDATETIME()
        );
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_stats_snapshots_counts' AND parent_object_id = OBJECT_ID('dbo.stats_snapshots'))
        ALTER TABLE dbo.stats_snapshots WITH CHECK
            ADD CONSTRAINT CK_stats_snapshots_counts
            CHECK (orders >= 0 AND completed >= 0 AND cancelled >= 0 AND completed + cancelled <= orders AND products_sold >= 0);

    IF OBJECT_ID('dbo.stats_snapshot_products', 'U') IS NULL
        CREATE TABLE dbo.stats_snapshot_products (
            day           DATE          NOT NULL,
            product_id    INT           NOT NULL,
            product_name  NVARCHAR(200) NOT NULL,
            last_order_at DATETIME2     NOT NULL,
            units_sold    BIGINT        NOT NULL,
            revenue       DECIMAL(38,7) NOT NULL,
            CONSTRAINT PK_stats_snapshot_products PRIMARY KEY (day, product_id)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_stats_snapshot_products_units' AND parent_object_id = OBJECT_ID('dbo.stats_snapshot_products'))
        ALTER TABLE dbo.stats_snapshot_products WITH CHECK
            ADD CONSTRAINT CK_stats_snapshot_products_units CHECK (units_sold > 0);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_orders_created' AND object_id = OBJECT_ID('dbo.orders'))
        CREATE INDEX IX_orders_created ON dbo.orders(created_at) INCLUDE(status, total_amount, user_id);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_order_items_order' AND object_id = OBJECT_ID('dbo.order_items'))
        CREATE INDEX IX_order_items_order ON dbo.order_items(order_id) INCLUDE(product_id, product_name, quantity, line_total);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
