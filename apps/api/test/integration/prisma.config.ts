import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";

// Integration tests supply their disposable database explicitly. Do not load
// the application .env, including while applying the production migrations.
export default defineConfig({
  schema: fileURLToPath(new URL("../../../../prisma/schema.prisma", import.meta.url)),
  migrations: {
    path:
      process.env.LINKSENSE_TEST_MIGRATIONS_PATH ??
      fileURLToPath(new URL("../../../../prisma/migrations", import.meta.url)),
  },
  datasource: { url: env("DATABASE_URL") },
});
