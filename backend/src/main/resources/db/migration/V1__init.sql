CREATE TABLE app_version (
                 id BIGSERIAL PRIMARY KEY,
                 version VARCHAR(20) NOT NULL,
                 description VARCHAR(100),
                 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_version (version, description)
VALUES ('1.0.0', 'Initial database setup');