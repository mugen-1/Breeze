/* =====================================================================
   Migration 002 — CHECK constraint cho dbo.orders.status (Phase 5)
   - Chốt whitelist trạng thái đơn ở TẦNG DB (lớp 2), khớp với whitelist ở
     routes/admin.js: pending | paid | shipped | completed | cancelled.
   - Idempotent: chỉ thêm khi CHƯA có (chạy lại nhiều lần an toàn).
   - Non-breaking: đã kiểm dữ liệu hiện có đều nằm trong whitelist trước khi thêm;
     nếu về sau có dữ liệu lạ, ALTER sẽ báo lỗi (đúng ý — buộc phải dọn trước).
   ===================================================================== */
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_orders_status' AND parent_object_id = OBJECT_ID('dbo.orders')
)
BEGIN
    ALTER TABLE dbo.orders WITH CHECK
        ADD CONSTRAINT CK_orders_status
        CHECK (status IN ('pending', 'paid', 'shipped', 'completed', 'cancelled'));
    PRINT 'Added CK_orders_status';
END
ELSE
    PRINT 'CK_orders_status already exists — skipped';
GO
