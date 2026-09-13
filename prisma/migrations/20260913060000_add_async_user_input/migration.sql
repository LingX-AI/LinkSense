BEGIN;

-- Preserve every historical row and field. Native asynchronous questions are
-- notifications, so they have no numeric JSON-RPC request id.
ALTER TABLE "conversation_user_input_requests"
  ALTER COLUMN "native_request_id" DROP NOT NULL,
  ADD COLUMN "response_delivery_json" JSONB,
  DROP CONSTRAINT "conversation_user_input_requests_kind_check",
  DROP CONSTRAINT "conversation_user_input_requests_form_shape_check",
  DROP CONSTRAINT "conversation_user_input_requests_response_shape_check";

ALTER TABLE "conversation_user_input_requests"
  ADD CONSTRAINT "conversation_user_input_requests_kind_check"
    CHECK ("request_kind" IN ('questions', 'form', 'async_questions')),
  ADD CONSTRAINT "conversation_user_input_requests_native_request_check"
    CHECK (
      ("request_kind" = 'async_questions' AND "native_request_id" IS NULL)
      OR ("request_kind" IN ('questions', 'form') AND "native_request_id" IS NOT NULL)
    ),
  ADD CONSTRAINT "conversation_user_input_requests_form_shape_check"
    CHECK (
      ("request_kind" IN ('questions', 'async_questions')
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
  ADD CONSTRAINT "conversation_user_input_requests_response_shape_check"
    CHECK (
      ("request_kind" = 'questions'
        AND "form_response_semantics_json" IS NULL
        AND "response_content_json" IS NULL)
      OR ("request_kind" = 'async_questions' AND "form_response_semantics_json" IS NULL)
      OR ("request_kind" = 'form' AND "form_response_semantics_json" IS NOT NULL)
    ),
  ADD CONSTRAINT "conversation_user_input_requests_delivery_shape_check"
    CHECK (
      "response_delivery_json" IS NULL
      OR (
        "request_kind" = 'async_questions'
        AND jsonb_typeof("response_delivery_json") = 'object'
        AND octet_length("response_delivery_json"::text) <= 2048
        AND (
          ("response_delivery_json"->>'method' = 'steer'
            AND "response_delivery_json" ?& ARRAY['method', 'turnId', 'operationId']
            AND "response_delivery_json" - ARRAY['method', 'turnId', 'operationId'] = '{}'::jsonb
            AND jsonb_typeof("response_delivery_json"->'turnId') = 'string'
            AND jsonb_typeof("response_delivery_json"->'operationId') = 'string'
            AND length("response_delivery_json"->>'turnId') = 36
            AND length("response_delivery_json"->>'operationId') = 36)
          OR
          ("response_delivery_json"->>'method' = 'start'
            AND "response_delivery_json" ?& ARRAY['method', 'idempotencyKey']
            AND "response_delivery_json" - ARRAY['method', 'idempotencyKey'] = '{}'::jsonb
            AND jsonb_typeof("response_delivery_json"->'idempotencyKey') = 'string'
            AND length("response_delivery_json"->>'idempotencyKey') BETWEEN 1 AND 120)
        )
      ) IS TRUE
    );

COMMIT;
