import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// Shared by publication and the real installation gate: both consume exactly
// the same checksummed assets, with no dependency installation on the runner.
export function verifyReleaseAssets({ version, sourceSha, workflowUrl, assetDirectory }) {
  assert.match(version, /^v\d+\.\d+\.\d+$/u)
  assert.match(sourceSha, /^[0-9a-f]{40}$/u)
  assert.match(
    workflowUrl,
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/u,
  )
  const directory = path.resolve(assetDirectory)
  const files = readdirSync(directory).sort()
  for (const file of files) {
    assert.match(file, /^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
    assert.ok(
      lstatSync(path.join(directory, file)).isFile(),
      `Invalid release asset: ${file}`,
    )
  }
  const hashes = new Map()
  for (const line of readFileSync(path.join(directory, "SHA256SUMS"), "utf8")
    .trim()
    .split("\n")) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/u.exec(line)
    assert.ok(match, "Invalid SHA256SUMS entry")
    assert.ok(!hashes.has(match[2]), "Duplicate SHA256SUMS entry")
    hashes.set(match[2], match[1])
  }
  assert.deepEqual(
    [...hashes.keys()].sort(),
    files.filter((file) => file !== "SHA256SUMS"),
  )
  for (const [file, hash] of hashes) {
    assert.equal(
      sha256(readFileSync(path.join(directory, file))),
      hash,
      `Invalid local asset: ${file}`,
    )
  }
  const manifest = readFileSync(
    path.join(directory, "release-manifest.env"),
    "utf8",
  ).split("\n")
  for (const [key, value] of Object.entries({
    RELEASE_VERSION: version,
    RELEASE_GIT_COMMIT: sourceSha,
    RELEASE_WORKFLOW_ID: workflowUrl,
  })) {
    assert.deepEqual(
      manifest.filter((line) => line.startsWith(`${key}=`)),
      [`${key}=${value}`],
      `Release identity mismatch: ${key}`,
    )
  }

  return { directory, files }
}

// GitHub CLI owns authentication and uploads.
export function publishRelease(
  { repository, version, sourceSha, workflowUrl, assetDirectory },
  run = runGh,
) {
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/u)
  const { directory, files } = verifyReleaseAssets({ version, sourceSha, workflowUrl, assetDirectory })
  const endpoint = `repos/${repository}`
  const api = (route) => JSON.parse(run(["api", `${endpoint}/${route}`]))
  const pages = (route) => {
    const result = JSON.parse(
      run(["api", `${endpoint}/${route}`, "--paginate", "--slurp"]),
    )
    assert.ok(
      Array.isArray(result) && result.every(Array.isArray),
      "Invalid paginated GitHub response",
    )
    return result.flat()
  }
  const releaseArgs = [version, "--repo", repository]
  const verifyTag = (required) => {
    const refs = api(`git/matching-refs/tags/${version}`)
    assert.ok(Array.isArray(refs), "Invalid GitHub tag response")
    const ref = refs.find((item) => item.ref === `refs/tags/${version}`)
    if (!ref) {
      assert.ok(!required, "Published release tag is missing")
      return
    }
    let object = ref.object
    for (let depth = 0; object.type === "tag" && depth < 5; depth += 1) {
      assert.match(object.sha, /^[0-9a-f]{40}$/u)
      object = api(`git/tags/${object.sha}`).object
    }
    assert.equal(object.type, "commit", "Release tag must resolve to a commit")
    assert.equal(object.sha, sourceSha, "Release tag points to another commit")
  }
  verifyTag(false)
  const findRelease = () => {
    const matches = pages("releases?per_page=100").filter(
      (release) => release.tag_name === version,
    )
    assert.ok(matches.length <= 1, "Ambiguous GitHub Release")
    return matches[0]
  }
  let release = findRelease()
  if (!release) {
    // Create the draft without assets. An interrupted upload can be resumed
    // without replacing an already uploaded asset or recreating a release.
    run([
      "release",
      "create",
      ...releaseArgs,
      "--draft",
      "--target",
      sourceSha,
      "--generate-notes",
      "--title",
      `LinkSense ${version}`,
    ])
    release = findRelease()
  }
  assert.ok(
    release &&
      Number.isSafeInteger(release.id) &&
      typeof release.draft === "boolean",
    "Invalid GitHub Release",
  )
  if (release.draft) {
    assert.equal(
      release.target_commitish,
      sourceSha,
      "Draft release targets another commit",
    )
  } else {
    verifyTag(true)
  }
  const uploaded = pages(`releases/${release.id}/assets?per_page=100`)
    .map((asset) => asset.name)
    .sort()
  assert.equal(
    new Set(uploaded).size,
    uploaded.length,
    "Duplicate remote release assets",
  )
  for (const file of uploaded)
    assert.ok(files.includes(file), `Unexpected remote release asset: ${file}`)
  const missing = files.filter((file) => !uploaded.includes(file))
  assert.ok(
    release.draft || missing.length === 0,
    "Published release assets are incomplete; refusing mutation",
  )

  const verificationDirectory = mkdtempSync(
    path.join(tmpdir(), "linksense-release-verify-"),
  )
  try {
    // Validate existing files before resuming any interrupted draft upload.
    if (uploaded.length) {
      run([
        "release",
        "download",
        ...releaseArgs,
        "--dir",
        verificationDirectory,
      ])
      for (const file of uploaded) {
        assert.deepEqual(
          readFileSync(path.join(verificationDirectory, file)),
          readFileSync(path.join(directory, file)),
          `Remote asset differs: ${file}`,
        )
      }
    }
    if (missing.length) {
      run([
        "release",
        "upload",
        ...releaseArgs,
        ...missing.map((file) => path.join(directory, file)),
      ])
    }
    const finalNames = pages(`releases/${release.id}/assets?per_page=100`)
      .map((asset) => asset.name)
      .sort()
    assert.deepEqual(finalNames, files, "Release asset list is incomplete")
    run([
      "release",
      "download",
      ...releaseArgs,
      "--dir",
      verificationDirectory,
      "--clobber",
    ])
    for (const file of files) {
      assert.deepEqual(
        readFileSync(path.join(verificationDirectory, file)),
        readFileSync(path.join(directory, file)),
        `Remote asset differs: ${file}`,
      )
    }
    verifyTag(!release.draft)
    if (release.draft) run(["release", "edit", ...releaseArgs, "--draft=false"])
    verifyTag(true)
  } finally {
    rmSync(verificationDirectory, { recursive: true, force: true })
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function runGh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  publishRelease({
    repository: process.env.GITHUB_REPOSITORY,
    version: process.env.RELEASE_VERSION,
    sourceSha: process.env.SOURCE_SHA,
    workflowUrl: process.env.RELEASE_WORKFLOW_ID,
    assetDirectory: process.argv[2],
  })
}
