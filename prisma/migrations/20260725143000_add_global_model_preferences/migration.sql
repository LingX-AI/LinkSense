ALTER TABLE users
  ADD COLUMN preferred_model varchar(240),
  ADD COLUMN preferred_reasoning_effort varchar(32);

ALTER TABLE conversation_turn_start_intents
  ADD COLUMN model varchar(240),
  ADD COLUMN reasoning_effort varchar(32);

ALTER TABLE users
  ADD CONSTRAINT users_preferred_reasoning_effort_check
  CHECK (
    preferred_reasoning_effort IS NULL
    OR preferred_reasoning_effort IN ('minimal', 'low', 'medium', 'high', 'xhigh')
  );

ALTER TABLE users
  ADD CONSTRAINT users_model_preference_pair_check
  CHECK (
    (preferred_model IS NULL AND preferred_reasoning_effort IS NULL)
    OR (preferred_model IS NOT NULL AND preferred_reasoning_effort IS NOT NULL)
  );

ALTER TABLE conversation_turn_start_intents
  ADD CONSTRAINT conversation_turn_start_intents_reasoning_effort_check
  CHECK (
    reasoning_effort IS NULL
    OR reasoning_effort IN ('minimal', 'low', 'medium', 'high', 'xhigh')
  );

ALTER TABLE conversation_turn_start_intents
  ADD CONSTRAINT conversation_turn_start_intents_model_preference_pair_check
  CHECK (
    (model IS NULL AND reasoning_effort IS NULL)
    OR (model IS NOT NULL AND reasoning_effort IS NOT NULL)
  );
