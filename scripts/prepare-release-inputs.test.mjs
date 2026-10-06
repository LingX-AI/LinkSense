import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import test from "node:test"
import { baselineInputs, baselineFingerprint, runtimeNames, serviceNames, vendorComponents } from "../deploy/baselines/tools/baseline-images.mjs"
import { baselineDockerfileDefaults } from "./baseline-adoption.mjs"

const root = path.resolve(import.meta.dirname, "..")
function fixture(t) {
  const directory = mkdtempSync(
    path.join(tmpdir(), "linksense-release-inputs-"),
  )
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = path.join(directory, "source")
  const bin = path.join(directory, "bin")
  mkdirSync(path.join(source, "scripts"), { recursive: true })
  mkdirSync(bin)
  for (const file of [
    "prepare-release-inputs.sh",
    "resolve-release-image.sh",
    "bundle-release-installers.mjs",
    "baseline-adoption.mjs",
  ])
    cpSync(path.join(root, "scripts", file), path.join(source, "scripts", file))
  for (const input of baselineInputs) cpSync(path.join(root, input), path.join(source, input), { recursive: true, filter: file => !file.split(/[\\/]/u).includes("node_modules") })
  const require = createRequire(import.meta.url)
  cpSync(path.dirname(require.resolve("zod/package.json")), path.join(source, "node_modules/zod"), { recursive: true })
  const rawIndex = JSON.stringify({ schemaVersion: 2, manifests: ["amd64", "arm64"].map(architecture => ({ digest: "sha256:" + "a".repeat(64), platform: { os: "linux", architecture } })) })
  const indexHash = createHash("sha256").update(rawIndex).digest("hex")
  const reference = name => `ghcr.io/lingx-ai/linksense-${name}@sha256:${indexHash}`
  const baseline = { schemaVersion: 1, id: "baseline-123-1", recipeFingerprint: baselineFingerprint(source), sourceCommit: "b".repeat(40), workflowUrl: "https://github.com/LingX-AI/LinkSense/actions/runs/123", builtAt: "2026-10-06T00:00:00Z", runtimes: Object.fromEntries(runtimeNames.map(name => [name, reference(`runtime-${name}`)])), services: Object.fromEntries(serviceNames.map(name => [name, vendorComponents[name] ? reference(vendorComponents[name]) : `docker.io/${name === "MINIO" ? "pgsty/silo" : "library/busybox"}@sha256:${indexHash}`])) }
  writeFileSync(path.join(source, "deploy/baselines/images.lock.json"), JSON.stringify(baseline))
  for (const name of ["Dockerfile.api", "Dockerfile.web", "Dockerfile.runner"]) writeFileSync(path.join(source, name), baselineDockerfileDefaults(baseline, name, readFileSync(path.join(root, name), "utf8")))
  writeFileSync(path.join(bin, "gh"), `#!${process.execPath}
if (process.env.RELEASE_TEST_PROOF_FAILURE) process.exit(1);
process.stdout.write(JSON.stringify({id:123,run_attempt:1,head_sha:'b'.repeat(40),head_branch:'main',event:'workflow_dispatch',conclusion:'success',path:'.github/workflows/maintain-baselines.yml',repository:{full_name:'LingX-AI/LinkSense'}}));
`, { mode: 0o755 })
  cpSync(
    path.join(root, "deploy/release"),
    path.join(source, "deploy/release"),
    { recursive: true },
  )
  for (const file of ["LICENSE", "LICENSE-EXCEPTIONS.md", "ATTRIBUTION.md", "TRADEMARK.md", "NOTICE", "THIRD-PARTY-NOTICES.md"]) {
    cpSync(path.join(root, file), path.join(source, file))
  }
  const countFile = path.join(directory, "docker-count")
  writeFileSync(
    path.join(bin, "docker"),
    `#!${process.execPath}
const fs = require('node:fs');
const file = process.env.RELEASE_TEST_COUNT;
fs.appendFileSync(file + '.images', process.argv.at(-1) + '\\n');
const count = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) + 1 : 1;
fs.writeFileSync(file, String(count));
if (count <= Number(process.env.RELEASE_TEST_FAILURES || 0)) process.exit(1);
const platforms = process.env.RELEASE_TEST_MISSING_ARM ? ['amd64'] : ['amd64', 'arm64'];
process.stdout.write(JSON.stringify({schemaVersion:2, manifests:platforms.map(architecture=>({digest:'sha256:'+'a'.repeat(64), platform:{os:'linux',architecture}}))}));
`,
    { mode: 0o755 },
  )
  writeFileSync(
    path.join(bin, "curl"),
    `#!${process.execPath}
if(process.env.RELEASE_TEST_CURL_FAILURE) process.exit(22);
require('node:fs').writeFileSync(process.argv[process.argv.indexOf('-o')+1], 'locked tokenizer fixture');
`,
    { mode: 0o755 },
  )
  writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  })
  const output = path.join(directory, "inputs")
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RELEASE_TEST_COUNT: countFile,
    RELEASE_VERSION: "v0.2.3",
    SOURCE_SHA: "a".repeat(40),
    RELEASE_WORKFLOW_ID:
      "https://github.com/example/linksense/actions/runs/123",
  }
  const prepare = () =>
    spawnSync(
      "sh",
      [path.join(source, "scripts/prepare-release-inputs.sh"), output],
      { env, encoding: "utf8" },
    )
  const resolve = () =>
    spawnSync(
      "sh",
      [
        path.join(source, "scripts/resolve-release-image.sh"),
        "registry.example/image:test",
        "linux/amd64",
        "linux/arm64",
      ],
      { env, encoding: "utf8" },
    )
  return { source, output, env, countFile, prepare, resolve }
}

test("preparation reuses verified immutable baselines and freezes tokenizer bytes, entry scripts and identity", (t) => {
  const { output, countFile, prepare } = fixture(t)
  const source = readFileSync(
    path.join(root, "scripts/prepare-release-inputs.sh"),
    "utf8",
  )
  assert.doesNotMatch(source, /(?:quay\.io|docker\.io)\/minio\//u)
  const result = prepare()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(Number(readFileSync(countFile, "utf8")), 12)
  const requestedImages = readFileSync(`${countFile}.images`, "utf8")
    .trim()
    .split("\n")
  assert.ok(requestedImages.every(reference => reference.includes("@sha256:")))
  assert.ok(requestedImages.some(reference => reference.startsWith("ghcr.io/lingx-ai/linksense-runtime-worker@sha256:")))
  const images = readFileSync(path.join(output, "upstream-images.env"), "utf8")
    .trim()
    .split("\n")
  assert.equal(images.length, 8)
  for (const name of ["MINIO"]) {
    assert.ok(images.some((line) =>
      line.startsWith(`IMAGE_${name}=docker.io/pgsty/silo@sha256:`),
    ))
  }
  assert.ok(images.some(line => line.startsWith("IMAGE_MINIO_CLIENT=ghcr.io/lingx-ai/linksense-minio-client@sha256:")))
  assert.equal(readFileSync(path.join(output, "runtime-images.env"), "utf8").trim().split("\n").length, 4)
  assert.ok(existsSync(path.join(output, "images.lock.json")))
  assert.ok(
    images.every((line) =>
      /^IMAGE_[A-Z_]+=[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u.test(line),
    ),
  )
  assert.match(
    readFileSync(path.join(output, "release-assets/install-full.sh"), "utf8"),
    /LINKSENSE_VERSION:-v0\.2\.3/u,
  )
  assert.match(
    readFileSync(path.join(output, "identity.env"), "utf8"),
    /RELEASE_BUILD_TIME=/u,
  )
  for (const file of ["LICENSE", "LICENSE-EXCEPTIONS.md", "ATTRIBUTION.md", "TRADEMARK.md", "NOTICE", "THIRD-PARTY-NOTICES.md"]) {
    assert.equal(
      readFileSync(path.join(output, "release-assets", file), "utf8"),
      readFileSync(path.join(root, file), "utf8"),
    )
  }
  const verified = spawnSync("sha256sum", ["-c", "SHA256SUMS"], {
    cwd: output,
    encoding: "utf8",
  })
  assert.equal(verified.status, 0, verified.stderr)
  writeFileSync(path.join(output, "tokenizer/tokenizer.json"), "changed")
  assert.notEqual(
    spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: output }).status,
    0,
  )
})

test("missing upstream architecture fails before publishing any frozen identity", (t) => {
  const { output, env, countFile, prepare } = fixture(t)
  env.RELEASE_TEST_MISSING_ARM = "1"
  const result = prepare()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /exactly one linux\/arm64/u)
  assert.equal(Number(readFileSync(countFile, "utf8")), 1)
  assert.equal(existsSync(path.join(output, "identity.env")), false)
  assert.equal(existsSync(path.join(output, "SHA256SUMS")), false)
})

test("an unsuccessful maintenance proof or changed runtime recipe blocks all release image operations", (t) => {
  for (const changedRecipe of [false, true]) {
    const { source, output, env, countFile, prepare } = fixture(t)
    if (changedRecipe) writeFileSync(path.join(source, "deploy/runtime/node/package.json"), "changed environment")
    else env.RELEASE_TEST_PROOF_FAILURE = "1"
    assert.notEqual(prepare().status, 0)
    assert.equal(existsSync(countFile), false)
    assert.equal(existsSync(path.join(output, "identity.env")), false)
  }
})

test("a tokenizer download failure stops preflight before it records trusted inputs", (t) => {
  const { output, env, prepare } = fixture(t)
  env.RELEASE_TEST_CURL_FAILURE = "1"
  assert.notEqual(prepare().status, 0)
  assert.equal(existsSync(path.join(output, "SHA256SUMS")), false)
})

test("unsafe tokenizer filenames fail without a download", (t) => {
  const { source, prepare } = fixture(t)
  const lock = path.join(source, "deploy/release/tokenizer.lock.json")
  const data = JSON.parse(readFileSync(lock, "utf8"))
  data.files = ["../outside"]
  writeFileSync(lock, JSON.stringify(data))
  assert.notEqual(prepare().status, 0)
})

test("registry reads recover after two failures and stop after three failed attempts", (t) => {
  const { env, countFile, resolve } = fixture(t)
  env.RELEASE_TEST_FAILURES = "2"
  const recovered = resolve()
  assert.equal(recovered.status, 0, recovered.stderr)
  assert.equal(Number(readFileSync(countFile, "utf8")), 3)
  writeFileSync(countFile, "0")
  env.RELEASE_TEST_FAILURES = "10"
  const failed = resolve()
  assert.notEqual(failed.status, 0)
  assert.equal(failed.stdout, "")
  assert.equal(Number(readFileSync(countFile, "utf8")), 3)
})
