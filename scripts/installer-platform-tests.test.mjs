import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { runPlatformTests } from "./installer-platform-tests.mjs"

for (const succeeds of [true, false]) {
  test(`platform reports preserve ${succeeds ? "successful" : "failed"} test results without claiming Docker runtime coverage`, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), "linksense-platform-report-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const fixture = path.join(directory, "fixture.mjs")
    await writeFile(fixture, `import assert from 'node:assert/strict'; import test from 'node:test'; test('fixture', () => assert.equal(${succeeds}, true));\n`)
    const reports = path.join(directory, "reports")
    assert.equal(await runPlatformTests(reports, [fixture]), succeeds ? 0 : 1)
    const report = JSON.parse(await readFile(path.join(reports, "platform.json"), "utf8"))
    assert.equal(report.success, succeeds)
    assert.equal(report.dockerRuntimeTested, false)
    assert.equal(report.platform, process.platform)
    assert.equal(report.architecture, process.arch)
    assert.match(await readFile(path.join(reports, "tests.tap"), "utf8"), succeeds ? /# pass 1/u : /# fail 1/u)
  })
}
