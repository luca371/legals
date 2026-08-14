CREATE TABLE permission (
                            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                            name VARCHAR(150) NOT NULL,
                            developer_name VARCHAR(150) NOT NULL,
                            description VARCHAR(500),

                            permission_type VARCHAR(50) NOT NULL,

                            active BOOLEAN NOT NULL DEFAULT TRUE,

                            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                            CONSTRAINT uk_permission_developer_name
                                UNIQUE (developer_name)
);