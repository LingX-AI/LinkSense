-- Historical data option A: preserve external identity UUIDs, sessions, tasks,
-- access IDs/secrets and quotas. Account records are removed only after their
-- execution preferences have been transferred to the corresponding session.
-- DATA-LOSS RISK: removes synthetic visitor rows from users and account_type.
-- Real member accounts and all task/history rows are retained.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM users u WHERE u.account_type = 'application_external'
    AND NOT EXISTS (SELECT 1 FROM application_external_sessions s WHERE s.runtime_principal_id = u.id)) THEN
    RAISE EXCEPTION 'External account without a session: resolve this conflict before conversion';
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE u.account_type = 'application_external' AND (
    EXISTS (SELECT 1 FROM capabilities c WHERE c.owner_id = u.id) OR
    EXISTS (SELECT 1 FROM credentials c WHERE c.owner_id = u.id) OR
    EXISTS (SELECT 1 FROM credential_bindings c WHERE c.user_id = u.id) OR
    EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = u.id) OR
    EXISTS (SELECT 1 FROM user_group_members g WHERE g.user_id = u.id) OR
    EXISTS (SELECT 1 FROM applications a WHERE a.owner_id = u.id)
  )) THEN
    RAISE EXCEPTION 'External account owns personal resources: reassign them before conversion';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE account_type NOT IN ('member', 'application_external')) THEN
    RAISE EXCEPTION 'Unknown account type: conversion requires review';
  END IF;
END $$;
ALTER TABLE application_external_sessions
  ADD COLUMN preferred_locale VARCHAR(16),
  ADD COLUMN preferred_model VARCHAR(240),
  ADD COLUMN preferred_reasoning_effort VARCHAR(32),
  ADD COLUMN total_credit_limit_micros BIGINT,
  ADD COLUMN weekly_credit_limit_micros BIGINT,
  ADD COLUMN monthly_credit_limit_micros BIGINT,
  ADD COLUMN credit_quota_reset_at TIMESTAMPTZ(6);
UPDATE application_external_sessions s SET
  display_name = COALESCE(s.display_name, u.name),
  preferred_locale = u.preferred_locale,
  preferred_model = u.preferred_model,
  preferred_reasoning_effort = u.preferred_reasoning_effort,
  total_credit_limit_micros = u.total_credit_limit_micros,
  weekly_credit_limit_micros = u.weekly_credit_limit_micros,
  monthly_credit_limit_micros = u.monthly_credit_limit_micros,
  credit_quota_reset_at = u.credit_quota_reset_at,
  status = CASE WHEN u.status <> 'active' AND s.status = 'active' THEN 'revoked' ELSE s.status END
FROM users u WHERE u.id = s.runtime_principal_id AND u.account_type = 'application_external';
DELETE FROM users WHERE account_type = 'application_external';
DROP INDEX users_account_type_status_idx;
ALTER TABLE users DROP COLUMN account_type;
ALTER TABLE runtime_cleanup_outbox ADD COLUMN service_session_id UUID;
COMMIT;
