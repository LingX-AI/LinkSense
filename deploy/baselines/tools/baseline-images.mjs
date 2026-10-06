import { z } from "zod";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { sourceFingerprint } from "../../../scripts/source-fingerprint.mjs";

export const runtimeNames = ["node", "api", "web", "worker"];
export const serviceNames = ["POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY", "ELASTICSEARCH", "DOCLING"];
export const vendorComponents = { POSTGRES: "postgres", REDIS: "redis", MINIO_CLIENT: "minio-client", GATEWAY: "gateway", ELASTICSEARCH: "elasticsearch", DOCLING: "docling" };
export const baselineBuildNames = [...runtimeNames.map(name => `runtime-${name}`), ...Object.values(vendorComponents)];
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);
const reference = z.string().max(512).regex(/^[a-z0-9./-]+@sha256:[a-f0-9]{64}$/u);
const exactObject = (keys, value) => z.object(Object.fromEntries(keys.map(key => [key, value(key)]))).strict();
const runtimeReferences = exactObject(runtimeNames, name => z.string().regex(new RegExp(`^ghcr\\.io/lingx-ai/linksense-runtime-${name}@sha256:[a-f0-9]{64}$`, "u")));
const serviceReferences = exactObject(serviceNames, () => reference);
export const baselineSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^baseline-\d+-\d+$/u),
  recipeFingerprint: hash,
  sourceCommit: commit,
  workflowUrl: z.string().regex(/^https:\/\/github\.com\/LingX-AI\/LinkSense\/actions\/runs\/\d+$/u),
  builtAt: z.iso.datetime(),
  runtimes: runtimeReferences,
  services: serviceReferences,
}).strict();

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const baselineInputs = [
  "deploy/baselines/Dockerfile.runtime", "deploy/baselines/upstream-images.json", "deploy/baselines/tools",
  "deploy/hardened", "deploy/docker/bootstrap-ubuntu-node.sh", "deploy/docker/patch-tooling-libraries.mjs",
  "deploy/docker/verify-tooling-libraries.mjs", "deploy/docker/verify-kernel-headers.mjs",
  "deploy/runtime", "apps/runner/src/codex/runtime-version.json", "scripts/patch-elasticsearch-jars.py",
  "scripts/source-fingerprint.mjs", "scripts/resolve-release-image.sh", ".dockerignore",
  "LICENSE", "LICENSE-EXCEPTIONS.md", "ATTRIBUTION.md", "TRADEMARK.md", "NOTICE",
];
export function baselineFingerprint(directory = root) {
  return sourceFingerprint(directory, baselineInputs);
}
export function readBaseline(file, directory = root, checkRecipe = true) {
  const baseline = baselineSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const [, runId] = /^baseline-(\d+)-\d+$/u.exec(baseline.id);
  if (!baseline.workflowUrl.endsWith(`/runs/${runId}`)) throw new Error("Baseline identity does not match its maintenance run");
  if (checkRecipe && baseline.recipeFingerprint !== baselineFingerprint(directory)) {
    throw new Error("Runtime or vendor recipes changed. Maintain and verify a new baseline before building application images.");
  }
  for (const [role, name] of Object.entries(vendorComponents)) {
    if (!baseline.services[role].startsWith(`ghcr.io/lingx-ai/linksense-${name}@sha256:`)) throw new Error(`Unverified vendor baseline for ${role}`);
  }
  for (const [role, repository] of Object.entries({ MINIO: "docker.io/pgsty/silo", BUSYBOX: "docker.io/library/busybox" })) {
    if (!baseline.services[role].startsWith(`${repository}@sha256:`)) throw new Error(`Unexpected external baseline for ${role}`);
  }
  return baseline;
}
export function validateMaintenanceProof(baseline, value) {
  const run = z.object({ id: z.number().int(), run_attempt: z.number().int(), head_sha: commit, head_branch: z.literal("main"), event: z.literal("workflow_dispatch"), conclusion: z.literal("success"), path: z.literal(".github/workflows/maintain-baselines.yml"), repository: z.object({ full_name: z.literal("LingX-AI/LinkSense") }) }).parse(value);
  const [, id, attempt] = /^baseline-(\d+)-(\d+)$/u.exec(baseline.id);
  if (String(run.id) !== id || run.run_attempt < Number(attempt) || run.head_sha !== baseline.sourceCommit) throw new Error("Baseline maintenance proof does not match the frozen source and identity");
  return run;
}
export function parseServiceEnvironment(contents) {
  const entries = contents.trim().split("\n").map(line => {
    const match = /^IMAGE_([A-Z_]+)=(.+)$/u.exec(line);
    if (!match) throw new Error("Invalid frozen source");
    return [match[1], match[2]];
  });
  if (entries.length !== serviceNames.length || new Set(entries.map(([name]) => name)).size !== entries.length) throw new Error("Frozen sources must contain every service exactly once");
  return serviceReferences.parse(Object.fromEntries(entries));
}
export function serviceEnvironment(baseline) {
  return serviceNames.map(name => `IMAGE_${name}=${baseline.services[name]}`).join("\n") + "\n";
}
export function runtimeEnvironment(baseline) {
  return runtimeNames.map(name => `BASELINE_${name.toUpperCase()}_IMAGE=${baseline.runtimes[name]}`).join("\n") + "\n";
}
export function writeScanInputs(baseline, directory) {
  mkdirSync(join(directory, "image-references"), { recursive: true });
  mkdirSync(join(directory, "release-inputs"), { recursive: true });
  const applications = { api: "api", web: "web", migrate: "node", runner: "node", worker: "worker" };
  for (const [name, runtime] of Object.entries(applications)) writeFileSync(join(directory, "image-references", name), baseline.runtimes[runtime] + "\n");
  writeFileSync(join(directory, "release-inputs/upstream-images.env"), serviceEnvironment(baseline));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "fingerprint") console.log(baselineFingerprint(args[0]));
  else if (command === "names") console.log(baselineBuildNames.join(" "));
  else if (command === "verify") readBaseline(args[0], args[1]);
  else if (command === "verify-proof") {
    const baseline = readBaseline(args[0], args[1]);
    const runId = baseline.id.split("-")[1];
    validateMaintenanceProof(baseline, JSON.parse(execFileSync("gh", ["api", `repos/LingX-AI/LinkSense/actions/runs/${runId}`], { encoding: "utf8", timeout: 120_000 })));
  }
  else if (command === "runtime-env") process.stdout.write(runtimeEnvironment(readBaseline(args[0], args[1])));
  else if (command === "service-env") process.stdout.write(serviceEnvironment(readBaseline(args[0], args[1])));
  else if (command === "scan-inputs") writeScanInputs(readBaseline(args[0], root, false), args[1]);
  else if (command === "freeze") {
    const tags = exactObject(serviceNames, () => z.string().max(512).regex(/^[a-zA-Z0-9./:_-]+$/u)).parse(JSON.parse(readFileSync(join(root, "deploy/baselines/upstream-images.json"), "utf8")));
    mkdirSync(args[0], { recursive: true });
    const lines = serviceNames.map(name => {
      const frozen = execFileSync("sh", [join(root, "scripts/resolve-release-image.sh"), tags[name], "linux/amd64", "linux/arm64"], { encoding: "utf8", timeout: 180_000 }).trim();
      return `IMAGE_${name}=${reference.parse(frozen)}`;
    });
    writeFileSync(join(args[0], "upstream-images.env"), lines.join("\n") + "\n");
  } else if (command === "assemble") {
    const [images, frozenFile, output] = args;
    const frozen = parseServiceEnvironment(readFileSync(frozenFile, "utf8"));
    const baseline = baselineSchema.parse({ schemaVersion: 1, id: process.env.BASELINE_ID, recipeFingerprint: baselineFingerprint(), sourceCommit: process.env.GITHUB_SHA, workflowUrl: process.env.BASELINE_WORKFLOW_URL, builtAt: process.env.BASELINE_BUILD_TIME,
      runtimes: Object.fromEntries(runtimeNames.map(name => [name, readFileSync(join(images, `runtime-${name}`), "utf8").trim()])),
      services: Object.fromEntries(serviceNames.map(name => [name, name in vendorComponents ? readFileSync(join(images, vendorComponents[name]), "utf8").trim() : frozen[name]])),
    });
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "images.lock.json"), JSON.stringify(baseline, null, 2) + "\n");
    writeScanInputs(baseline, output);
  } else throw new Error("Unknown baseline command");
}
