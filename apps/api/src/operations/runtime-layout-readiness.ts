import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "../generated/prisma/client.js";

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
}
