CREATE TABLE role_permission (
                                 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                                 role_id UUID NOT NULL,
                                 permission_id UUID NOT NULL,

                                 granted BOOLEAN NOT NULL DEFAULT TRUE,

                                 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                 CONSTRAINT fk_role_permission_role
                                     FOREIGN KEY (role_id)
                                         REFERENCES role(id),

                                 CONSTRAINT fk_role_permission_permission
                                     FOREIGN KEY (permission_id)
                                         REFERENCES permission(id),

                                 CONSTRAINT uk_role_permission
                                     UNIQUE (role_id, permission_id)
);

CREATE INDEX idx_role_permission_role_id
    ON role_permission(role_id);

CREATE INDEX idx_role_permission_permission_id
    ON role_permission(permission_id);