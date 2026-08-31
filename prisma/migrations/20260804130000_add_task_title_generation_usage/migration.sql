-- Add task auto naming as a metered generation workload.
-- This forward-only migration preserves every existing usage record and only
-- widens the accepted workload/model-kind pairs.

BEGIN;

ALTER TABLE "model_usage_records"
  DROP CONSTRAINT "model_usage_records_workload_check",
  DROP CONSTRAINT "model_usage_records_model_kind_check";

ALTER TABLE "model_usage_records"
  ADD CONSTRAINT "model_usage_records_workload_check" CHECK (
    "workload" IN (
      'document_embedding',
      'query_embedding',
      'rerank',
      'memory_generation',
      'task_title_generation'
    )
  ),
  ADD CONSTRAINT "model_usage_records_model_kind_check" CHECK (
    "model_kind" IN ('embedding', 'rerank', 'generation')
    AND (
      ("workload" IN ('document_embedding', 'query_embedding') AND "model_kind" = 'embedding')
      OR ("workload" = 'rerank' AND "model_kind" = 'rerank')
      OR ("workload" IN ('memory_generation', 'task_title_generation') AND "model_kind" = 'generation')
    )
  );

COMMIT;
