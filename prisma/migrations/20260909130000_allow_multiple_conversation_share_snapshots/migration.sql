BEGIN;

-- Keep every existing share ID and snapshot. A task may have multiple shares.
CREATE INDEX "conversation_shares_conversation_id_idx"
ON "conversation_shares"("conversation_id");

DROP INDEX "conversation_shares_conversation_id_key";

COMMIT;
