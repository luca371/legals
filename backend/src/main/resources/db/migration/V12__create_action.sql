CREATE TABLE action (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                        object_id UUID NOT NULL,
                        record_type_id UUID,
                        page_layout_id UUID,

                        name VARCHAR(150) NOT NULL,
                        developer_name VARCHAR(150) NOT NULL,
                        label VARCHAR(150) NOT NULL,

                        action_type VARCHAR(50) NOT NULL,

                        active BOOLEAN NOT NULL DEFAULT TRUE,
                        display_order INTEGER NOT NULL DEFAULT 0,

                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                        CONSTRAINT fk_action_object
                            FOREIGN KEY (object_id)
                                REFERENCES metadata_object(id),

                        CONSTRAINT fk_action_record_type
                            FOREIGN KEY (record_type_id)
                                REFERENCES record_type(id),

                        CONSTRAINT fk_action_page_layout
                            FOREIGN KEY (page_layout_id)
                                REFERENCES page_layout(id),

                        CONSTRAINT uk_action_object_developer_name
                            UNIQUE (object_id, developer_name)
);

CREATE INDEX idx_action_object_id
    ON action(object_id);

CREATE INDEX idx_action_record_type_id
    ON action(record_type_id);

CREATE INDEX idx_action_page_layout_id
    ON action(page_layout_id);