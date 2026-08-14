CREATE TABLE app_user_role (
                               id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                               user_id UUID NOT NULL,
                               role_id UUID NOT NULL,

                               created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                               updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                               CONSTRAINT fk_app_user_role_user
                                   FOREIGN KEY (user_id)
                                       REFERENCES app_user(id),

                               CONSTRAINT fk_app_user_role_role
                                   FOREIGN KEY (role_id)
                                       REFERENCES role(id),

                               CONSTRAINT uk_app_user_role
                                   UNIQUE (user_id, role_id)
);

CREATE INDEX idx_app_user_role_user_id
    ON app_user_role(user_id);

CREATE INDEX idx_app_user_role_role_id
    ON app_user_role(role_id);