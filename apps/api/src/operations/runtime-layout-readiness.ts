import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "../generated/prisma/client.js";

export async function assertRuntimeLayoutReady(prisma: PrismaClient, userDataRoot: string): Promise<void> {
  const marker = await lstat(join(userDataRoot, ".runtime-conversion.json")).catch(error => {
    if (error.code === "ENOENT") return null; throw error;
  });
  const [legacyTasks, pendingPublications] = await Promise.all([
    prisma.conversation.count({ where: { workspaceRelPath: { contains: "/home/workspaces/" } } }),
    prisma.applicationVersion.count({ where: { assetsReady: false } }),
  ]);
  if (marker || legacyTasks || pendingPublications) throw new Error("MIGRATION_PROJECT_RUNTIME_REQUIRED");
}
