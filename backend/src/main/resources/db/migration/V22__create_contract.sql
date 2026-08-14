CREATE TABLE contract (
                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant and metadata
                          tenant_id UUID NOT NULL,
                          record_type_id UUID,

    -- Business identification
                          contract_number VARCHAR(100) NOT NULL,
                          contract_title VARCHAR(255) NOT NULL,

    -- External system synchronization
                          external_id VARCHAR(255),
                          external_system VARCHAR(100),
                          last_synced_at TIMESTAMP,

    -- Contract details
                          contract_type VARCHAR(100),
                          contract_subtype VARCHAR(100),

                          status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',

                          description TEXT,

    -- Contract parties
                          provider_account_id UUID,
                          requestor_account_id UUID,

    -- Contract lifecycle dates
                          effective_date DATE,
                          expiration_date DATE,

    -- Renewal
                          auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
                          renewal_date DATE,
                          notice_period_days INTEGER,

    -- Termination
                          termination_date DATE,
                          termination_reason TEXT,

    -- Parent / relationship
                          parent_contract_id UUID,

    -- Versioning
                          version_number INTEGER NOT NULL DEFAULT 1,

    -- Amendment details
                          amendment_by_account_id UUID,
                          amendment_for_account_id UUID,
                          amendment_reason TEXT,

    -- Renewal details
                          renewal_by_account_id UUID,
                          renewal_for_account_id UUID,
                          renewal_reason TEXT,

    -- Ownership
                          owner_user_id UUID,

    -- Audit fields
                          created_by UUID,
                          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                          updated_by UUID,
                          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,


    ------------------------------------------------------------
    -- Foreign Keys
    ------------------------------------------------------------

                          CONSTRAINT fk_contract_tenant
                              FOREIGN KEY (tenant_id)
                                  REFERENCES tenant(id),

                          CONSTRAINT fk_contract_record_type
                              FOREIGN KEY (record_type_id)
                                  REFERENCES record_type(id),

                          CONSTRAINT fk_contract_provider_account
                              FOREIGN KEY (provider_account_id)
                                  REFERENCES account(id),

                          CONSTRAINT fk_contract_requestor_account
                              FOREIGN KEY (requestor_account_id)
                                  REFERENCES account(id),

                          CONSTRAINT fk_contract_parent
                              FOREIGN KEY (parent_contract_id)
                                  REFERENCES contract(id),

                          CONSTRAINT fk_contract_amendment_by
                              FOREIGN KEY (amendment_by_account_id)
                                  REFERENCES account(id),

                          CONSTRAINT fk_contract_amendment_for
                              FOREIGN KEY (amendment_for_account_id)
                                  REFERENCES account(id),

                          CONSTRAINT fk_contract_renewal_by
                              FOREIGN KEY (renewal_by_account_id)
                                  REFERENCES account(id),

                          CONSTRAINT fk_contract_renewal_for
                              FOREIGN KEY (renewal_for_account_id)
                                  REFERENCES account(id),

                          CONSTRAINT fk_contract_owner
                              FOREIGN KEY (owner_user_id)
                                  REFERENCES app_user(id),

                          CONSTRAINT fk_contract_created_by
                              FOREIGN KEY (created_by)
                                  REFERENCES app_user(id),

                          CONSTRAINT fk_contract_updated_by
                              FOREIGN KEY (updated_by)
                                  REFERENCES app_user(id),


    ------------------------------------------------------------
    -- Unique Constraints
    ------------------------------------------------------------

                          CONSTRAINT uk_contract_tenant_number
                              UNIQUE (tenant_id, contract_number),

                          CONSTRAINT uk_contract_external_id
                              UNIQUE (tenant_id, external_system, external_id)
);


------------------------------------------------------------
-- Indexes
------------------------------------------------------------

CREATE INDEX idx_contract_tenant_id
    ON contract(tenant_id);

CREATE INDEX idx_contract_record_type_id
    ON contract(record_type_id);

CREATE INDEX idx_contract_provider_account_id
    ON contract(provider_account_id);

CREATE INDEX idx_contract_requestor_account_id
    ON contract(requestor_account_id);

CREATE INDEX idx_contract_parent_contract_id
    ON contract(parent_contract_id);

CREATE INDEX idx_contract_owner_user_id
    ON contract(owner_user_id);

CREATE INDEX idx_contract_status
    ON contract(status);

CREATE INDEX idx_contract_effective_date
    ON contract(effective_date);

CREATE INDEX idx_contract_expiration_date
    ON contract(expiration_date);

CREATE INDEX idx_contract_external_lookup
    ON contract(
                tenant_id,
                external_system,
                external_id
        );