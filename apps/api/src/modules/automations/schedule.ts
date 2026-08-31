import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

import {
  automationScheduleSchema,
  type AutomationSchedule,
} from "@linksense/shared";
import {
  assertValidTimeZone,
  minutesToTimeOfDay,
  nextRecurringRunAt,
  timeOfDayToMinutes,
} from "../../lib/recurrence.js";

export {
  assertValidTimeZone,
  minutesToTimeOfDay,
  timeOfDayToMinutes,
};

dayjs.extend(utc);
dayjs.extend(timezone);

export function normalizeAutomationSchedule(
  input: AutomationSchedule,
): AutomationSchedule {
  const schedule = automationScheduleSchema.parse(input);
  assertValidTimeZone(schedule.time_zone);
  return schedule.frequency === "weekly"
    ? {
        ...schedule,
        weekdays: [...schedule.weekdays].sort((left, right) => left - right),
      }
    : schedule;
}

export function nextAutomationRunAt(
  input: AutomationSchedule,
  anchorAt: Date,
  after: Date,
): Date {
  const schedule = normalizeAutomationSchedule(input);
  return nextRecurringRunAt(schedule, anchorAt, after);
}

export function automationExpirationAt(
  expiresOn: string,
  timeZone: string,
): Date {
  assertValidTimeZone(timeZone);
  const date = dayjs.utc(`${expiresOn}T00:00:00.000Z`);
  if (!date.isValid() || date.format("YYYY-MM-DD") !== expiresOn) {
    throw new Error("invalid automation expiration date");
  }
  const exclusiveDate = date.add(1, "day").format("YYYY-MM-DD");
  const expiresAt = dayjs.tz(`${exclusiveDate} 00:00:00`, timeZone);
  if (!expiresAt.isValid()) throw new Error("invalid automation expiration");
  return expiresAt.toDate();
}

export function automationExpirationOn(
  expiresAt: Date,
  timeZone: string,
): string {
  assertValidTimeZone(timeZone);
  return dayjs(expiresAt)
    .tz(timeZone)
    .subtract(1, "day")
    .format("YYYY-MM-DD");
}

export function isAutomationExpired(
  expiresAt: Date | null,
  now: Date,
): boolean {
  return expiresAt !== null && now.getTime() >= expiresAt.getTime();
}

export function nextAutomationRunBeforeExpiration(
  schedule: AutomationSchedule,
  anchorAt: Date,
  after: Date,
  expiresAt: Date | null,
): Date | null {
  const nextRunAt = nextAutomationRunAt(schedule, anchorAt, after);
  return expiresAt && nextRunAt.getTime() >= expiresAt.getTime()
    ? null
    : nextRunAt;
}
