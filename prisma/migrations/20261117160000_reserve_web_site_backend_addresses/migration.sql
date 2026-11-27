CREATE TABLE "web_site_backend_addresses" (
    "label" VARCHAR(30) NOT NULL,
    "backend_id" UUID NOT NULL,
    CONSTRAINT "web_site_backend_addresses_pkey" PRIMARY KEY ("label")
);
CREATE INDEX "web_site_backend_addresses_backend_idx" ON "web_site_backend_addresses"("backend_id");

-- Reserve current addresses, including early development short hosts, without
-- changing any existing backend, Appwrite platform, site or credential.
INSERT INTO "web_site_backend_addresses" ("label", "backend_id")
SELECT COALESCE("host_label", left(replace("id"::text, '-', ''), 12)), "id"
FROM "web_site_backends"
ON CONFLICT ("label") DO NOTHING;
