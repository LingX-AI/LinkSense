-- Additive only: package declarations stay immutable; bindings belong to the draft.
ALTER TABLE "applications" ADD COLUMN "interactive_dependency_bindings" JSONB NOT NULL DEFAULT '[]';
