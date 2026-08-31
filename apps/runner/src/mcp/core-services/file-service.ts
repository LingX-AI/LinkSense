import type { Stats } from "node:fs"
import { chmod, chown, lstat, realpath } from "node:fs/promises"
import path from "node:path"

import { workspacePermissionPolicy } from "@linksense/shared"
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
    "ARTIFACT_NOT_FOUND",
    "ARTIFACT_REGISTRATION_BUSY",
    "ARTIFACT_REGISTRATION_FAILED",
    "ARTIFACT_REGISTRATION_INVALID",
    "ARTIFACT_REGISTRATION_UNAVAILABLE",
    "FILE_LIMIT_EXCEEDED",
    "FILE_SERVICE_FORBIDDEN",
    "FILE_SERVICE_TURN_INACTIVE",
  ]),
  retryable: z.boolean(),
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
    const token = z
      .string()
      .min(32)
      .parse(environment.LINKSENSE_FILE_SERVICE_TOKEN)
    const conversationId = z
      .uuid()
      .parse(environment.LINKSENSE_CONVERSATION_ID)

    return {
      key: "file_service",
      tools: [artifactTool],
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
          await prepareArtifactForSharedRead(
            workspaceRoot,
            arguments_.workspace_relative_path,
          )
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
            }),
            signal: withRequestTimeout(input.signal, 30_000),
          })
          const result = await parseResponse(response)
          if (!response.ok) {
            const failure = artifactFailureSchema.safeParse(result)
            return failureToolResult(
              failure.success
                ? failure.data
                : {
                    code: "ARTIFACT_REGISTRATION_UNAVAILABLE",
                    retryable: true,
                  },
            )
          }
          const artifact = artifactResultSchema.safeParse(result)
          if (!artifact.success) {
            throw new FileServiceMcpError({
              code: "ARTIFACT_REGISTRATION_UNAVAILABLE",
              retryable: true,
            })
          }
          return successToolResult(artifact.data)
        } catch (error) {
          if (input.signal.aborted) throw error
          return failureToolResult(classifyFailure(error))
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

async function parseResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new FileServiceMcpError({
      code: "ARTIFACT_REGISTRATION_UNAVAILABLE",
      retryable: true,
    })
  }
}

function classifyFailure(error: unknown): ArtifactFailure {
  if (error instanceof FileServiceMcpError) return error.failure
  if (error instanceof z.ZodError) {
    return {
      code: "ARTIFACT_REGISTRATION_INVALID",
      retryable: false,
    }
  }
  return {
    code: "ARTIFACT_REGISTRATION_UNAVAILABLE",
    retryable: true,
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
    "Register one existing file, including supported audio or video, from the current LinkSense task workspace as a downloadable artifact.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string", format: "uuid" },
      workspace_relative_path: { type: "string" },
      display_name: { type: "string" },
      mime_type: { type: "string" },
      artifact_kind: { type: "string" },
    },
    required: ["workspace_relative_path", "display_name"],
    additionalProperties: false,
  },
} satisfies Tool
