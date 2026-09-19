import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

export const developmentOwnerLabel = "com.linksense.development.owner";
export const developmentRoleLabel = "com.linksense.development.role";
const roles = ["dependencies", "docs", "migrate", "worker"];
const ownerSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const imageIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const imageSchema = z.object({
  Id: imageIdSchema,
  Created: z.iso.datetime({ offset: true }),
  RepoTags: z.array(z.string()).nullable(),
  Config: z.object({ Labels: z.record(z.string(), z.string()).nullable() }),
});

const hasExplicitTag = (image) => (image.RepoTags ?? []).some((tag) => tag !== "<none>:<none>");

export function developmentResourceOwner(root, environmentFile) {
  return createHash("sha256").update(JSON.stringify([resolve(root), resolve(environmentFile)])).digest("hex");
}

export function developmentImageNames(environment) {
  const tag = environment.LINKSENSE_DEV_IMAGE_TAG?.trim() || "local";
  return [`linksense-api-dev:${tag}`, `linksense-runner-controller-dev:${tag}`, `linksense-web-dev:${tag}`];
}

export function developmentImageGroups(environment) {
  const tag = environment.LINKSENSE_DEV_IMAGE_TAG?.trim() || "local";
  return [
    { role: "dependencies", services: ["api", "runner", "web"], images: developmentImageNames(environment), label: "com.linksense.development.fingerprint", fingerprint: environment.LINKSENSE_DEV_IMAGE_FINGERPRINT },
    { role: "docs", services: ["docs"], images: [`linksense-docs-dev:${tag}`], label: "com.linksense.docs.fingerprint", fingerprint: environment.LINKSENSE_DOCS_IMAGE_FINGERPRINT },
    { role: "migrate", services: ["migrate"], images: [`linksense-migrate:${environment.LINKSENSE_IMAGE_TAG?.trim() || "local"}`], label: "com.linksense.migration.fingerprint", fingerprint: environment.LINKSENSE_MIGRATION_IMAGE_FINGERPRINT },
    { role: "worker", services: ["runner-worker-image"], images: [environment.LINKSENSE_WORKER_IMAGE?.trim() || "linksense-runner-worker:local"], label: "com.linksense.worker.fingerprint", fingerprint: environment.LINKSENSE_WORKER_IMAGE_FINGERPRINT },
  ];
}

// Both startup and Watch use the same grouping and label comparisons.
export function planDevelopmentImageBuilds(environment, services, imageLabel, force = false) {
  const owner = ownerSchema.parse(environment.LINKSENSE_DEV_RESOURCE_OWNER);
  const groups = developmentImageGroups(environment);
  for (const service of services) {
    if (!groups.some((group) => group.services.includes(service))) throw new Error(`Unknown development image service: ${service}`);
  }
  return groups.filter((group) => group.services.some((service) => services.includes(service))).map((group) => {
    z.string().min(1).parse(group.fingerprint);
    return { ...group, needsBuild: force || group.images.some((image) =>
      imageLabel(image, group.label) !== group.fingerprint ||
      imageLabel(image, developmentOwnerLabel) !== owner ||
      imageLabel(image, developmentRoleLabel) !== group.role,
    ) };
  });
}

export async function buildDevelopmentImageGroups(groups, build) {
  for (const group of groups) {
    if (group.needsBuild) await build(group.services);
  }
  // Even a cached image may not yet be running after a previous failed update.
  return groups.flatMap((group) => group.services);
}

export function planDevelopmentImageCleanup({ owner, images, usedImageIds, currentImageIds }) {
  ownerSchema.parse(owner);
  const protectedIds = new Set(z.array(imageIdSchema).parse([...usedImageIds, ...currentImageIds]));
  const candidates = z.array(imageSchema).parse(images).filter((image) =>
    image.Config.Labels?.[developmentOwnerLabel] === owner &&
    roles.includes(image.Config.Labels?.[developmentRoleLabel]) &&
    !protectedIds.has(image.Id) &&
    // Explicit tags may belong to a user's saved version or another checkout.
    !hasExplicitTag(image),
  );
  return roles.flatMap((role) => candidates
    .filter((image) => image.Config.Labels[developmentRoleLabel] === role)
    .sort((left, right) => right.Created.localeCompare(left.Created) || left.Id.localeCompare(right.Id))
    .slice(1) // Retain the newest unused previous image in each group.
    .map((image) => image.Id));
}

const executeDocker = async (args) => (await promisify(execFile)("docker", args, {
  timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
})).stdout;

export async function cleanupDevelopmentImages(environment, { execute = executeDocker, dryRun = false } = {}) {
  const owner = ownerSchema.parse(environment.LINKSENSE_DEV_RESOURCE_OWNER);
  const ids = [...new Set((await execute(["image", "ls", "--all", "--quiet", "--no-trunc", "--filter", `label=${developmentOwnerLabel}=${owner}`])).trim().split(/\s+/u).filter(Boolean))];
  if (!ids.length) return { candidates: [], removed: [], failed: [] };
  z.array(imageIdSchema).parse(ids);
  const images = z.array(imageSchema).parse(JSON.parse(await execute(["image", "inspect", ...ids])));
  const containers = (await execute(["container", "ls", "--all", "--quiet", "--no-trunc"])).trim().split(/\s+/u).filter(Boolean);
  z.array(z.string().regex(/^[a-f0-9]{64}$/u)).parse(containers);
  const usedImageIds = containers.length
    ? (await execute(["container", "inspect", "--format", "{{.Image}}", ...containers])).trim().split(/\s+/u).filter(Boolean)
    : [];
  const currentImageIds = [];
  for (const image of developmentImageGroups(environment).flatMap((group) => group.images)) {
    // Missing current images stop cleanup: never infer safety from an incomplete inventory.
    currentImageIds.push((await execute(["image", "inspect", "--format", "{{.Id}}", image])).trim());
  }
  const candidates = planDevelopmentImageCleanup({ owner, images, usedImageIds, currentImageIds });
  const removed = [], failed = [];
  if (!dryRun) {
    for (const id of candidates) {
      try {
        const [current] = z.array(imageSchema).length(1).parse(JSON.parse(await execute(["image", "inspect", id])));
        if (current.Id !== id || current.Config.Labels?.[developmentOwnerLabel] !== owner ||
            !roles.includes(current.Config.Labels?.[developmentRoleLabel]) || hasExplicitTag(current)) {
          failed.push(id);
          continue;
        }
        // No --force: Docker protects a container created after our snapshot.
        await execute(["image", "rm", id]);
        removed.push(id);
      } catch { failed.push(id); }
    }
  }
  return { candidates, removed, failed };
}

export async function reportDevelopmentImageCleanup(environment) {
  try {
    const { removed, failed } = await cleanupDevelopmentImages(environment);
    if (removed.length) console.log(`[dev] removed ${removed.length} unused previous development images`);
    if (failed.length) console.warn(`[dev] retained ${failed.length} images that Docker could not safely remove`);
  } catch {
    console.warn("[dev] image retention skipped: unable to verify the complete Docker resource inventory");
  }
}
