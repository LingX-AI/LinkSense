-- Extend the accepted sources without rewriting historical files or fields.
ALTER TABLE "conversation_files"
  DROP CONSTRAINT "conversation_files_source_check",
  ADD CONSTRAINT "conversation_files_source_check" CHECK (
    "source" IN ('user_upload', 'agent_generated', 'system_generated', 'interactive_application_upload')
  );
