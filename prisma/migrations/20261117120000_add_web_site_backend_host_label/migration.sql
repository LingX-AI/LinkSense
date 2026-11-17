ALTER TABLE "web_site_backends" ADD COLUMN "host_label" VARCHAR(30);
CREATE UNIQUE INDEX "web_site_backends_host_label_key" ON "web_site_backends"("host_label");
