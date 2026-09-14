import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  contributorEnd,
  contributorStart,
  normalizeContributors,
  readmeFiles,
  renderContributors,
  replaceContributors,
  updateContributors,
} from "./update-contributors.mjs"

const user = (login = "example-user", id = 1, contributions = 1) => ({
  type: "User", login, id, contributions,
})
const readme = (title = "Contributors") =>
  `# LinkSense\n\n## ${title}\n\n${contributorStart}\nold avatars\n${contributorEnd}\n`

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linksense-contributors-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const file of readmeFiles) await writeFile(path.join(directory, file), readme(file), "utf8")
  return directory
}

const readBoth = (directory) => Promise.all(readmeFiles.map((file) =>
  readFile(path.join(directory, file), "utf8"),
))

function client(input) {
  const calls = []
  const listContributors = () => { throw new Error("Use Octokit pagination.") }
  return {
    calls,
    rest: { repos: { listContributors } },
    paginate: async (endpoint, options) => {
      assert.equal(endpoint, listContributors)
      calls.push(options)
      if (input instanceof Error) throw input
      return input
    },
  }
}

test("contributors are sorted by commits, deduplicated by identity, and exclude bots and anonymous authors", () => {
  const input = [
    user("zed", 2, 10),
    { type: "Anonymous", email: "anonymous@example.test", contributions: 50 },
    { type: "Bot", login: "github-actions[bot]", contributions: 100 },
    user("Amy", 1, 10),
    user("Amy", 1, 10),
    user("newcomer", 3, 1),
    user("zero-commits", 4, 0),
  ]
  const original = structuredClone(input)
  assert.deepEqual(normalizeContributors(input).map(({ login }) => login), ["Amy", "zed", "newcomer"])
  assert.deepEqual(input, original)
})

test("avatars link to public profiles and use only validated GitHub identifiers", () => {
  const block = renderContributors([{
    ...user("example-user", 7),
    avatar_url: "https://untrusted.example.test/track?token=not-a-real-secret",
    html_url: "javascript:alert(1)",
    email: "private@example.test",
  }])
  assert.equal(block, [
    "<p>",
    '  <a href="https://github.com/example-user"><img src="https://avatars.githubusercontent.com/u/7?s=128" width="64" height="64" alt="example-user" title="example-user" /></a>',
    "</p>",
  ].join("\n"))
  assert.doesNotMatch(block, /token|secret|javascript|private@example|untrusted/iu)
})

test("commit-count changes that preserve the order do not cause README churn", () => {
  assert.equal(
    renderContributors([user("first", 1, 10), user("second", 2, 5)]),
    renderContributors([user("first", 1, 11), user("second", 2, 6)]),
  )
})

for (const invalid of [
  null,
  {},
  [null],
  [user('<img src=x onerror="alert(1)">')],
  [user("../../outside")],
  [user("x?token=not-a-real-secret")],
  [user("user", -1)],
  [user("user", 1.5)],
  [user("user", Number.MAX_SAFE_INTEGER + 1)],
  [user("user", 1, -1)],
  [user("user", 1, "5")],
  [{ type: "User", id: 1, contributions: 1 }],
  [{ ...user(), type: "Unknown" }],
]) {
  test(`malformed contributor input is rejected without echoing the payload (${JSON.stringify(invalid)})`, () => {
    assert.throws(() => renderContributors(invalid), {
      message: "Invalid GitHub contributor data; READMEs were not changed.",
    })
  })
}

for (const empty of [[], [{ type: "Bot" }], [{ type: "Anonymous" }], [user("user", 1, 0)]]) {
  test(`empty human contributor lists preserve existing content (${JSON.stringify(empty)})`, () => {
    assert.throws(() => renderContributors(empty), /existing READMEs were preserved/u)
  })
}

test("marker replacement preserves surrounding English, Chinese, and CRLF content and is idempotent", () => {
  const block = renderContributors([user()])
  for (const title of ["Contributors", "贡献者"]) {
    for (const newline of ["\n", "\r\n"]) {
      const original = (readme(title) + "\nUnrelated footer.\n").replaceAll("\n", newline)
      const expected = original.replace("old avatars", block.replaceAll("\n", newline))
      assert.equal(replaceContributors(original, block), expected)
      assert.equal(replaceContributors(expected, block), expected)
    }
  }
})

for (const malformed of [
  "# No markers",
  contributorStart,
  contributorEnd,
  `${contributorEnd}\n${contributorStart}`,
  `${contributorStart}\n${contributorStart}\n${contributorEnd}`,
  `${contributorStart}\n${contributorEnd}\n${contributorEnd}`,
]) {
  test(`missing, reversed, or duplicate markers are rejected (${malformed})`, () => {
    assert.throws(() => replaceContributors(malformed, "new avatars"), /exactly one ordered pair/u)
  })
}

test("the updater uses paginated authenticated Octokit requests and synchronizes more than one page", async (t) => {
  const directory = await fixture(t)
  const entries = Array.from({ length: 105 }, (_, index) => user(`user-${index + 1}`, index + 1, 105 - index))
  const github = client(entries)
  const unrelatedPath = path.join(directory, "unrelated.txt")
  await writeFile(unrelatedPath, "leave unchanged", "utf8")
  assert.deepEqual(await updateContributors({ github, owner: "example", repo: "project", directory }), readmeFiles)
  assert.deepEqual(github.calls, [{
    owner: "example", repo: "project", per_page: 100, request: { timeout: 15_000 },
  }])
  const block = renderContributors(entries)
  for (const [index, content] of (await readBoth(directory)).entries()) {
    assert.equal(content, readme(readmeFiles[index]).replace("old avatars", block))
    assert.equal([...content.matchAll(/<img /gu)].length, 105)
  }
  assert.deepEqual(await updateContributors({ github, owner: "example", repo: "project", directory }), [])
  assert.equal(await readFile(unrelatedPath, "utf8"), "leave unchanged")
})

test("the updater validates both READMEs before changing either one", async (t) => {
  const directory = await fixture(t)
  await writeFile(path.join(directory, "README.zh-CN.md"), "missing markers", "utf8")
  const before = await readBoth(directory)
  await assert.rejects(
    updateContributors({ github: client([user()]), owner: "example", repo: "project", directory }),
    /exactly one ordered pair/u,
  )
  assert.deepEqual(await readBoth(directory), before)
})

test("a missing translation file prevents writes to the other README", async (t) => {
  const directory = await fixture(t)
  await rm(path.join(directory, "README.zh-CN.md"))
  await assert.rejects(updateContributors({ github: client([user()]), owner: "example", repo: "project", directory }), { code: "ENOENT" })
  assert.equal(await readFile(path.join(directory, "README.md"), "utf8"), readme("README.md"))
})

for (const response of [new Error("GitHub request failed"), [], [{ type: "Bot" }], [{ type: "User" }]]) {
  test(`API errors or unusable data never erase either README (${JSON.stringify(response)})`, async (t) => {
    const directory = await fixture(t)
    const before = await readBoth(directory)
    await assert.rejects(updateContributors({ github: client(response), owner: "example", repo: "project", directory }))
    assert.deepEqual(await readBoth(directory), before)
  })
}

test("invalid repository identity fails before any API call or file change", async (t) => {
  const directory = await fixture(t)
  const github = client([user()])
  const before = await readBoth(directory)
  await assert.rejects(updateContributors({ github, owner: "example", repo: "../../project", directory }), /Invalid GitHub repository identity/u)
  assert.deepEqual(github.calls, [])
  assert.deepEqual(await readBoth(directory), before)
})

test("the workflow is a bounded documentation-only PR update without release, build, or broad credentials", async () => {
  const workflow = await readFile(new URL("../.github/workflows/contributors.yml", import.meta.url), "utf8")
  assert.match(workflow, /schedule:\n    - cron: "23 3 \* \* 1"/u)
  assert.match(workflow, /^  workflow_dispatch:/mu)
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|pull_request_target|workflow_run|release):/mu)
  assert.match(workflow, /github\.repository == 'LingX-AI\/linksense'/u)
  assert.match(workflow, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/u)
  assert.match(workflow, /permissions:\n  contents: read/u)
  assert.match(workflow, /permissions:\n      contents: write\n      pull-requests: write/u)
  assert.match(workflow, /timeout-minutes: 5/u)
  assert.match(workflow, /persist-credentials: false/u)
  assert.match(workflow, /--filter link-sense install --frozen-lockfile --ignore-scripts/u)
  assert.match(workflow, /node --test scripts\/update-contributors\.test\.mjs scripts\/readme\.test\.mjs/u)
  assert.match(workflow, /retries: 2/u)
  assert.match(workflow, /branch: automation\/readme-contributors/u)
  assert.match(workflow, /add-paths: \|\n            README\.md\n            README\.zh-CN\.md\n/u)
  assert.match(workflow, /author: github-actions\[bot\]/u)
  assert.match(workflow, /commit-message: "docs: update README contributors \[skip ci\]"/u)
  assert.match(workflow, /title: "docs: update README contributors \[skip ci\]"/u)
  assert.deepEqual([...workflow.matchAll(/secrets\.([A-Z_]+)/gu)].map(([, name]) => name), ["GITHUB_TOKEN"])
  for (const [, action] of workflow.matchAll(/uses: ([^\s]+)/gu)) {
    assert.match(action, /@[a-f\d]{40}$/u)
  }
  assert.doesNotMatch(workflow, /docker|pnpm build|workflow_run|createRelease|\.merge\(|gh pr merge|enable-auto-merge|git push|write-all|packages: write/u)
})
