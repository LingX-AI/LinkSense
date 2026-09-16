import { lstat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createPrismaClient } from "../db.js";
import { convertApplicationEnvironments, recoverApplicationEnvironments } from "../operations/application-environment-conversion.js";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    apply: { type: "boolean", default: false }, recover: { type: "boolean", default: false },
    "workers-stopped": { type: "boolean", default: false },
    "output-directory": { type: "string" }, "database-backup": { type: "string" },
  } });
  const environment = z.object({ DATABASE_URL: z.string().min(1), LINKSENSE_USER_DATA_ROOT: z.string().min(1) }).parse(process.env);
  const outputRoot = z.string().min(1).parse(values["output-directory"]);
  if (values.apply && values.recover) throw new Error("MIGRATION_ARGUMENT_CONFLICT");
  if ((values.apply || values.recover) && !values["workers-stopped"]) throw new Error("MIGRATION_REQUIRES_STOPPED_WORKERS");
  if (values.apply) {
    const backup = await lstat(z.string().min(1).parse(values["database-backup"]));
    if (!backup.isFile() || backup.isSymbolicLink() || backup.size === 0) throw new Error("MIGRATION_DATABASE_BACKUP_REQUIRED");
  }
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    if (values.recover) {
      await recoverApplicationEnvironments(prisma, outputRoot);
      process.stdout.write(JSON.stringify({ recovered: true }) + "\n");
    } else {
      const result = await convertApplicationEnvironments({ prisma, userDataRoot: environment.LINKSENSE_USER_DATA_ROOT, outputRoot, apply: values.apply });
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  } finally { await prisma.$disconnect(); }
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^MIGRATION_[A-Z_]+$/.test(error.message) ? error.message : "MIGRATION_FAILED";
  process.stderr.write(JSON.stringify({ error_code: code }) + "\n");
  process.exitCode = 1;
});
