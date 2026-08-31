import { z } from "zod";

import { uniqueArraySchema } from "./common.js";

export const scheduleIntervalSchema = z.number().int().min(1).max(999);

export const scheduleTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
    message: "invalid_time_zone",
  });

export const scheduleTimeOfDaySchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

export const scheduleWeekdaySchema = z.number().int().min(1).max(7);

export const scheduleWeekdaysSchema = uniqueArraySchema(
  scheduleWeekdaySchema,
)
  .min(1)
  .max(7);
