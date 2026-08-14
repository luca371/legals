CREATE TABLE app_user (
                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                          tenant_id UUID NOT NULL,

                          username VARCHAR(100) NOT NULL,
                          name VARCHAR(255) NOT NULL,
                          email VARCHAR(255) NOT NULL,
                          mobile VARCHAR(50),

    -- External Identity Provider / SSO identity
                          federation_id VARCHAR(255),

    -- Platform-managed authentication
                          password_hash VARCHAR(255),

    -- User preferences
                          language VARCHAR(20) NOT NULL DEFAULT 'en',
                          timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',

    -- User status
                          status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
                          active BOOLEAN NOT NULL DEFAULT TRUE,

                          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                          CONSTRAINT fk_app_user_tenant
                              FOREIGN KEY (tenant_id)
                                  REFERENCES tenant(id),

                          CONSTRAINT uk_app_user_tenant_username
                              UNIQUE (tenant_id, username),

                          CONSTRAINT uk_app_user_tenant_email
                              UNIQUE (tenant_id, email)
);

CREATE INDEX idx_app_user_tenant_id
    ON app_user(tenant_id);

CREATE INDEX idx_app_user_federation_id
    ON app_user(federation_id);

/*
 | Field           | Purpose                                     |
| --------------- | ------------------------------------------- |
| `id`            | Internal user ID                            |
| `tenant_id`     | Tenant this user belongs to                 |
| `username`      | Application username                        |
| `name`          | User's name                                 |
| `email`         | Email                                       |
| `mobile`        | Mobile number                               |
| `federation_id` | External SSO/IdP identity                   |
| `password_hash` | Hashed password for platform authentication |
| `language`      | User language preference                    |
| `timezone`      | User timezone                               |
| `status`        | User status                                 |
| `active`        | Enable/disable user                         |
| `created_at`    | Creation timestamp                          |
| `updated_at`    | Last update timestamp                       |

 */