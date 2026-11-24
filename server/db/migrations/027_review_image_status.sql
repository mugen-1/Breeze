/* Trạng thái xử lý ảnh đánh giá — cột review_images.status.
   - pending: ảnh gốc đã nhận, đang chờ job review_image.process (lib/jobs/handlers/review-image.js)
     chuyển sang WebP; ready: đã có file /review-images/<32hex>.webp; failed: xử lý không thành công.
   - NOT NULL + DEFAULT 'ready': khi thêm cột, SQL Server điền 'ready' cho MỌI dòng đang có, nên ảnh
     cũ vẫn hiển thị sau khi deploy. Đường xử lý đồng bộ (JOBS_MODE=sync) cũng ghi 'ready'.
   - CHECK so khớp phân biệt hoa/thường + không dấu cách cuối (cùng cách CK_users_role).
   - CHECK tạo qua EXEC: câu tham chiếu cột vừa thêm phải biên dịch SAU khi cột đã có.
   Idempotent: phần nào đã có thì bỏ qua; không xoá/sửa dữ liệu. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF COL_LENGTH('dbo.review_images', 'status') IS NULL
        ALTER TABLE dbo.review_images
            ADD status VARCHAR(10) NOT NULL CONSTRAINT DF_review_images_status DEFAULT 'ready';

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_review_images_status' AND parent_object_id = OBJECT_ID('dbo.review_images'))
        EXEC(N'ALTER TABLE dbo.review_images WITH CHECK
            ADD CONSTRAINT CK_review_images_status
            CHECK (status COLLATE Latin1_General_CS_AS IN (''pending'', ''ready'', ''failed'')
                   AND DATALENGTH(status) = LEN(status));');

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
