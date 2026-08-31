ALTER TABLE conversations
  ADD COLUMN preferred_model varchar(240);

ALTER TABLE conversation_turns
  ADD COLUMN reasoning_effort varchar(32);

ALTER TABLE conversation_turns
  ADD CONSTRAINT conversation_turns_reasoning_effort_check
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
