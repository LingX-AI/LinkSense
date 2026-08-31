ALTER TABLE "applications"
ADD COLUMN "icon_preset" VARCHAR(32) NOT NULL DEFAULT 'bot',
ADD COLUMN "icon_object_key" TEXT;
