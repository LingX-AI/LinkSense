import { z } from "zod"
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js"

import { currentUserCoreMcpModule } from "./core-services/current-user-service.js"
import { documentConversionCoreMcpModule } from "./core-services/document-conversion.js"
import { fileServiceCoreMcpModule } from "./core-services/file-service.js"
import { imageGenerationCoreMcpModule } from "./core-services/image-generation-service.js"
import { interactiveFormCoreMcpModule } from "./core-services/interactive-form-service.js"
import { knowledgeCoreMcpModule } from "./core-services/knowledge-service.js"
import { skillCreatorCoreMcpModule } from "./core-services/skill-creator-service.js"
import type {
  CoreMcpCollaborationMode,
  CoreMcpModuleContext,
  CoreMcpModuleDefinition,
  CoreMcpToolCall,
  CoreMcpToolModule,
} from "./core-service-module.js"

const collaborationModeSchema = z.enum(["default", "plan"])

export const coreMcpModuleRegistry: readonly CoreMcpModuleDefinition[] = [
  fileServiceCoreMcpModule,
  documentConversionCoreMcpModule,
  currentUserCoreMcpModule,
  imageGenerationCoreMcpModule,
  knowledgeCoreMcpModule,
  interactiveFormCoreMcpModule,
  skillCreatorCoreMcpModule,
]

export class CoreMcpToolUnavailableError extends Error {
  constructor(readonly toolName: string) {
    super(`Core MCP tool is unavailable: ${toolName}`)
    this.name = "CoreMcpToolUnavailableError"
  }
}

export type CoreMcpRegistry = {
  mode: CoreMcpCollaborationMode
  modules: readonly CoreMcpToolModule[]
  tools: readonly Tool[]
  instructions: string
  callTool: (input: CoreMcpToolCall) => Promise<CallToolResult>
}

export function coreMcpToolNamesFor(
  mode: CoreMcpCollaborationMode,
): string[] {
  return coreMcpModuleRegistry
    .filter((definition) => definition.modes.includes(mode))
    .flatMap((definition) => definition.toolNames)
}

export function createCoreMcpRegistry(
  input: Partial<CoreMcpModuleContext> & {
    mode?: CoreMcpCollaborationMode
  } = {},
): CoreMcpRegistry {
  const environment = input.environment ?? process.env
  const mode = collaborationModeSchema.parse(
    input.mode ?? environment.LINKSENSE_COLLABORATION_MODE ?? "default",
  )
  const context: CoreMcpModuleContext = {
    environment,
    workspaceRoot: input.workspaceRoot ?? process.cwd(),
    fetch: input.fetch ?? globalThis.fetch,
  }
  const definitions = coreMcpModuleRegistry.filter((definition) =>
    definition.modes.includes(mode),
  )
  const modules = definitions.map((definition) => definition.create(context))
  const toolsByName = new Map<string, CoreMcpToolModule>()

  for (const [index, module] of modules.entries()) {
    const definition = definitions[index]
    if (!definition || module.key !== definition.key) {
      throw new Error("Core MCP module registry key mismatch")
    }
    const declaredNames = [...definition.toolNames].sort()
    const actualNames = module.tools.map((tool) => tool.name).sort()
    if (
      actualNames.length !== declaredNames.length ||
      actualNames.some((name, toolIndex) => name !== declaredNames[toolIndex])
    ) {
      throw new Error(`Core MCP module tool registry mismatch: ${module.key}`)
    }
    for (const tool of module.tools) {
      if (toolsByName.has(tool.name)) {
        throw new Error(`Duplicate Core MCP tool registration: ${tool.name}`)
      }
      toolsByName.set(tool.name, module)
    }
  }

  return {
    mode,
    modules,
    tools: modules.flatMap((module) => module.tools),
    instructions: modules
      .map((module) => module.instructions?.trim())
      .filter((value): value is string => Boolean(value))
      .join("\n\n"),
    async callTool(call) {
      const module = toolsByName.get(call.toolName)
      if (!module) throw new CoreMcpToolUnavailableError(call.toolName)
      return module.callTool(call)
    },
  }
}
