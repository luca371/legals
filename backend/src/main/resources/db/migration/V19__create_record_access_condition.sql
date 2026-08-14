CREATE TABLE record_access_condition (
                                         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                                         record_access_rule_id UUID NOT NULL,
                                         condition_group_id UUID NOT NULL,

                                         field_id UUID NOT NULL,

                                         operator VARCHAR(50) NOT NULL,
                                         comparison_type VARCHAR(50) NOT NULL,
                                         comparison_value VARCHAR(500),

                                         sequence_number INTEGER NOT NULL DEFAULT 0,

                                         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                         CONSTRAINT fk_record_access_condition_rule
                                             FOREIGN KEY (record_access_rule_id)
                                                 REFERENCES record_access_rule(id),

                                         CONSTRAINT fk_record_access_condition_group
                                             FOREIGN KEY (condition_group_id)
                                                 REFERENCES record_access_condition_group(id),

                                         CONSTRAINT fk_record_access_condition_field
                                             FOREIGN KEY (field_id)
                                                 REFERENCES metadata_field(id)
);

CREATE INDEX idx_record_access_condition_rule_id
    ON record_access_condition(record_access_rule_id);

CREATE INDEX idx_record_access_condition_group_id
    ON record_access_condition(condition_group_id);

CREATE INDEX idx_record_access_condition_field_id
    ON record_access_condition(field_id);