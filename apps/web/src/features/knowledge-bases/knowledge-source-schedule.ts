import type {
  KnowledgeSourceSyncFrequency,
  KnowledgeSourceSyncSchedule,
} from "@linksense/shared"

export type KnowledgeSourceSyncScheduleDraft = {
  frequency: KnowledgeSourceSyncFrequency
  time: string
  timeZone: string
  weekday: string
  dayOfMonth: string
}

export function createDefaultKnowledgeSourceSyncScheduleDraft(): KnowledgeSourceSyncScheduleDraft {
  return {
    frequency: "daily",
    time: "09:00",
    timeZone: detectedTimeZone(),
    weekday: "1",
    dayOfMonth: "1",
  }
}

export function knowledgeSourceSyncScheduleFromDraft(
  draft: KnowledgeSourceSyncScheduleDraft
): KnowledgeSourceSyncSchedule {
  const common = {
    time: draft.time,
    time_zone: draft.timeZone,
  }
  switch (draft.frequency) {
    case "daily":
      return { frequency: "daily", ...common }
    case "weekly":
      return {
        frequency: "weekly",
        ...common,
        weekday: Number(draft.weekday),
      }
    case "monthly":
      return {
        frequency: "monthly",
        ...common,
        day_of_month: Number(draft.dayOfMonth),
      }
  }
}

function detectedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}
