import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { workspacePermissionPolicy } from "@linksense/shared"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  blockUnresolvedLocalMarkdownImages,
  projectAssistantMessageAssets,
  projectImageViewAsset,
} from "../src/codex/assistant-message-assets.js"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)
const FILE_ID = "30000000-0000-4000-8000-000000000001"
const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("assistant message image projection", () => {
  it("registers a viewed workspace image as a guarded inline artifact", async () => {
    const fixture = await imageFixture()
    const source = join(fixture.workspace, "temp", "preview.png")
    const internalRoot = join(fixture.workspace, ".linksense")
    const handoffRoot = join(internalRoot, "inline-images")
    await mkdir(dirname(source), { recursive: true })
    await mkdir(handoffRoot, { recursive: true, mode: 0o700 })
    await Promise.all([
      chmod(internalRoot, 0o700),
      chmod(handoffRoot, 0o700),
    ])
    await writeFile(source, PNG)
    const registerArtifact = vi.fn(async (input) => {
      const handoffPath = join(
        fixture.workspace,
        input.workspaceRelativePath,
      )
      expect(await readFile(handoffPath)).toEqual(PNG)
      expect((await stat(internalRoot)).mode & 0o7777).toBe(
        workspacePermissionPolicy.sharedReadonlyDirectory,
      )
      expect((await stat(handoffRoot)).mode & 0o7777).toBe(
        workspacePermissionPolicy.sharedReadonlyDirectory,
      )
      expect((await stat(dirname(handoffPath))).mode & 0o7777).toBe(
        workspacePermissionPolicy.sharedReadonlyDirectory,
      )
      expect((await stat(handoffPath)).mode & 0o777).toBe(
        workspacePermissionPolicy.sharedReadonlyFile,
      )
      return { file_id: FILE_ID }
    })

    await expect(
      projectImageViewAsset({
        path: "$WORKSPACE/temp/preview.png",
        workspace: fixture.workspace,
        codexHome: fixture.codexHome,
        authorizedSkills: [],
        turnId: "turn-image-view",
        itemId: "image-view-1",
        registerArtifact,
      })
    ).resolves.toEqual({ fileId: FILE_ID })
    expect(registerArtifact).toHaveBeenCalledWith({
      workspaceRelativePath: expect.stringMatching(
        /^\.linksense\/inline-images\/turn-image-view-image-view-1-[^/]+\/[0-9a-f]{64}\.png$/u
      ),
      displayName: "preview.png",
      mimeType: "image/png",
      artifactKind: "inline_image",
    })
  })

  it("copies a workspace image into the guarded handoff area and rewrites Markdown", async () => {
    const fixture = await imageFixture()
    const source = join(fixture.workspace, "generated", "preview.png")
    await mkdir(dirname(source), { recursive: true })
    await writeFile(source, PNG)
    const registerArtifact = vi.fn(async (input) => {
      expect(await readFile(join(fixture.workspace, input.workspaceRelativePath))).toEqual(
        PNG,
      )
      return { file_id: FILE_ID }
    })

    const result = await projectAssistantMessageAssets({
      text: `结果如下：\n\n![风格参考](${source})`,
      workspace: fixture.workspace,
      codexHome: fixture.codexHome,
      authorizedSkills: [],
      turnId: "turn-1",
      itemId: "message-1",
      registerArtifact,
    })

    expect(result).toEqual({
      text: `结果如下：\n\n![风格参考](linksense-artifact:${FILE_ID})`,
      registeredImageCount: 1,
      unavailableImageCount: 0,
    })
    expect(registerArtifact).toHaveBeenCalledWith({
      workspaceRelativePath: expect.stringMatching(
        /^\.linksense\/inline-images\/turn-1-message-1-[^/]+\/[0-9a-f]{64}\.png$/u,
      ),
      displayName: "inline-image-1.png",
      mimeType: "image/png",
      artifactKind: "inline_image",
    })
  })

  it("allows only authorized skill assets and supports reference-style images", async () => {
    const fixture = await imageFixture()
    const skillFile = join(
      fixture.codexHome,
      ".agents",
      "skills",
      "presentations",
      "SKILL.md",
    )
    const source = join(dirname(skillFile), "assets", "theme.png")
    await mkdir(dirname(source), { recursive: true })
    await writeFile(skillFile, "# Presentations")
    await writeFile(source, PNG)
    const registerArtifact = vi.fn(async () => ({ file_id: FILE_ID }))

    const result = await projectAssistantMessageAssets({
      text: `![主题预览][theme]\n\n[theme]: ${source} "主题"`,
      workspace: fixture.workspace,
      codexHome: fixture.codexHome,
      authorizedSkills: [{ name: "presentations", path: skillFile }],
      turnId: "turn-2",
      itemId: "message-2",
      registerArtifact,
    })

    expect(result.text).toContain(
      `![主题预览](linksense-artifact:${FILE_ID})`,
    )
    expect(result.text).not.toContain(source)
    expect(result.text).not.toContain("[theme]:")
    expect(registerArtifact).toHaveBeenCalledOnce()
  })

  it("removes local reference definitions when unresolved images are blocked", () => {
    const source = "/data/linksense/codex-home/private/theme.png"
    const result = blockUnresolvedLocalMarkdownImages(
      `![主题预览][theme]\n\n[theme]: ${source} "主题"`,
    )

    expect(result).toContain(
      "![主题预览](linksense-artifact:unavailable)",
    )
    expect(result).not.toContain(source)
    expect(result).not.toContain("[theme]:")
  })

  it("fails closed for unapproved paths, symlinks, and registration errors", async () => {
    const fixture = await imageFixture()
    const outside = join(fixture.root, "outside.png")
    const linked = join(fixture.workspace, "linked.png")
    const valid = join(fixture.workspace, "valid.png")
    await writeFile(outside, PNG)
    await writeFile(valid, PNG)
    await symlink(outside, linked)
    const registerArtifact = vi.fn(async () => {
      throw new Error("file service unavailable")
    })

    const result = await projectAssistantMessageAssets({
      text: [
        `![outside](${outside})`,
        `![linked](${linked})`,
        "![missing]($CODEX_HOME/private.png)",
        `![registration-failed](${valid})`,
        "![remote](https://example.com/remote.png)",
      ].join("\n"),
      workspace: fixture.workspace,
      codexHome: fixture.codexHome,
      authorizedSkills: [],
      turnId: "turn-3",
      itemId: "message-3",
      registerArtifact,
    })

    expect(result.text).toBe(
      [
        "![outside](linksense-artifact:unavailable)",
        "![linked](linksense-artifact:unavailable)",
        "![missing](linksense-artifact:unavailable)",
        "![registration-failed](linksense-artifact:unavailable)",
        "![remote](https://example.com/remote.png)",
      ].join("\n"),
    )
    expect(result.text).not.toContain(fixture.root)
    expect(result.unavailableImageCount).toBe(4)
    expect(registerArtifact).toHaveBeenCalledOnce()
  })

  it("blocks unresolved local image URLs without changing remote images", () => {
    expect(
      blockUnresolvedLocalMarkdownImages(
        "![local](/data/linksense/private.png)\n![remote](https://example.com/a.png)",
      ),
    ).toBe(
      "![local](linksense-artifact:unavailable)\n![remote](https://example.com/a.png)",
    )
  })
})

async function imageFixture() {
  const root = await mkdtemp(join(tmpdir(), "linksense-inline-image-"))
  roots.push(root)
  const workspace = join(root, "workspace")
  const codexHome = join(root, "codex-home")
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
  ])
  return { root, workspace, codexHome }
}
