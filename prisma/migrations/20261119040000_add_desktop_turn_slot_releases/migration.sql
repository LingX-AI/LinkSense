CREATE TABLE "desktop_turn_slot_releases" (
    "turn_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desktop_turn_slot_releases_pkey" PRIMARY KEY ("turn_id")
);

CREATE INDEX "desktop_turn_slot_releases_created_idx"
    ON "desktop_turn_slot_releases"("created_at", "turn_id");
