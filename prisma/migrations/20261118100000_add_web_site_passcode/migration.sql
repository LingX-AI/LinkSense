-- NULL keeps every existing site public.
ALTER TABLE "web_sites" ADD COLUMN "passcode_hash" VARCHAR(255);
