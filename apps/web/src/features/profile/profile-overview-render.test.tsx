import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PersonalUsageProfile, User } from "@/api/contracts"
import { ProfileOverview } from "@/features/profile/profile-overview"
import i18n from "@/i18n"

const user: User = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Alex Chen",
  email: "alex@example.test",
  role: "admin",
  status: "active",
  avatar_url: null,
  language: "zh-CN",
  login_method: "password",
  running_message_action: "queue",
  registration_source: "organization_invitation",
  weekly_credit_limit: null,
  user_groups: [],
}

const usage: PersonalUsageProfile = {
  generated_at: "2026-08-07T12:00:00.000Z",
  activity_period: {
    from: "2025-08-08",
    to: "2026-08-07",
    time_zone: "Asia/Shanghai",
  },
  token_coverage: {
    started_at: "2026-07-01T00:00:00.000Z",
  },
  metrics: {
    task_count: 5,
    turn_count: 8,
    request_count: 12,
    skill_usage_count: 3,
    token_usage: {
      total_tokens: "1200",
      input_tokens: "700",
      cached_input_tokens: "100",
      output_tokens: "500",
      reasoning_output_tokens: "20",
    },
  },
  peak_daily_tokens: "900",
  active_days: 2,
  current_streak_days: 1,
  longest_streak_days: 2,
  daily_activity: [],
  models: [
    {
      model_id: "gpt-5.6-terra",
      display_name: "GPT-5.6 Terra",
      model_kind: "generation",
      request_count: 12,
      turn_count: 8,
      token_usage: {
        total_tokens: "1200",
        input_tokens: "700",
        cached_input_tokens: "100",
        output_tokens: "500",
        reasoning_output_tokens: "20",
      },
    },
  ],
  skills: [
    {
      skill_id: "40000000-0000-4000-8000-000000000001",
      name: "dashi-ppt",
      usage_count: 2,
    },
    {
      skill_id: "builtin:capability:linksense-browser",
      name: "linksense-browser",
      usage_count: 1,
    },
  ],
}

describe("ProfileOverview", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  it("shows chat and Skill usage insights with the Skill ranking", () => {
    render(
      <ProfileOverview
        avatarUploadPending={false}
        initials="O"
        language="zh-CN"
        onAvatarUploadRequest={vi.fn()}
        onNameEditRequest={vi.fn()}
        profileError={null}
        usage={usage}
        usageError={null}
        usagePending={false}
        user={user}
      />
    )

    expect(screen.getByText("聊天总数")).toBeVisible()
    expect(screen.getByText("技能使用次数")).toBeVisible()
    expect(screen.getByRole("heading", { name: "最常用的技能" })).toBeVisible()
    expect(screen.getByText("dashi-ppt")).toBeVisible()
    expect(screen.getByText("linksense-browser")).toBeVisible()
    expect(screen.getByText("2 次")).toBeVisible()
    expect(
      screen.queryByRole("progressbar", { name: /dashi-ppt/u })
    ).not.toBeInTheDocument()
  })
})
