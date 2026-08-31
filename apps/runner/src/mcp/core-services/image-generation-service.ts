import { randomUUID } from "node:crypto"
import path from "node:path"

import {
  imageGenerationInternalResultSchema,
  imageGenerationMcpFailureSchema,
  imageGenerationMcpSuccessSchema,
  imageGenerationRequestSchema,
  type ImageGenerationMcpFailure,
  type ImageGenerationMcpSuccess,
} from "@linksense/shared"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import {
  removeSharedWorkspaceFile,
  writeSharedWorkspaceFile,
} from "../../workspace/shared-workspace-file.js"
import {
  failureToolResult,
  successToolResult,
  withRequestTimeout,
  type CoreMcpModuleDefinition,
  type CoreMcpToolModule,
} from "../core-service-module.js"

const generateImageArgumentsSchema = imageGenerationRequestSchema.extend({
  conversation_id: z.uuid().optional(),
})

const artifactResultSchema = z.object({
  success: z.literal(true),
  artifact_id: z.uuid(),
  file_id: z.uuid(),
  display_name: z.string().min(1).max(260),
  download_card_event_id: z.uuid(),
})

class ImageGenerationMcpError extends Error {
  constructor(readonly failure: ImageGenerationMcpFailure) {
    super(failure.code)
    this.name = "ImageGenerationMcpError"
  }
}

export const imageGenerationCoreMcpModule = {
  key: "image_generation",
  modes: ["default"],
  toolNames: ["generate_image"],
  create({ environment, workspaceRoot }): CoreMcpToolModule {
    const endpoint = z
      .url()
      .parse(environment.LINKSENSE_IMAGE_GENERATION_ENDPOINT)
    const token = z
      .string()
      .min(32)
      .parse(environment.LINKSENSE_IMAGE_GENERATION_TOKEN)
    const fileServiceEndpoint = z
      .url()
      .parse(environment.LINKSENSE_FILE_SERVICE_ENDPOINT)
    const fileServiceToken = z
      .string()
      .min(32)
      .parse(environment.LINKSENSE_FILE_SERVICE_TOKEN)
    const conversationId = z
      .uuid()
      .parse(environment.LINKSENSE_CONVERSATION_ID)

    return {
      key: "image_generation",
      tools: [generateImageTool],
      async callTool(input) {
        try {
          const arguments_ = generateImageArgumentsSchema.parse(
            input.argumentsValue,
          )
          if (
            arguments_.conversation_id &&
            arguments_.conversation_id !== conversationId
          ) {
            throw new ImageGenerationMcpError({
              code: "IMAGE_GENERATION_FORBIDDEN",
              retryable: false,
            })
          }
          const requestBody: z.infer<typeof imageGenerationRequestSchema> = {
            prompt: arguments_.prompt,
            count: arguments_.count,
            background: arguments_.background,
            transparency_mode: arguments_.transparency_mode,
            ...(arguments_.size ? { size: arguments_.size } : {}),
            ...(arguments_.negative_prompt
              ? { negative_prompt: arguments_.negative_prompt }
              : {}),
            ...(arguments_.seed === undefined
              ? {}
              : { seed: arguments_.seed }),
            ...(arguments_.chroma_key === undefined
              ? {}
              : { chroma_key: arguments_.chroma_key }),
          }
          const result = await requestImages({
            endpoint,
            token,
            body: requestBody,
            signal: input.signal,
          })
          const artifacts: ImageGenerationMcpSuccess["artifacts"] = []
          for (const [index, image] of result.images.entries()) {
            let workspaceRelativePath: string | undefined
            try {
              workspaceRelativePath = await writeGeneratedImage({
                workspaceRoot,
                displayName: image.display_name,
                mimeType: image.mime_type,
                dataBase64: image.data_base64,
                index,
              })
              const artifact = await registerArtifact({
                endpoint: fileServiceEndpoint,
                token: fileServiceToken,
                workspaceRelativePath,
                displayName: image.display_name,
                mimeType: image.mime_type,
                signal: input.signal,
              })
              artifacts.push({
                artifact_id: artifact.artifact_id,
                file_id: artifact.file_id,
                display_name: artifact.display_name,
                download_card_event_id: artifact.download_card_event_id,
                workspace_relative_path: workspaceRelativePath,
                mime_type: image.mime_type,
                has_transparency: image.has_transparency,
              })
            } catch (error) {
              if (workspaceRelativePath) {
                await removeSharedWorkspaceFile(
                  workspaceRoot,
                  path.resolve(workspaceRoot, workspaceRelativePath),
                ).catch(() => undefined)
              }
              if (input.signal.aborted) throw error
              if (error instanceof ImageGenerationMcpError) throw error
              throw artifactRegistrationFailure()
            }
          }
          return successToolResult(
            imageGenerationMcpSuccessSchema.parse({
              success: true,
              provider: result.provider,
              model: result.model,
              image_count: result.image_count,
              unit_price: result.unit_price,
              total_cost: result.total_cost,
              currency: result.currency,
              transparency: result.transparency,
              artifacts,
            }),
          )
        } catch (error) {
          if (input.signal.aborted) throw error
          return failureToolResult(classifyFailure(error))
        }
      },
    }
  },
} satisfies CoreMcpModuleDefinition

async function requestImages(input: {
  endpoint: string
  token: string
  body: z.infer<typeof imageGenerationRequestSchema>
  signal: AbortSignal
}) {
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input.body),
    signal: withRequestTimeout(input.signal, 180_000),
  })
  const result = await parseResponse(response)
  if (!response.ok) {
    throw new ImageGenerationMcpError(
      mcpFailureFromResponse(result) ?? {
        code: "IMAGE_GENERATION_UNAVAILABLE",
        retryable: true,
      },
    )
  }
  return imageGenerationInternalResultSchema.parse(result)
}

async function writeGeneratedImage(input: {
  workspaceRoot: string
  displayName: string
  mimeType: "image/png" | "image/jpeg" | "image/webp"
  dataBase64: string
  index: number
}): Promise<string> {
  const directory = path.join(input.workspaceRoot, "artifacts")
  const filename = safeGeneratedImageName(
    input.displayName,
    input.mimeType,
    input.index,
  )
  const target = path.resolve(directory, filename)
  const relativeTarget = path.relative(input.workspaceRoot, target)
  if (
    relativeTarget.startsWith("..") ||
    path.isAbsolute(relativeTarget) ||
    relativeTarget.split(path.sep).some((segment) => segment === "..")
  ) {
    throw new ImageGenerationMcpError({
      code: "IMAGE_GENERATION_OUTPUT_INVALID",
      retryable: false,
    })
  }
  await writeSharedWorkspaceFile(
    input.workspaceRoot,
    target,
    Buffer.from(input.dataBase64, "base64"),
  )
  return relativeTarget.split(path.sep).join("/")
}

async function registerArtifact(input: {
  endpoint: string
  token: string
  workspaceRelativePath: string
  displayName: string
  mimeType: string
  signal: AbortSignal
}) {
  try {
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceRelativePath: input.workspaceRelativePath,
        displayName: input.displayName,
        mimeType: input.mimeType,
        artifactKind: "generated_image",
      }),
      signal: withRequestTimeout(input.signal, 30_000),
    })
    const result = await response.json().catch(() => {
      throw artifactRegistrationFailure()
    })
    if (!response.ok) throw artifactRegistrationFailure()
    const artifact = artifactResultSchema.safeParse(result)
    if (!artifact.success) throw artifactRegistrationFailure()
    return artifact.data
  } catch (error) {
    if (input.signal.aborted) throw error
    if (error instanceof ImageGenerationMcpError) throw error
    throw artifactRegistrationFailure()
  }
}

function artifactRegistrationFailure(): ImageGenerationMcpError {
  return new ImageGenerationMcpError({
    code: "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED",
    retryable: false,
  })
}

async function parseResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ImageGenerationMcpError({
      code: "IMAGE_GENERATION_UNAVAILABLE",
      retryable: true,
    })
  }
}

function classifyFailure(error: unknown): ImageGenerationMcpFailure {
  if (error instanceof ImageGenerationMcpError) return error.failure
  if (error instanceof z.ZodError) {
    return { code: "IMAGE_GENERATION_INVALID", retryable: false }
  }
  return { code: "IMAGE_GENERATION_UNAVAILABLE", retryable: true }
}

function mcpFailureFromResponse(
  value: unknown,
): ImageGenerationMcpFailure | null {
  const record = asRecord(value)
  const base = imageGenerationMcpFailureSchema.safeParse({
    code: record.code,
    retryable: record.retryable,
  })
  if (!base.success) return null
  return {
    ...base.data,
    ...optionalString("provider_code", record),
    ...optionalString("provider_message", record),
    ...optionalString("provider_request_id", record),
  }
}

function optionalString(
  key: "provider_code" | "provider_message" | "provider_request_id",
  value: Record<string, unknown>,
): Partial<ImageGenerationMcpFailure> {
  const item = value[key]
  return typeof item === "string" && item.trim() ? { [key]: item } : {}
}

function safeGeneratedImageName(
  displayName: string,
  mimeType: "image/png" | "image/jpeg" | "image/webp",
  index: number,
): string {
  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType === "image/webp"
        ? "webp"
        : "png"
  const base = displayName
    .replace(/\.[A-Za-z0-9]+$/u, "")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120)
  return `${base || "generated-image"}-${index + 1}-${randomUUID().slice(
    0,
    8,
  )}.${extension}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

const generateImageTool = {
  name: "generate_image",
  description:
    "Generate one or more raster images with the LinkSense configured image generation model, save them to the task workspace, and register them as downloadable artifacts.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string", format: "uuid" },
      prompt: { type: "string" },
      count: { type: "integer", minimum: 1, maximum: 10, default: 1 },
      size: { type: "string", examples: ["1024x1024", "1024x768"] },
      negative_prompt: { type: "string" },
      seed: { type: "integer", minimum: 0, maximum: 4_294_967_295 },
      background: {
        type: "string",
        enum: ["opaque", "transparent"],
        default: "opaque",
        description:
          "Request an ordinary opaque image or a final PNG with a validated alpha channel.",
      },
      transparency_mode: {
        type: "string",
        enum: ["auto", "native", "chroma_key"],
        default: "auto",
        description:
          "For transparent output, auto prefers native model support and otherwise uses chroma key; native refuses unsupported configured models; chroma_key always uses post-processing.",
      },
      chroma_key: {
        type: "string",
        enum: ["green", "magenta"],
        description:
          "Optional chroma color. Use magenta when the foreground is predominantly green.",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
} satisfies Tool
