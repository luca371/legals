CREATE TABLE metadata_field (
                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                                object_id UUID NOT NULL,

                                name VARCHAR(100) NOT NULL,
                                developer_name VARCHAR(100) NOT NULL,
                                description VARCHAR(500),

                                data_type VARCHAR(50) NOT NULL,

                                required BOOLEAN NOT NULL DEFAULT FALSE,
                                unique_field BOOLEAN NOT NULL DEFAULT FALSE,
                                active BOOLEAN NOT NULL DEFAULT TRUE,

                                display_order INTEGER,

                                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                CONSTRAINT fk_metadata_field_object
                                    FOREIGN KEY (object_id)
                                        REFERENCES metadata_object(id),

                                CONSTRAINT uk_metadata_field_object_developer_name
                                    UNIQUE (object_id, developer_name)
);

CREATE INDEX idx_metadata_field_object_id
    ON metadata_field(object_id);