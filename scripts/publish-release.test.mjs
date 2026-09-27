import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { publishRelease } from "./publish-release.mjs"

function fixture(t) {
  const directory = mkdtempSync(
    path.join(tmpdir(), "linksense-publication-test-"),
  )
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const options = {
    repository: "example/linksense",
    version: "v0.2.3",
    sourceSha: "a".repeat(40),
    workflowUrl: "https://github.com/example/linksense/actions/runs/123",
    assetDirectory: directory,
  }
  writeFileSync(path.join(directory, "install-full.sh"), "#!/bin/sh\nexit 0\n")
  writeFileSync(
    path.join(directory, "release-manifest.env"),
    `RELEASE_VERSION=${options.version}\nRELEASE_GIT_COMMIT=${options.sourceSha}\nRELEASE_WORKFLOW_ID=${options.workflowUrl}\n`,
  )
  const checksums = readdirSync(directory)
    .sort()
    .map(
      (file) =>
        `${createHash("sha256")
          .update(readFileSync(path.join(directory, file)))
          .digest("hex")}  ${file}\n`,
    )
    .join("")
  writeFileSync(path.join(directory, "SHA256SUMS"), checksums)
  const state = {
    release: null,
    assets: new Map(),
    tag: null,
    calls: [],
    interruptUpload: false,
    corruptDownload: false,
    failRead: false,
  }
  const run = (args) => {
    state.calls.push(args)
    if (args[0] === "api") {
      if (state.failRead) throw new Error("GitHub unavailable")
      const route = args[1].replace(`repos/${options.repository}/`, "")
      if (route.startsWith("git/matching-refs/")) {
        return JSON.stringify(
          state.tag
            ? [
                {
                  ref: `refs/tags/${options.version}`,
                  object: { type: "commit", sha: state.tag },
                },
              ]
            : [],
        )
      }
      if (route === "releases?per_page=100")
        return JSON.stringify([[], state.release ? [state.release] : []])
      if (route === "releases/1/assets?per_page=100")
        return JSON.stringify([
          [...state.assets.keys()].map((name) => ({ name })),
        ])
    }
    if (args[0] === "release") {
      if (args[1] === "create") {
        assert.ok(args.includes("--draft"))
        state.release = {
          id: 1,
          tag_name: options.version,
          target_commitish: options.sourceSha,
          draft: true,
        }
        return ""
      }
      if (args[1] === "upload") {
        assert.equal(state.release.draft, true)
        assert.ok(!args.includes("--clobber"))
        for (const file of args.slice(5)) {
          const name = path.basename(file)
          assert.ok(!state.assets.has(name), `Must reuse uploaded ${name}`)
          state.assets.set(name, readFileSync(file))
          if (state.interruptUpload) throw new Error("Upload interrupted")
        }
        return ""
      }
      if (args[1] === "download") {
        const destination = args[args.indexOf("--dir") + 1]
        for (const [file, bytes] of state.assets)
          writeFileSync(
            path.join(destination, file),
            state.corruptDownload ? "corrupted" : bytes,
          )
        return ""
      }
      if (args[1] === "edit") {
        assert.ok(args.includes("--draft=false"))
        const downloadIndex = state.calls.findLastIndex(
          (call) => call[1] === "download",
        )
        assert.ok(
          downloadIndex >= 0,
          "Download verification must happen before publication",
        )
        state.release.draft = false
        state.tag = options.sourceSha
        return ""
      }
    }
    throw new Error(`Unexpected call: ${JSON.stringify(args)}`)
  }
  return { options, state, run }
}

test("release stays a draft until all uploaded assets have been downloaded and verified", (t) => {
  const { options, state, run } = fixture(t)
  publishRelease(options, run)
  assert.equal(state.release.draft, false)
  assert.equal(state.tag, options.sourceSha)
  assert.equal(state.assets.size, 3)
  const create = state.calls.find((call) => call[1] === "create")
  assert.equal(create[create.indexOf("--title") + 1], `LinkSense ${options.version}`)
})

test("an interrupted draft upload resumes only missing assets on the same workflow run", (t) => {
  const { options, state, run } = fixture(t)
  state.interruptUpload = true
  assert.throws(() => publishRelease(options, run), /Upload interrupted/u)
  assert.equal(state.release.draft, true)
  assert.equal(state.assets.size, 1)
  state.interruptUpload = false
  publishRelease(options, run)
  assert.equal(state.release.draft, false)
  assert.equal(state.calls.filter((call) => call[1] === "create").length, 1)
})

test("rechecking a historical private-source release performs no writes", (t) => {
  const { options, state, run } = fixture(t)
  publishRelease(options, run)
  state.release.name = `LinkSense ${options.version} (private source)`
  state.calls = []
  publishRelease(options, run)
  assert.ok(
    state.calls.every((call) => call[0] === "api" || call[1] === "download"),
  )
})

test("a corrupted download leaves the release in draft", (t) => {
  const { options, state, run } = fixture(t)
  state.corruptDownload = true
  assert.throws(() => publishRelease(options, run), /Remote asset differs/u)
  assert.equal(state.release.draft, true)
  assert.ok(!state.calls.some((call) => call[1] === "edit"))
})

test("a different existing asset is never overwritten during recovery", (t) => {
  const { options, state, run } = fixture(t)
  state.interruptUpload = true
  assert.throws(() => publishRelease(options, run), /Upload interrupted/u)
  state.interruptUpload = false
  state.assets.set("SHA256SUMS", Buffer.from("different checksums"))
  state.calls = []
  assert.throws(() => publishRelease(options, run), /Remote asset differs/u)
  assert.ok(
    !state.calls.some((call) => call[1] === "upload" || call[1] === "edit"),
  )
})

test("a failed GitHub lookup cannot be mistaken for an absent release", (t) => {
  const { options, state, run } = fixture(t)
  state.failRead = true
  assert.throws(() => publishRelease(options, run), /GitHub unavailable/u)
  assert.ok(state.calls.every((call) => call[0] === "api"))
})

test("a tag belonging to another commit blocks release creation", (t) => {
  const { options, state, run } = fixture(t)
  state.tag = "b".repeat(40)
  assert.throws(() => publishRelease(options, run), /another commit/u)
  assert.equal(state.release, null)
})

test("local corruption and mismatched workflow identity fail before any GitHub request", (t) => {
  const { options, state, run } = fixture(t)
  assert.throws(
    () =>
      publishRelease(
        { ...options, workflowUrl: options.workflowUrl.replace("123", "456") },
        run,
      ),
    /identity mismatch/u,
  )
  writeFileSync(path.join(options.assetDirectory, "install-full.sh"), "changed")
  assert.throws(() => publishRelease(options, run), /Invalid local asset/u)
  assert.equal(state.calls.length, 0)
})

test("an incomplete published release is rejected without uploading new assets", (t) => {
  const { options, state, run } = fixture(t)
  publishRelease(options, run)
  state.assets.delete("install-full.sh")
  state.calls = []
  assert.throws(() => publishRelease(options, run), /refusing mutation/u)
  assert.ok(state.calls.every((call) => call[0] === "api"))
})
