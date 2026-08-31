CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "instruction" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "frequency" VARCHAR(16) NOT NULL,
    "interval_count" INTEGER NOT NULL,
    "minute_of_hour" INTEGER,
    "time_of_day_minutes" INTEGER,
    "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "day_of_month" INTEGER,
    "month_of_year" INTEGER,
    "time_zone" VARCHAR(120) NOT NULL,
    "anchor_at" TIMESTAMPTZ(6) NOT NULL,
    "next_run_at" TIMESTAMPTZ(6),
    "last_run_at" TIMESTAMPTZ(6),
    "last_run_status" VARCHAR(24),
    "last_error_code" VARCHAR(120),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "automations_status_check" CHECK ("status" IN ('active', 'paused')),
    CONSTRAINT "automations_frequency_check" CHECK ("frequency" IN ('hourly', 'daily', 'weekly', 'monthly', 'yearly')),
    CONSTRAINT "automations_interval_check" CHECK ("interval_count" BETWEEN 1 AND 999),
    CONSTRAINT "automations_minute_check" CHECK ("minute_of_hour" IS NULL OR "minute_of_hour" BETWEEN 0 AND 59),
    CONSTRAINT "automations_time_of_day_check" CHECK ("time_of_day_minutes" IS NULL OR "time_of_day_minutes" BETWEEN 0 AND 1439),
    CONSTRAINT "automations_weekdays_check" CHECK (
        cardinality("weekdays") <= 7
        AND "weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[]
    ),
    CONSTRAINT "automations_day_of_month_check" CHECK ("day_of_month" IS NULL OR "day_of_month" BETWEEN 1 AND 31),
    CONSTRAINT "automations_month_of_year_check" CHECK ("month_of_year" IS NULL OR "month_of_year" BETWEEN 1 AND 12),
    CONSTRAINT "automations_last_run_status_check" CHECK (
        "last_run_status" IS NULL OR "last_run_status" IN ('dispatching', 'queued', 'started', 'failed')
    ),
    CONSTRAINT "automations_active_schedule_check" CHECK (
        ("status" = 'active' AND "deleted_at" IS NULL AND "next_run_at" IS NOT NULL)
        OR (("status" = 'paused' OR "deleted_at" IS NOT NULL) AND "next_run_at" IS NULL)
    ),
    CONSTRAINT "automations_schedule_shape_check" CHECK (
        ("frequency" = 'hourly'
            AND "minute_of_hour" IS NOT NULL
            AND "time_of_day_minutes" IS NULL
            AND cardinality("weekdays") = 0
            AND "day_of_month" IS NULL
            AND "month_of_year" IS NULL)
        OR ("frequency" = 'daily'
            AND "minute_of_hour" IS NULL
            AND "time_of_day_minutes" IS NOT NULL
            AND cardinality("weekdays") = 0
            AND "day_of_month" IS NULL
            AND "month_of_year" IS NULL)
        OR ("frequency" = 'weekly'
            AND "minute_of_hour" IS NULL
            AND "time_of_day_minutes" IS NOT NULL
            AND cardinality("weekdays") BETWEEN 1 AND 7
            AND "day_of_month" IS NULL
            AND "month_of_year" IS NULL)
        OR ("frequency" = 'monthly'
            AND "minute_of_hour" IS NULL
            AND "time_of_day_minutes" IS NOT NULL
            AND cardinality("weekdays") = 0
            AND "day_of_month" IS NOT NULL
            AND "month_of_year" IS NULL)
        OR ("frequency" = 'yearly'
            AND "minute_of_hour" IS NULL
            AND "time_of_day_minutes" IS NOT NULL
            AND cardinality("weekdays") = 0
            AND "day_of_month" IS NOT NULL
            AND "month_of_year" IS NOT NULL
            AND "day_of_month" <= CASE
                WHEN "month_of_year" = 2 THEN 29
                WHEN "month_of_year" IN (4, 6, 9, 11) THEN 30
                ELSE 31
            END)
    )
);

CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "turn_id" UUID,
    "pending_request_id" UUID,
    "error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "automation_runs_status_check" CHECK ("status" IN ('dispatching', 'queued', 'started', 'failed')),
    CONSTRAINT "automation_runs_target_check" CHECK (
        ("status" = 'queued' AND "pending_request_id" IS NOT NULL AND "turn_id" IS NULL)
        OR ("status" = 'started' AND "turn_id" IS NOT NULL AND "pending_request_id" IS NULL)
        OR ("status" IN ('dispatching', 'failed') AND "turn_id" IS NULL AND "pending_request_id" IS NULL)
    )
);

CREATE INDEX "automations_owner_deleted_updated_idx"
    ON "automations"("owner_id", "deleted_at", "updated_at" DESC);
CREATE INDEX "automations_status_next_run_idx"
    ON "automations"("status", "next_run_at");
CREATE INDEX "automations_conversation_deleted_idx"
    ON "automations"("conversation_id", "deleted_at");

CREATE UNIQUE INDEX "automation_runs_idempotency_key"
    ON "automation_runs"("idempotency_key");
CREATE UNIQUE INDEX "automation_runs_automation_scheduled_key"
    ON "automation_runs"("automation_id", "scheduled_for");
CREATE INDEX "automation_runs_automation_created_idx"
    ON "automation_runs"("automation_id", "created_at" DESC);
CREATE INDEX "automation_runs_owner_created_idx"
    ON "automation_runs"("owner_id", "created_at" DESC);
CREATE INDEX "automation_runs_conversation_created_idx"
    ON "automation_runs"("conversation_id", "created_at" DESC);
CREATE INDEX "automation_runs_status_updated_idx"
    ON "automation_runs"("status", "updated_at");
