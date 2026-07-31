IF OBJECT_ID('dbo.user_privacy_settings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_privacy_settings (
        id                          INT IDENTITY(1,1) NOT NULL,
        user_id                     INT               NOT NULL,
        show_profile_public         BIT               NOT NULL CONSTRAINT DF_ups_show_profile_public        DEFAULT 0,
        allow_marketing_email       BIT               NOT NULL CONSTRAINT DF_ups_allow_marketing_email       DEFAULT 0,
        allow_data_personalization  BIT               NOT NULL CONSTRAINT DF_ups_allow_data_personalization  DEFAULT 0,
        updated_at                  DATETIME2         NOT NULL CONSTRAINT DF_ups_updated_at                 DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_user_privacy_settings      PRIMARY KEY (id),
        CONSTRAINT FK_user_privacy_settings_user FOREIGN KEY (user_id) REFERENCES dbo.users(id),
        CONSTRAINT UQ_user_privacy_settings_user UNIQUE (user_id)
    );
END
GO
PRINT 'Migration: user_privacy_settings OK';
GO
