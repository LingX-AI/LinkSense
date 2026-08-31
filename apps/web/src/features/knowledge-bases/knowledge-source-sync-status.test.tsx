import { render, screen } from "@testing-library/react"
import type { KnowledgeBaseSource } from "@linksense/shared"
import { beforeEach, describe, expect, it } from "vitest"

import i18n from "@/i18n"

import { KnowledgeSourceSyncStatus } from "./knowledge-source-sync-status"

describe("KnowledgeSourceSyncStatus", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  it("shows indeterminate scanning progress with the discovered item count", () => {
    render(
      <KnowledgeSourceSyncStatus
        source={sourceFixture({
          sync_status: "syncing",
          sync_progress: progressFixture({
            phase: "scanning",
            total_count: null,
            progress_percent: null,
            scanned_count: 18,
          }),
        })}
      />
    )

    expect(
      screen.getByText("正在扫描目录，已发现 18 个条目")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("progressbar", {
        name: "正在扫描目录，已发现 18 个条目",
      })
    ).not.toHaveAttribute("aria-valuenow")
  })

  it("shows determinate processing progress and the final failure summary", () => {
    const { rerender } = render(
      <KnowledgeSourceSyncStatus
        source={sourceFixture({
          sync_status: "syncing",
          sync_progress: progressFixture({
            phase: "processing",
            total_count: 4,
            processed_count: 3,
            progress_percent: 75,
          }),
        })}
      />
    )

    expect(screen.getByText("正在处理文档（3/4）")).toBeInTheDocument()
    expect(screen.getByText("75%")).toBeInTheDocument()

    rerender(
      <KnowledgeSourceSyncStatus
        source={sourceFixture({
          sync_status: "failed",
          retry_available: true,
          stable_error_code: "KNOWLEDGE_SOURCE_ITEM_SYNC_FAILED",
          sync_progress: progressFixture({
            status: "partial",
            phase: "completed",
            failure_phase: "processing",
            total_count: 4,
            processed_count: 4,
            retried_count: 3,
            failed_count: 1,
            progress_percent: 100,
            completed_at: "2026-08-12T01:05:00.000Z",
          }),
        })}
      />
    )

    expect(screen.getByText(/共处理 4\/4 个/)).toHaveTextContent("续传 3")
    expect(screen.getByText(/共处理 4\/4 个/)).toHaveTextContent("失败 1")
    expect(screen.getByText(/点击“重试同步”/)).toBeInTheDocument()
  })
})

function sourceFixture(
  overrides: Partial<KnowledgeBaseSource> = {}
): KnowledgeBaseSource {
  return {
    id: "00000000-0000-4000-8000-000000000401",
    knowledge_base_id: "00000000-0000-4000-8000-000000000402",
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
    sync_status: "ready",
    retry_available: false,
    sync_progress: null,
    stable_error_code: null,
    last_synced_at: null,
    next_sync_at: "2026-08-13T01:00:00.000Z",
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T01:00:00.000Z",
    ...overrides,
  }
}

function progressFixture(
  overrides: Partial<NonNullable<KnowledgeBaseSource["sync_progress"]>> = {}
): NonNullable<KnowledgeBaseSource["sync_progress"]> {
  return {
    run_id: "00000000-0000-4000-8000-000000000403",
    trigger: "manual",
    status: "running",
    phase: "processing",
    failure_phase: null,
    retry_of_run_id: null,
    scanned_count: 4,
    total_count: 4,
    processed_count: 0,
    created_count: 0,
    updated_count: 0,
    deleted_count: 0,
    skipped_count: 0,
    retried_count: 0,
    failed_count: 0,
    progress_percent: 0,
    started_at: "2026-08-12T01:00:00.000Z",
    updated_at: "2026-08-12T01:02:00.000Z",
    completed_at: null,
    ...overrides,
  }
}
