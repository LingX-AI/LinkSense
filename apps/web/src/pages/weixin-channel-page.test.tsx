import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nextProvider } from "react-i18next"

import { apiRequest } from "@/api/client"
import { notify } from "@/components/feedback/notification"
import i18n from "@/i18n"
import { WeixinChannelPage } from "@/pages/weixin-channel-page"

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>()
  return { ...actual, apiRequest: vi.fn() }
})
vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <svg
      data-testid={value.includes("feishu") ? "feishu-qr-svg" : "weixin-qr-svg"}
    />
  ),
}))

const CONNECTION_ID = "10000000-0000-4000-8000-000000000001"
const LOGIN_ID = "20000000-0000-4000-8000-000000000001"
const FEISHU_CONNECTION_ID = "30000000-0000-4000-8000-000000000001"
const FEISHU_REGISTRATION_ID = "40000000-0000-4000-8000-000000000001"
const NOW = "2026-08-13T08:00:00.000Z"

describe("WeixinChannelPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    notify.dismiss()
    cleanup()
    vi.restoreAllMocks()
  })

  it("starts QR login and submits a pairing code without handling protocol credentials", async () => {
    let loginPolls = 0
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/weixin" && !options.method) return { items: [] }
      if (path === "/feishu" && !options.method) return { items: [] }
      if (path === "/bot-channels" && !options.method) return { items: [] }
      if (path === "/weixin/login-sessions" && options.method === "POST") {
        return loginSession("waiting_scan")
      }
      if (path === `/weixin/login-sessions/${LOGIN_ID}` && !options.method) {
        loginPolls += 1
        return loginPolls === 1
          ? loginSession("verification_required")
          : {
              ...loginSession("connected"),
              connection: connection({ runtimeStatus: "connecting" }),
            }
      }
      if (
        path === `/weixin/login-sessions/${LOGIN_ID}/verification` &&
        options.method === "POST"
      ) {
        return loginSession("scanned")
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "连接微信" }))

    expect(await screen.findByTestId("weixin-qr-svg")).toBeInTheDocument()
    const closeButtons = screen.getAllByRole("button", { name: "关闭" })
    expect(closeButtons).toHaveLength(1)
    expect(closeButtons[0]).toHaveAttribute("data-slot", "dialog-close")
    const pairingCode = await screen.findByRole("textbox", {
      name: "手机微信显示的配对码",
    })
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    expect(loginPolls).toBe(1)
    await user.type(pairingCode, "123456")
    await user.click(screen.getByRole("button", { name: "提交配对码" }))

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/weixin/login-sessions/${LOGIN_ID}/verification`,
        expect.objectContaining({
          method: "POST",
          body: { verify_code: "123456" },
        })
      )
    )
    const successHeading = await screen.findByRole(
      "heading",
      { name: "连接成功" },
      { timeout: 3_000 }
    )
    const successStatus = successHeading.closest('[role="status"]')
    expect(successStatus).toHaveClass("weixin-login-success")
    expect(successHeading).toBeVisible()
    expect(screen.getByText("已连接账号 ****1234")).toBeVisible()
    expect(
      successStatus?.querySelector(".weixin-login-success-mark span")
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "完成" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "完成" }))
    expect(screen.getByText("在线")).toBeVisible()
    expect(screen.queryByText("连接中")).not.toBeInTheDocument()
    expect(apiRequest).toHaveBeenCalledWith(
      "/weixin/login-sessions",
      expect.objectContaining({
        body: {},
      })
    )
  })

  it("shows an existing connection, supported scope, and management actions", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === "/weixin") return { items: [connection()] }
      if (path === "/feishu") return { items: [] }
      throw new Error(`Unexpected request: ${path}`)
    })

    renderPage()

    expect(
      await screen.findByRole("heading", { name: "消息渠道" })
    ).toBeVisible()
    expect(
      await screen.findByRole("region", { name: "可接入渠道" })
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "微信" })).toBeVisible()
    expect(screen.getByLabelText("微信图标")).toBeVisible()
    expect(
      screen.getByRole("heading", { name: "Microsoft Teams" })
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "飞书" })).toBeVisible()
    expect(
      screen.getByText("通过飞书机器人接收消息，并交给 LinkSense 助手处理。")
    ).toBeVisible()
    expect(screen.queryByText(/扫码自动创建或更新/u)).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "企业微信" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "钉钉" })).toBeVisible()
    expect(screen.queryByText("即将支持")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "连接企业微信" })
    ).toBeInTheDocument()
    expect(screen.queryByText("已连接账号 ****1234")).not.toBeInTheDocument()
    expect(
      screen.queryByText("仅扫码账号本人 · 文本与语音转写")
    ).not.toBeInTheDocument()
    expect(screen.queryByText("消息处理应用")).not.toBeInTheDocument()
    expect(screen.queryByText("默认 LinkSense 助手")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重新连接" })).toBeVisible()
    const disconnectButton = screen.getByRole("button", { name: "断开连接" })
    expect(disconnectButton).toBeVisible()
    expect(disconnectButton).toHaveClass("channel-access-action-destructive")
    expect(apiRequest).not.toHaveBeenCalledWith(
      "/applications",
      expect.anything()
    )
  })

  it("shows action names in tooltips for compact icon actions", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === "/weixin") return { items: [connection()] }
      if (path === "/feishu") return { items: [] }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    const reconnect = await screen.findByRole("button", { name: "重新连接" })
    expect(reconnect).toBeVisible()
    expect(reconnect).toHaveTextContent("")

    await user.hover(reconnect)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("重新连接")
  })

  it("allows retrying when the initial QR request fails", async () => {
    let loginAttempts = 0
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/weixin") return { items: [] }
      if (path === "/feishu") return { items: [] }
      if (path === "/weixin/login-sessions" && options.method === "POST") {
        loginAttempts += 1
        if (loginAttempts === 1) throw new Error("upstream unavailable")
        return loginSession("waiting_scan")
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "连接微信" }))
    await user.click(await screen.findByRole("button", { name: "重新生成" }))

    expect(await screen.findByTestId("weixin-qr-svg")).toBeInTheDocument()
    expect(loginAttempts).toBe(2)
  })

  it("allows generating another QR code when login polling expires", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/weixin") return { items: [] }
      if (path === "/feishu") return { items: [] }
      if (path === "/weixin/login-sessions" && options.method === "POST") {
        return loginSession("waiting_scan")
      }
      if (path === `/weixin/login-sessions/${LOGIN_ID}` && !options.method) {
        throw new Error("login session expired")
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "连接微信" }))

    expect(
      await screen.findByRole("button", { name: "重新生成" })
    ).toBeVisible()
  })

  it("creates an official Feishu bot by QR code without exposing credentials", async () => {
    let polls = 0
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/weixin") return { items: [] }
      if (path === "/feishu") return { items: [] }
      if (
        path === "/feishu/registration-sessions" &&
        options.method === "POST"
      ) {
        return feishuRegistration("waiting_scan")
      }
      if (
        path === `/feishu/registration-sessions/${FEISHU_REGISTRATION_ID}` &&
        !options.method
      ) {
        polls += 1
        return polls === 1
          ? feishuRegistration("waiting_scan")
          : {
              ...feishuRegistration("connected"),
              connection: feishuConnection(),
            }
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "连接飞书" }))

    expect(await screen.findByTestId("feishu-qr-svg")).toBeInTheDocument()
    const registrationStatus = screen
      .getByText("等待使用飞书扫描并确认授权")
      .closest('[data-slot="alert"]')
    expect(registrationStatus).toHaveClass("border-0")
    expect(registrationStatus).not.toHaveClass("border")
    expect(registrationStatus).toHaveClass("w-fit", "justify-self-center")
    expect(registrationStatus).not.toHaveClass("w-full")
    expect(
      await screen.findByRole(
        "heading",
        { name: "机器人创建成功" },
        { timeout: 3_000 }
      )
    ).toBeVisible()
    expect(
      screen.getByText("机器人“LinkSense 个人助手”已创建，正在建立消息连接")
    ).toBeVisible()
    expect(
      screen.queryByText(/app_secret|client_secret/iu)
    ).not.toBeInTheDocument()
    expect(apiRequest).toHaveBeenCalledWith(
      "/feishu/registration-sessions",
      expect.objectContaining({ method: "POST", body: {} })
    )
  })

  it("shows pending approval after creation and keeps that state after closing the dialog", async () => {
    let registrationCompleted = false
    const pendingConnection = feishuConnection({
      runtimeStatus: "pending_approval",
      status: "reauthorization_required",
      lastErrorCode: "FEISHU_REAUTHORIZATION_REQUIRED",
    })
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/weixin") return { items: [] }
      if (path === "/feishu" && !options.method) {
        return { items: registrationCompleted ? [pendingConnection] : [] }
      }
      if (
        path === "/feishu/registration-sessions" &&
        options.method === "POST"
      ) {
        return feishuRegistration("waiting_scan")
      }
      if (
        path === `/feishu/registration-sessions/${FEISHU_REGISTRATION_ID}` &&
        !options.method
      ) {
        registrationCompleted = true
        return {
          ...feishuRegistration("pending_approval"),
          connection: pendingConnection,
        }
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "连接飞书" }))

    expect(
      await screen.findByText("应用已创建，等待管理员审核", undefined, {
        timeout: 3_000,
      })
    ).toBeVisible()
    expect(
      screen.getByText(
        "无需重新扫码。管理员审核通过后，LinkSense 会自动完成连接。"
      )
    ).toBeVisible()

    await user.click(screen.getByRole("button", { name: "完成" }))

    expect(
      await screen.findByText("等待管理员审核", undefined, {
        timeout: 3_000,
      })
    ).toBeVisible()
    expect(screen.queryByText("需要重新连接")).not.toBeInTheDocument()
  })

  it("recovers a bot created by an earlier failed attempt without forcing another creation", async () => {
    let starts = 0
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/weixin") return { items: [] }
      if (path === "/feishu") return { items: [] }
      if (
        path === "/feishu/registration-sessions" &&
        options.method === "POST"
      ) {
        starts += 1
        return feishuRegistration(starts === 1 ? "failed" : "waiting_scan")
      }
      if (
        path === `/feishu/registration-sessions/${FEISHU_REGISTRATION_ID}` &&
        !options.method
      ) {
        return feishuRegistration("failed")
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "连接飞书" }))
    await user.click(
      await screen.findByRole("button", { name: "连接已创建机器人" })
    )

    expect(apiRequest).toHaveBeenCalledWith(
      "/feishu/registration-sessions",
      expect.objectContaining({
        method: "POST",
        body: { reuse_existing: true },
      })
    )
  })

  it("escapes a deleted-app update loop by explicitly creating a replacement", async () => {
    let starts = 0
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/weixin") return { items: [] }
      if (path === "/feishu") return { items: [] }
      if (
        path === "/feishu/registration-sessions" &&
        options.method === "POST"
      ) {
        starts += 1
        return feishuRegistration(
          "waiting_scan",
          starts === 1 ? "update" : "create"
        )
      }
      if (
        path === `/feishu/registration-sessions/${FEISHU_REGISTRATION_ID}` &&
        !options.method
      ) {
        return feishuRegistration("waiting_scan", "update")
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "连接飞书" }))
    await user.click(
      await screen.findByRole("button", {
        name: "应用已被删除？创建新应用",
      })
    )

    expect(apiRequest).toHaveBeenCalledWith(
      "/feishu/registration-sessions",
      expect.objectContaining({
        method: "POST",
        body: { force_create: true },
      })
    )
  })

  it("uses update copy after Feishu identifies a retained app and completes authorization", async () => {
    let polls = 0
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/weixin") return { items: [] }
      if (path === "/feishu" && !options.method) {
        return { items: [] }
      }
      if (
        path === "/feishu/registration-sessions" &&
        options.method === "POST"
      ) {
        return feishuRegistration("waiting_scan", "update")
      }
      if (
        path === `/feishu/registration-sessions/${FEISHU_REGISTRATION_ID}` &&
        !options.method
      ) {
        polls += 1
        return polls === 1
          ? feishuRegistration("waiting_scan", "update")
          : {
              ...feishuRegistration("connected", "update"),
              connection: feishuConnection(),
            }
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "连接飞书" }))

    expect(
      await screen.findByRole("heading", { name: "更新飞书机器人授权" })
    ).toBeVisible()
    expect(screen.getByText(/不会创建重复机器人/u)).toBeVisible()
    expect(await screen.findByTestId("feishu-qr-svg")).toBeInTheDocument()
    expect(
      await screen.findByRole(
        "heading",
        { name: "飞书应用更新成功" },
        { timeout: 3_000 }
      )
    ).toBeVisible()
    expect(
      screen.getByText("飞书应用授权已更新，正在建立消息连接。")
    ).toBeVisible()
    expect(screen.queryByText("机器人创建成功")).not.toBeInTheDocument()
  })

  it("shows an aligned warning with update-specific copy when Feishu authorization fails", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/weixin") return { items: [] }
      if (path === "/feishu" && !options.method) return { items: [] }
      if (path === "/bot-channels" && !options.method) return { items: [] }
      if (
        path === "/feishu/registration-sessions" &&
        options.method === "POST"
      ) {
        return feishuRegistration("failed", "update")
      }
      if (
        path === `/feishu/registration-sessions/${FEISHU_REGISTRATION_ID}` &&
        !options.method
      ) {
        return feishuRegistration("failed", "update")
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "连接飞书" }))

    const message =
      await screen.findByText("飞书应用更新未完成，请重新扫码再试")
    const alert = message.closest('[data-slot="alert"]')
    expect(alert).toHaveAttribute("role", "status")
    expect(alert).toHaveClass("items-start")
    expect(alert?.querySelector("svg")).toBeInTheDocument()
    expect(screen.queryByText(/机器人可能已经创建/u)).not.toBeInTheDocument()
  })
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <WeixinChannelPage />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function loginSession(
  status: "waiting_scan" | "scanned" | "verification_required" | "connected"
) {
  return {
    id: LOGIN_ID,
    status,
    qrcode_url:
      status === "connected" ? null : "https://weixin.qq.com/x/scan-me",
    expires_at: "2026-08-13T08:10:00.000Z",
    connection: null,
  }
}

function connection({
  runtimeStatus = "online",
}: {
  runtimeStatus?: "online" | "connecting" | "error" | "reauthorization_required"
} = {}) {
  return {
    id: CONNECTION_ID,
    account_hint: "****1234",
    application: null,
    status: "active" as const,
    runtime_status: runtimeStatus,
    last_poll_at: NOW,
    last_inbound_at: null,
    last_error_code: null,
    created_at: NOW,
    updated_at: NOW,
  }
}

function feishuRegistration(
  status: "waiting_scan" | "pending_approval" | "connected" | "failed",
  operation: "create" | "update" = "create"
) {
  return {
    id: FEISHU_REGISTRATION_ID,
    operation,
    status,
    qrcode_url:
      status === "waiting_scan"
        ? "https://open.feishu.cn/scan/create-bot"
        : null,
    expires_at: "2026-08-13T08:10:00.000Z",
    connection: null,
  }
}

function feishuConnection({
  runtimeStatus = "connecting",
  status = "active",
  lastErrorCode = null,
}: {
  runtimeStatus?:
    | "online"
    | "connecting"
    | "pending_approval"
    | "error"
    | "reauthorization_required"
  status?: "active" | "reauthorization_required"
  lastErrorCode?: string | null
} = {}) {
  return {
    id: FEISHU_CONNECTION_ID,
    account_hint: "****5678",
    bot_name: "LinkSense 个人助手",
    status,
    runtime_status: runtimeStatus,
    last_connected_at: null,
    last_inbound_at: null,
    last_error_code: lastErrorCode,
    created_at: NOW,
    updated_at: NOW,
  }
}
