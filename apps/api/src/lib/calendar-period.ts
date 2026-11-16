import dayjs, { type Dayjs } from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);
dayjs.extend(timezone);

/** Advance the local calendar date, then resolve its midnight with the new UTC offset. */
export function nextCalendarPeriodStart(
  periodStart: Dayjs,
  period: "week" | "month",
  timeZone: string,
): Dayjs {
  if (!periodStart.isValid()) throw new RangeError("invalid_calendar_period_start");
  const nextDate = dayjs.utc(periodStart.tz(timeZone).format("YYYY-MM-DD"))
    .add(1, period)
    .format("YYYY-MM-DD");
  return dayjs.tz(`${nextDate}T00:00:00`, timeZone);
}
