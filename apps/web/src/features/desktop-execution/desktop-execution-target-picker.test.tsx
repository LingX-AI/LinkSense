import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import i18n from "@/i18n"
import { DesktopExecutionTargetPicker } from "./desktop-execution-target-picker"
import type { DesktopExecutionDeviceAvailability } from "./desktop-execution-target"

const ready: DesktopExecutionDeviceAvailability = {
  kind: "ready",
  deviceId: "device-1",
}
const offline: DesktopExecutionDeviceAvailability = {
  kind: "unavailable",
  reason: "offline",
}
const notReady: DesktopExecutionDeviceAvailability = {
  kind: "unavailable",
  reason: "not_ready",
}
const statusUnavailable: DesktopExecutionDeviceAvailability = {
  kind: "unavailable",
  reason: "status_unavailable",
}

function renderPicker(
  props: Partial<{
    value: "cloud" | "local"
    availability: DesktopExecutionDeviceAvailability
    disabled: boolean
    onValueChange: (target: "cloud" | "local") => void
  }> = {}
) {
  const onValueChange = props.onValueChange ?? vi.fn()
  render(
    <MemoryRouter>
      <DesktopExecutionTargetPicker
        value={props.value ?? "cloud"}
        onValueChange={onValueChange}
        availability={props.availability ?? ready}
        disabled={props.disabled}
      />
    </MemoryRouter>
  )
  return { onValueChange }
}

async function openPicker() {
  const interaction = userEvent.setup()
  await interaction.click(screen.getByRole("button", { name: /运行位置/u }))
  return interaction
}

describe("DesktopExecutionTargetPicker", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
  })

  it("defaults to cloud and selects local on a ready Mac", async () => {
    const { onValueChange } = renderPicker()
    expect(screen.getByRole("button", { name: /运行位置/u })).toHaveTextContent(
      "云电脑"
    )

    const interaction = await openPicker()
    const local = screen.getByRole("radio", { name: "本地电脑" })
    expect(local).not.toHaveAttribute("aria-disabled", "true")
    expect(screen.getByText("在这台 Mac 上运行任务。")).toBeVisible()

    await interaction.click(local)
    expect(onValueChange).toHaveBeenCalledWith("local")
  })

  it("names the trigger with the current selection", () => {
    renderPicker()
    expect(
      screen.getByRole("button", { name: "运行位置：云电脑" })
    ).toBeVisible()
    cleanup()
    renderPicker({ value: "local", availability: ready })
    expect(
      screen.getByRole("button", { name: "运行位置：本地电脑" })
    ).toBeVisible()
  })

  it("opens and selects local with the keyboard", async () => {
    const { onValueChange } = renderPicker()
    const interaction = userEvent.setup()
    const trigger = screen.getByRole("button", {
      name: "运行位置：云电脑",
    })
    trigger.focus()
    expect(trigger).toHaveFocus()

    await interaction.keyboard("{Enter}")
    const cloud = await screen.findByRole("radio", { name: "云电脑" })
    expect(cloud).toBeVisible()
    cloud.focus()
    await interaction.keyboard("{ArrowDown}")

    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("local"))
  })

  it("disables local and links to device settings when this Mac is offline", async () => {
    renderPicker({ availability: offline })
    await openPicker()

    expect(
      screen.getByRole("radio", {
        name: "本地电脑",
        description: "这台 Mac 当前离线。请检查网络后重试。",
      })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByText("这台 Mac 当前离线。请检查网络后重试。")
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "管理设备" })).toHaveAttribute(
      "href",
      "/settings/general#desktop-devices-heading"
    )
  })

  it("keeps local disabled for an old host without an execution link", async () => {
    renderPicker({ availability: notReady })
    await openPicker()

    expect(screen.getByRole("radio", { name: "本地电脑" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    expect(
      screen.getByText(
        "此版本的客户端无法运行本地任务。请更新 LinkSense 后重试。"
      )
    ).toBeVisible()
    expect(
      screen.queryByRole("link", { name: "管理设备" })
    ).not.toBeInTheDocument()
  })

  it("shows a checking hint while device status is loading", async () => {
    renderPicker({ availability: { kind: "checking" } })
    await openPicker()

    expect(screen.getByRole("radio", { name: "本地电脑" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    expect(screen.getByText("正在检查这台 Mac 是否可用…")).toBeVisible()
  })

  it("fails closed when device status cannot be read", async () => {
    renderPicker({ availability: statusUnavailable })
    await openPicker()

    expect(screen.getByRole("radio", { name: "本地电脑" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    expect(
      screen.getByText("无法读取这台 Mac 的设备状态。请重试。")
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "管理设备" })).toBeVisible()
  })

  it("keeps the selected local target visible after readiness is lost", () => {
    renderPicker({ value: "local", availability: offline })
    const trigger = screen.getByRole("button", { name: /运行位置/u })
    expect(trigger).toHaveTextContent("本地电脑")
    // The warning icon is decorative; the label and readiness copy carry the state.
    expect(trigger.querySelector("svg.text-destructive")).not.toBeNull()
  })

  it("does not change the target when the picker is disabled", async () => {
    const { onValueChange } = renderPicker({ disabled: true })
    const trigger = screen.getByRole("button", { name: /运行位置/u })
    expect(trigger).toBeDisabled()
    expect(onValueChange).not.toHaveBeenCalled()
  })
})
