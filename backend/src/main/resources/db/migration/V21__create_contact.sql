CREATE TABLE contact (
                         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant and metadata
                         tenant_id UUID NOT NULL,
                         record_type_id UUID,

    -- Account relationship
                         account_id UUID,

    -- Business identifier
                         contact_number VARCHAR(100) NOT NULL,

    -- External system synchronization
                         external_id VARCHAR(255),
                         external_system VARCHAR(100),
                         last_synced_at TIMESTAMP,

    -- Contact information
                         salutation VARCHAR(50),
                         first_name VARCHAR(100),
                         last_name VARCHAR(100) NOT NULL,

                         job_title VARCHAR(150),
                         department VARCHAR(150),

                         email VARCHAR(255),
                         phone VARCHAR(50),
                         mobile_phone VARCHAR(50),

                         preferred_language VARCHAR(50),

    -- Status
                         status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
                         active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Ownership
                         owner_user_id UUID,

    -- Audit fields
                         created_by UUID,
                         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                         updated_by UUID,
                         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Foreign keys
                         CONSTRAINT fk_contact_tenant
                             FOREIGN KEY (tenant_id)
                                 REFERENCES tenant(id),

                         CONSTRAINT fk_contact_record_type
                             FOREIGN KEY (record_type_id)
                                 REFERENCES record_type(id),

                         CONSTRAINT fk_contact_account
                             FOREIGN KEY (account_id)
                                 REFERENCES account(id),

                         CONSTRAINT fk_contact_owner
                             FOREIGN KEY (owner_user_id)
                                 REFERENCES app_user(id),

                         CONSTRAINT fk_contact_created_by
                             FOREIGN KEY (created_by)
                                 REFERENCES app_user(id),

                         CONSTRAINT fk_contact_updated_by
                             FOREIGN KEY (updated_by)
                                 REFERENCES app_user(id),

    -- Unique contact number within a tenant
                         CONSTRAINT uk_contact_tenant_number
                             UNIQUE (tenant_id, contact_number),

    -- Prevent duplicate external records within the same tenant/source
                         CONSTRAINT uk_contact_external_id
                             UNIQUE (tenant_id, external_system, external_id)
);


-- Indexes

CREATE INDEX idx_contact_tenant_id
    ON contact(tenant_id);

CREATE INDEX idx_contact_record_type_id
    ON contact(record_type_id);

CREATE INDEX idx_contact_account_id
    ON contact(account_id);

CREATE INDEX idx_contact_owner_user_id
    ON contact(owner_user_id);

CREATE INDEX idx_contact_name
    ON contact(last_name, first_name);

CREATE INDEX idx_contact_email
    ON contact(email);

CREATE INDEX idx_contact_status
    ON contact(status);

CREATE INDEX idx_contact_external_lookup
    ON contact(tenant_id, external_system, external_id);