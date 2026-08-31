import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ProfileActivityHeatmap } from "@/features/profile/profile-activity-heatmap"
import { activityLevel } from "@/features/profile/profile-usage"
import i18n from "@/i18n"

describe("ProfileActivityHeatmap", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  it("maps precise token strings onto five activity levels", () => {
    expect(activityLevel("0", "100")).toBe(0)
    expect(activityLevel("1", "100")).toBe(1)
    expect(activityLevel("25", "100")).toBe(1)
    expect(activityLevel("26", "100")).toBe(2)
    expect(activityLevel("51", "100")).toBe(3)
    expect(activityLevel("100", "100")).toBe(4)
    expect(activityLevel("9007199254740993", "9007199254740993")).toBe(4)
    expect(activityLevel("invalid", "100")).toBe(0)
  })

  it("provides localized labels and keyboard-focusable daily cells", () => {
    const { container } = render(
      <ProfileActivityHeatmap
        activity={[
          { date: "2026-07-26", total_tokens: "25" },
          { date: "2026-07-27", total_tokens: "100" },
        ]}
        language="zh-CN"
        peakDailyTokens="100"
      />
    )

    expect(
      screen.getByRole("group", {
        name: "最近 365 天的 Token 活动热力图",
      })
    ).toBeVisible()
    const peakDay = screen.getByRole("img", {
      name: "2026年7月27日，使用 100 Token",
    })
    expect(peakDay).toHaveAttribute("tabindex", "0")
    expect(peakDay).toHaveClass("profile-activity-level-4")
    expect(
      container.querySelector(".profile-activity-level-1")
    ).toBeInTheDocument()

    fireEvent.mouseOver(peakDay)
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "7月27日 使用了 100 个 Token"
    )

    fireEvent.mouseLeave(peakDay)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

    fireEvent.focus(peakDay)
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "7月27日 使用了 100 个 Token"
    )
  })

  it("shows an English activity tooltip with a compact date", async () => {
    await i18n.changeLanguage("en-US")

    render(
      <ProfileActivityHeatmap
        activity={[{ date: "2026-07-27", total_tokens: "100" }]}
        language="en-US"
        peakDailyTokens="100"
      />
    )

    const peakDay = screen.getByRole("img", {
      name: "Jul 27, 2026, 100 tokens used",
    })
    fireEvent.mouseOver(peakDay)

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Jul 27 used 100 tokens"
    )
  })

  it("positions the activity tooltip above the hovered day cell", () => {
    const { container } = render(
      <ProfileActivityHeatmap
        activity={[{ date: "2026-07-27", total_tokens: "100" }]}
        language="zh-CN"
        peakDailyTokens="100"
      />
    )

    const shell = container.querySelector(
      ".profile-activity-heatmap-shell"
    ) as HTMLDivElement
    const peakDay = screen.getByRole("img", {
      name: "2026年7月27日，使用 100 Token",
    })

    shell.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 20,
        top: 20,
        left: 0,
        right: 640,
        bottom: 220,
        width: 640,
        height: 200,
        toJSON: () => ({}),
      }) as DOMRect
    peakDay.getBoundingClientRect = () =>
      ({
        x: 260,
        y: 120,
        top: 120,
        left: 260,
        right: 270,
        bottom: 130,
        width: 10,
        height: 10,
        toJSON: () => ({}),
      }) as DOMRect

    fireEvent.mouseOver(peakDay)

    expect(
      screen
        .getByRole("tooltip")
        .style.getPropertyValue("--profile-activity-tooltip-y")
    ).toBe("58px")
  })
})
