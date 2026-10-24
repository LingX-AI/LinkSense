ALTER TABLE "automations" ADD COLUMN "notification_target_json" JSONB;

CREATE TABLE "automation_notification_deliveries" (
  "id" UUID NOT NULL,
  "automation_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "target_json" JSONB NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "processing_token" UUID,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error_code" VARCHAR(120),
  "sent_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_notification_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "automation_notifications_run_key" ON "automation_notification_deliveries"("run_id");
CREATE INDEX "automation_notifications_due_idx" ON "automation_notification_deliveries"("status", "next_attempt_at");
CREATE INDEX "automation_notifications_owner_idx" ON "automation_notification_deliveries"("owner_id");
CREATE INDEX "automation_notifications_automation_idx" ON "automation_notification_deliveries"("automation_id");
