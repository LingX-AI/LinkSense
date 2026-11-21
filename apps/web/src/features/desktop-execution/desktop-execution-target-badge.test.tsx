import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import i18n from "@/i18n"
import { DesktopExecutionTargetBadge } from "./desktop-execution-target-badge"

describe("DesktopExecutionTargetBadge", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
  })

  it("shows a cloud task target", () => {
    render(<DesktopExecutionTargetBadge target="cloud" />)
    expect(screen.getByLabelText("运行位置：云电脑")).toHaveTextContent(
      "云电脑"
    )
  })

  it("shows a local task target", () => {
    render(<DesktopExecutionTargetBadge target="local" />)
    expect(screen.getByLabelText("运行位置：本地电脑")).toHaveTextContent(
      "本地电脑"
    )
  })
})
