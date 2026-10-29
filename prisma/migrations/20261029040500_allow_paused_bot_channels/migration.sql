-- Organization channels can be paused without removing member associations.
ALTER TABLE "bot_channel_connections"
  DROP CONSTRAINT "bot_channel_connections_status_check",
  ADD CONSTRAINT "bot_channel_connections_status_check"
    CHECK ("status" IN ('active', 'disabled', 'disconnecting'));
