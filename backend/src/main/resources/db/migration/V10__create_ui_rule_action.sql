CREATE TABLE ui_rule_action (
                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                                ui_rule_id UUID NOT NULL,

                                target_type VARCHAR(50) NOT NULL,
                                target_id UUID NOT NULL,

                                action VARCHAR(50) NOT NULL,
                                value VARCHAR(500),

                                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                CONSTRAINT fk_ui_rule_action_rule
                                    FOREIGN KEY (ui_rule_id)
                                        REFERENCES ui_rule(id)
);

CREATE INDEX idx_ui_rule_action_rule_id
    ON ui_rule_action(ui_rule_id);

CREATE INDEX idx_ui_rule_action_target
    ON ui_rule_action(target_type, target_id);