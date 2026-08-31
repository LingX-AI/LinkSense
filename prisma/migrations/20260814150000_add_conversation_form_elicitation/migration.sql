BEGIN;

ALTER TABLE "conversation_user_input_requests"
  ADD COLUMN "request_kind" VARCHAR(24) NOT NULL DEFAULT 'questions',
  ADD COLUMN "server_name" TEXT,
  ADD COLUMN "message_text" TEXT,
  ADD COLUMN "form_schema_json" JSONB,
  ADD COLUMN "form_ui_hints_json" JSONB,
  ADD COLUMN "resolved_action" VARCHAR(24);

ALTER TABLE "conversation_user_input_requests"
  ADD CONSTRAINT "conversation_user_input_requests_kind_check"
    CHECK ("request_kind" IN ('questions', 'form')),
  ADD CONSTRAINT "conversation_user_input_requests_form_shape_check"
    CHECK (
      ("request_kind" = 'questions'
        AND "server_name" IS NULL
        AND "message_text" IS NULL
        AND "form_schema_json" IS NULL
        AND "form_ui_hints_json" IS NULL)
      OR
      ("request_kind" = 'form'
        AND "server_name" IS NOT NULL
        AND "message_text" IS NOT NULL
        AND "form_schema_json" IS NOT NULL
        AND "form_ui_hints_json" IS NOT NULL)
    ),
  ADD CONSTRAINT "conversation_user_input_requests_resolved_action_check"
    CHECK (
      "resolved_action" IS NULL
      OR "resolved_action" IN ('accept', 'decline', 'cancel')
    );

COMMIT;
