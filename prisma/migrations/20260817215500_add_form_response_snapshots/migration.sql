BEGIN;

ALTER TABLE "conversation_user_input_requests"
  ADD COLUMN "form_response_semantics_json" JSONB,
  ADD COLUMN "response_content_json" JSONB;

UPDATE "conversation_user_input_requests"
SET "form_response_semantics_json" = '{"kind":"input"}'::jsonb
WHERE "request_kind" = 'form';

ALTER TABLE "conversation_user_input_requests"
  ADD CONSTRAINT "conversation_user_input_requests_response_shape_check"
    CHECK (
      ("request_kind" = 'questions'
        AND "form_response_semantics_json" IS NULL
        AND "response_content_json" IS NULL)
      OR
      ("request_kind" = 'form'
        AND "form_response_semantics_json" IS NOT NULL)
    ),
  ADD CONSTRAINT "conversation_user_input_requests_response_content_object_check"
    CHECK (
      "response_content_json" IS NULL
      OR jsonb_typeof("response_content_json") = 'object'
    );

COMMIT;
