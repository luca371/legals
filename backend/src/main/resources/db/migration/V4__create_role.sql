CREATE TABLE role (
                      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                      tenant_id UUID NOT NULL,

                      name VARCHAR(100) NOT NULL,
                      developer_name VARCHAR(100) NOT NULL,
                      description VARCHAR(500),

                      active BOOLEAN NOT NULL DEFAULT TRUE,

                      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                      CONSTRAINT fk_role_tenant
                          FOREIGN KEY (tenant_id)
                              REFERENCES tenant(id),

                      CONSTRAINT uk_role_tenant_developer_name
                          UNIQUE (tenant_id, developer_name)
);

CREATE INDEX idx_role_tenant_id
    ON role(tenant_id);