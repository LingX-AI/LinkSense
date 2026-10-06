import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBaseline } from "../deploy/baselines/tools/baseline-images.mjs";

export const baselineDockerfiles = {
  "Dockerfile.api": ["node", "api"],
  "Dockerfile.web": ["node", "web"],
  "Dockerfile.runner": ["node", "worker"],
};

// The reviewed descriptor is authoritative. Docker defaults are a mechanically
// generated view so direct Docker/Compose source builds need no extra host tool.
export function baselineDockerfileDefaults(baseline, name, source) {
  if (!Object.hasOwn(baselineDockerfiles, name)) throw new Error("Unknown application Dockerfile");
  for (const runtime of baselineDockerfiles[name]) {
    const key = `BASELINE_${runtime.toUpperCase()}_IMAGE`;
    const expression = new RegExp(`^ARG ${key}(?:=[^\\n]*)?$`, "gmu");
    if ([...source.matchAll(expression)].length !== 1) throw new Error(`Expected one ${key} argument in ${name}`);
    source = source.replace(expression, `ARG ${key}=${baseline.runtimes[runtime]}`);
  }
  return source;
}

export function checkBaselineAdoption(directory = resolve(import.meta.dirname, "..")) {
  const baseline = readBaseline(resolve(directory, "deploy/baselines/images.lock.json"), directory);
  for (const name of Object.keys(baselineDockerfiles)) {
    const source = readFileSync(resolve(directory, name), "utf8");
    if (source !== baselineDockerfileDefaults(baseline, name, source)) throw new Error(`Adopt the verified baseline in ${name} before building`);
  }
  return baseline;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const directory = resolve(import.meta.dirname, "..");
  if (process.argv[2] === "--check") checkBaselineAdoption(directory);
  else if (process.argv[2] === "--write") {
    const baseline = readBaseline(resolve(directory, "deploy/baselines/images.lock.json"), directory);
    const changes = Object.keys(baselineDockerfiles).map(name => [name, baselineDockerfileDefaults(baseline, name, readFileSync(resolve(directory, name), "utf8"))]);
    for (const [name, source] of changes) writeFileSync(resolve(directory, name), source);
  } else throw new Error("Expected --check or --write");
}
