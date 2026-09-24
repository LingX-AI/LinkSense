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
import test from "node:test"

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
  ])
    cpSync(path.join(root, "scripts", file), path.join(source, "scripts", file))
  cpSync(
    path.join(root, "deploy/release"),
    path.join(source, "deploy/release"),
    { recursive: true },
  )
  cpSync(path.join(root, "LICENSE"), path.join(source, "LICENSE"))
  const countFile = path.join(directory, "docker-count")
  writeFileSync(
    path.join(bin, "docker"),
    `#!${process.execPath}
const fs = require('node:fs');
const file = process.env.RELEASE_TEST_COUNT;
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

test("preparation freezes all upstream digests, tokenizer bytes, entry scripts and identity", (t) => {
  const { output, countFile, prepare } = fixture(t)
  const source = readFileSync(
    path.join(root, "scripts/prepare-release-inputs.sh"),
    "utf8",
  )
  assert.match(
    source,
    /resolve MINIO_CLIENT quay\.io\/minio\/mc:RELEASE\.2025-08-13T08-35-41Z/u,
  )
  assert.doesNotMatch(source, /resolve MINIO_CLIENT docker\.io\/minio\/mc:/u)
  const result = prepare()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(Number(readFileSync(countFile, "utf8")), 8)
  const images = readFileSync(path.join(output, "upstream-images.env"), "utf8")
    .trim()
    .split("\n")
  assert.equal(images.length, 8)
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
  assert.equal(existsSync(path.join(output, "upstream-images.env")), false)
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
