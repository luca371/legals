CREATE TABLE page_layout (
                             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                             object_id UUID NOT NULL,
                             record_type_id UUID,

                             name VARCHAR(150) NOT NULL,
                             developer_name VARCHAR(150) NOT NULL,
                             description VARCHAR(500),

                             active BOOLEAN NOT NULL DEFAULT TRUE,

                             created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                             updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                             CONSTRAINT fk_page_layout_object
                                 FOREIGN KEY (object_id)
                                     REFERENCES metadata_object(id),

                             CONSTRAINT fk_page_layout_record_type
                                 FOREIGN KEY (record_type_id)
                                     REFERENCES record_type(id),

                             CONSTRAINT uk_page_layout_object_developer_name
                                 UNIQUE (object_id, developer_name)
);

CREATE INDEX idx_page_layout_object_id
    ON page_layout(object_id);

CREATE INDEX idx_page_layout_record_type_id
    ON page_layout(record_type_id);