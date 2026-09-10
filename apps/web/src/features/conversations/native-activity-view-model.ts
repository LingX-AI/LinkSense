import { coreMcpServerKey } from "@linksense/shared"
import type { TFunction } from "i18next"

import type { NativeCodexItem } from "@/api/contracts"
import { isSkillDefinitionReadAction } from "@/features/conversations/native-activity-icon-kind"

export type NativeLifecycleMethod = "item/started" | "item/completed"

export type NativeActivityDetailRow =
  | {
      labelKey: string
      kind: "text"
      value: string
      code?: boolean
    }
  | {
      labelKey: string
      kind: "translation"
      valueKey: string
      fallback: string
    }
  | {
      labelKey: string
      kind: "duration"
      value: number
    }

export type NativeActivitySummaryPart = {
  key: string
  values: Record<string, string | number>
}

type NativeFileChange = {
  kind: string
  path?: string
}

export type NativeActivityViewModel = {
  summary: string | null
  summaryKey: string | null
  summaryValues: Record<string, string | number>
  summaryParts: NativeActivitySummaryPart[]
  status: string | null
  commands: string[]
  fileChanges: NativeFileChange[]
  searchQueries: string[]
  detailRows: NativeActivityDetailRow[]
  expandable: boolean
}

export function translateNativeActivitySummary(
  model: NativeActivityViewModel,
  t: TFunction
): string | null {
  if (model.summaryParts.length > 0) {
    return model.summaryParts
      .map((part) => t(part.key, part.values))
      .join(t("conversation.nativeActivities.summary.separator"))
  }
  return model.summaryKey
    ? t(model.summaryKey, model.summaryValues)
    : model.summary
}

/** Reuse the already-redacted detail model for a compact tool preview. */
export function getNativeActivityPreview(
  model: NativeActivityViewModel,
  label: string
): string | null {
  return joinedNativeValues(
    [
      ...model.commands,
      ...model.fileChanges.map((change) => change.path),
      ...model.searchQueries,
      ...model.detailRows.flatMap((row) =>
        row.kind === "text" &&
        row.labelKey !== "conversation.nativeActivityDetails.fields.plugin"
          ? [row.value]
          : []
      ),
    ]
      .map((value) => value?.replace(/\s+/gu, " ").trim())
      .filter((value) => value && !label.includes(value))
  )
}

export type NativeCommandActivity = {
  item: NativeCodexItem
  method: NativeLifecycleMethod
}

export type NativeToolActivity = NativeCommandActivity

export function isKnowledgeSearchNativeItem(item: NativeCodexItem): boolean {
  return (
    item.type === "mcpToolCall" &&
    item.server === coreMcpServerKey &&
    item.tool === "search_knowledge_base"
  )
}

type NativeToolSummaryStats = {
  loadedTools: number
  runningLoadedTools: number
  calledTools: number
  runningCalledTools: number
  editedFiles: number
  runningEditedFiles: number
  exploredFiles: number
  runningExploredFiles: number
  commands: number
  runningCommands: number
  webSearches: number
  runningWebSearches: number
  dynamicTools: string[]
}

function nonempty(values: Array<string | null | undefined>) {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
}

function uniqueNonempty(values: Array<string | null | undefined>) {
  return [...new Set(nonempty(values))]
}

function joinedNativeValues(values: Array<string | null | undefined>) {
  const normalized = uniqueNonempty(values)
  return normalized.length > 0 ? normalized.join(" · ") : null
}

function firstNativeValue(values: Array<string | null | undefined>) {
  return uniqueNonempty(values)[0] ?? null
}

function durationRow(durationMs: number | null | undefined) {
  return durationMs === null || durationMs === undefined
    ? []
    : ([
        {
          labelKey: "conversation.nativeActivityDetails.fields.duration",
          kind: "duration",
          value: durationMs,
        },
      ] satisfies NativeActivityDetailRow[])
}

function emptyNativeToolSummaryStats(): NativeToolSummaryStats {
  return {
    loadedTools: 0,
    runningLoadedTools: 0,
    calledTools: 0,
    runningCalledTools: 0,
    editedFiles: 0,
    runningEditedFiles: 0,
    exploredFiles: 0,
    runningExploredFiles: 0,
    commands: 0,
    runningCommands: 0,
    webSearches: 0,
    runningWebSearches: 0,
    dynamicTools: [],
  }
}

function normalizeNativeFileChanges(
  item: Extract<NativeCodexItem, { type: "fileChange" }>
) {
  return [
    ...new Map(
      (item.changes ?? []).map((change, index) => {
        const path = change.path?.trim()
        const normalized = {
          kind: change.kind.type,
          ...(path ? { path } : {}),
        }
        const key = path
          ? path.replaceAll("\\", "/")
          : `${item.id}\u0000${index}`
        return [key, normalized] as const
      })
    ).values(),
  ]
}

function collectNativeToolSummaryStats(
  activities: readonly NativeToolActivity[]
) {
  const stats = emptyNativeToolSummaryStats()
  const editedFileKeys = new Set<string>()
  const runningEditedFileKeys = new Set<string>()
  const dynamicToolNames = new Set<string>()

  for (const activity of activities) {
    const running = activity.method === "item/started"
    const item = activity.item

    if (item.type === "commandExecution") {
      const actions = item.commandActions ?? []
      if (actions.length === 0) {
        stats.commands += 1
        if (running) stats.runningCommands += 1
        continue
      }

      for (const action of actions) {
        if (isSkillDefinitionReadAction(action)) {
          stats.loadedTools += 1
          if (running) stats.runningLoadedTools += 1
          continue
        }
        if (
          action.type === "read" ||
          action.type === "listFiles" ||
          action.type === "search"
        ) {
          stats.exploredFiles += 1
          if (running) stats.runningExploredFiles += 1
          continue
        }
        if (action.type === "unknown") {
          stats.commands += 1
          if (running) stats.runningCommands += 1
        }
      }
      continue
    }

    if (item.type === "mcpToolCall") {
      if (item.server === "node_repl") {
        stats.commands += 1
        if (running) stats.runningCommands += 1
        continue
      }
      stats.calledTools += 1
      if (running) stats.runningCalledTools += 1
      continue
    }

    if (item.type === "fileChange") {
      for (const [index, change] of normalizeNativeFileChanges(
        item
      ).entries()) {
        const key = change.path
          ? change.path.replaceAll("\\", "/")
          : `${item.id}\u0000${index}`
        editedFileKeys.add(key)
        if (running) runningEditedFileKeys.add(key)
      }
      continue
    }

    if (item.type === "webSearch") {
      stats.webSearches += 1
      if (running) stats.runningWebSearches += 1
      continue
    }

    if (item.type === "dynamicToolCall") {
      const name = joinedNativeValues([item.namespace, item.tool])
      if (name) dynamicToolNames.add(name)
    }
  }

  stats.editedFiles = editedFileKeys.size
  stats.runningEditedFiles = runningEditedFileKeys.size
  stats.dynamicTools = [...dynamicToolNames]

  return stats
}

function nativeToolSummaryPart(
  category:
    | "loadedTools"
    | "calledTools"
    | "editedFiles"
    | "readFiles"
    | "commands"
    | "webSearch",
  count: number,
  state: "completed" | "running",
  leading: boolean
): NativeActivitySummaryPart {
  const placement =
    state === "running" ? "running" : leading ? "leading" : "following"
  const pluralized = category !== "readFiles" && category !== "webSearch"
  return {
    key: pluralized
      ? `conversation.nativeActivities.summary.${category}.${placement}_${count === 1 ? "one" : "other"}`
      : `conversation.nativeActivities.summary.${category}.${placement}`,
    values: { count },
  }
}

function buildNativeToolSummaryParts(
  activities: readonly NativeToolActivity[]
) {
  const stats = collectNativeToolSummaryStats(activities)
  const parts: NativeActivitySummaryPart[] = []
  const append = (
    category: Parameters<typeof nativeToolSummaryPart>[0],
    count: number,
    runningCount: number
  ) => {
    const completedCount = Math.max(0, count - runningCount)
    if (completedCount > 0) {
      parts.push(
        nativeToolSummaryPart(
          category,
          completedCount,
          "completed",
          parts.length === 0
        )
      )
    }
    if (runningCount > 0) {
      parts.push(
        nativeToolSummaryPart(
          category,
          runningCount,
          "running",
          parts.length === 0
        )
      )
    }
  }

  // Keep the same stable order used by Codex Desktop's collapsed activity
  // header so the summary does not jump as events complete.
  append("loadedTools", stats.loadedTools, stats.runningLoadedTools)
  append("calledTools", stats.calledTools, stats.runningCalledTools)
  append("editedFiles", stats.editedFiles, stats.runningEditedFiles)
  append("readFiles", stats.exploredFiles, stats.runningExploredFiles)
  append("commands", stats.commands, stats.runningCommands)
  append("webSearch", stats.webSearches, stats.runningWebSearches)
  for (const tool of stats.dynamicTools) {
    parts.push({
      key: "conversation.nativeActivities.summary.dynamicTool",
      values: { tool },
    })
  }

  return parts
}

export function buildNativeActivityViewModel(
  item: NativeCodexItem,
  method: NativeLifecycleMethod,
  options: { stopped?: boolean } = {}
): NativeActivityViewModel {
  let summary: string | null = null
  let summaryKey: string | null = null
  let summaryValues: Record<string, string | number> = {}
  let summaryParts: NativeActivitySummaryPart[] = []
  let commands: string[] = []
  let fileChanges: NativeFileChange[] = []
  let searchQueries: string[] = []
  const detailRows: NativeActivityDetailRow[] = []

  if (item.type === "commandExecution") {
    const actionCommands = nonempty(
      item.commandActions?.map((action) => action.command) ?? []
    )
    commands = actionCommands.length
      ? actionCommands
      : uniqueNonempty([item.command])
    summaryParts = buildNativeToolSummaryParts([{ item, method }])
  }

  if (item.type === "fileChange") {
    fileChanges = normalizeNativeFileChanges(item)
    if (fileChanges.length > 0) {
      summaryKey =
        method === "item/started"
          ? "conversation.nativeActivities.fileChangeRunning"
          : "conversation.nativeActivities.fileChangeCompleted"
      summaryValues = { count: fileChanges.length }
    } else {
      summaryKey =
        method === "item/started"
          ? "conversation.nativeActivities.fileChangeRunningGeneric"
          : "conversation.nativeActivities.fileChangeCompletedGeneric"
    }
  }

  if (item.type === "mcpToolCall") {
    if (isKnowledgeSearchNativeItem(item)) {
      summaryKey =
        method === "item/started"
          ? "conversation.nativeActivities.knowledgeSearchRunning"
          : item.failureCode === "KNOWLEDGE_NO_AVAILABLE_BASES"
            ? "conversation.nativeActivities.knowledgeSearchNoAvailableBases"
            : item.status === "failed"
              ? "conversation.nativeActivities.knowledgeSearchFailed"
              : "conversation.nativeActivities.knowledgeSearchCompleted"
    } else {
      summary = joinedNativeValues([item.server, item.tool])
      if (item.server) {
        detailRows.push({
          labelKey: "conversation.nativeActivityDetails.fields.server",
          kind: "text",
          value: item.server,
          code: true,
        })
      }
      if (item.tool) {
        detailRows.push({
          labelKey: "conversation.nativeActivityDetails.fields.tool",
          kind: "text",
          value: item.tool,
          code: true,
        })
      }
      if (item.pluginId) {
        detailRows.push({
          labelKey: "conversation.nativeActivityDetails.fields.plugin",
          kind: "text",
          value: item.pluginId,
          code: true,
        })
      }
      detailRows.push(...durationRow(item.durationMs))
    }
  }

  if (item.type === "dynamicToolCall") {
    summary = joinedNativeValues([item.namespace, item.tool])
    if (item.namespace) {
      detailRows.push({
        labelKey: "conversation.nativeActivityDetails.fields.namespace",
        kind: "text",
        value: item.namespace,
        code: true,
      })
    }
    if (item.tool) {
      detailRows.push({
        labelKey: "conversation.nativeActivityDetails.fields.tool",
        kind: "text",
        value: item.tool,
        code: true,
      })
    }
    if (item.success !== null && item.success !== undefined) {
      detailRows.push({
        labelKey: "conversation.nativeActivityDetails.fields.result",
        kind: "translation",
        valueKey: item.success
          ? "conversation.nativeActivityDetails.values.succeeded"
          : "conversation.nativeActivityDetails.values.failed",
        fallback: String(item.success),
      })
    }
    detailRows.push(...durationRow(item.durationMs))
  }

  if (item.type === "webSearch") {
    const searchAction = item.action?.type === "search" ? item.action : null
    searchQueries = uniqueNonempty([
      item.query,
      searchAction?.query,
      ...(searchAction?.queries ?? []),
    ])
    summary = firstNativeValue([
      searchQueries[0],
      item.action && "url" in item.action ? item.action.url : undefined,
      item.action?.type === "findInPage" ? item.action.pattern : undefined,
      item.action?.type,
    ])
    if (!summary || summary === "other") {
      summary = null
      summaryKey =
        method === "item/started"
          ? "conversation.nativeActivities.webSearchRunning"
          : "conversation.nativeActivities.webSearchCompleted"
    }
    if (item.action?.type) {
      detailRows.push({
        labelKey: "conversation.nativeActivityDetails.fields.action",
        kind: "translation",
        valueKey: `conversation.nativeActivityDetails.actions.${item.action.type}`,
        fallback: item.action.type,
      })
    }
    if (item.action && "url" in item.action && item.action.url) {
      detailRows.push({
        labelKey: "conversation.nativeActivityDetails.fields.url",
        kind: "text",
        value: item.action.url,
        code: true,
      })
    }
    if (item.action?.type === "findInPage" && item.action.pattern) {
      detailRows.push({
        labelKey: "conversation.nativeActivityDetails.fields.pattern",
        kind: "text",
        value: item.action.pattern,
        code: true,
      })
    }
  }

  if (item.type === "imageView") {
    summaryKey =
      method === "item/started"
        ? "conversation.nativeActivities.imageViewRunning"
        : "conversation.nativeActivities.imageViewCompleted"
    if (item.path) {
      detailRows.push({
        labelKey: "conversation.nativeActivityDetails.fields.path",
        kind: "text",
        value: item.path,
        code: true,
      })
    }
  }

  if (item.type === "reasoning") {
    summary = joinedNativeValues(item.summary ?? [])
  }

  if (item.type === "plan") {
    summary = joinedNativeValues([item.text])
  }

  if (item.type === "collabAgentToolCall") {
    summaryKey =
      method === "item/started"
        ? "conversation.nativeActivities.collabAgentRunning"
        : "conversation.nativeActivities.collabAgentCompleted"
  }

  if (item.type === "subAgentActivity") {
    summaryKey =
      item.kind === "started"
        ? "conversation.nativeActivities.subAgentStarted"
        : item.kind === "interacted"
          ? "conversation.nativeActivities.subAgentUpdated"
          : item.kind === "completed"
            ? "conversation.nativeActivities.subAgentCompleted"
            : "conversation.nativeActivities.subAgentInterrupted"
  }

  if (item.type === "sleep") {
    summary = `${item.durationMs} ms`
  }

  if (item.type === "imageGeneration") {
    summaryKey =
      method === "item/started"
        ? "conversation.nativeActivities.imageGenerationRunning"
        : "conversation.nativeActivities.imageGenerationCompleted"
    if (item.revisedPrompt) {
      detailRows.push({
        labelKey: "conversation.nativeActivityDetails.fields.prompt",
        kind: "text",
        value: item.revisedPrompt,
      })
    }
    if (item.savedPath) {
      detailRows.push({
        labelKey: "conversation.nativeActivityDetails.fields.path",
        kind: "text",
        value: item.savedPath,
        code: true,
      })
    }
  }

  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") {
    summaryKey =
      item.type === "enteredReviewMode"
        ? "conversation.nativeActivities.enteredReviewMode"
        : "conversation.nativeActivities.exitedReviewMode"
    if (item.review) {
      detailRows.push({
        labelKey: "conversation.nativeActivityDetails.fields.review",
        kind: "text",
        value: item.review,
      })
    }
  }

  if (item.type === "contextCompaction") {
    summaryKey =
      method === "item/completed"
        ? "conversation.nativeActivities.contextCompactionCompleted"
        : options.stopped
          ? "conversation.nativeActivities.contextCompactionIncomplete"
          : "conversation.nativeActivities.contextCompactionRunning"
  }

  return {
    summary,
    summaryKey,
    summaryValues,
    summaryParts,
    status:
      "status" in item && typeof item.status === "string" ? item.status : null,
    commands,
    fileChanges,
    searchQueries,
    detailRows,
    expandable: Boolean(
      commands.length ||
      fileChanges.length ||
      searchQueries.length ||
      detailRows.length
    ),
  }
}

export function buildNativeCommandGroupViewModel(
  activities: NativeCommandActivity[]
): NativeActivityViewModel {
  return buildNativeToolGroupViewModel(activities)
}

export function buildNativeToolGroupViewModel(
  activities: NativeToolActivity[]
): NativeActivityViewModel {
  const activityModels = activities.map((activity) =>
    buildNativeActivityViewModel(activity.item, activity.method)
  )
  const running = activities.some(
    (activity) => activity.method === "item/started"
  )

  return {
    summary: null,
    summaryKey: null,
    summaryValues: {},
    summaryParts: buildNativeToolSummaryParts(activities),
    status: running ? "running" : "completed",
    commands: activityModels.flatMap((model) => model.commands),
    fileChanges: [
      ...new Map(
        activityModels
          .flatMap((model) => model.fileChanges)
          .map((change, index) => [
            change.path?.replaceAll("\\", "/") ?? `missing-path-${index}`,
            change,
          ])
      ).values(),
    ],
    searchQueries: uniqueNonempty(
      activityModels.flatMap((model) => model.searchQueries)
    ),
    detailRows: activityModels.flatMap((model) => model.detailRows),
    expandable: activityModels.some((model) => model.expandable),
  }
}
