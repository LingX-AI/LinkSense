export type ConversationSlashCommandTrigger = Readonly<{
  start: number
  end: number
  query: string
}>

export type ConversationSkillCommandTrigger = Readonly<{
  start: number
  end: number
  query: string
}>

const contextCompactionCommands = new Set(["/压缩", "/compact"])

export function isConversationContextCompactionCommand(value: string) {
  return contextCompactionCommands.has(value.trim().toLocaleLowerCase("en-US"))
}

export function findConversationSlashCommandTrigger(
  value: string
): ConversationSlashCommandTrigger | null {
  const match = /(^|\s)\/([^\s/]*)$/u.exec(value)
  if (!match) return null
  const prefix = match[1] ?? ""
  const query = match[2] ?? ""
  const start = match.index + prefix.length
  return {
    start,
    end: value.length,
    query,
  }
}

export function removeConversationSlashCommandTrigger(
  value: string,
  trigger: ConversationSlashCommandTrigger
) {
  return `${value.slice(0, trigger.start)}${value.slice(trigger.end)}`
}

export function findConversationSkillCommandTrigger(
  value: string
): ConversationSkillCommandTrigger | null {
  const match = /(^|\s)\$([^\s$]*)$/u.exec(value)
  if (!match) return null
  const prefix = match[1] ?? ""
  const query = match[2] ?? ""
  const start = match.index + prefix.length
  return {
    start,
    end: value.length,
    query,
  }
}

export function removeConversationSkillCommandTrigger(
  value: string,
  trigger: ConversationSkillCommandTrigger
) {
  return `${value.slice(0, trigger.start)}${value.slice(trigger.end)}`
}
export type ConversationTaskReferenceTrigger = ConversationSlashCommandTrigger

export function findConversationTaskReferenceTrigger(
  value: string,
  caret = value.length
): ConversationTaskReferenceTrigger | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > value.length) return null
  const match = /(^|\s)@([^\n@]*)$/u.exec(value.slice(0, caret))
  if (!match || (match[2]?.length ?? 0) > 240) return null
  return {
    start: match.index + (match[1]?.length ?? 0),
    end: caret,
    query: match[2] ?? "",
  }
}

export function removeConversationTaskReferenceTrigger(
  value: string,
  trigger: ConversationTaskReferenceTrigger
): string {
  return `${value.slice(0, trigger.start)}${value.slice(trigger.end)}`
}
