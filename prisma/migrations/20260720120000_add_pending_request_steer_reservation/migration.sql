-- Reserve a queued request while it is being promoted to a native turn/steer
-- operation. The state is durable so a process crash cannot let terminal
-- processing start the same request as a new turn.
ALTER TABLE "pending_requests"
  ADD COLUMN "steer_operation_id" UUID,
  ADD COLUMN "steer_turn_id" UUID;

ALTER TABLE "pending_requests"
  DROP CONSTRAINT "pending_requests_status_check",
  DROP CONSTRAINT "pending_requests_block_code_check";

ALTER TABLE "pending_requests"
  ADD CONSTRAINT "pending_requests_status_check" CHECK (
    "status" IN (
      'waiting_previous_turn',
      'blocked_overload',
      'blocked_preflight',
      'steering'
    )
  ),
  ADD CONSTRAINT "pending_requests_block_code_check" CHECK (
    ("status" = 'blocked_preflight' AND "block_code" IS NOT NULL)
    OR ("status" <> 'blocked_preflight' AND "block_code" IS NULL)
  ),
  ADD CONSTRAINT "pending_requests_steer_reservation_check" CHECK (
    (
      "status" = 'steering'
      AND "steer_operation_id" IS NOT NULL
      AND "steer_turn_id" IS NOT NULL
    )
    OR (
      "status" <> 'steering'
      AND "steer_operation_id" IS NULL
      AND "steer_turn_id" IS NULL
    )
  );
