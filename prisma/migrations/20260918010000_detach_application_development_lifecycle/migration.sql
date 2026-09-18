-- Preserve the source location independently of the optional development task.
-- No records, existing columns, source files or application packages are removed.
BEGIN;
ALTER TABLE application_developments
  ADD COLUMN workspace_rel_path VARCHAR(500),
  ADD COLUMN project_id UUID;

UPDATE application_developments d
SET workspace_rel_path = c.workspace_rel_path, project_id = c.project_id
FROM conversations c
WHERE c.id = d.conversation_id AND c.owner_id = d.owner_id AND c.application_id IS NULL;

-- Stop rather than invent a source location if pre-existing integrity is broken.
ALTER TABLE application_developments
  ALTER COLUMN workspace_rel_path SET NOT NULL,
  ALTER COLUMN conversation_id DROP NOT NULL;
CREATE INDEX application_developments_owner_project_idx
  ON application_developments(owner_id, project_id);
COMMIT;
