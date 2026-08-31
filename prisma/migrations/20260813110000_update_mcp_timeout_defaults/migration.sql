ALTER TABLE "mcp_servers"
  ALTER COLUMN "startup_timeout_seconds" SET DEFAULT 60,
  ALTER COLUMN "tool_timeout_seconds" SET DEFAULT 600;
