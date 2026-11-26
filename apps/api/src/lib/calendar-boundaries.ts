import dayjs, { type Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

export function localDateAsUtc(instant: Date, timeZone: string): Dayjs {
  return dayjs.utc(dayjs(instant).tz(timeZone).format("YYYY-MM-DD"));
}

export function localMidnight(calendarDate: Dayjs, timeZone: string): Dayjs {
  return dayjs.tz(calendarDate.format("YYYY-MM-DD"), timeZone);
}
