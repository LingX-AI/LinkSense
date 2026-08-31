CREATE TABLE "feedbacks" (
    "id" UUID NOT NULL,
    "submitter_id" UUID NOT NULL,
    "submitter_name" VARCHAR(120) NOT NULL,
    "submitter_email" VARCHAR(320) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feedbacks_content_check" CHECK (char_length(btrim("content")) BETWEEN 1 AND 2000)
);

CREATE TABLE "feedback_images" (
    "id" UUID NOT NULL,
    "feedback_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "filename" VARCHAR(260) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feedback_images_mime_type_check" CHECK ("mime_type" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
    CONSTRAINT "feedback_images_size_check" CHECK ("size_bytes" BETWEEN 1 AND 5242880),
    CONSTRAINT "feedback_images_checksum_check" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "feedback_images_sort_order_check" CHECK ("sort_order" BETWEEN 0 AND 8)
);

CREATE INDEX "feedbacks_created_id_idx" ON "feedbacks"("created_at" DESC, "id" DESC);
CREATE INDEX "feedbacks_submitter_created_idx" ON "feedbacks"("submitter_id", "created_at" DESC);
CREATE UNIQUE INDEX "feedback_images_object_key_key" ON "feedback_images"("object_key");
CREATE UNIQUE INDEX "feedback_images_feedback_order_key" ON "feedback_images"("feedback_id", "sort_order");
CREATE INDEX "feedback_images_feedback_created_idx" ON "feedback_images"("feedback_id", "created_at");
