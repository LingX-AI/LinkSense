import { z } from "zod";

export const diskUsageCategoryKeys = [
  "user_data",
  "file_storage",
  "database",
  "backups",
  "logs",
  "runtime",
  "images",
  "other",
] as const;

export const diskUsageCategorySchema = z
  .strictObject({
    key: z.enum(diskUsageCategoryKeys),
    status: z.enum(["available", "partial", "unavailable", "not_present"]),
    used_bytes: z.number().int().nonnegative().safe().nullable(),
  })
  .superRefine((value, context) => {
    if (
      (value.status === "unavailable" && value.used_bytes !== null) ||
      (value.status === "not_present" && value.used_bytes !== 0) ||
      ((value.status === "available" || value.status === "partial") &&
        value.used_bytes === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Disk category amount does not match its status",
        path: ["used_bytes"],
      });
    }
  });

export const diskUsageSchema = z
  .strictObject({
    status: z.enum(["available", "partial", "unavailable", "collecting"]),
    checked_at: z.iso.datetime().nullable(),
    total_bytes: z.number().int().nonnegative().safe().nullable(),
    refreshing: z.boolean(),
    categories: z
      .array(diskUsageCategorySchema)
      .max(diskUsageCategoryKeys.length),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.categories.map((category) => category.key)).size !==
      value.categories.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Duplicate disk category",
        path: ["categories"],
      });
    }
    if (
      value.total_bytes !== null &&
      value.total_bytes !==
        value.categories.reduce(
          (sum, category) => sum + (category.used_bytes ?? 0),
          0,
        )
    ) {
      context.addIssue({
        code: "custom",
        message: "Disk total does not match categories",
        path: ["total_bytes"],
      });
    }
    if (
      value.status === "available" &&
      (value.total_bytes === null ||
        value.checked_at === null ||
        value.categories.some(
          (category) =>
            category.status === "unavailable" || category.status === "partial",
        ))
    ) {
      context.addIssue({
        code: "custom",
        message: "Incomplete disk total cannot be available",
        path: ["status"],
      });
    }
    if (
      (value.status === "collecting" || value.status === "unavailable") &&
      value.total_bytes !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Unmeasured disk usage cannot have a total",
        path: ["total_bytes"],
      });
    }
  });

export type DiskUsageCategoryKey = (typeof diskUsageCategoryKeys)[number];
export type DiskUsageCategory = z.infer<typeof diskUsageCategorySchema>;
export type DiskUsage = z.infer<typeof diskUsageSchema>;

export function unavailableDiskUsage(): DiskUsage {
  return {
    status: "unavailable",
    checked_at: null,
    total_bytes: null,
    refreshing: false,
    categories: [],
  };
}
