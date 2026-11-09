-- Bảng ghi sự kiện bảo mật (request đáng ngờ/bị chặn) cho threat hunting.
-- Ghi bởi server/middleware/securityLogger.js; xem bằng server/scripts/show-security-events.js.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.SecurityEvents', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.SecurityEvents (
            id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SecurityEvents PRIMARY KEY,
            created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_SecurityEvents_created_at DEFAULT SYSUTCDATETIME(),
            ip          VARCHAR(45)    NULL,
            method      VARCHAR(10)    NULL,
            path        NVARCHAR(500)  NULL,
            status_code INT            NULL,
            event_type  VARCHAR(40)    NOT NULL,
            severity    VARCHAR(10)    NOT NULL,
            detail      NVARCHAR(1000) NULL,
            user_agent  NVARCHAR(400)  NULL
        );
        CREATE INDEX IX_SecurityEvents_created ON dbo.SecurityEvents(created_at DESC);
        CREATE INDEX IX_SecurityEvents_ip      ON dbo.SecurityEvents(ip);
        CREATE INDEX IX_SecurityEvents_type    ON dbo.SecurityEvents(event_type);
    END
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
