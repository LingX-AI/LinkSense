CREATE TABLE "feedback_replies" (
  "id" UUID NOT NULL,
  "feedback_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_replies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "feedback_replies_content_check" CHECK (char_length("content") <= 2000)
);
CREATE INDEX "feedback_replies_feedback_created_id_idx" ON "feedback_replies"("feedback_id", "created_at", "id");

CREATE TABLE "feedback_reply_images" (
    "id" UUID NOT NULL,
    "reply_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "filename" VARCHAR(260) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_reply_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feedback_reply_images_mime_type_check" CHECK ("mime_type" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
    CONSTRAINT "feedback_reply_images_size_check" CHECK ("size_bytes" BETWEEN 1 AND 5242880),
    CONSTRAINT "feedback_reply_images_checksum_check" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "feedback_reply_images_sort_order_check" CHECK ("sort_order" BETWEEN 0 AND 8)
);

CREATE UNIQUE INDEX "feedback_reply_images_object_key_key" ON "feedback_reply_images"("object_key");
CREATE UNIQUE INDEX "feedback_reply_images_reply_order_key" ON "feedback_reply_images"("reply_id", "sort_order");
CREATE INDEX "feedback_reply_images_reply_created_idx" ON "feedback_reply_images"("reply_id", "created_at");
