import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { preparePublicDocs } from "../scripts/prepare-public-docs.mjs"

test("public sidebar does not force categories open by default", async () => {
  for (const file of ["sidebars.public.ts", "sidebars.ts"]) {
    const sidebar = await readFile(
      new URL(`../${file}`, import.meta.url),
      "utf8",
    )
    assert.doesNotMatch(sidebar, /collapsed\s*:\s*false/u, file)
  }
})

test("public docs combine bilingual sources without changing the product help content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linksense-public-docs-"))
  const sources = {
    "docs/introduction.md": "# 中文概览",
    "deployment/core.md": "# 中文 Core",
    "i18n/en-US/docusaurus-plugin-content-docs/current/introduction.md":
      "# English overview",
    "i18n/en-US/docusaurus-plugin-content-docs-deployment/current/core.md":
      "# English Core",
    "i18n/en-US/docusaurus-theme-classic/navbar.json":
      '{"title":{"message":"Help Center"}}',
  }
  try {
    for (const [file, content] of Object.entries(sources)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), content)
    }
    await preparePublicDocs(root)
    assert.equal(
      await readFile(
        path.join(root, ".public-docs/docs/deploy/core.md"),
        "utf8",
      ),
      "# 中文 Core",
    )
    assert.equal(
      await readFile(
        path.join(
          root,
          ".public-docs/i18n/en-US/docusaurus-plugin-content-docs/current/deploy/core.md",
        ),
        "utf8",
      ),
      "# English Core",
    )
    for (const [file, content] of Object.entries(sources)) {
      assert.equal(await readFile(path.join(root, file), "utf8"), content)
    }
    await writeFile(path.join(root, ".public-docs/stale.md"), "old build")
    await preparePublicDocs(root)
    await assert.rejects(readFile(path.join(root, ".public-docs/stale.md")), {
      code: "ENOENT",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
