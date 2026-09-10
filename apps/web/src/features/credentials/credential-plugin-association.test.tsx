import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CredentialConfigurationStatus } from "@linksense/shared"
import i18n from "@/i18n"
import { CredentialPluginAssociation } from "./credential-plugin-association"

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(cleanup)
const binding = {
  id: "b1",
  capability_id: "p1",
  credential_id: "c1",
  env_key: "CLIENT_ID",
  credential_key: "SAVED_ID",
  status: "active" as const,
  created_at: "2026-09-10T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
}
function props(status: CredentialConfigurationStatus = "configured") {
  return {
    name: "ManageBac",
    bindings: [binding],
    configuration: {
      capability_id: "p1",
      available: true,
      fields: [{ env_key: "CLIENT_ID", status }],
    },
    disabled: false,
    loading: false,
    failed: false,
    pending: false,
    onManage: vi.fn(),
    onEnable: vi.fn(),
    onRemove: vi.fn(),
    onRemoveField: vi.fn(),
    onRetry: vi.fn(),
  }
}
describe("credential plugin associations", () => {
  it("hides technical fields until details are expanded and exposes explicit removal actions", async () => {
    const input = props()
    render(<CredentialPluginAssociation {...input} />)
    expect(screen.getByText("凭据已配置")).toBeVisible()
    expect(screen.queryByText("CLIENT_ID")).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "ManageBac 的配置详情" })
    )
    expect(screen.getByText("CLIENT_ID")).toHaveAttribute("translate", "no")
    expect(screen.getByText("SAVED_ID")).toBeVisible()
    fireEvent.click(
      screen.getByRole("button", { name: "移除 CLIENT_ID 的关联" })
    )
    expect(input.onRemoveField).toHaveBeenCalledWith(binding)
    const interaction = userEvent.setup()
    expect(
      screen.queryByRole("button", { name: "解除关联" })
    ).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "ManageBac 的关联操作" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "解除关联" })
    )
    expect(input.onRemove).toHaveBeenCalledOnce()
  })
  it.each([
    ["missing", "还有信息未配置", "补充配置"],
    ["conflict", "关联存在冲突", "处理关联"],
    ["invalid", "配置需要更新", "处理关联"],
    ["disabled", "有凭据已停用", "管理关联"],
  ] as const)(
    "explains %s and offers an actionable next step",
    async (status, label, action) => {
      const input = props(status)
      render(<CredentialPluginAssociation {...input} />)
      expect(screen.getByText(label)).toBeVisible()
      expect(
        screen.queryByRole("button", { name: action })
      ).not.toBeInTheDocument()
      const interaction = userEvent.setup()
      await interaction.click(
        screen.getByRole("button", { name: "ManageBac 的关联操作" })
      )
      await interaction.click(
        await screen.findByRole("menuitem", { name: action })
      )
      expect(input.onManage).toHaveBeenCalledOnce()
      expect(screen.queryByText("凭据已配置")).not.toBeInTheDocument()
    }
  )
  it("offers enabling the current disabled credential", () => {
    const input = props("disabled")
    render(<CredentialPluginAssociation {...input} disabled />)
    fireEvent.click(screen.getByRole("button", { name: "启用凭据" }))
    expect(input.onEnable).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("button", { name: "管理关联" })
    ).not.toBeInTheDocument()
  })
  it("does not claim readiness when loading or when status cannot be loaded", () => {
    const input = props()
    const { rerender } = render(
      <CredentialPluginAssociation {...input} loading />
    )
    expect(screen.getByText("正在检查…")).toBeVisible()
    rerender(<CredentialPluginAssociation {...input} failed />)
    expect(screen.getByText("状态加载失败")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(input.onRetry).toHaveBeenCalledOnce()
    expect(screen.queryByText("凭据已配置")).not.toBeInTheDocument()
  })
  it("keeps unlink available for inaccessible plugins without offering configuration", async () => {
    const input = props()
    render(
      <CredentialPluginAssociation
        {...input}
        configuration={{ capability_id: "p1", available: false, fields: [] }}
      />
    )
    expect(screen.getByText("插件不可用")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "管理关联" })
    ).not.toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "ManageBac 的关联操作" }))
    expect(
      await screen.findByRole("menuitem", { name: "解除关联" })
    ).toBeEnabled()
  })
  it("disables managing links while a change is pending", async () => {
    const input = props()
    render(<CredentialPluginAssociation {...input} pending />)
    const interaction = userEvent.setup()
    await interaction.click(
      screen.getByRole("button", { name: "ManageBac 的关联操作" })
    )
    const action = await screen.findByRole("menuitem", { name: "管理关联" })
    expect(action).toHaveAttribute("aria-disabled", "true")
    expect(input.onManage).not.toHaveBeenCalled()
  })
  it("provides Chinese, English and fallback text for every state and action", () => {
    const chinese = i18n.getResourceBundle("zh-CN", "translation").credential
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    for (const key of Object.keys(chinese)) {
      const paths =
        typeof chinese[key] === "string"
          ? [key]
          : Object.keys(chinese[key]).map((child) => `${key}.${child}`)
      for (const path of paths) {
        const fullKey = `credential.${path}`
        expect(i18n.t(fullKey, { lng: "en-US" })).not.toBe(fullKey)
        expect(fallback.t(fullKey, { lng: "en-US" })).toBe(
          i18n.t(fullKey, { lng: "zh-CN" })
        )
      }
    }
  })
})
