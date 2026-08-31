import { describe, expect, it } from "vitest";

import {
  createSharePointKnowledgeBaseInputSchema,
  knowledgeBaseSourceSchema,
  knowledgeSourceSyncScheduleSchema,
} from "../src/index.js";

describe("knowledge source synchronization contracts", () => {
  it.each([
    {
      frequency: "daily",
      time: "09:00",
      time_zone: "Asia/Shanghai",
    },
    {
      frequency: "weekly",
      weekday: 3,
      time: "14:35",
      time_zone: "Asia/Shanghai",
    },
    {
      frequency: "monthly",
      day_of_month: 31,
      time: "23:59",
      time_zone: "America/New_York",
    },
  ])("accepts the $frequency synchronization schedule", (schedule) => {
    expect(knowledgeSourceSyncScheduleSchema.parse(schedule)).toEqual(schedule);
  });

  it("rejects removed interval schedules and invalid calendar controls", () => {
    expect(
      createSharePointKnowledgeBaseInputSchema.safeParse({
        name: "Policies",
        source_type: "sharepoint",
        sharepoint_folder_url:
          "https://contoso.sharepoint.com/sites/Finance/Policies",
        sync_interval_minutes: 60,
      }).success,
    ).toBe(false);
    expect(
      knowledgeSourceSyncScheduleSchema.safeParse({
        frequency: "weekly",
        weekdays: [1, 3],
        time: "09:00",
        time_zone: "UTC",
      }).success,
    ).toBe(false);
    expect(
      knowledgeSourceSyncScheduleSchema.safeParse({
        frequency: "monthly",
        day_of_month: 32,
        time: "09:00",
        time_zone: "UTC",
      }).success,
    ).toBe(false);
    expect(
      knowledgeSourceSyncScheduleSchema.safeParse({
        frequency: "hourly",
        time: "09:00",
        time_zone: "UTC",
      }).success,
    ).toBe(false);
  });

  it("exposes a bounded synchronization progress snapshot without Graph cursors", () => {
    const parsed = knowledgeBaseSourceSchema.parse({
      id: "00000000-0000-4000-8000-000000000301",
      knowledge_base_id: "00000000-0000-4000-8000-000000000302",
      provider: "sharepoint",
      source_url: "https://contoso.sharepoint.com/sites/Finance/Policies",
      site_name: "Finance",
      drive_name: "Documents",
      folder_name: "Policies",
      sync_schedule: {
        frequency: "daily",
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
      sync_status: "syncing",
      retry_available: false,
      sync_progress: {
        run_id: "00000000-0000-4000-8000-000000000303",
        trigger: "retry",
        status: "running",
        phase: "processing",
        failure_phase: null,
        retry_of_run_id: "00000000-0000-4000-8000-000000000304",
        scanned_count: 12,
        total_count: 4,
        processed_count: 3,
        created_count: 1,
        updated_count: 0,
        deleted_count: 0,
        skipped_count: 0,
        retried_count: 2,
        failed_count: 0,
        progress_percent: 75,
        started_at: "2026-08-12T01:00:00.000Z",
        updated_at: "2026-08-12T01:02:00.000Z",
        completed_at: null,
      },
      stable_error_code: null,
      last_synced_at: null,
      next_sync_at: "2026-08-13T01:00:00.000Z",
      created_at: "2026-08-12T00:00:00.000Z",
      updated_at: "2026-08-12T01:02:00.000Z",
    });

    expect(parsed.sync_progress?.progress_percent).toBe(75);
    expect(parsed.sync_progress).not.toHaveProperty("scan_cursor");
    expect(parsed.sync_progress).not.toHaveProperty("scan_delta_link");
  });
});
