import type { NativeCodexItem } from "@/api/contracts"

type NativeCommandAction = NonNullable<
  Extract<NativeCodexItem, { type: "commandExecution" }>["commandActions"]
>[number]

export type NativeActivityIconKind =
  | "agents"
  | "audio"
  | "automation"
  | "browser"
  | "calendar"
  | "cloud"
  | "code"
  | "compact"
  | "database"
  | "document"
  | "file-edit"
  | "file-read"
  | "file-search"
  | "finance"
  | "folder"
  | "git"
  | "image"
  | "image-generation"
  | "knowledge"
  | "mail"
  | "map"
  | "plan"
  | "presentation"
  | "reasoning"
  | "review"
  | "skill"
  | "spreadsheet"
  | "terminal"
  | "test"
  | "tool"
  | "user-input"
  | "video"
  | "wait"
  | "web"

function normalizedIdentity(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase()
    .replaceAll(/[_./:-]+/g, " ")
}

function includesAny(identity: string, terms: readonly string[]) {
  return terms.some((term) => identity.includes(term))
}

export function isSkillDefinitionReadAction(action: NativeCommandAction) {
  if (action.type !== "read") return false
  const identity = normalizedIdentity([
    action.name,
    action.path,
    action.command,
  ])
  return identity.includes("skill md")
}

function resolveNamedToolIcon(
  server: string | null | undefined,
  namespace: string | null | undefined,
  tool: string | null | undefined
): NativeActivityIconKind {
  const identity = normalizedIdentity([server, namespace, tool])

  if (
    includesAny(identity, [
      "imagegen",
      "generate image",
      "render image",
      "create image",
    ])
  ) {
    return "image-generation"
  }
  if (includesAny(identity, ["view image", "image preview", "screenshot"])) {
    return "image"
  }
  if (includesAny(identity, ["audio", "speech", "transcribe", "voice"])) {
    return "audio"
  }
  if (includesAny(identity, ["video", "movie", "runway"])) return "video"
  if (includesAny(identity, ["spreadsheet", "excel", "sheet", "xlsx", "csv"])) {
    return "spreadsheet"
  }
  if (
    includesAny(identity, [
      "presentation",
      "powerpoint",
      "slide",
      "pptx",
      "ppt ",
    ])
  ) {
    return "presentation"
  }
  if (
    includesAny(identity, ["knowledge", "library", "search knowledge base"])
  ) {
    return "knowledge"
  }
  if (includesAny(identity, ["document", "word", "docx", "pdf"])) {
    return "document"
  }
  if (includesAny(identity, ["browser", "chrome", "playwright", "page "])) {
    return "browser"
  }
  if (includesAny(identity, ["web ", "website", "url", "http"])) return "web"
  if (
    includesAny(identity, ["database", "postgres", "mysql", "sqlite", "sql"])
  ) {
    return "database"
  }
  if (includesAny(identity, ["github", "gitlab", "git ", "pull request"])) {
    return "git"
  }
  if (includesAny(identity, ["test", "vitest", "jest", "pytest", "spec"])) {
    return "test"
  }
  if (includesAny(identity, ["mail", "email", "outlook", "gmail"])) {
    return "mail"
  }
  if (includesAny(identity, ["calendar", "schedule", "event"])) {
    return "calendar"
  }
  if (includesAny(identity, ["map", "location", "place", "route"])) {
    return "map"
  }
  if (
    includesAny(identity, [
      "finance",
      "stock",
      "trading",
      "market",
      "crypto",
      "portfolio",
    ])
  ) {
    return "finance"
  }
  if (includesAny(identity, ["automation", "workflow", "cron", "reminder"])) {
    return "automation"
  }
  if (includesAny(identity, ["request user input", "ask user", "question"])) {
    return "user-input"
  }
  if (
    includesAny(identity, ["update plan", "create goal", "todo", "task list"])
  ) {
    return "plan"
  }
  if (includesAny(identity, ["agent", "subagent", "spawn", "collaboration"])) {
    return "agents"
  }
  if (includesAny(identity, ["wait", "sleep", "poll"])) return "wait"
  if (
    includesAny(identity, [
      "apply patch",
      "edit file",
      "write file",
      "rename file",
    ])
  ) {
    return "file-edit"
  }
  if (includesAny(identity, ["search file", "find file", "grep", "ripgrep"])) {
    return "file-search"
  }
  if (includesAny(identity, ["read file", "open file", "load file"])) {
    return "file-read"
  }
  if (includesAny(identity, ["list file", "directory", "folder"])) {
    return "folder"
  }
  if (includesAny(identity, ["terminal", "shell", "exec", "command", "repl"])) {
    return "terminal"
  }
  if (includesAny(identity, ["deploy", "cloudflare", "hosting", "cloud"])) {
    return "cloud"
  }
  if (includesAny(identity, ["code", "typescript", "javascript", "python"])) {
    return "code"
  }
  return "tool"
}

function resolveCommandIcon(
  item: Extract<NativeCodexItem, { type: "commandExecution" }>,
  mode: "all" | "exploration" = "all"
): NativeActivityIconKind | null {
  const actions = item.commandActions ?? []
  if (actions.some(isSkillDefinitionReadAction)) return "skill"
  if (actions.some((action) => action.type === "read")) return "file-read"
  if (actions.some((action) => action.type === "listFiles")) return "folder"
  if (actions.some((action) => action.type === "search")) return "file-search"
  if (mode === "exploration") return null

  const command = normalizedIdentity([
    item.command,
    ...actions.map((action) => action.command),
  ])
  if (includesAny(command, ["git ", "git status", "git diff", "git commit"])) {
    return "git"
  }
  if (includesAny(command, ["vitest", "jest", "pytest", " test", "test "])) {
    return "test"
  }
  if (includesAny(command, ["rg ", "grep ", "find "])) return "file-search"
  if (includesAny(command, ["curl ", "wget ", "http "])) return "web"
  if (includesAny(command, ["tsc ", "typecheck", "eslint", "prettier"])) {
    return "code"
  }
  return "terminal"
}

function resolveSingleItemIcon(item: NativeCodexItem): NativeActivityIconKind {
  switch (item.type) {
    case "commandExecution":
      return resolveCommandIcon(item) ?? "terminal"
    case "fileChange":
      return "file-edit"
    case "reasoning":
      return "reasoning"
    case "plan":
      return "plan"
    case "webSearch":
      return "web"
    case "imageView":
      return "image"
    case "imageGeneration":
      return "image-generation"
    case "mcpToolCall":
      return resolveNamedToolIcon(item.server, undefined, item.tool)
    case "dynamicToolCall":
      return resolveNamedToolIcon(undefined, item.namespace, item.tool)
    case "collabAgentToolCall":
    case "subAgentActivity":
      return "agents"
    case "sleep":
      return "wait"
    case "enteredReviewMode":
    case "exitedReviewMode":
      return "review"
    case "contextCompaction":
      return "compact"
    default:
      return "tool"
  }
}

export function resolveNativeActivityIconKind(
  item: NativeCodexItem,
  activityItems: readonly NativeCodexItem[] = []
): NativeActivityIconKind {
  if (activityItems.length === 0) return resolveSingleItemIcon(item)

  const commands = activityItems.filter(
    (
      activity
    ): activity is Extract<NativeCodexItem, { type: "commandExecution" }> =>
      activity.type === "commandExecution"
  )
  const skillCommand = commands.find((command) =>
    command.commandActions?.some(isSkillDefinitionReadAction)
  )
  if (skillCommand) return "skill"

  const calledTool = activityItems.find(
    (activity) =>
      activity.type === "mcpToolCall" && activity.server !== "node_repl"
  )
  if (calledTool?.type === "mcpToolCall") {
    return resolveSingleItemIcon(calledTool)
  }
  if (activityItems.some((activity) => activity.type === "fileChange")) {
    return "file-edit"
  }
  for (const command of commands) {
    const explorationIcon = resolveCommandIcon(command, "exploration")
    if (explorationIcon) return explorationIcon
  }
  if (commands.length > 0) return resolveSingleItemIcon(commands[0])
  if (activityItems.some((activity) => activity.type === "webSearch")) {
    return "web"
  }
  const dynamicTool = activityItems.find(
    (activity) => activity.type === "dynamicToolCall"
  )
  return dynamicTool
    ? resolveSingleItemIcon(dynamicTool)
    : resolveSingleItemIcon(item)
}
