import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, describe, expect, it } from "vitest"

import { documentConversionCoreMcpModule } from "../src/mcp/core-services/document-conversion.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("document conversion Core MCP module", () => {
  it("converts a supported workspace document to Markdown", async () => {
    const workspaceRoot = await createWorkspace()
    await writeFile(
      join(workspaceRoot, "attachments", "people.csv"),
      "name,role\nAda,Engineer\nLin,Designer\n",
      "utf8",
    )

    const result = await callTool(workspaceRoot, {
      workspace_relative_path: "attachments/people.csv",
    })

    expect(result.isError).toBe(false)
    const payload = successPayload(result)
    expect(payload).toMatchObject({
      success: true,
      byte_start: 0,
      complete: true,
      next_byte_offset: null,
    })
    expect(payload.markdown).toContain("Ada")
    expect(payload.markdown_sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(payload.byte_end).toBe(payload.total_bytes)
  })

  it("returns stable UTF-8 pages pinned to the converted Markdown digest", async () => {
    const workspaceRoot = await createWorkspace()
    const rows = Array.from(
      { length: 240 },
      (_, index) => `${index},成员${index},研发与设计`,
    )
    await writeFile(
      join(workspaceRoot, "attachments", "team.csv"),
      `id,name,role\n${rows.join("\n")}\n`,
      "utf8",
    )

    const pages: string[] = []
    let byteOffset = 0
    let expectedMarkdownSha256: string | undefined
    let complete = false
    let totalBytes = 0

    while (!complete) {
      const result = await callTool(workspaceRoot, {
        workspace_relative_path: "attachments/team.csv",
        byte_offset: byteOffset,
        max_bytes: 1_024,
        ...(expectedMarkdownSha256
          ? { expected_markdown_sha256: expectedMarkdownSha256 }
          : {}),
      })
      expect(result.isError).toBe(false)
      const payload = successPayload(result)
      pages.push(payload.markdown)
      expectedMarkdownSha256 = payload.markdown_sha256
      totalBytes = payload.total_bytes
      complete = payload.complete
      if (!complete) {
        expect(payload.next_byte_offset).toBe(payload.byte_end)
        byteOffset = payload.next_byte_offset!
      }
    }

    expect(Buffer.byteLength(pages.join(""), "utf8")).toBe(totalBytes)
    expect(pages.join("")).toContain("成员239")
  })

  it("rejects continuation pages after the source document changes", async () => {
    const workspaceRoot = await createWorkspace()
    const sourcePath = join(workspaceRoot, "attachments", "large.csv")
    await writeFile(
      sourcePath,
      `id,value\n${"1,original value\n".repeat(200)}`,
      "utf8",
    )
    const first = successPayload(
      await callTool(workspaceRoot, {
        workspace_relative_path: "attachments/large.csv",
        max_bytes: 1_024,
      }),
    )
    expect(first.complete).toBe(false)

    await writeFile(
      sourcePath,
      `id,value\n${"1,changed value\n".repeat(200)}`,
      "utf8",
    )
    const continuation = await callTool(workspaceRoot, {
      workspace_relative_path: "attachments/large.csv",
      byte_offset: first.next_byte_offset!,
      max_bytes: 1_024,
      expected_markdown_sha256: first.markdown_sha256,
    })

    expect(continuation.isError).toBe(true)
    expect(failurePayload(continuation)).toEqual({
      code: "DOCUMENT_CHANGED",
      retryable: false,
    })
  })

  it("rejects paths outside the workspace and symbolic links", async () => {
    const workspaceRoot = await createWorkspace()
    const outsideRoot = await mkdtemp(join(tmpdir(), "linksense-anydoc-outside-"))
    roots.push(outsideRoot)
    const outsidePath = join(outsideRoot, "outside.csv")
    await writeFile(outsidePath, "name\nprivate\n", "utf8")
    await symlink(
      outsidePath,
      join(workspaceRoot, "attachments", "linked.csv"),
    )

    for (const workspaceRelativePath of [
      "../outside.csv",
      "attachments/linked.csv",
    ]) {
      const result = await callTool(workspaceRoot, {
        workspace_relative_path: workspaceRelativePath,
      })
      expect(result.isError).toBe(true)
      expect(failurePayload(result)).toEqual({
        code: "DOCUMENT_CONVERSION_INVALID",
        retryable: false,
      })
    }
  })

  it("returns a stable unsupported-format failure", async () => {
    const workspaceRoot = await createWorkspace()
    await writeFile(
      join(workspaceRoot, "attachments", "notes.txt"),
      "plain text is intentionally not a supported AnyDoc input",
      "utf8",
    )

    const result = await callTool(workspaceRoot, {
      workspace_relative_path: "attachments/notes.txt",
    })

    expect(result.isError).toBe(true)
    expect(failurePayload(result)).toEqual({
      code: "DOCUMENT_UNSUPPORTED",
      retryable: false,
    })
  })
})

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "linksense-anydoc-"))
  roots.push(workspaceRoot)
  await mkdir(join(workspaceRoot, "attachments"), { recursive: true })
  return workspaceRoot
}

async function callTool(
  workspaceRoot: string,
  argumentsValue: Record<string, unknown>,
): Promise<CallToolResult> {
  const module = documentConversionCoreMcpModule.create({
    environment: {},
    workspaceRoot,
  })
  return module.callTool({
    toolName: "convert_document_to_markdown",
    argumentsValue,
    signal: AbortSignal.timeout(10_000),
  })
}

type DocumentConversionPayload = {
  success: true
  markdown: string
  markdown_sha256: string
  byte_start: number
  byte_end: number
  total_bytes: number
  next_byte_offset: number | null
  complete: boolean
}

type DocumentConversionFailurePayload = {
  code: string
  retryable: boolean
}

function successPayload(result: CallToolResult): DocumentConversionPayload {
  return resultPayload(result) as DocumentConversionPayload
}

function failurePayload(
  result: CallToolResult,
): DocumentConversionFailurePayload {
  return resultPayload(result) as DocumentConversionFailurePayload
}

function resultPayload(result: CallToolResult): unknown {
  const content = result.content[0]
  if (!content || content.type !== "text") {
    throw new Error("expected a text MCP result")
  }
  return JSON.parse(content.text) as unknown
}
