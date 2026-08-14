CREATE TABLE record_type (
                             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                             object_id UUID NOT NULL,

                             name VARCHAR(100) NOT NULL,
                             developer_name VARCHAR(100) NOT NULL,
                             description VARCHAR(500),

                             active BOOLEAN NOT NULL DEFAULT TRUE,

                             created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                             updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                             CONSTRAINT fk_record_type_object
                                 FOREIGN KEY (object_id)
                                     REFERENCES metadata_object(id),

                             CONSTRAINT uk_record_type_object_developer_name
                                 UNIQUE (object_id, developer_name)
);

CREATE INDEX idx_record_type_object_id
    ON record_type(object_id);