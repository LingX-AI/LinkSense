import { join } from "node:path";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";

function artifactUuid(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR");
  return parsed.data.toLowerCase();
}

export const desktopArtifactStagingKey = (artifactId: string): string =>
  `desktop-artifact-staging/${artifactUuid(artifactId)}`;

export const desktopArtifactObjectKey = (conversationId: string, artifactId: string): string =>
  `conversations/${artifactUuid(conversationId)}/artifacts/${artifactUuid(artifactId)}/content`;

export const desktopArtifactScratchPath = (capabilityRoot: string, artifactId: string): string =>
  join(capabilityRoot, ".desktop-artifacts", artifactUuid(artifactId));
