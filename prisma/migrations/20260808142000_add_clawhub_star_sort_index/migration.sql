BEGIN;

CREATE INDEX "clawhub_skills_available_star_slug_idx"
  ON "clawhub_skills"("available", "star_count" DESC, "slug");

COMMIT;
