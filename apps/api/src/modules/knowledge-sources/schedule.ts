import {
  knowledgeSourceSyncFrequencySchema,
  knowledgeSourceSyncScheduleSchema,
  type KnowledgeSourceSyncSchedule,
} from "@linksense/shared";

import {
  assertValidTimeZone,
  minutesToTimeOfDay,
  nextRecurringRunAt,
  timeOfDayToMinutes,
} from "../../lib/recurrence.js";

export type KnowledgeSourceScheduleRecord = {
  syncFrequency: string;
  syncTimeOfDayMinutes: number;
  syncTimeZone: string;
  syncWeekday: number | null;
  syncDayOfMonth: number | null;
};

export function normalizeKnowledgeSourceSchedule(
  input: KnowledgeSourceSyncSchedule,
): KnowledgeSourceSyncSchedule {
  const schedule = knowledgeSourceSyncScheduleSchema.parse(input);
  assertValidTimeZone(schedule.time_zone);
  return schedule;
}

export function nextKnowledgeSourceSyncAt(
  input: KnowledgeSourceSyncSchedule,
  anchorAt: Date,
  after: Date,
): Date {
  const schedule = normalizeKnowledgeSourceSchedule(input);
  return nextRecurringRunAt(
    schedule.frequency === "weekly"
      ? { ...schedule, weekdays: [schedule.weekday], interval: 1 }
      : { ...schedule, interval: 1 },
    anchorAt,
    after,
  );
}

export function knowledgeSourceScheduleToRecord(
  input: KnowledgeSourceSyncSchedule,
): KnowledgeSourceScheduleRecord {
  const schedule = normalizeKnowledgeSourceSchedule(input);
  return {
    syncFrequency: schedule.frequency,
    syncTimeOfDayMinutes: timeOfDayToMinutes(schedule.time),
    syncTimeZone: schedule.time_zone,
    syncWeekday: schedule.frequency === "weekly" ? schedule.weekday : null,
    syncDayOfMonth:
      schedule.frequency === "monthly" ? schedule.day_of_month : null,
  };
}

export function knowledgeSourceScheduleFromRecord(
  record: KnowledgeSourceScheduleRecord,
): KnowledgeSourceSyncSchedule {
  const frequency = knowledgeSourceSyncFrequencySchema.parse(
    record.syncFrequency,
  );
  const common = {
    time: minutesToTimeOfDay(record.syncTimeOfDayMinutes),
    time_zone: record.syncTimeZone,
  };
  switch (frequency) {
    case "daily":
      return normalizeKnowledgeSourceSchedule({
        frequency,
        ...common,
      });
    case "weekly":
      return normalizeKnowledgeSourceSchedule({
        frequency,
        ...common,
        weekday: requiredNumber(record.syncWeekday),
      });
    case "monthly":
      return normalizeKnowledgeSourceSchedule({
        frequency,
        ...common,
        day_of_month: requiredNumber(record.syncDayOfMonth),
      });
  }
}

function requiredNumber(value: number | null): number {
  if (value === null) throw new Error("knowledge source schedule is incomplete");
  return value;
}
