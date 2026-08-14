CREATE TABLE record_access_rule (
                                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                                    object_id UUID NOT NULL,
                                    role_id UUID,

                                    name VARCHAR(150) NOT NULL,
                                    developer_name VARCHAR(150) NOT NULL,
                                    description VARCHAR(500),

                                    access_type VARCHAR(50) NOT NULL,

                                    can_read BOOLEAN NOT NULL DEFAULT TRUE,
                                    can_update BOOLEAN NOT NULL DEFAULT FALSE,
                                    can_delete BOOLEAN NOT NULL DEFAULT FALSE,

                                    active BOOLEAN NOT NULL DEFAULT TRUE,

                                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                    CONSTRAINT fk_record_access_rule_object
                                        FOREIGN KEY (object_id)
                                            REFERENCES metadata_object(id),

                                    CONSTRAINT fk_record_access_rule_role
                                        FOREIGN KEY (role_id)
                                            REFERENCES role(id),

                                    CONSTRAINT uk_record_access_rule_developer_name
                                        UNIQUE (object_id, developer_name)
);

CREATE INDEX idx_record_access_rule_object_id
    ON record_access_rule(object_id);

CREATE INDEX idx_record_access_rule_role_id
    ON record_access_rule(role_id);