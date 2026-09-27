import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const workflow = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8")
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
