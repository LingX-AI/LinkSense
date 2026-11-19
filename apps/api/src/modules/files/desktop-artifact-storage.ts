import { join } from "node:path";
import { desktopArtifactMaxParts } from "@linksense/shared";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";

function artifactUuid(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR");
  return parsed.data.toLowerCase();
}

export const desktopArtifactStagingPrefix = "desktop-artifact-staging/";
export const desktopArtifactPartPrefix = "desktop-artifact-parts/";

export const desktopArtifactStagingKey = (artifactId: string): string =>
  `${desktopArtifactStagingPrefix}${artifactUuid(artifactId)}`;

export const desktopArtifactPartKey = (artifactId: string, index: number): string => {
  const parsed = z.number().int().min(0).max(desktopArtifactMaxParts - 1).safeParse(index);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR");
  return `${desktopArtifactPartPrefix}${artifactUuid(artifactId)}/${parsed.data}`;
};

export const desktopArtifactObjectKey = (conversationId: string, artifactId: string): string =>
  `conversations/${artifactUuid(conversationId)}/artifacts/${artifactUuid(artifactId)}/content`;

export const desktopArtifactScratchPath = (capabilityRoot: string, artifactId: string): string =>
  join(capabilityRoot, ".desktop-artifacts", artifactUuid(artifactId));
