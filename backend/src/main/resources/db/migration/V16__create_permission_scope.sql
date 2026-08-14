CREATE TABLE permission_scope (
                                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                                  permission_id UUID NOT NULL,

                                  object_id UUID,
                                  field_id UUID,
                                  record_type_id UUID,
                                  action_id UUID,

                                  can_read BOOLEAN NOT NULL DEFAULT FALSE,
                                  can_create BOOLEAN NOT NULL DEFAULT FALSE,
                                  can_update BOOLEAN NOT NULL DEFAULT FALSE,
                                  can_delete BOOLEAN NOT NULL DEFAULT FALSE,

                                  active BOOLEAN NOT NULL DEFAULT TRUE,

                                  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                  CONSTRAINT fk_permission_scope_permission
                                      FOREIGN KEY (permission_id)
                                          REFERENCES permission(id),

                                  CONSTRAINT fk_permission_scope_object
                                      FOREIGN KEY (object_id)
                                          REFERENCES metadata_object(id),

                                  CONSTRAINT fk_permission_scope_field
                                      FOREIGN KEY (field_id)
                                          REFERENCES metadata_field(id),

                                  CONSTRAINT fk_permission_scope_record_type
                                      FOREIGN KEY (record_type_id)
                                          REFERENCES record_type(id),

                                  CONSTRAINT fk_permission_scope_action
                                      FOREIGN KEY (action_id)
                                          REFERENCES action(id)
);

CREATE INDEX idx_permission_scope_permission_id
    ON permission_scope(permission_id);

CREATE INDEX idx_permission_scope_object_id
    ON permission_scope(object_id);

CREATE INDEX idx_permission_scope_field_id
    ON permission_scope(field_id);

CREATE INDEX idx_permission_scope_record_type_id
    ON permission_scope(record_type_id);

CREATE INDEX idx_permission_scope_action_id
    ON permission_scope(action_id);