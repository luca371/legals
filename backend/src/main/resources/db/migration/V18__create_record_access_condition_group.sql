CREATE TABLE record_access_condition_group (
                                               id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                                               record_access_rule_id UUID NOT NULL,

                                               group_number INTEGER NOT NULL DEFAULT 1,

                                               logical_operator VARCHAR(10) NOT NULL DEFAULT 'AND',

                                               created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                               updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                               CONSTRAINT fk_record_access_condition_group_rule
                                                   FOREIGN KEY (record_access_rule_id)
                                                       REFERENCES record_access_rule(id),

                                               CONSTRAINT uk_record_access_condition_group
                                                   UNIQUE (record_access_rule_id, group_number),

                                               CONSTRAINT chk_record_access_condition_group_operator
                                                   CHECK (logical_operator IN ('AND', 'OR'))
);

CREATE INDEX idx_record_access_condition_group_rule_id
    ON record_access_condition_group(record_access_rule_id);