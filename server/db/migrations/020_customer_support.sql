/* CSKH storage foundation; no chat fixtures or runtime/session policy.
   expires_at deliberately has no timeout default. Heartbeat, expiry cleanup and
   guest-to-account merging belong to their approved implementation tasks.
   Deleting a conversation physically deletes its messages and guest credentials.
   Deleting its customer cascades through the conversation. Staff identities use
   a separate actor row so removing staff never removes another customer's chat
   (and avoids two cascading paths from users to support_messages). */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.support_admin_actors', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.support_admin_actors (
            id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_support_admin_actors PRIMARY KEY,
            user_id INT NULL,
            original_user_id INT NOT NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_support_admin_actors_created DEFAULT SYSUTCDATETIME(),
            CONSTRAINT UQ_support_admin_actors_original UNIQUE (original_user_id),
            CONSTRAINT CK_support_admin_actors_identity CHECK (user_id IS NULL OR user_id = original_user_id),
            CONSTRAINT FK_support_admin_actors_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE SET NULL
        );
    END;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.support_admin_actors') AND name = 'UX_support_admin_actors_user')
        CREATE UNIQUE INDEX UX_support_admin_actors_user ON dbo.support_admin_actors(user_id) WHERE user_id IS NOT NULL;

    IF OBJECT_ID('dbo.support_conversations', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.support_conversations (
            id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_support_conversations PRIMARY KEY,
            user_id INT NULL,
            admin_read_message_id BIGINT NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_support_conversations_created DEFAULT SYSUTCDATETIME(),
            updated_at DATETIME2 NOT NULL CONSTRAINT DF_support_conversations_updated DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_support_conversations_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
        );
    END;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.support_conversations') AND name = 'UX_support_conversations_user')
        CREATE UNIQUE INDEX UX_support_conversations_user ON dbo.support_conversations(user_id) WHERE user_id IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.support_conversations') AND name = 'IX_support_conversations_inbox')
        CREATE INDEX IX_support_conversations_inbox ON dbo.support_conversations(updated_at DESC, id DESC)
            INCLUDE(user_id, admin_read_message_id);

    IF OBJECT_ID('dbo.support_guest_sessions', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.support_guest_sessions (
            id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_support_guest_sessions PRIMARY KEY,
            conversation_id BIGINT NOT NULL,
            token_hash BINARY(32) NOT NULL,
            display_name NVARCHAR(150) NOT NULL,
            email NVARCHAR(254) NOT NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_support_guest_sessions_created DEFAULT SYSUTCDATETIME(),
            last_seen_at DATETIME2 NOT NULL CONSTRAINT DF_support_guest_sessions_seen DEFAULT SYSUTCDATETIME(),
            expires_at DATETIME2 NULL,
            revoked_at DATETIME2 NULL,
            CONSTRAINT UQ_support_guest_sessions_conversation UNIQUE (conversation_id),
            CONSTRAINT UQ_support_guest_sessions_token UNIQUE (token_hash),
            CONSTRAINT CK_support_guest_sessions_name CHECK (LEN(LTRIM(RTRIM(display_name))) > 0),
            CONSTRAINT CK_support_guest_sessions_email CHECK (LEN(LTRIM(RTRIM(email))) > 0),
            CONSTRAINT CK_support_guest_sessions_expiry CHECK (expires_at IS NULL OR expires_at > created_at),
            CONSTRAINT FK_support_guest_sessions_conversation FOREIGN KEY (conversation_id)
                REFERENCES dbo.support_conversations(id) ON DELETE CASCADE
        );
    END;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.support_guest_sessions') AND name = 'IX_support_guest_sessions_expiry')
        CREATE INDEX IX_support_guest_sessions_expiry ON dbo.support_guest_sessions(expires_at, id)
            INCLUDE(conversation_id) WHERE expires_at IS NOT NULL;

    IF OBJECT_ID('dbo.support_messages', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.support_messages (
            id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_support_messages PRIMARY KEY,
            conversation_id BIGINT NOT NULL,
            sender_kind VARCHAR(20) COLLATE Latin1_General_100_BIN2 NOT NULL,
            admin_actor_id INT NULL,
            body NVARCHAR(MAX) NOT NULL,
            system_code VARCHAR(30) COLLATE Latin1_General_100_BIN2 NULL,
            client_message_id UNIQUEIDENTIFIER NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_support_messages_created DEFAULT SYSUTCDATETIME(),
            CONSTRAINT CK_support_messages_kind CHECK (sender_kind IN ('customer', 'admin', 'system')),
            CONSTRAINT CK_support_messages_actor CHECK (
                (sender_kind = 'admin' AND admin_actor_id IS NOT NULL) OR
                (sender_kind IN ('customer', 'system') AND admin_actor_id IS NULL)),
            CONSTRAINT CK_support_messages_body CHECK (LEN(LTRIM(RTRIM(body))) > 0),
            CONSTRAINT CK_support_messages_system CHECK (
                (sender_kind IN ('customer', 'admin') AND system_code IS NULL) OR
                (sender_kind = 'system' AND system_code IS NOT NULL AND system_code = 'first_wait'
                    AND body COLLATE Latin1_General_100_BIN2 = N'quý khách vui lòng đợi ít phút'
                    AND DATALENGTH(body) = DATALENGTH(N'quý khách vui lòng đợi ít phút'))),
            CONSTRAINT FK_support_messages_conversation FOREIGN KEY (conversation_id)
                REFERENCES dbo.support_conversations(id) ON DELETE CASCADE,
            CONSTRAINT FK_support_messages_admin_actor FOREIGN KEY (admin_actor_id)
                REFERENCES dbo.support_admin_actors(id) ON DELETE NO ACTION,
            CONSTRAINT UQ_support_messages_conversation_id UNIQUE (conversation_id, id)
        );
    END;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.support_messages') AND name = 'UX_support_messages_first_wait')
        CREATE UNIQUE INDEX UX_support_messages_first_wait ON dbo.support_messages(conversation_id, system_code)
            WHERE system_code = 'first_wait';
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.support_messages') AND name = 'UX_support_messages_client_id')
        CREATE UNIQUE INDEX UX_support_messages_client_id ON dbo.support_messages(conversation_id, sender_kind, admin_actor_id, client_message_id)
            WHERE client_message_id IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.support_messages') AND name = 'IX_support_messages_history')
        CREATE INDEX IX_support_messages_history ON dbo.support_messages(conversation_id, created_at, id)
            INCLUDE(sender_kind, admin_actor_id, system_code);

    -- A shared inbox read cursor can only point into its own conversation.
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.support_conversations') AND name = 'FK_support_conversations_read_message')
        ALTER TABLE dbo.support_conversations ADD CONSTRAINT FK_support_conversations_read_message
            FOREIGN KEY (id, admin_read_message_id) REFERENCES dbo.support_messages(conversation_id, id) ON DELETE NO ACTION;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
