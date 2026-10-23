import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { MAX_IMAGE_PREVIEW_BYTES, workspacePermissionPolicy } from "@linksense/shared"
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
    const registerPreview = vi.fn(async (input) => {
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
        registerPreview,
      })
    ).resolves.toEqual({ fileId: FILE_ID })
    expect(registerPreview).toHaveBeenCalledWith({
      workspaceRelativePath: expect.stringMatching(
        /^\.linksense\/inline-images\/turn-image-view-image-view-1-[^/]+\/[0-9a-f]{64}\.png$/u
      ),
      displayName: "preview.png",
      mimeType: "image/png",
    })
  })

  it.each(["c1.png", "c2.png", "c3.png", "c4.png"])(
    "snapshots a natively viewed temporary image %s before the source disappears",
    async (filename) => {
      const fixture = await imageFixture()
      const temporaryRoot = join(fixture.root, "worker-tmp")
      const source = join(temporaryRoot, filename)
      await mkdir(temporaryRoot)
      await writeFile(source, PNG)
      let handoffPath = ""
      const registerPreview = vi.fn(async (input) => {
        handoffPath = join(fixture.workspace, input.workspaceRelativePath)
        await rm(source)
        expect(await readFile(handoffPath)).toEqual(PNG)
        return { file_id: FILE_ID }
      })

      await expect(projectImageViewAsset({
        path: source,
        workspace: fixture.workspace,
        codexHome: fixture.codexHome,
        authorizedSkills: [],
        temporaryRoots: [temporaryRoot],
        turnId: "turn-temporary-image",
        itemId: filename,
        registerPreview,
      })).resolves.toEqual({ fileId: FILE_ID })
      expect(registerPreview).toHaveBeenCalledExactlyOnceWith({
        workspaceRelativePath: expect.stringMatching(/^\.linksense\/inline-images\//u),
        displayName: filename,
        mimeType: "image/png",
      })
      await expect(stat(handoffPath)).rejects.toMatchObject({ code: "ENOENT" })
    },
  )

  it("rejects temporary images without an explicit root and prevents symlink escapes", async () => {
    const fixture = await imageFixture()
    const temporaryRoot = join(fixture.root, "worker-tmp")
    const outsideRoot = join(fixture.root, "other-worker-tmp")
    await Promise.all([mkdir(temporaryRoot), mkdir(outsideRoot)])
    const source = join(temporaryRoot, "crop.png")
    const outside = join(outsideRoot, "private.png")
    const linked = join(temporaryRoot, "linked.png")
    const linkedDirectory = join(temporaryRoot, "linked-directory")
    await Promise.all([writeFile(source, PNG), writeFile(outside, PNG)])
    await symlink(outside, linked)
    await symlink(outsideRoot, linkedDirectory, "dir")
    const registerPreview = vi.fn(async () => ({ file_id: FILE_ID }))
    const base = {
      workspace: fixture.workspace,
      codexHome: fixture.codexHome,
      authorizedSkills: [],
      turnId: "turn-temporary-image",
      itemId: "temporary-image",
      registerPreview,
    }

    await expect(projectImageViewAsset({ ...base, path: source })).rejects.toThrow("inline_image_source_forbidden")
    for (const path of [outside, linked, join(linkedDirectory, "private.png")]) {
      await expect(projectImageViewAsset({ ...base, path, temporaryRoots: [temporaryRoot] })).rejects.toThrow()
    }
    const markdown = await projectAssistantMessageAssets({ ...base, text: `![crop](${source})` })
    expect(markdown.text).toBe("![crop](linksense-artifact:unavailable)")
    expect(registerPreview).not.toHaveBeenCalled()
  })

  it.each(["unsupported type", "oversized file"])("rejects a temporary image with %s before registration", async (failure) => {
    const fixture = await imageFixture()
    const temporaryRoot = join(fixture.root, "worker-tmp")
    const source = join(temporaryRoot, "crop.png")
    await mkdir(temporaryRoot)
    await writeFile(source, failure === "unsupported type" ? "not an image" : PNG)
    if (failure === "oversized file") await truncate(source, MAX_IMAGE_PREVIEW_BYTES + 1)
    const registerPreview = vi.fn(async () => ({ file_id: FILE_ID }))

    await expect(projectImageViewAsset({
      path: source,
      workspace: fixture.workspace,
      codexHome: fixture.codexHome,
      authorizedSkills: [],
      temporaryRoots: [temporaryRoot],
      turnId: "turn-temporary-image",
      itemId: "invalid-image",
      registerPreview,
    })).rejects.toThrow(failure === "unsupported type"
      ? "inline_image_type_unsupported"
      : "inline_image_source_too_large")
    expect(registerPreview).not.toHaveBeenCalled()
  })

  it("copies a workspace image into the guarded handoff area and rewrites Markdown", async () => {
    const fixture = await imageFixture()
    const source = join(fixture.workspace, "generated", "preview.png")
    await mkdir(dirname(source), { recursive: true })
    await writeFile(source, PNG)
    const registerPreview = vi.fn(async (input) => {
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
      registerPreview,
    })

    expect(result).toEqual({
      text: `结果如下：\n\n![风格参考](linksense-artifact:${FILE_ID})`,
      registeredImageCount: 1,
      unavailableImageCount: 0,
    })
    expect(registerPreview).toHaveBeenCalledWith({
      workspaceRelativePath: expect.stringMatching(
        /^\.linksense\/inline-images\/turn-1-message-1-[^/]+\/[0-9a-f]{64}\.png$/u,
      ),
      displayName: "inline-image-1.png",
      mimeType: "image/png",
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
    const registerPreview = vi.fn(async () => ({ file_id: FILE_ID }))

    const result = await projectAssistantMessageAssets({
      text: `![主题预览][theme]\n\n[theme]: ${source} "主题"`,
      workspace: fixture.workspace,
      codexHome: fixture.codexHome,
      authorizedSkills: [{ name: "presentations", path: skillFile }],
      turnId: "turn-2",
      itemId: "message-2",
      registerPreview,
    })

    expect(result.text).toContain(
      `![主题预览](linksense-artifact:${FILE_ID})`,
    )
    expect(result.text).not.toContain(source)
    expect(result.text).not.toContain("[theme]:")
    expect(registerPreview).toHaveBeenCalledOnce()
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
    const registerPreview = vi.fn(async () => {
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
      registerPreview,
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
    expect(registerPreview).toHaveBeenCalledOnce()
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
