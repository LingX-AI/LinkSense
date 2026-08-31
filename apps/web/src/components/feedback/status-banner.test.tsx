import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"

describe("StatusBanner", () => {
  it("composes the shadcn alert primitive while preserving status semantics", () => {
    render(
      <StatusBanner title="同步完成" actions={<Button>查看</Button>}>
        数据已经更新。
      </StatusBanner>
    )

    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("data-slot", "alert")
    expect(status).toHaveClass("items-center")
    expect(screen.getByText("同步完成")).toHaveAttribute(
      "data-slot",
      "alert-title"
    )
    expect(screen.getByText("数据已经更新。")).toHaveAttribute(
      "data-slot",
      "alert-description"
    )
    expect(screen.getByText("数据已经更新。").parentElement).toHaveClass(
      "justify-center"
    )
    expect(screen.getByRole("button", { name: "查看" })).toBeVisible()
  })

  it("keeps error messages as assertive alerts", () => {
    render(<StatusBanner variant="error">保存失败。</StatusBanner>)

    const alert = screen.getByRole("alert")
    expect(alert).toHaveAttribute("data-slot", "alert")
    const icon = alert.querySelector("svg")
    expect(icon).toHaveClass("size-4", "shrink-0", "translate-y-0!")
    expect(icon).not.toHaveClass("mt-0.5")
  })

  it("can hide the leading status icon for inline contextual notices", () => {
    const { container } = render(
      <StatusBanner hideIcon>由应用管理。</StatusBanner>
    )

    const status = container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    if (!status) {
      throw new Error("Expected status banner")
    }
    expect(status.querySelector("svg")).toBeNull()
    expect(screen.getByText("由应用管理。")).toBeVisible()
  })
})
