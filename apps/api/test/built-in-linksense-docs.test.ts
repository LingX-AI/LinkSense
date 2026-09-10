import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  bundleLinksenseDocsSources,
  resolveLinksenseDocsSourceRoots,
  writeBuiltInLinksenseDocs,
  type LinksenseDocsSourceRoots,
} from "../src/modules/capabilities/built-in-linksense-docs.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe("linksense-docs built-in Skill", () => {
  it("materializes the official bilingual help documentation as a valid Skill", async () => {
    const workspace = await temporaryDirectory()
    const skillsRoot = path.join(workspace, "skills")
    await mkdir(skillsRoot)

    await writeBuiltInLinksenseDocs(skillsRoot)

    const skillRoot = path.join(skillsRoot, "linksense-docs")
    const sourceRoots = await resolveLinksenseDocsSourceRoots()
    const [chinesePaths, englishPaths, sourceChinesePaths] = await Promise.all([
      markdownPaths(path.join(skillRoot, "references", "zh-CN")),
      markdownPaths(path.join(skillRoot, "references", "en-US")),
      markdownPaths(sourceRoots["zh-CN"]),
    ])

    expect(chinesePaths).toHaveLength(60)
    expect(chinesePaths).toEqual(expect.arrayContaining([
      "user-guide/tasks/task-categories.md",
      "user-guide/message-channels/wecom.md",
      "user-guide/message-channels/dingtalk.md",
      "user-guide/message-channels/teams.md",
    ]))
    expect(englishPaths).toEqual(chinesePaths)
    expect(chinesePaths).toEqual(sourceChinesePaths)
    await expect(
      readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
    ).resolves.toMatch(/name: linksense-docs[\s\S]*references\/catalog\.md/u)
    await expect(
      readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8"),
    ).resolves.toMatch(
      /default_prompt: "Use \$linksense-docs[\s\S]*allow_implicit_invocation: true/u,
    )
    await expect(
      readFile(path.join(skillRoot, "references", "catalog.md"), "utf8"),
    ).resolves.toMatch(
      /\[创建与运行任务\]\(zh-CN\/user-guide\/tasks\/create-and-run\.md\)[\s\S]*`\/help\/user-guide\/tasks\/create-and-run\/`[\s\S]*\[Create and run tasks\]\(en-US\/user-guide\/tasks\/create-and-run\.md\)/u,
    )
    const catalog = await readFile(
      path.join(skillRoot, "references", "catalog.md"),
      "utf8",
    )
    expect(catalog).toContain(
      "[使用计划模式](zh-CN/user-guide/tasks/plan-mode.md)",
    )
    expect(catalog).toContain(
      "[Check for and install LinkSense updates](en-US/admin-guide/system-update.md)",
    )
    await expect(
      readFile(
        path.join(
          skillRoot,
          "references",
          "zh-CN",
          "user-guide",
          "tasks",
          "create-and-run.md",
        ),
        "utf8",
      ),
    ).resolves.toBe(
      await readFile(
        path.join(
          sourceRoots["zh-CN"],
          "user-guide",
          "tasks",
          "create-and-run.md",
        ),
        "utf8",
      ),
    )
    await expect(fileMode(path.join(skillRoot, "SKILL.md"))).resolves.toBe(
      0o640,
    )
  })

  it("bundles exact Markdown sources for the production API package", async () => {
    const workspace = await temporaryDirectory()
    const outputRoot = path.join(workspace, "bundled")
    const sourceRoots = await resolveLinksenseDocsSourceRoots()

    await bundleLinksenseDocsSources({ sourceRoots, outputRoot })

    const [chinesePaths, englishPaths] = await Promise.all([
      markdownPaths(path.join(outputRoot, "zh-CN")),
      markdownPaths(path.join(outputRoot, "en-US")),
    ])
    expect(chinesePaths).toHaveLength(60)
    expect(englishPaths).toEqual(chinesePaths)
    await expect(
      readFile(path.join(outputRoot, "zh-CN", "introduction.md"), "utf8"),
    ).resolves.toBe(
      await readFile(path.join(sourceRoots["zh-CN"], "introduction.md"), "utf8"),
    )
  })

  it("rejects locale drift and symbolic links before publishing", async () => {
    const workspace = await temporaryDirectory()
    const sourceRoots = await createSourceRoots(workspace)
    await writeDocument(
      path.join(sourceRoots["zh-CN"], "only-chinese.md"),
      "中文",
    )

    await expect(
      writeBuiltInLinksenseDocs(path.join(workspace, "skills"), {
        sourceRoots,
      }),
    ).rejects.toThrow(
      "Chinese and English LinkSense documentation paths do not match",
    )

    await writeDocument(
      path.join(sourceRoots["en-US"], "only-chinese.md"),
      "English",
    )
    await writeDocument(
      path.join(sourceRoots["zh-CN"], "target.md"),
      "目标",
    )
    await symlink(
      path.join(sourceRoots["zh-CN"], "target.md"),
      path.join(sourceRoots["zh-CN"], "linked.md"),
    )

    await expect(
      bundleLinksenseDocsSources({
        sourceRoots,
        outputRoot: path.join(workspace, "output"),
      }),
    ).rejects.toThrow("LinkSense documentation cannot contain symlinks")
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-docs-"))
  temporaryDirectories.push(directory)
  return directory
}

async function createSourceRoots(
  workspace: string,
): Promise<LinksenseDocsSourceRoots> {
  const roots = {
    "zh-CN": path.join(workspace, "source", "zh-CN"),
    "en-US": path.join(workspace, "source", "en-US"),
  }
  await Promise.all(Object.values(roots).map((root) => mkdir(root, { recursive: true })))
  return roots
}

async function writeDocument(
  destination: string,
  title: string,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(
    destination,
    `---\ntitle: ${title}\ndescription: ${title} description\n---\n\n# ${title}\n`,
  )
}

async function markdownPaths(
  root: string,
  current = root,
): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) return markdownPaths(root, entryPath)
      if (entry.isFile() && entry.name.endsWith(".md")) {
        return [path.relative(root, entryPath).split(path.sep).join("/")]
      }
      return []
    }),
  )
  return nested.flat().sort()
}

async function fileMode(filePath: string): Promise<number> {
  return (await stat(filePath)).mode & 0o777
}
