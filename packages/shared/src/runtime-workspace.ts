import { z } from "zod";

/** Paths relative to an execution user's HOME, shared by API and Worker. */
export const userWorkspacePathSchema = z.union([
  z.literal("workspace"),
  z.templateLiteral(["projects/", z.uuid()]),
]);

export function projectWorkspacePath(projectId: string | null): string {
  return projectId === null
    ? "workspace"
    : `projects/${z.uuid().parse(projectId).toLowerCase()}`;
}

export const runtimeWorkspaceHeader = "x-linksense-workspace";

/** A published application environment uses its application ID within the user's storage. */
export const runtimeServiceSessionHeader = "x-linksense-service-session";
/** Internal API authorization to reclaim an unreferenced service environment. */
export const runtimeCleanupEnvironmentHeader = "x-linksense-cleanup-environment";

export const runtimePlacementSchema = z.strictObject({
  workspacePath: userWorkspacePathSchema,
  serviceSessionId: z.uuid().optional(),
});
export type RuntimePlacement = z.infer<typeof runtimePlacementSchema>;

export function runtimeEnvironmentPath(ownerId: string, serviceSessionId?: string): string {
  const owner = z.uuid().parse(ownerId).toLowerCase();
  return serviceSessionId === undefined
    ? owner
    : `${owner}/services/${z.uuid().parse(serviceSessionId).toLowerCase()}`;
}
