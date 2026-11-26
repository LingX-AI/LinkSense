ALTER TABLE "desktop_devices" ADD COLUMN "installation_id" UUID;
CREATE UNIQUE INDEX "desktop_devices_owner_installation_key" ON "desktop_devices"("owner_id", "installation_id");
