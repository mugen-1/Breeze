/* Audit Log — bảng audit_logs (append-only); ghi log ở lib/audit.js.
   - KHÔNG có FOREIGN KEY (kể cả actor_user_id -> dbo.users): SQL Server không cho tạo trigger
     INSTEAD OF DELETE/UPDATE trên bảng có FK ON DELETE/UPDATE CASCADE/SET NULL, và log phải sống
     tiếp khi user/đơn/sản phẩm bị xoá. actor_email chỉ lưu với admin/staff; khách = NULL.
   - actor_role: so khớp phân biệt hoa/thường + không dấu cách cuối, cùng cách CK_users_role (023).
   - before_json / after_json: CHECK ISJSON (ISJSON cần SQL Server 2016 trở lên, không phụ thuộc compatibility level).
   - action, entity_type cố ý KHÔNG có CHECK (sẽ thêm loại mới về sau).
   - TR_audit_logs_no_update_delete chặn UPDATE/DELETE. Giới hạn đã biết: TRUNCATE TABLE và DROP TABLE
     không kích hoạt trigger — chỉ chặn được bằng phân quyền SQL login.
   Idempotent: phần nào đã có thì bỏ qua; không xoá/sửa dữ liệu. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.audit_logs', 'U') IS NULL
        CREATE TABLE dbo.audit_logs (
            id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_audit_logs PRIMARY KEY,
            created_at    DATETIME2(3)  NOT NULL CONSTRAINT DF_audit_logs_created_at DEFAULT SYSUTCDATETIME(),
            actor_user_id INT           NULL,
            actor_email   NVARCHAR(255) NULL,
            actor_role    VARCHAR(20)   NOT NULL,
            action        VARCHAR(50)   NOT NULL,
            entity_type   VARCHAR(30)   NOT NULL,
            entity_id     VARCHAR(50)   NULL,
            before_json   NVARCHAR(MAX) NULL,
            after_json    NVARCHAR(MAX) NULL,
            ip            VARCHAR(45)   NULL,
            user_agent    NVARCHAR(400) NULL
        );

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_audit_logs_actor_role' AND parent_object_id = OBJECT_ID('dbo.audit_logs'))
        ALTER TABLE dbo.audit_logs WITH CHECK
            ADD CONSTRAINT CK_audit_logs_actor_role
            CHECK (actor_role COLLATE Latin1_General_CS_AS IN ('admin', 'staff', 'customer', 'cli')
                   AND DATALENGTH(actor_role) = LEN(actor_role));
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_audit_logs_before_json' AND parent_object_id = OBJECT_ID('dbo.audit_logs'))
        ALTER TABLE dbo.audit_logs WITH CHECK
            ADD CONSTRAINT CK_audit_logs_before_json CHECK (before_json IS NULL OR ISJSON(before_json) = 1);
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_audit_logs_after_json' AND parent_object_id = OBJECT_ID('dbo.audit_logs'))
        ALTER TABLE dbo.audit_logs WITH CHECK
            ADD CONSTRAINT CK_audit_logs_after_json CHECK (after_json IS NULL OR ISJSON(after_json) = 1);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_logs_time' AND object_id = OBJECT_ID('dbo.audit_logs'))
        CREATE INDEX IX_audit_logs_time   ON dbo.audit_logs(created_at DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_logs_entity' AND object_id = OBJECT_ID('dbo.audit_logs'))
        CREATE INDEX IX_audit_logs_entity ON dbo.audit_logs(entity_type, entity_id, created_at DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_logs_actor' AND object_id = OBJECT_ID('dbo.audit_logs'))
        CREATE INDEX IX_audit_logs_actor  ON dbo.audit_logs(actor_user_id, created_at DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_logs_role' AND object_id = OBJECT_ID('dbo.audit_logs'))
        CREATE INDEX IX_audit_logs_role   ON dbo.audit_logs(actor_role, created_at DESC);

    -- CREATE TRIGGER phải đứng đầu batch -> tạo qua EXEC để vẫn nằm trong transaction này.
    IF OBJECT_ID('dbo.TR_audit_logs_no_update_delete', 'TR') IS NULL
        EXEC(N'CREATE TRIGGER dbo.TR_audit_logs_no_update_delete ON dbo.audit_logs
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51000, N''audit_logs chỉ cho phép thêm, không được sửa hoặc xoá'', 1;
END;');

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
