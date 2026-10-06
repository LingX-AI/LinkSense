import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { createRequire } from "node:module"

const root = path.resolve(import.meta.dirname, "..")
const workflow = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8")
const { parse } = createRequire(new URL("../apps/api/package.json", import.meta.url))("yaml")

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

test("Docling import checks configure its RQ backend without accessing external services", () => {
  const dockerfile = readFileSync(path.join(root, "deploy/hardened/Dockerfile.docling"), "utf8")
  assert.match(dockerfile, /DOCLING_SERVE_ENG_KIND=rq DOCLING_SERVE_ENG_RQ_REDIS_URL=redis:\/\/127\.0\.0\.1:6379\/0/u)
  const { jobs } = parse(workflow)
  const smoke = jobs["hardened-images"].steps.find((step) => step.name === "Verify the patched component entrypoint")
  assert.match(smoke.run, /docling\) docker run --rm --network none --env DOCLING_SERVE_ENG_KIND=rq --env DOCLING_SERVE_ENG_RQ_REDIS_URL=redis:\/\/127\.0\.0\.1:6379\/0/u)
})

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
  assert.ok(jobs["image-indexes"].needs.includes("hardened-images"))
  assert.equal(jobs["hardened-images"].strategy.matrix.component.length, 6)
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
const preflight = workflow
  .split(/      - name: Verify (?:private )?release authorization and identity\n/u)[1]
  ?.split("        run: |\n")[1]
  .split("\n      - uses:")[0]
  .replace(/^          /gmu, "")

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
