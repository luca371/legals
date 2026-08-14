CREATE TABLE document_version (
                                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant and parent contract
                                  tenant_id UUID NOT NULL,
                                  contract_id UUID NOT NULL,

    -- Versioning
                                  major_version INTEGER NOT NULL DEFAULT 1,
                                  minor_version INTEGER NOT NULL DEFAULT 0,
                                  revision_number INTEGER NOT NULL DEFAULT 0,

    -- Version status
                                  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',

    -- Document information
                                  document_name VARCHAR(255),
                                  file_reference TEXT,
                                  mime_type VARCHAR(100),
                                  file_size BIGINT,

    -- Version/change information
                                  change_reason TEXT,

    -- Current version indicator
                                  is_current BOOLEAN NOT NULL DEFAULT FALSE,

    -- Audit fields
                                  created_by UUID,
                                  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                  updated_by UUID,
                                  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,


    ------------------------------------------------------------
    -- Foreign Keys
    ------------------------------------------------------------

                                  CONSTRAINT fk_document_version_tenant
                                      FOREIGN KEY (tenant_id)
                                          REFERENCES tenant(id),

                                  CONSTRAINT fk_document_version_contract
                                      FOREIGN KEY (contract_id)
                                          REFERENCES contract(id),

                                  CONSTRAINT fk_document_version_created_by
                                      FOREIGN KEY (created_by)
                                          REFERENCES app_user(id),

                                  CONSTRAINT fk_document_version_updated_by
                                      FOREIGN KEY (updated_by)
                                          REFERENCES app_user(id),


    ------------------------------------------------------------
    -- Version uniqueness
    ------------------------------------------------------------

                                  CONSTRAINT uk_document_version_number
                                      UNIQUE (
                                              contract_id,
                                              major_version,
                                              minor_version,
                                              revision_number
                                          )
);


------------------------------------------------------------
-- Indexes
------------------------------------------------------------

CREATE INDEX idx_document_version_tenant_id
    ON document_version(tenant_id);

CREATE INDEX idx_document_version_contract_id
    ON document_version(contract_id);

CREATE INDEX idx_document_version_status
    ON document_version(status);

CREATE INDEX idx_document_version_current
    ON document_version(contract_id, is_current);