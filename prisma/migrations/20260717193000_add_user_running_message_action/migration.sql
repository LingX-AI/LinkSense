-- Add a non-destructive per-user default for messages sent while a turn is
-- running. Existing accounts receive the safe queue behavior automatically.

ALTER TABLE "users"
    ADD COLUMN "running_message_action" VARCHAR(32) NOT NULL DEFAULT 'queue';

ALTER TABLE "users"
    ADD CONSTRAINT "users_running_message_action_check" CHECK (
        "running_message_action" IN ('steer', 'queue')
    );
