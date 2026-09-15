import { join } from "node:path";
import { lstat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createPrismaClient } from "../db.js";
import { convertProjectRuntime, recoverProjectConversion } from "../operations/project-runtime-conversion.js";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    apply: { type: "boolean", default: false }, recover: { type: "boolean", default: false },
    "workers-stopped": { type: "boolean", default: false },
    "backup-directory": { type: "string" }, "database-backup": { type: "string" },
  } });
  const environment = z.object({ DATABASE_URL: z.string().min(1), LINKSENSE_USER_DATA_ROOT: z.string().min(1) }).parse(process.env);
  const backupRoot = z.string().min(1).parse(values["backup-directory"]);
  if ((values.apply || values.recover) && !values["workers-stopped"]) throw new Error("MIGRATION_REQUIRES_STOPPED_WORKERS");
  if (values.apply) {
    const backup = await lstat(z.string().min(1).parse(values["database-backup"]));
    if (!backup.isFile() || backup.isSymbolicLink() || backup.size === 0) throw new Error("MIGRATION_DATABASE_BACKUP_REQUIRED");
    if (process.platform === "linux" && process.geteuid?.() !== 0) throw new Error("MIGRATION_REQUIRES_ROOT");
  }
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    if (values.recover) {
      await recoverProjectConversion(prisma, backupRoot);
      process.stdout.write(JSON.stringify({ recovered: true }) + "\n");
    } else {
      const result = await convertProjectRuntime({ prisma, userDataRoot: environment.LINKSENSE_USER_DATA_ROOT,
        capabilityRoot: join(environment.LINKSENSE_USER_DATA_ROOT, ".capabilities"), backupRoot, apply: values.apply });
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  } finally { await prisma.$disconnect(); }
}
main().catch((error: unknown) => {
  const code = error instanceof Error && /^MIGRATION_[A-Z_]+$/.test(error.message) ? error.message : "MIGRATION_FAILED";
  process.stderr.write(JSON.stringify({ error_code: code }) + "\n"); process.exitCode = 1;
});
