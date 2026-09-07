import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const preparationSchema = z.object({ storageFingerprint: z.string(), configuration: z.string() });

export function storageFingerprint(directory) {
  try {
    const stat = statSync(directory);
    if (!stat.isDirectory()) return null;
    return createHash("sha256").update(JSON.stringify([
      resolve(directory), stat.dev, stat.ino, stat.uid, stat.gid, stat.mode,
    ])).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function preparationStatePath(rootDirectory, environmentFile, environment) {
  const key = createHash("sha256").update(JSON.stringify([
    resolve(environmentFile), environment.COMPOSE_PROJECT_NAME || "linksense",
    environment.DOCKER_HOST || "", environment.DOCKER_CONTEXT || "",
  ])).digest("hex").slice(0, 20);
  return resolve(rootDirectory, `.data/dev/preparation-${key}.json`);
}

export function storageNeedsInitialization(statePath, directory, configuration) {
  const current = storageFingerprint(directory);
  if (!current) return true;
  try {
    const state = preparationSchema.safeParse(JSON.parse(readFileSync(statePath, "utf8")));
    return !state.success || state.data.storageFingerprint !== current || state.data.configuration !== configuration;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return true;
    throw error;
  }
}

export function recordStoragePreparation(statePath, directory, configuration) {
  const fingerprint = storageFingerprint(directory);
  if (!fingerprint) throw new Error("Development storage initialization did not create its directory");
  mkdirSync(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(preparationSchema.parse({ storageFingerprint: fingerprint, configuration })), { mode: 0o600 });
  renameSync(temporary, statePath);
}
