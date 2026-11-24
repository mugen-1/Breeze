/* Hàng đợi xử lý nền — bảng jobs; thao tác ở lib/jobs/queue.js, chạy ở lib/jobs/worker.js.
   - type: danh sách cố định, so khớp phân biệt hoa/thường + không dấu cách cuối (cùng cách CK_users_role).
     Thêm loại job mới = migration mới sửa CK_jobs_type + JOB_TYPES trong lib/jobs/queue.js.
   - payload: CHECK ISJSON. Chỉ chứa định danh (id, ngày...), không chứa dữ liệu cá nhân.
   - status: queued -> running -> done | failed; running quá locked_until thì worker khác nhận lại.
     CK_jobs_lock / CK_jobs_finished buộc cột khoá và finished_at khớp trạng thái.
   - attempts tăng mỗi lần nhận; đạt max_attempts thì lần lỗi tiếp theo chuyển failed.
   - UX_jobs_dedupe có lọc: chỉ chặn trùng dedupe_key giữa các job ĐANG queued; job đã chạy
     (running/done/failed) không chặn job mới cùng khoá.
   - Không FOREIGN KEY: job sống độc lập với dòng nghiệp vụ, handler tự xử lý khi đối tượng đã mất.
   Idempotent: phần nào đã có thì bỏ qua; không xoá/sửa dữ liệu. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.jobs', 'U') IS NULL
        CREATE TABLE dbo.jobs (
            id           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_jobs PRIMARY KEY,
            type         VARCHAR(40)    NOT NULL,
            payload      NVARCHAR(2000) NOT NULL,
            status       VARCHAR(12)    NOT NULL CONSTRAINT DF_jobs_status DEFAULT 'queued',
            attempts     TINYINT        NOT NULL CONSTRAINT DF_jobs_attempts DEFAULT 0,
            max_attempts TINYINT        NOT NULL CONSTRAINT DF_jobs_max_attempts DEFAULT 5,
            run_after    DATETIME2(3)   NOT NULL CONSTRAINT DF_jobs_run_after DEFAULT SYSUTCDATETIME(),
            locked_by    VARCHAR(64)    NULL,
            locked_until DATETIME2(3)   NULL,
            last_error   NVARCHAR(400)  NULL,
            dedupe_key   VARCHAR(100)   NULL,
            created_at   DATETIME2(3)   NOT NULL CONSTRAINT DF_jobs_created_at DEFAULT SYSUTCDATETIME(),
            updated_at   DATETIME2(3)   NOT NULL CONSTRAINT DF_jobs_updated_at DEFAULT SYSUTCDATETIME(),
            finished_at  DATETIME2(3)   NULL
        );

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_jobs_type' AND parent_object_id = OBJECT_ID('dbo.jobs'))
        ALTER TABLE dbo.jobs WITH CHECK
            ADD CONSTRAINT CK_jobs_type
            CHECK (type COLLATE Latin1_General_CS_AS IN ('review_image.process', 'stats.recompute_day')
                   AND DATALENGTH(type) = LEN(type));
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_jobs_status' AND parent_object_id = OBJECT_ID('dbo.jobs'))
        ALTER TABLE dbo.jobs WITH CHECK
            ADD CONSTRAINT CK_jobs_status
            CHECK (status COLLATE Latin1_General_CS_AS IN ('queued', 'running', 'done', 'failed')
                   AND DATALENGTH(status) = LEN(status));
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_jobs_payload' AND parent_object_id = OBJECT_ID('dbo.jobs'))
        ALTER TABLE dbo.jobs WITH CHECK
            ADD CONSTRAINT CK_jobs_payload CHECK (ISJSON(payload) = 1);
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_jobs_attempts' AND parent_object_id = OBJECT_ID('dbo.jobs'))
        ALTER TABLE dbo.jobs WITH CHECK
            ADD CONSTRAINT CK_jobs_attempts
            CHECK (max_attempts BETWEEN 1 AND 10 AND attempts <= max_attempts);
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_jobs_lock' AND parent_object_id = OBJECT_ID('dbo.jobs'))
        ALTER TABLE dbo.jobs WITH CHECK
            ADD CONSTRAINT CK_jobs_lock
            CHECK ((status = 'running' AND locked_by IS NOT NULL AND LEN(locked_by) > 0 AND locked_until IS NOT NULL)
                OR (status <> 'running' AND locked_by IS NULL AND locked_until IS NULL));
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_jobs_finished' AND parent_object_id = OBJECT_ID('dbo.jobs'))
        ALTER TABLE dbo.jobs WITH CHECK
            ADD CONSTRAINT CK_jobs_finished
            CHECK ((status IN ('done', 'failed') AND finished_at IS NOT NULL)
                OR (status IN ('queued', 'running') AND finished_at IS NULL));
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_jobs_dedupe_key' AND parent_object_id = OBJECT_ID('dbo.jobs'))
        ALTER TABLE dbo.jobs WITH CHECK
            ADD CONSTRAINT CK_jobs_dedupe_key CHECK (dedupe_key IS NULL OR LEN(dedupe_key) > 0);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jobs_ready' AND object_id = OBJECT_ID('dbo.jobs'))
        CREATE INDEX IX_jobs_ready ON dbo.jobs(status, run_after) INCLUDE(type);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_jobs_dedupe' AND object_id = OBJECT_ID('dbo.jobs'))
        CREATE UNIQUE INDEX UX_jobs_dedupe ON dbo.jobs(dedupe_key)
            WHERE status = 'queued' AND dedupe_key IS NOT NULL;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
