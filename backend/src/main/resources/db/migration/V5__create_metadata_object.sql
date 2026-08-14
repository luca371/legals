CREATE TABLE metadata_object (
                                 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                                 name VARCHAR(100) NOT NULL,
                                 developer_name VARCHAR(100) NOT NULL,
                                 description VARCHAR(500),

                                 active BOOLEAN NOT NULL DEFAULT TRUE,

                                 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                 CONSTRAINT uk_metadata_object_developer_name
                                     UNIQUE (developer_name)
);

CREATE INDEX idx_metadata_object_developer_name
    ON metadata_object(developer_name);