import { readFile } from "node:fs/promises"
import path from "node:path"

import { parse } from "smol-toml"

const featureNamePattern = /^[A-Za-z0-9_-]+$/u

export class CodexTemplateFeatureConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CodexTemplateFeatureConfigError"
  }
}

/**
 * Loads the deployment-owned feature and agent policy without modifying a user's
 * persistent config.toml. The returned values are passed to Codex as CLI
 * overrides, whose precedence is higher than every file-backed config layer.
 */
export async function loadCodexTemplateFeatureOverrides(
  codexHomeTemplate: string | undefined,
): Promise<string[]> {
  if (!codexHomeTemplate) return []

  const configPath = path.join(codexHomeTemplate, "config.toml")
  let source: string
  try {
    source = await readFile(configPath, "utf8")
  } catch (error) {
    throw new CodexTemplateFeatureConfigError(
      `failed to read Codex template feature policy at ${configPath}: ${errorMessage(error)}`,
    )
  }

  let config: unknown
  try {
    config = parse(source)
  } catch (error) {
    throw new CodexTemplateFeatureConfigError(
      `failed to parse Codex template feature policy at ${configPath}: ${errorMessage(error)}`,
    )
  }

  if (!isTable(config)) {
    throw new CodexTemplateFeatureConfigError(
      `Codex template config at ${configPath} must be a TOML table`,
    )
  }

  const features = config.features ?? {}
  if (!isTable(features)) {
    throw new CodexTemplateFeatureConfigError(
      `Codex template [features] at ${configPath} must be a TOML table`,
    )
  }

  const overrides = Object.entries(features)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([name, enabled]) => {
      if (!featureNamePattern.test(name)) {
        throw new CodexTemplateFeatureConfigError(
          `Codex template feature name ${JSON.stringify(name)} at ${configPath} is not a valid Codex feature name`,
        )
      }
      if (typeof enabled !== "boolean") {
        throw new CodexTemplateFeatureConfigError(
          `Codex template feature features.${name} at ${configPath} must be true or false`,
        )
      }
      return `features.${name}=${enabled}`
    })

  const agents = config.agents
  if (agents !== undefined) {
    if (!isTable(agents)) {
      throw new CodexTemplateFeatureConfigError(
        `Codex template [agents] at ${configPath} must be a TOML table`,
      )
    }
    if (agents.enabled !== undefined) {
      if (typeof agents.enabled !== "boolean") {
        throw new CodexTemplateFeatureConfigError(
          `Codex template agents.enabled at ${configPath} must be true or false`,
        )
      }
      overrides.push(`agents.enabled=${agents.enabled}`)
    }
  }
  return overrides
}

function isTable(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error"
}
