CREATE TABLE account (
                         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                         tenant_id UUID NOT NULL,
                         record_type_id UUID,

                         account_number VARCHAR(100) NOT NULL,

                         external_id VARCHAR(255),
                         external_system VARCHAR(100),
                         last_synced_at TIMESTAMP,

                         name VARCHAR(255) NOT NULL,
                         account_type VARCHAR(100),
                         industry VARCHAR(100),

                         tax_registration_id VARCHAR(100),

                         status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
                         active BOOLEAN NOT NULL DEFAULT TRUE,

                         parent_account_id UUID,

                         website VARCHAR(500),
                         phone VARCHAR(50),
                         email VARCHAR(255),

                         billing_street TEXT,
                         billing_city VARCHAR(100),
                         billing_state VARCHAR(100),
                         billing_postal_code VARCHAR(30),
                         billing_country VARCHAR(100),

                         shipping_street TEXT,
                         shipping_city VARCHAR(100),
                         shipping_state VARCHAR(100),
                         shipping_postal_code VARCHAR(30),
                         shipping_country VARCHAR(100),

                         description TEXT,

                         owner_user_id UUID,

                         created_by UUID,
                         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                         updated_by UUID,
                         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                         CONSTRAINT fk_account_tenant
                             FOREIGN KEY (tenant_id)
                                 REFERENCES tenant(id),

                         CONSTRAINT fk_account_record_type
                             FOREIGN KEY (record_type_id)
                                 REFERENCES record_type(id),

                         CONSTRAINT fk_account_parent
                             FOREIGN KEY (parent_account_id)
                                 REFERENCES account(id),

                         CONSTRAINT fk_account_owner
                             FOREIGN KEY (owner_user_id)
                                 REFERENCES app_user(id),

                         CONSTRAINT fk_account_created_by
                             FOREIGN KEY (created_by)
                                 REFERENCES app_user(id),

                         CONSTRAINT fk_account_updated_by
                             FOREIGN KEY (updated_by)
                                 REFERENCES app_user(id),

                         CONSTRAINT uk_account_tenant_number
                             UNIQUE (tenant_id, account_number),

                         CONSTRAINT uk_account_external_id
                             UNIQUE (tenant_id, external_system, external_id)
);

CREATE INDEX idx_account_tenant_id
    ON account(tenant_id);

CREATE INDEX idx_account_record_type_id
    ON account(record_type_id);

CREATE INDEX idx_account_parent_account_id
    ON account(parent_account_id);

CREATE INDEX idx_account_owner_user_id
    ON account(owner_user_id);

CREATE INDEX idx_account_name
    ON account(name);

CREATE INDEX idx_account_status
    ON account(status);

CREATE INDEX idx_account_external_lookup
    ON account(tenant_id, external_system, external_id);