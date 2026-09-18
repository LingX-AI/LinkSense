import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";

export const applicationEnvironmentConversionMarker = ".application-environment-conversion.json";

export async function assertRuntimeLayoutReady(prisma: PrismaClient, userDataRoot: string): Promise<void> {
  const applicationConversion = await lstat(join(userDataRoot, applicationEnvironmentConversionMarker)).catch(error => {
    if (error.code === "ENOENT") return null; throw error;
  });
  if (applicationConversion) throw new Error("MIGRATION_APPLICATION_ENVIRONMENT_REQUIRED");
  const marker = await lstat(join(userDataRoot, ".runtime-conversion.json")).catch(error => {
    if (error.code === "ENOENT") return null; throw error;
  });
  const [legacyTasks, pendingPublications] = await Promise.all([
    prisma.conversation.count({ where: { workspaceRelPath: { contains: "/home/workspaces/" } } }),
    prisma.applicationVersion.count({ where: { assetsReady: false } }),
  ]);
  if (marker || legacyTasks || pendingPublications) throw new Error("MIGRATION_PROJECT_RUNTIME_REQUIRED");
  const pending = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT c.id FROM conversations c WHERE c.application_id IS NOT NULL
      AND c.workspace_rel_path <> c.owner_id::text || '/services/' || c.application_id::text || '/home/workspace'
    UNION ALL
    SELECT a.id FROM applications a
      JOIN _prisma_migrations m ON m.migration_name = '20260918130000_application_runtime_installations'
        AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
      LEFT JOIN application_runtime_installations i ON i.owner_id = a.owner_id AND i.application_id = a.id
      WHERE a.created_at <= m.finished_at AND a.status <> 'deleted' AND a.development_only = false
        AND (i.version_id IS NULL OR i.updated_at < m.finished_at)
    UNION ALL
    SELECT c.id FROM conversations c JOIN applications a ON a.id = c.application_id AND a.status <> 'deleted'
      LEFT JOIN application_runtime_installations i ON i.owner_id = c.owner_id AND i.application_id = c.application_id
      WHERE i.version_id IS NULL AND (a.development_only = false OR EXISTS (SELECT 1 FROM conversation_turns t WHERE t.conversation_id = c.id))
    LIMIT 1
  `);
  if (pending.length) throw new Error("MIGRATION_APPLICATION_ENVIRONMENT_REQUIRED");
}
