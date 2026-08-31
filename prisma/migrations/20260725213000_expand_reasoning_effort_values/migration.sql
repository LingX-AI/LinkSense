BEGIN;

ALTER TABLE users
  DROP CONSTRAINT users_preferred_reasoning_effort_check,
  ADD CONSTRAINT users_preferred_reasoning_effort_check
  CHECK (
    preferred_reasoning_effort IS NULL
    OR preferred_reasoning_effort IN (
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra'
    )
  );

ALTER TABLE conversation_turn_start_intents
  DROP CONSTRAINT conversation_turn_start_intents_reasoning_effort_check,
  ADD CONSTRAINT conversation_turn_start_intents_reasoning_effort_check
  CHECK (
    reasoning_effort IS NULL
    OR reasoning_effort IN (
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra'
    )
  );

COMMIT;
