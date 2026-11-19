import type { Stats } from "node:fs"
import { chmod, chown, lstat, realpath, readdir } from "node:fs/promises"
import path from "node:path"

import { desktopArtifactUploadLifetimeMs, workspacePermissionPolicy } from "@linksense/shared"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import {
  failureToolResult,
  successToolResult,
  withRequestTimeout,
  type CoreMcpModuleDefinition,
  type CoreMcpToolModule,
} from "../core-service-module.js"

const artifactArgumentsSchema = z.strictObject({
  conversation_id: z.uuid().optional(),
  workspace_relative_path: z.string().min(1).max(2_000),
  display_name: z.string().min(1).max(260),
  mime_type: z.string().max(160).optional(),
  artifact_kind: z.string().max(80).optional(),
  web_root_relative_path: z.string().min(1).max(2_000).optional(),
})

const artifactResultSchema = z.object({
  success: z.literal(true),
  artifact_id: z.uuid(),
  file_id: z.uuid(),
  display_name: z.string().min(1).max(260),
  download_card_event_id: z.uuid(),
})

const artifactFailureSchema = z.object({
  code: z.enum([
    "WEB_SITE_BUNDLE_INVALID",
    "WEB_SITE_RESOURCES_MISSING",
    "ARTIFACT_NOT_FOUND",
    "ARTIFACT_REGISTRATION_BUSY",
    "ARTIFACT_REGISTRATION_FAILED",
    "ARTIFACT_REGISTRATION_INVALID",
    "ARTIFACT_REGISTRATION_UNAVAILABLE",
    "FILE_LIMIT_EXCEEDED",
    "FILE_SERVICE_FORBIDDEN",
    "FILE_SERVICE_TURN_INACTIVE",
    "RUNNER_OPERATION_UNCERTAIN",
  ]),
  retryable: z.boolean(),
  artifact_id: z.uuid().optional(),
})

type ArtifactFailure = z.infer<typeof artifactFailureSchema>

class FileServiceMcpError extends Error {
  constructor(readonly failure: ArtifactFailure) {
    super(failure.code)
    this.name = "FileServiceMcpError"
  }
}

export const fileServiceCoreMcpModule = {
  key: "file_service",
  modes: ["default"],
  toolNames: ["register_artifact"],
  create({ environment, workspaceRoot }): CoreMcpToolModule {
    const endpoint = z.url().parse(environment.LINKSENSE_FILE_SERVICE_ENDPOINT)
    // The desktop worker marks its own loopback endpoint. This trusted marker
    // never comes from tool arguments, so a model cannot request Mac behavior.
    const desktop = new URL(endpoint).searchParams.get("desktop") === "1"
    const requestTimeoutMs = desktop
      ? desktopArtifactUploadLifetimeMs + 10_000
      : 30_000
    const token = z
      .string()
      .min(32)
      .parse(environment.LINKSENSE_FILE_SERVICE_TOKEN)
    const conversationId = z
      .uuid()
      .parse(environment.LINKSENSE_CONVERSATION_ID)

    return {
      key: "file_service",
      tools: [desktop ? desktopArtifactTool : artifactTool],
      async callTool(input) {
        try {
          const arguments_ = artifactArgumentsSchema.parse(
            input.argumentsValue,
          )
          if (
            arguments_.conversation_id &&
            arguments_.conversation_id !== conversationId
          ) {
            throw new FileServiceMcpError({
              code: "FILE_SERVICE_FORBIDDEN",
              retryable: false,
            })
          }
          if (desktop) {
            // The task user owns these files, so no shared-permission
            // normalization runs. Reject website snapshots before any file
            // access; the Mac runtime has no snapshot builder.
            if (arguments_.web_root_relative_path) {
              throw new FileServiceMcpError({
                code: "ARTIFACT_REGISTRATION_INVALID",
                retryable: false,
              })
            }
          } else {
            await prepareArtifactForSharedRead(
              workspaceRoot,
              arguments_.workspace_relative_path,
            )
            if (arguments_.web_root_relative_path) await prepareWebDirectory(workspaceRoot, arguments_.web_root_relative_path)
          }
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              workspaceRelativePath: arguments_.workspace_relative_path,
              displayName: arguments_.display_name,
              ...(arguments_.mime_type
                ? { mimeType: arguments_.mime_type }
                : {}),
              ...(arguments_.artifact_kind
                ? { artifactKind: arguments_.artifact_kind }
                : {}),
              ...(arguments_.web_root_relative_path ? { webRootRelativePath: arguments_.web_root_relative_path } : {}),
            }),
            signal: withRequestTimeout(input.signal, requestTimeoutMs),
          })
          const result = await parseResponse(response, desktop)
          if (!response.ok) {
            const failure = artifactFailureSchema.safeParse(result)
            return failureToolResult(
              failure.success
                ? failure.data
                : {
                    code: desktop ? "RUNNER_OPERATION_UNCERTAIN" : "ARTIFACT_REGISTRATION_UNAVAILABLE",
                    retryable: !desktop,
                  },
            )
          }
          const artifact = artifactResultSchema.safeParse(result)
          if (!artifact.success) {
            throw new FileServiceMcpError({
              code: desktop ? "RUNNER_OPERATION_UNCERTAIN" : "ARTIFACT_REGISTRATION_UNAVAILABLE",
              retryable: !desktop,
            })
          }
          return successToolResult(artifact.data)
        } catch (error) {
          if (input.signal.aborted) throw error
          return failureToolResult(classifyFailure(error, desktop))
        }
      },
    }
  },
} satisfies CoreMcpModuleDefinition

async function prepareArtifactForSharedRead(
  workspaceRootInput: string,
  workspaceRelativePath: string,
): Promise<void> {
  const workspaceRoot = path.resolve(workspaceRootInput)
  const target = path.resolve(workspaceRoot, workspaceRelativePath)
  const relativeTarget = path.relative(workspaceRoot, target)
  if (
    !relativeTarget ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw invalidArtifactRegistration()
  }

  let fileInfo
  try {
    fileInfo = await lstat(target)
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return
    throw invalidArtifactRegistration()
  }
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw invalidArtifactRegistration()
  }
  const [canonicalWorkspace, canonicalTarget] = await Promise.all([
    realpath(workspaceRoot),
    realpath(target),
  ]).catch(() => {
    throw invalidArtifactRegistration()
  })
  if (!canonicalTarget.startsWith(`${canonicalWorkspace}${path.sep}`)) {
    throw invalidArtifactRegistration()
  }

  const directories: Array<{ path: string; info: Stats }> = []
  let directory = path.dirname(target)
  while (directory !== workspaceRoot) {
    const info = await lstat(directory).catch(() => {
      throw invalidArtifactRegistration()
    })
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw invalidArtifactRegistration()
    }
    directories.push({ path: directory, info })
    const parent = path.dirname(directory)
    if (parent === directory) throw invalidArtifactRegistration()
    directory = parent
  }

  for (const entry of directories.reverse()) {
    await normalizeSharedEntry(
      entry.path,
      entry.info,
      workspacePermissionPolicy.sharedDirectory,
      0o010,
    )
  }
  const fileMode =
    (fileInfo.mode & 0o111) !== 0
      ? workspacePermissionPolicy.sharedExecutableFile
      : workspacePermissionPolicy.sharedReadableFile
  await normalizeSharedEntry(target, fileInfo, fileMode, 0o040)
}

async function normalizeSharedEntry(
  target: string,
  info: Stats,
  mode: number,
  requiredGroupBit: number,
): Promise<void> {
  const currentUid = process.getuid?.()
  const sharedGid = process.getgid?.()
  if (currentUid === undefined || sharedGid === undefined) {
    throw invalidArtifactRegistration()
  }
  if (info.uid === currentUid) {
    try {
      if (info.gid !== sharedGid) await chown(target, info.uid, sharedGid)
      if ((info.mode & 0o7777) !== mode) await chmod(target, mode)
    } catch {
      throw invalidArtifactRegistration()
    }
    return
  }
  if (info.gid !== sharedGid || (info.mode & requiredGroupBit) === 0) {
    throw invalidArtifactRegistration()
  }
}

function invalidArtifactRegistration(): FileServiceMcpError {
  return new FileServiceMcpError({
    code: "ARTIFACT_REGISTRATION_INVALID",
    retryable: false,
  })
}

async function parseResponse(response: Response, desktop: boolean): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new FileServiceMcpError({
      code: desktop ? "RUNNER_OPERATION_UNCERTAIN" : "ARTIFACT_REGISTRATION_UNAVAILABLE",
      retryable: !desktop,
    })
  }
}

function classifyFailure(error: unknown, desktop: boolean): ArtifactFailure {
  if (error instanceof FileServiceMcpError) return error.failure
  if (error instanceof z.ZodError) {
    return {
      code: "ARTIFACT_REGISTRATION_INVALID",
      retryable: false,
    }
  }
  return {
    code: desktop ? "RUNNER_OPERATION_UNCERTAIN" : "ARTIFACT_REGISTRATION_UNAVAILABLE",
    retryable: !desktop,
  }
}

function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

const artifactTool = {
  name: "register_artifact",
  description:
    "Register an existing file from the current task as a downloadable artifact. To deliver a registered file, include a Markdown link in the final answer using the returned display_name as its relative target, for example [report.pdf](report.pdf). Link only final deliverables there; keep process images, temporary outputs, and reference files in commentary. For a webpage with local JS, CSS, images, fonts, or data, put all public files in a dedicated directory and set web_root_relative_path to that directory; workspace_relative_path is its HTML entry. This snapshots the complete website for link sharing. Use relative resource URLs, including runtime fetch URLs. Do not include secrets, dotfiles, node_modules, source maps, or source projects; use their built static output. Single self-contained HTML needs no web_root_relative_path.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string", format: "uuid" },
      workspace_relative_path: { type: "string" },
      display_name: { type: "string" },
      mime_type: { type: "string" },
      artifact_kind: { type: "string" },
      web_root_relative_path: { type: "string", description: "Dedicated public website directory inside this task workspace; never the whole workspace." },
    },
    required: ["workspace_relative_path", "display_name"],
    additionalProperties: false,
  },
} satisfies Tool

const singleFileProperties = Object.fromEntries(
  Object.entries(artifactTool.inputSchema.properties).filter(([name]) => name !== "web_root_relative_path"),
)
const desktopArtifactTool: Tool = {
  ...artifactTool,
  description: "Register one existing workspace file as a downloadable artifact. In the final answer, link to the returned display_name. If confirmation is uncertain, check the conversation's artifact list for the returned artifact_id; do not upload the file again.",
  inputSchema: { ...artifactTool.inputSchema, properties: singleFileProperties },
}

async function prepareWebDirectory(workspaceRoot: string, directory: string): Promise<void> {
  const root = path.resolve(workspaceRoot, directory)
  if (!root.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`)) throw invalidArtifactRegistration()
  let entries = 0
  const visit = async (current: string): Promise<void> => {
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current) throw invalidArtifactRegistration()
    for (const name of await readdir(current)) {
      if (++entries > 1_000 || name.startsWith(".") || name === "node_modules") throw invalidArtifactRegistration()
      const target = path.join(current, name)
      const stat = await lstat(target)
      if (stat.isSymbolicLink()) throw invalidArtifactRegistration()
      if (stat.isDirectory()) await visit(target)
      else await prepareArtifactForSharedRead(workspaceRoot, path.relative(workspaceRoot, target))
    }
  }
  await visit(root)
}
