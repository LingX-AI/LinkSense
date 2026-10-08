import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { createRequire } from "node:module"

const root = path.resolve(import.meta.dirname, "..")
const workflow = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8")
const { parse } = createRequire(new URL("../apps/api/package.json", import.meta.url))("yaml")

function verifyAnonymousImages(t, deniedReference) {
  const directory = mkdtempSync(path.join(tmpdir(), "linksense-anonymous-images-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const assets = path.join(directory, "release-assets")
  const bin = path.join(directory, "bin")
  mkdirSync(assets)
  mkdirSync(bin)
  const roles = ["LINKSENSE_API", "LINKSENSE_WEB", "LINKSENSE_MIGRATE", "LINKSENSE_RUNNER", "LINKSENSE_WORKER", "POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY", "ELASTICSEARCH", "DOCLING"]
  const references = roles.map(role => `registry.example/${role.toLowerCase()}@sha256:${createHash("sha256").update(role).digest("hex")}`)
  const manifest = references.map((reference, index) => `IMAGE_${roles[index]}=${reference}\nIMAGE_${roles[index]}_DIGEST=${reference.split("@")[1]}`).join("\n") + "\n"
  writeFileSync(path.join(assets, "release-manifest.env"), manifest)
  writeFileSync(path.join(assets, "release-manifest.env.sha256"), `${createHash("sha256").update(manifest).digest("hex")}  release-manifest.env\n`)
  const calls = path.join(directory, "docker-calls")
  writeFileSync(path.join(bin, "docker"), `#!${process.execPath}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ANONYMOUS_TEST_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'logout') {
  assert.deepEqual(args, ['logout', 'ghcr.io']);
  process.exit(0);
}
assert.deepEqual(args.slice(0, 3), ['buildx', 'imagetools', 'inspect']);
assert.equal(args.length, 4);
assert.match(args[3], /^registry\\.example\\/[a-z_]+@sha256:[0-9a-f]{64}$/u);
if (args[3] === process.env.ANONYMOUS_TEST_DENIED) process.exit(1);
`, { mode: 0o755 })
  const step = parse(workflow).jobs.release.steps.find(item => item.name === "Verify anonymous access to every LinkSense image candidate")
  assert.equal(step["continue-on-error"], undefined)
  const result = spawnSync("bash", ["-c", step.run], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ANONYMOUS_TEST_CALLS: calls,
      ANONYMOUS_TEST_DENIED: deniedReference ? references[3] : "",
    },
  })
  const commands = readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line))
  assert.deepEqual(commands[0], ["logout", "ghcr.io"])
  return { ...result, references, inspected: commands.slice(1).map(args => args[3]) }
}

test("anonymous verification checks all thirteen image references without treating digest metadata as repositories", t => {
  const result = verifyAnonymousImages(t, false)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.inspected, [...result.references].sort())
})

test("an image that cannot be read anonymously still blocks release publication", t => {
  const result = verifyAnonymousImages(t, true)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Every application and baseline image must be anonymously available/u)
  assert.ok(result.inspected.includes(result.references[3]))
})

test("native application verification builds every thin image without publishing images or product Releases", () => {
  const verification = parse(readFileSync(path.join(root, ".github/workflows/verify-application-images.yml"), "utf8"))
  assert.deepEqual(Object.keys(verification.on), ["workflow_dispatch"])
  assert.equal(verification.jobs.build.strategy.matrix.application.length, 5)
  assert.deepEqual(verification.jobs.build.strategy.matrix.platform.map(p => p.runner), ["ubuntu-24.04", "ubuntu-24.04-arm"])
  const build = verification.jobs.build.steps.find(step => step.uses?.startsWith("docker/build-push-action@"))
  assert.equal(build.with.push, false)
  assert.equal(build.with.load, true)
  assert.deepEqual(verification.jobs.build.permissions, { contents: "read", packages: "read" })
  assert.equal(verification.jobs.identities.needs, "build")
  const smoke = verification.jobs.build.steps.find(step => step.name?.startsWith("Check inherited tools"))
  assert.match(smoke.run, /migrate\) docker run --rm --network none --env DATABASE_URL=postgresql:\/\/build:build@127\.0\.0\.1:5432\/build --entrypoint pnpm "\$IMAGE" exec prisma --version/u)
  assert.doesNotMatch(smoke.run, /db:migrate:deploy|migrate deploy|db:seed/u)
  assert.doesNotMatch(JSON.stringify(verification), /packages":"write|contents":"write|gh release|publish-release\.mjs/u)
})

test("isolated Elasticsearch startup diagnostics remain read-only and do not require rescanning all images", () => {
  const preflight = parse(readFileSync(path.join(root, ".github/workflows/image-preflight.yml"), "utf8"))
  assert.deepEqual(preflight.permissions, { contents: "read" })
  assert.equal(preflight.on.workflow_dispatch.inputs.images_json.required, false)
  assert.equal(preflight.jobs.freeze.if, "inputs.images_json != ''")
  const smoke = preflight.jobs["elasticsearch-startup"]
  assert.equal(smoke.if, "inputs.elasticsearch_image != ''")
  assert.equal(smoke["timeout-minutes"], 10)
  assert.match(smoke.steps.at(-1).run, /node scripts\/elasticsearch-image-smoke\.mjs/u)
  assert.match(smoke.steps.at(-1).run, /timeout --kill-after=30s 300 docker pull/u)
  assert.ok(smoke.steps.at(-1).run.indexOf("docker pull") < smoke.steps.at(-1).run.indexOf("node scripts/"))
  assert.doesNotMatch(JSON.stringify(smoke), /packages: write|publish-release|docker push/u)
})

test("both native worker gates verify the production supervisor-to-task capability boundary", () => {
  const release = parse(workflow)
  const verification = parse(readFileSync(path.join(root, ".github/workflows/verify-application-images.yml"), "utf8"))
  const checks = [
    release.jobs["worker-image"].steps.find(step => step.name === "Smoke-test worker candidate"),
    verification.jobs.build.steps.find(step => step.name?.startsWith("Check inherited tools")),
  ]
  for (const check of checks) {
    assert.match(check.run, /node scripts\/worker-isolation-smoke\.mjs "\$(?:image|IMAGE)"/u)
    assert.doesNotMatch(check.run, /--user 1001:1000|assertCodexRuntimeVersion/u)
    assert.equal(check["continue-on-error"], undefined)
  }
  assert.deepEqual(release.jobs["worker-image"].strategy.matrix.include.map(platform => platform.architecture), ["amd64", "arm64"])
})

test("Docling import checks configure its RQ backend without accessing external services", () => {
  const dockerfile = readFileSync(path.join(root, "deploy/hardened/Dockerfile.docling"), "utf8")
  assert.match(dockerfile, /DOCLING_SERVE_ENG_KIND=rq DOCLING_SERVE_ENG_RQ_REDIS_URL=redis:\/\/127\.0\.0\.1:6379\/0/u)
  const { jobs } = parse(readFileSync(path.join(root, ".github/workflows/maintain-baselines.yml"), "utf8"))
  const smoke = jobs.build.steps.find((step) => step.name === "Verify the patched component entrypoint")
  assert.match(smoke.run, /docling\) docker run --rm --network none --env DOCLING_SERVE_ENG_KIND=rq --env DOCLING_SERVE_ENG_RQ_REDIS_URL=redis:\/\/127\.0\.0\.1:6379\/0/u)
})

test("publication requires real Core and Full installations on both native architectures", () => {
  const { jobs } = parse(workflow)
  assert.ok(jobs.release.needs.includes("installation-smoke"))
  const gate = jobs["installation-smoke"]
  assert.deepEqual(gate.needs, ["prepare", "assets"])
  assert.deepEqual(gate.strategy.matrix.edition, ["core", "full"])
  assert.deepEqual(gate.strategy.matrix.platform.map(value => value.architecture), ["amd64", "arm64"])
  assert.equal(gate.strategy["fail-fast"], false)
  assert.deepEqual(gate.permissions, { contents: "read", packages: "read" })
  assert.equal(gate.if, undefined)
  assert.equal(gate["continue-on-error"], undefined)
  assert.ok(gate.steps.every(step => !step["continue-on-error"]))
  const smoke = gate.steps.find(step => step.run?.includes("scripts/release-installation-smoke.mjs"))
  assert.ok(smoke)
  assert.match(smoke.run, /previous-release-assets/u)
  assert.equal(smoke.env.RELEASE_VERSION, "${{ needs.prepare.outputs.release_version }}")
  assert.equal(smoke.env.SOURCE_SHA, "${{ needs.prepare.outputs.source_sha }}")
  const upload = gate.steps.find(step => step.uses?.startsWith("actions/upload-artifact@"))
  assert.equal(upload.if, "always()")
  assert.equal(upload.with.path, "installation-reports/")
  assert.doesNotMatch(JSON.stringify(gate), /packages":"write|contents":"write|publish-release\.mjs|docker push/u)
})

for (const [version, apiStatus, accepted] of [["v0.3.5", 0, true], ["", 0, true], ["", 1, false], ["invalid-tag", 0, false]]) {
  test(`upgrade baseline discovery handles ${JSON.stringify(version)} with API status ${apiStatus}`, t => {
    const directory = mkdtempSync(path.join(tmpdir(), "linksense-upgrade-baseline-"))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const output = path.join(directory, "output")
    const step = parse(workflow).jobs.prepare.steps.find(item => item.id === "upgrade")
    assert.match(step.run, /--exclude-drafts --exclude-pre-releases/u)
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", `gh() { printf '%s' "$FIXTURE_VERSION"; return "$FIXTURE_API_STATUS"; }\n${step.run}`], {
      encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: "example/linksense", GITHUB_OUTPUT: output, FIXTURE_VERSION: version, FIXTURE_API_STATUS: String(apiStatus) },
    })
    assert.equal(result.status, accepted ? 0 : 1, result.stderr)
    if (accepted) assert.equal(readFileSync(output, "utf8"), `version=${version}\n`)
    else assert.equal(existsSync(output), false, "Discovery failures must not silently skip upgrade verification")
  })
}

test("formal image tags and GitHub Release publication require every architecture security scan", () => {
  const { jobs } = parse(workflow)
  assert.ok(jobs.release.needs.includes("image-security"))
  assert.ok(jobs.release.needs.includes("storage-upgrade"))
  const gate = jobs["image-security"]
  assert.deepEqual(gate.needs, ["prepare", "image-indexes"])
  assert.deepEqual(gate.strategy.matrix.architecture, ["amd64", "arm64"])
  assert.equal(gate.strategy["fail-fast"], false)
  assert.deepEqual(gate.permissions, { contents: "read", packages: "read" })
  assert.equal(gate["continue-on-error"], undefined)
  assert.equal(jobs.release.if, undefined)
  assert.ok(gate.steps.every((step) => !step["continue-on-error"]))
  const scan = gate.steps.find((step) => step.run?.includes("scripts/scan-release-images.sh"))
  assert.match(scan.run, /sha256sum -c SHA256SUMS/u)
  assert.match(scan.run, /release-inputs\/identity\.env/u)
  assert.match(scan.run, /image-references verified-inputs image-security-reports/u)
  assert.match(scan.run, /release-image-inventory\.mjs upstream-env/u)
  assert.deepEqual(jobs["image-indexes"].needs, ["prepare", "images", "worker-image"])
  assert.equal(jobs["hardened-images"], undefined)
  assert.doesNotMatch(workflow, /SECURITY_REBUILD_ID|deploy\/hardened\//u)
  assert.match(workflow, /BASELINE_WORKER_IMAGE=\$\{\{ needs\.prepare\.outputs\.baseline_worker \}\}/u)
  assert.equal(scan.env.RELEASE_VERSION, "${{ needs.prepare.outputs.release_version }}")
  assert.equal(scan.env.SOURCE_SHA, "${{ needs.prepare.outputs.source_sha }}")
  assert.equal(scan.env.SCAN_PLATFORM, "linux/${{ matrix.architecture }}")
  const upload = gate.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"))
  assert.equal(upload.if, "always()")
  assert.equal(upload.with["if-no-files-found"], "error")
  assert.equal(upload.with.path, "image-security-reports/")
  assert.equal(upload.with.name, "image-security-reports-${{ matrix.architecture }}")
  assert.equal(upload.with["retention-days"], 30)
  const install = gate.steps.find((step) => step.name === "Install checksum-pinned Trivy")
  assert.match(install.run, /releases\/download\/v0\.75\.0\/trivy_0\.75\.0_Linux-64bit\.tar\.gz/u)
  const verify = install.run.indexOf("c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f")
  assert.ok(verify > 0)
  assert.ok(verify < install.run.indexOf("tar -xzf"))
  assert.doesNotMatch(install.run, /install\.sh|\/latest\//u)
})
const preflight = parse(workflow).jobs.prepare.steps.find(step => step.name === "Verify release authorization and identity")?.run

function check(t, overrides = {}) {
  assert.ok(preflight, "Release authorization step must be present")
  const directory = mkdtempSync(path.join(tmpdir(), "linksense-release-gate-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(path.join(directory, "gh"), `#!${process.execPath}
const args = process.argv.slice(2)
const request = args.join(" ")
if (process.env.FAKE_API_FAILURE === "1") process.exit(1)
if (args[0] === "release") process.exit(1)
if (request.includes("/actions/workflows/")) {
  const name = request.includes("ci.yml") ? "CI" : "SECURITY"
  const expectedEvents = name === "CI" ? "push" : "push,public,workflow_dispatch,schedule"
  if (process.env.WORKFLOW_EVENTS !== expectedEvents ||
      process.env.TARGET_SHA !== process.env.GITHUB_SHA ||
      !args.includes("branch=main") || !args.includes("head_sha=" + process.env.GITHUB_SHA))
    throw new Error("Checks must use the release commit, main and allowed events")
  if (process.env["FAKE_MISSING_" + name] !== "1")
    process.stdout.write("123\\thttps://github.com/example/linksense/actions/runs/123\\n")
} else if (request.includes("/actions/runs/123/jobs")) {
  if (process.env.FAKE_CODEQL === "success") process.stdout.write("456\\n")
} else if (args[1] === "repos/example/linksense") {
  process.stdout.write(process.env.FAKE_VISIBILITY + "\\n")
} else {
  throw new Error("Unexpected GitHub request: " + request)
}
`, { mode: 0o755 })
  const output = path.join(directory, "output")
  const result = spawnSync("bash", ["-c", `git() { return 1; }\n${preflight}`], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      PATH: `${directory}:${process.env.PATH}`,
      GITHUB_REPOSITORY: "example/linksense",
      GITHUB_REF_NAME: "main",
      GITHUB_ACTOR: "release-owner",
      RELEASE_ACTOR: "release-owner",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_OUTPUT: output,
      FAKE_VISIBILITY: "private",
      FAKE_CODEQL: "success",
      ...overrides,
    },
  })
  return { ...result, output }
}

for (const visibility of ["private", "public"]) {
  test(`${visibility} releases pass the existing checks on main`, (t) => {
    const result = check(t, { FAKE_VISIBILITY: visibility })
    assert.equal(result.status, 0, result.stderr)
    assert.match(readFileSync(result.output, "utf8"), /source_sha=a{40}/u)
  })
}

test("private releases do not require the public-only CodeQL job", (t) => {
  assert.equal(check(t, { FAKE_CODEQL: "skipped" }).status, 0)
})

for (const conclusion of ["skipped", "failure", "missing"]) {
  test(`public releases reject a ${conclusion} CodeQL job from an otherwise successful Security run`, (t) => {
    const result = check(t, { FAKE_VISIBILITY: "public", FAKE_CODEQL: conclusion })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /CodeQL must pass/u)
  })
}

for (const [name, overrides, message] of [
  ["unsupported visibility", { FAKE_VISIBILITY: "internal" }, /Unsupported repository visibility/u],
  ["another branch", { GITHUB_REF_NAME: "develop" }, /must be dispatched from main/u],
  ["another actor", { GITHUB_ACTOR: "other-user" }, /Only LINKSENSE_RELEASE_ACTOR/u],
  ["missing release actor", { RELEASE_ACTOR: "" }, /LINKSENSE_RELEASE_ACTOR is required/u],
  ["missing CI", { FAKE_MISSING_CI: "1" }, /CI must pass/u],
  ["missing Security", { FAKE_MISSING_SECURITY: "1" }, /Security must pass/u],
]) {
  test(`${name} blocks release preparation`, (t) => {
    const result = check(t, overrides)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, message)
  })
}

test("a GitHub API failure blocks preparation", (t) => {
  assert.notEqual(check(t, { FAKE_API_FAILURE: "1" }).status, 0)
})
