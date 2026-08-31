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
