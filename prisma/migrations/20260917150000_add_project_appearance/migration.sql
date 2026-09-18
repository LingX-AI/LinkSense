-- Additive migration: existing projects retain their names, ordering, tasks,
-- and files. Defaults give all existing rows their current folder appearance.
ALTER TABLE "projects"
  ADD COLUMN "icon" VARCHAR(32) NOT NULL DEFAULT 'folder',
  ADD COLUMN "color" VARCHAR(16) NOT NULL DEFAULT 'default';
