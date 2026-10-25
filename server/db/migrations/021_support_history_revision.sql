-- Structural chat changes must invalidate cached pages even after a missed SSE.
-- Ordinary sends/read/heartbeat do not change this revision.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.support_conversations', 'U') IS NULL
        THROW 51000, 'Run 020_customer_support.sql before 021_support_history_revision.sql', 1;
    IF COL_LENGTH('dbo.support_conversations', 'history_revision') IS NULL
        ALTER TABLE dbo.support_conversations ADD history_revision BIGINT NOT NULL
            CONSTRAINT DF_support_conversations_history_revision DEFAULT (0) WITH VALUES;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
