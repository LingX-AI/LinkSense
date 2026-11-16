import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

import { baselineInputs, baselineFingerprint } from "../deploy/baselines/tools/baseline-images.mjs";
import { checkBaselineDockerDefaults } from "./baseline-adoption.mjs";
import { sourceFingerprint } from "./source-fingerprint.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const versionPath = "apps/runner/src/codex/runtime-version.json";
const versionSchema = z.strictObject({ version: z.string().regex(/^\d+\.\d+\.\d+$/u) });
const label = "com.linksense.development.codex";

export function checkDevelopmentBaseline(directory = repositoryRoot, readRecorded = (commit) =>
  execFileSync("git", ["show", `${commit}:${versionPath}`], { cwd: directory, encoding: "utf8", timeout: 10_000, maxBuffer: 4096 }),
) {
  const baseline = checkBaselineDockerDefaults(directory);
  const { version } = versionSchema.parse(JSON.parse(readFileSync(resolve(directory, versionPath), "utf8")));
  if (baseline.recipeFingerprint === baselineFingerprint(directory)) return { baseline, version, needsOverlay: false };

  // Only the Codex pin may differ in development. Verify all remaining recipe
  // bytes against the recorded baseline, using its exact source commit as proof.
  const recorded = readRecorded(baseline.sourceCommit);
  versionSchema.parse(JSON.parse(recorded));
  const snapshot = mkdtempSync(join(tmpdir(), "linksense-dev-baseline-"));
  try {
    for (const input of baselineInputs) cpSync(resolve(directory, input), resolve(snapshot, input), {
      recursive: true, filter: path => !path.split(/[\\/]/u).includes("node_modules"),
    });
    writeFileSync(resolve(snapshot, versionPath), recorded);
    if (baselineFingerprint(snapshot) !== baseline.recipeFingerprint) {
      throw new Error("Runtime or vendor recipes changed. Maintain and verify a new baseline before building application images.");
    }
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
  return { baseline, version, needsOverlay: true };
}

export function prepareDevelopmentCodexRuntime(environment, directory = repositoryRoot, { execute = execFileSync } = {}) {
  const state = checkDevelopmentBaseline(directory, commit => execute("git", ["show", `${commit}:${versionPath}`], {
    cwd: directory, encoding: "utf8", timeout: 10_000, maxBuffer: 4096,
  }));
  if (!state.needsOverlay) return { ...environment, BASELINE_WORKER_IMAGE: state.baseline.runtimes.worker };
  const registry = environment.LINKSENSE_NODE_PACKAGE_REGISTRY_URL || "https://registry.npmjs.org/";
  const fingerprint = createHash("sha256")
    .update(sourceFingerprint(directory, ["deploy/docker/Dockerfile.dev-codex", versionPath]))
    .update(state.baseline.runtimes.worker).update(registry).digest("hex");
  const image = `linksense-dev-codex:${fingerprint}`;
  let installed;
  try {
    installed = execute("docker", ["image", "inspect", "--format", `{{index .Config.Labels ${JSON.stringify(label)}}}`, image], {
      cwd: directory, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { installed = undefined; }
  if (installed !== fingerprint) {
    console.log(`[dev] Preparing local Codex ${state.version} runtime`);
    execute("docker", ["build", "--file", "deploy/docker/Dockerfile.dev-codex", "--tag", image,
      "--label", `${label}=${fingerprint}`,
      "--build-arg", `BASELINE_WORKER_IMAGE=${state.baseline.runtimes.worker}`,
      "--build-arg", `LINKSENSE_NODE_PACKAGE_REGISTRY_URL=${registry}`, "."], {
      cwd: directory, env: environment, stdio: "inherit", timeout: 20 * 60_000,
    });
  }
  return { ...environment, BASELINE_WORKER_IMAGE: image };
}
