ALTER TABLE "automations" ADD COLUMN "monitoring_json" JSONB;
ALTER TABLE "automation_runs" ADD COLUMN "execution_context_json" JSONB;
