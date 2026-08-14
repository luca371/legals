CREATE TABLE page_layout_field (
                                   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                                   page_layout_id UUID NOT NULL,
                                   field_id UUID NOT NULL,

                                   section_name VARCHAR(150),
                                   display_order INTEGER NOT NULL DEFAULT 0,

                                   visible BOOLEAN NOT NULL DEFAULT TRUE,
                                   required BOOLEAN NOT NULL DEFAULT FALSE,
                                   read_only BOOLEAN NOT NULL DEFAULT FALSE,

                                   created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                   updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                   CONSTRAINT fk_page_layout_field_layout
                                       FOREIGN KEY (page_layout_id)
                                           REFERENCES page_layout(id),

                                   CONSTRAINT fk_page_layout_field_field
                                       FOREIGN KEY (field_id)
                                           REFERENCES metadata_field(id),

                                   CONSTRAINT uk_page_layout_field
                                       UNIQUE (page_layout_id, field_id)
);

CREATE INDEX idx_page_layout_field_layout_id
    ON page_layout_field(page_layout_id);

CREATE INDEX idx_page_layout_field_field_id
    ON page_layout_field(field_id);