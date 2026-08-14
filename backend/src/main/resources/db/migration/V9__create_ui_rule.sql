CREATE TABLE ui_rule (
                         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                         object_id UUID NOT NULL,
                         record_type_id UUID,
                         page_layout_id UUID,

                         name VARCHAR(150) NOT NULL,
                         developer_name VARCHAR(150) NOT NULL,
                         description VARCHAR(500),

                         rule_type VARCHAR(50) NOT NULL,
                         condition_expression TEXT,

                         active BOOLEAN NOT NULL DEFAULT TRUE,

                         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                         CONSTRAINT fk_ui_rule_object
                             FOREIGN KEY (object_id)
                                 REFERENCES metadata_object(id),

                         CONSTRAINT fk_ui_rule_record_type
                             FOREIGN KEY (record_type_id)
                                 REFERENCES record_type(id),

                         CONSTRAINT fk_ui_rule_page_layout
                             FOREIGN KEY (page_layout_id)
                                 REFERENCES page_layout(id),

                         CONSTRAINT uk_ui_rule_object_developer_name
                             UNIQUE (object_id, developer_name)
);

CREATE INDEX idx_ui_rule_object_id
    ON ui_rule(object_id);

CREATE INDEX idx_ui_rule_record_type_id
    ON ui_rule(record_type_id);

CREATE INDEX idx_ui_rule_page_layout_id
    ON ui_rule(page_layout_id);