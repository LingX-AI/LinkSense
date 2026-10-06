import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const script = path.join(root, "scripts/scan-release-images.sh")
const ownImages = ["api", "web", "migrate", "runner", "worker"]
const upstreamImages = ["POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY", "ELASTICSEARCH", "DOCLING"]
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`

function fixture(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "linksense-image-security-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const images = path.join(directory, "images")
  const inputs = path.join(directory, "inputs")
  const bin = path.join(directory, "bin")
  for (const child of [images, inputs, bin]) mkdirSync(child)
  const manifests = ["amd64", "arm64"].filter((arch) => arch !== options.missingArchitecture)
    .map((architecture) => ({ digest: digest(architecture), platform: { os: "linux", architecture } }))
  if (options.duplicateArchitecture) manifests.push(manifests.find((entry) => entry.platform.architecture === options.duplicateArchitecture))
  const index = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests })
  const indexDigest = digest(index)
  writeFileSync(path.join(directory, "index.json"), index)
  for (const name of ownImages) writeFileSync(path.join(images, name), `ghcr.io/lingx-ai/linksense-${name}@${indexDigest}\n`)
  writeFileSync(path.join(inputs, "upstream-images.env"), upstreamImages.map((name) => `IMAGE_${name}=registry.example/${name.toLowerCase().replaceAll("_", "-")}@${indexDigest}`).join("\n") + "\n")
  const calls = path.join(directory, "calls.jsonl")
  const timeoutCalls = path.join(directory, "timeouts.log")
  const mock = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const command = path.basename(process.argv[1]);
const mode = process.env.IMAGE_TEST_MODE;
fs.appendFileSync(process.env.IMAGE_TEST_CALLS, JSON.stringify({command,args,trivyEnvironment:Object.keys(process.env).filter(k=>k.startsWith('TRIVY_'))})+'\\n');
if(command==='docker') {
  if(mode==='registry-failure') { process.stderr.write('registry unavailable'); process.exit(1); }
  process.stdout.write(fs.readFileSync(process.env.IMAGE_TEST_INDEX));
} else if(args.includes('--version')) {
  process.stdout.write('Version: '+(mode==='wrong-version'?'0.68.2':'0.75.0')+'\\n');
} else if(args.includes('--download-db-only') || args.includes('--download-java-db-only')) {
  const java = args.includes('--download-java-db-only');
  if(mode==='db-failure' || (java && mode==='java-db-failure')) { process.stderr.write('database unavailable'); process.exit(1); }
  const cache = args[args.indexOf('--cache-dir')+1];
  const db = path.join(cache,java?'java-db':'db');
  fs.mkdirSync(db,{recursive:true});
  fs.writeFileSync(path.join(db,'metadata.json'),JSON.stringify({Version:java?1:2,UpdatedAt:'2026-10-05T00:00:00Z',NextUpdate:'2026-10-06T00:00:00Z'}));
} else {
  const reference=args.at(-1);
  const platform=args[args.indexOf('--platform')+1];
  const output=args[args.indexOf('--output')+1];
  if(mode==='scan-failure') { process.stderr.write('layer download failed'); process.exit(1); }
  if(mode==='missing-report') process.exit(0);
  if(mode==='invalid-report') { fs.writeFileSync(output,'not json'); process.exit(0); }
  const severity = mode==='critical'?'CRITICAL':mode==='high' || mode==='silent-high'?'HIGH':mode==='medium'?'MEDIUM':undefined;
  const report={SchemaVersion:2,Trivy:{Version:'0.75.0'},ArtifactName:mode==='wrong-image'?'registry.example/other@sha256:'+'a'.repeat(64):reference,ArtifactType:'container_image',Metadata:{ImageConfig:{os:'linux',architecture:mode==='wrong-platform'?'ppc64le':platform.split('/')[1]}},Results:[{Target:'fixture',Class:'os-pkgs',Type:'alpine',...(severity?{Vulnerabilities:[{VulnerabilityID:'CVE-fixture',Severity:severity,PkgName:'fixture',InstalledVersion:'1',FixedVersion:''}]}:{})}]};
  fs.writeFileSync(output,JSON.stringify(report));
  if(mode==='high'||mode==='critical') process.exit(1);
  if(mode==='exit-failure') process.exit(2);
}
`
  for (const command of ["docker", "trivy"]) writeFileSync(path.join(bin, command), mock, { mode: 0o755 })
  writeFileSync(path.join(bin, "timeout"), '#!/bin/sh\nprintf "%s %s\\n" "$1" "$2" >> "$IMAGE_TEST_TIMEOUTS"\ncase "$1" in --kill-after=*) shift ;; esac\nshift\nexec "$@"\n', { mode: 0o755 })
  const report = path.join(directory, "reports")
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, IMAGE_TEST_CALLS: calls, IMAGE_TEST_TIMEOUTS: timeoutCalls, IMAGE_TEST_INDEX: path.join(directory, "index.json"), IMAGE_TEST_MODE: options.mode ?? "clean" }
  const scan = (platform = "linux/amd64") => spawnSync("sh", [script, images, inputs, report, platform], { env, encoding: "utf8", timeout: 20_000 })
  const commands = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse) : []
  const timeouts = () => existsSync(timeoutCalls) ? readFileSync(timeoutCalls, "utf8").trim().split("\n") : []
  return { directory, images, inputs, report, indexDigest, env, scan, commands, timeouts }
}

test("all external operations have a forced termination deadline when SIGTERM is ignored", (t) => {
  const { scan, timeouts } = fixture(t)
  const result = scan()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(timeouts().length, 29)
  assert.ok(timeouts().every((entry) => entry.startsWith("--kill-after=30s ")))
  assert.deepEqual(timeouts().map((entry) => entry.split(" ")[1]), ["30", "360", "360", ...Array.from({ length: 13 }, () => ["120", "960"]).flat()])
})

for (const platform of ["linux/amd64", "linux/arm64"]) {
  test(`clean release scans all owned and upstream roles at the actual ${platform} manifest digest`, (t) => {
    const context = fixture(t)
    const result = context.scan(platform)
    assert.equal(result.status, 0, result.stderr)
    const scans = context.commands().filter(({ command, args }) => command === "trivy" && args.includes("--output"))
    assert.equal(scans.length, 13)
    assert.equal(new Set(scans.map(({ args }) => args.at(-1).split("@")[0])).size, 13)
    for (const { args } of scans) {
      assert.ok(args.at(-1).endsWith(`@${digest(platform.split("/")[1])}`))
      assert.equal(args[args.indexOf("--platform") + 1], platform)
      assert.equal(args[args.indexOf("--image-src") + 1], "remote")
      assert.equal(args[args.indexOf("--severity") + 1], "HIGH,CRITICAL")
      assert.equal(args[args.indexOf("--exit-code") + 1], "1")
      assert.equal(args[args.indexOf("--scanners") + 1], "vuln")
      assert.ok(args.includes("--ignore-unfixed=false"))
      assert.equal(args[args.indexOf("--ignorefile") + 1], "")
      assert.ok(args.includes("--skip-db-update"))
      assert.ok(args.includes("--skip-java-db-update"))
    }
    const summary = JSON.parse(readFileSync(path.join(context.report, "summary.json"), "utf8"))
    assert.equal(summary.status, "passed")
    assert.equal(summary.images.length, 13)
    const manifestGenerator = readFileSync(path.join(root, "scripts/generate-release-manifest.mjs"), "utf8")
    const manifestImageKeys = [...manifestGenerator.match(/const imageKeys = \[([\s\S]*?)\]/u)[1].matchAll(/"([A-Z_]+)"/gu)].map((match) => match[1])
    assert.deepEqual(summary.images.map(({ role }) => role).sort(), manifestImageKeys.sort())
    assert.ok(summary.images.every(({ indexReference, manifestReference, status }) => indexReference.endsWith(context.indexDigest) && manifestReference.endsWith(digest(platform.split("/")[1])) && status === "passed"))
    assert.ok(existsSync(path.join(context.report, "vulnerability-db.json")))
    assert.ok(existsSync(path.join(context.report, "java-db.json")))
  })
}

for (const mode of ["high", "critical", "silent-high"]) {
  test(`${mode} findings including vulnerabilities without a fix block promotion and retain all reports`, (t) => {
    const { scan, report, commands } = fixture(t, { mode })
    assert.notEqual(scan().status, 0)
    const summary = JSON.parse(readFileSync(path.join(report, "summary.json"), "utf8"))
    assert.equal(summary.status, "failed")
    assert.ok(summary.images.every(({ status }) => status === "vulnerabilities"))
    assert.equal(commands().filter(({ args }) => args.includes("--output")).length, 13)
    assert.equal(summary.images.length, 13)
  })
}

test("findings below HIGH do not block the configured gate", (t) => {
  const { scan } = fixture(t, { mode: "medium" })
  assert.equal(scan().status, 0)
})

for (const mode of ["scan-failure", "exit-failure", "missing-report", "invalid-report", "wrong-image", "wrong-platform", "registry-failure"]) {
  test(`${mode} fails safely instead of treating an incomplete or incorrect scan as clean`, (t) => {
    const { scan, report } = fixture(t, { mode })
    assert.notEqual(scan().status, 0)
    const summary = JSON.parse(readFileSync(path.join(report, "summary.json"), "utf8"))
    assert.equal(summary.status, "failed")
    assert.equal(summary.images.length, 13)
    assert.ok(summary.images.every(({ status }) => status === "error"))
  })
}

for (const mode of ["db-failure", "java-db-failure", "wrong-version"]) {
  test(`${mode} stops the gate before scanning any image and preserves diagnostics`, (t) => {
    const { scan, report, commands } = fixture(t, { mode })
    assert.notEqual(scan().status, 0)
    assert.equal(commands().filter(({ args }) => args.includes("--output")).length, 0)
    assert.ok(existsSync(path.join(report, "summary.json")))
  })
}

for (const options of [{ missingArchitecture: "amd64" }, { missingArchitecture: "arm64" }, { duplicateArchitecture: "arm64" }]) {
  test(`${JSON.stringify(options)} prevents scanning an incomplete or ambiguous release index`, (t) => {
    const { scan, report, commands } = fixture(t, options)
    assert.notEqual(scan().status, 0)
    assert.equal(commands().filter(({ args }) => args.includes("--output")).length, 0)
    assert.equal(JSON.parse(readFileSync(path.join(report, "summary.json"), "utf8")).status, "failed")
  })
}

test("an index response that does not match the frozen digest is rejected", (t) => {
  const { scan, env, commands } = fixture(t)
  writeFileSync(env.IMAGE_TEST_INDEX, JSON.stringify({ schemaVersion: 2, manifests: [] }))
  assert.notEqual(scan().status, 0)
  assert.equal(commands().filter(({ args }) => args.includes("--output")).length, 0)
})

for (const missing of ["worker", "DOCLING"]) {
  test(`a missing ${missing} candidate cannot produce a partial passing scan`, (t) => {
    const { images, inputs, scan, commands } = fixture(t)
    if (missing === "worker") rmSync(path.join(images, missing))
    else {
      const file = path.join(inputs, "upstream-images.env")
      writeFileSync(file, readFileSync(file, "utf8").split("\n").filter((line) => !line.startsWith(`IMAGE_${missing}=`)).join("\n"))
    }
    assert.notEqual(scan().status, 0)
    assert.equal(commands().length, 0)
  })
}

test("mutable references and duplicate upstream keys are rejected before invoking external commands", (t) => {
  const { images, inputs, scan, commands, indexDigest } = fixture(t)
  writeFileSync(path.join(images, "api"), "ghcr.io/lingx-ai/linksense-api:latest\n")
  assert.notEqual(scan().status, 0)
  assert.equal(commands().length, 0)
  writeFileSync(path.join(images, "api"), `ghcr.io/lingx-ai/linksense-api@${indexDigest}\n`)
  const file = path.join(inputs, "upstream-images.env")
  writeFileSync(file, readFileSync(file, "utf8") + readFileSync(file, "utf8").split("\n")[0] + "\n")
  assert.notEqual(scan().status, 0)
  assert.equal(commands().length, 0)
})

test("ambient Trivy policy cannot disable scanning or suppress release findings", (t) => {
  const { scan, env, commands } = fixture(t)
  env.TRIVY_IGNORE_UNFIXED = "true"
  env.TRIVY_SKIP_FILES = "*"
  env.TRIVY_SCANNERS = "secret"
  env.TRIVY_SERVER = "https://untrusted.example"
  assert.equal(scan().status, 0)
  for (const { command, trivyEnvironment } of commands()) {
    if (command === "trivy") assert.deepEqual(trivyEnvironment, [])
  }
})

test("a prior successful report cannot hide a missing report from the current scanner run", (t) => {
  const { scan, env, report } = fixture(t)
  assert.equal(scan().status, 0)
  env.IMAGE_TEST_MODE = "missing-report"
  assert.notEqual(scan().status, 0)
  assert.ok(JSON.parse(readFileSync(path.join(report, "summary.json"), "utf8")).images.every(({ status }) => status === "error"))
})

test("unsupported target platforms fail before touching a registry", (t) => {
  const { scan, commands } = fixture(t)
  assert.notEqual(scan("linux/ppc64le").status, 0)
  assert.equal(commands().length, 0)
})

test("vendor VEX corrects only the specific fixed SILO revision and is confined to its server role", () => {
  const vex = JSON.parse(readFileSync(path.join(root, "deploy/security/silo-fixed.vex.json"), "utf8"))
  assert.equal(vex.statements.length, 1)
  const statement = vex.statements[0]
  assert.equal(statement.status, "fixed")
  assert.equal(statement.vulnerability.name, "CVE-2026-39414")
  assert.deepEqual(statement.products, [{ "@id": "pkg:golang/github.com/minio/minio@v0.0.0-20260916155009-2a4d51406b7e" }])
  assert.match(statement.status_notes, /SIMD/u)
  assert.match(statement.status_notes, /https:\/\/silo\.pgsty\.com/u)
  const scriptSource = readFileSync(script, "utf8")
  assert.match(scriptSource, /\[ "\$role" = MINIO \]/u)
  assert.match(scriptSource, /set -- --vex "\$vex_file"/u)
})

test("header VEX covers only reviewed CVEs for exact userspace packages and never claims host kernel safety", () => {
  const vex = JSON.parse(readFileSync(path.join(root, "deploy/security/worker-kernel-headers.vex.json"), "utf8"))
  assert.equal(vex.statements.length, 173)
  assert.equal(new Set(vex.statements.map(({ vulnerability }) => vulnerability.name)).size, 173)
  for (const statement of vex.statements) {
    assert.match(statement.vulnerability.name, /^CVE-\d{4}-\d+$/u)
    assert.equal(statement.status, "not_affected")
    assert.equal(statement.justification, "vulnerable_code_not_present")
    assert.deepEqual(statement.products, ["amd64", "arm64"].map((architecture) => ({ "@id": `pkg:deb/ubuntu/linux-libc-dev@6.8.0-146.146?arch=${architecture}&distro=ubuntu-24.04` })))
    assert.match(statement.impact_statement, /host kernel is NOT assessed/u)
    assert.match(statement.impact_statement, /New CVEs and other package versions are not covered/u)
  }
  const source = readFileSync(script, "utf8")
  assert.match(source, /elif \[ "\$role" = LINKSENSE_WORKER \]/u)
  assert.match(source, /worker-kernel-headers\.vex\.json/u)
})
