import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { runPlatformTests } from "./installer-platform-tests.mjs"

for (const [availableGiB, succeeds] of [[120, true], [80, false]]) {
  test(`Full VM allocation with ${availableGiB} GiB backing space reserves room for both runtime versions`, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), "linksense-vm-storage-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const source = await readFile(new URL("./installer-centos-vm.sh", import.meta.url), "utf8")
    const end = source.indexOf("\nssh-keygen ")
    assert.ok(end > 0)
    const trace = path.join(directory, "qemu-args")
    const result = spawnSync("bash", ["-c", `
uname() { case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac; }
realpath() { printf '%s\\n' "$2"; }
test() { if [ "$#" -eq 2 ] && [ "$1" = -c ] && [ "$2" = /dev/kvm ]; then return 0; fi; builtin test "$@"; }
curl() { :; }
sha256sum() { :; }
df() { printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nhost 999999999 1 %s 1%% /\\n' "$HOST_AVAILABLE_KIB"; }
qemu-img() { printf '%s\\n' "$@" > "$QEMU_TRACE"; }
${source.slice(0, end)}
`, "bash", "full", path.join(directory, "reports")], {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, GITHUB_SHA: "a".repeat(40), RUNNER_ENVIRONMENT: "github-hosted", HOST_AVAILABLE_KIB: String(availableGiB * 1024 ** 2), QEMU_TRACE: trace },
    })
    assert.equal(result.status, succeeds ? 0 : 1, result.stderr)
    if (succeeds) {
      const size = (await readFile(trace, "utf8")).trim().split("\n").at(-1)
      assert.match(size, /^\d+G$/u)
      const allocated = Number(size.slice(0, -1))
      assert.ok(allocated >= 96, "Full lifecycle needs the 60 GiB admission reserve after caching the candidate runtime")
      assert.ok(allocated <= availableGiB - 4, "Virtual capacity must not exceed the physical backing space minus the host reserve")
    } else await assert.rejects(readFile(trace), { code: "ENOENT" })
  })
}

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
