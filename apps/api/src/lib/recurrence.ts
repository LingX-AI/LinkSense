import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import rrule, { type Options } from "rrule";

dayjs.extend(utc);
dayjs.extend(timezone);

// rrule 2.x publishes CommonJS at its Node entry point even though its type
// declarations describe named ESM exports. Node 24 therefore exposes the
// runtime API through the default export inside the container.
const { datetime, RRule } = rrule;

const WEEKDAYS = [
  RRule.MO,
  RRule.TU,
  RRule.WE,
  RRule.TH,
  RRule.FR,
  RRule.SA,
  RRule.SU,
] as const;

export type RecurrenceSchedule =
  | {
      frequency: "hourly";
      interval: number;
      minute: number;
      time_zone: string;
    }
  | {
      frequency: "daily";
      interval: number;
      time: string;
      time_zone: string;
    }
  | {
      frequency: "weekly";
      interval: number;
      weekdays: number[];
      time: string;
      time_zone: string;
    }
  | {
      frequency: "monthly";
      interval: number;
      day_of_month: number;
      time: string;
      time_zone: string;
    }
  | {
      frequency: "yearly";
      interval: number;
      month_of_year: number;
      day_of_month: number;
      time: string;
      time_zone: string;
    };

export function nextRecurringRunAt(
  schedule: RecurrenceSchedule,
  anchorAt: Date,
  after: Date,
): Date {
  assertValidTimeZone(schedule.time_zone);
  const rule = new RRule(buildRRuleOptions(schedule, anchorAt));
  let floatingAfter = floatingDate(after, schedule.time_zone);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const nextFloating = rule.after(floatingAfter, false);
    if (!nextFloating) throw new Error("recurrence has no next run");
    const next = floatingDateToInstant(nextFloating, schedule.time_zone);
    if (next.getTime() > after.getTime()) return next;
    floatingAfter = nextFloating;
  }

  throw new Error("recurrence did not advance");
}

export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  } catch {
    throw new Error("invalid recurrence time zone");
  }
}

export function timeOfDayToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (
    hours === undefined ||
    minutes === undefined ||
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error("invalid recurrence time of day");
  }
  return hours * 60 + minutes;
}

export function minutesToTimeOfDay(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 1_439) {
    throw new Error("invalid recurrence time of day minutes");
  }
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(
    value % 60,
  ).padStart(2, "0")}`;
}

function buildRRuleOptions(
  schedule: RecurrenceSchedule,
  anchorAt: Date,
): Partial<Options> {
  const common = {
    interval: schedule.interval,
    dtstart: floatingDate(anchorAt, schedule.time_zone),
    wkst: RRule.MO,
    bysecond: [0],
  } satisfies Partial<Options>;

  if (schedule.frequency === "hourly") {
    return {
      ...common,
      freq: RRule.HOURLY,
      byminute: [schedule.minute],
    };
  }

  const [hour, minute] = schedule.time.split(":").map(Number) as [
    number,
    number,
  ];
  const timed = { ...common, byhour: [hour], byminute: [minute] };

  switch (schedule.frequency) {
    case "daily":
      return { ...timed, freq: RRule.DAILY };
    case "weekly":
      return {
        ...timed,
        freq: RRule.WEEKLY,
        byweekday: schedule.weekdays.map((weekday) => WEEKDAYS[weekday - 1]!),
      };
    case "monthly":
      return {
        ...timed,
        freq: RRule.MONTHLY,
        bymonthday: [schedule.day_of_month],
      };
    case "yearly":
      return {
        ...timed,
        freq: RRule.YEARLY,
        bymonth: [schedule.month_of_year],
        bymonthday: [schedule.day_of_month],
      };
  }
}

function floatingDate(value: Date, timeZone: string): Date {
  const local = dayjs(value).tz(timeZone);
  return datetime(
    local.year(),
    local.month() + 1,
    local.date(),
    local.hour(),
    local.minute(),
    local.second(),
  );
}

function floatingDateToInstant(value: Date, timeZone: string): Date {
  const localText = [
    String(value.getUTCFullYear()).padStart(4, "0"),
    "-",
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    "-",
    String(value.getUTCDate()).padStart(2, "0"),
    " ",
    String(value.getUTCHours()).padStart(2, "0"),
    ":",
    String(value.getUTCMinutes()).padStart(2, "0"),
    ":",
    String(value.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const parsed = dayjs.tz(localText, timeZone);
  if (!parsed.isValid()) throw new Error("invalid recurrence");
  return parsed.toDate();
}
