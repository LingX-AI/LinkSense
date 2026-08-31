import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import dayjs from "dayjs"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAccessToken } from "@/api/session"
import { MaintenanceSettingsForm } from "@/features/admin/maintenance-settings-form"
import i18n from "@/i18n"

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("maintenance settings form", () => {
  beforeEach(async () => {
    setAccessToken("maintenance-settings-token")
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("saves an enabled maintenance window without a reason", async () => {
    const requests: RequestInit[] = []
    const startAt = dayjs("2026-08-05T01:00").toISOString()
    const endAt = dayjs("2026-08-05T02:30").toISOString()
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(init ?? {})
        if ((init?.method ?? "GET") === "PUT") {
          const body = JSON.parse(String(init?.body)) as {
            reason: string | null
            start_at: string
            end_at: string
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                enabled: true,
                active: false,
                reason: body.reason,
                start_at: body.start_at,
                end_at: body.end_at,
              },
            })
          )
        }
        return Promise.resolve(
          envelope({
            enabled: false,
            active: false,
            reason: null,
            start_at: startAt,
            end_at: endAt,
          })
        )
      })
    )
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MaintenanceSettingsForm />
      </QueryClientProvider>
    )

    const maintenanceSwitch = await screen.findByRole("switch", {
      name: "开启计划维护",
    })
    const maintenanceHeading = screen.getByRole("heading", {
      name: "系统维护",
    })
    const maintenanceTitleRow = maintenanceHeading.closest<HTMLElement>(
      '[data-slot="settings-section-title-row"]'
    )
    expect(maintenanceTitleRow).not.toBeNull()
    expect(within(maintenanceTitleRow!).getByText("未开启")).toBeVisible()
    expect(screen.queryByLabelText("维护原因")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "保存维护设置" })
    ).not.toBeInTheDocument()
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull()

    await interaction.click(maintenanceSwitch)
    expect(screen.getByLabelText("维护原因")).toBeVisible()
    expect(screen.getByLabelText("维护原因")).toHaveAttribute(
      "placeholder",
      "可选：说明本次维护的原因和对用户的影响…"
    )
    await interaction.click(
      screen.getByRole("button", { name: "保存维护设置" })
    )

    await waitFor(() =>
      expect(
        requests.filter((request) => request.method === "PUT")
      ).toHaveLength(1)
    )
    const putRequest = requests.find((request) => request.method === "PUT")
    const payload = JSON.parse(String(putRequest?.body)) as {
      enabled: boolean
      reason: string
      start_at: string
      end_at: string
    }
    expect(payload.enabled).toBe(true)
    expect(payload.reason).toBeNull()
    expect(Date.parse(payload.end_at)).toBeGreaterThan(
      Date.parse(payload.start_at)
    )
  })

  it("updates the maintenance window from a preset duration", async () => {
    const requests: RequestInit[] = []
    const startAt = dayjs("2026-08-05T01:15").toISOString()
    const endAt = dayjs("2026-08-05T02:00").toISOString()
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(init ?? {})
        if ((init?.method ?? "GET") === "PUT") {
          const body = JSON.parse(String(init?.body)) as {
            reason: string
            start_at: string
            end_at: string
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                enabled: true,
                active: false,
                reason: body.reason,
                start_at: body.start_at,
                end_at: body.end_at,
              },
            })
          )
        }
        return Promise.resolve(
          envelope({
            enabled: false,
            active: false,
            reason: null,
            start_at: startAt,
            end_at: endAt,
          })
        )
      })
    )
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MaintenanceSettingsForm />
      </QueryClientProvider>
    )

    await interaction.click(
      await screen.findByRole("switch", { name: "开启计划维护" })
    )
    await interaction.click(screen.getByRole("button", { name: "2 小时" }))
    expect(screen.getByLabelText("维护时长")).toHaveValue(2)

    await interaction.type(screen.getByLabelText("维护原因"), "系统升级")
    await interaction.click(
      screen.getByRole("button", { name: "保存维护设置" })
    )

    await waitFor(() =>
      expect(
        requests.filter((request) => request.method === "PUT")
      ).toHaveLength(1)
    )
    const putRequest = requests.find((request) => request.method === "PUT")
    const payload = JSON.parse(String(putRequest?.body)) as {
      start_at: string
      end_at: string
    }
    const expectedStartAt = dayjs(dayjs(startAt).format("YYYY-MM-DDTHH:mm"))
    expect(payload.start_at).toBe(expectedStartAt.toISOString())
    expect(payload.end_at).toBe(expectedStartAt.add(2, "hour").toISOString())
  })

  it("updates the maintenance window from a custom duration", async () => {
    const requests: RequestInit[] = []
    const startAt = dayjs("2026-08-05T03:00").toISOString()
    const endAt = dayjs("2026-08-05T03:30").toISOString()
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(init ?? {})
        if ((init?.method ?? "GET") === "PUT") {
          const body = JSON.parse(String(init?.body)) as {
            reason: string
            start_at: string
            end_at: string
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                enabled: true,
                active: false,
                reason: body.reason,
                start_at: body.start_at,
                end_at: body.end_at,
              },
            })
          )
        }
        return Promise.resolve(
          envelope({
            enabled: false,
            active: false,
            reason: null,
            start_at: startAt,
            end_at: endAt,
          })
        )
      })
    )
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MaintenanceSettingsForm />
      </QueryClientProvider>
    )

    await interaction.click(
      await screen.findByRole("switch", { name: "开启计划维护" })
    )
    const durationInput = screen.getByLabelText("维护时长")
    await interaction.clear(durationInput)
    await interaction.type(durationInput, "45")

    await interaction.type(screen.getByLabelText("维护原因"), "系统升级")
    await interaction.click(
      screen.getByRole("button", { name: "保存维护设置" })
    )

    await waitFor(() =>
      expect(
        requests.filter((request) => request.method === "PUT")
      ).toHaveLength(1)
    )
    const putRequest = requests.find((request) => request.method === "PUT")
    const payload = JSON.parse(String(putRequest?.body)) as {
      start_at: string
      end_at: string
    }
    const expectedStartAt = dayjs(dayjs(startAt).format("YYYY-MM-DDTHH:mm"))
    expect(payload.start_at).toBe(expectedStartAt.toISOString())
    expect(payload.end_at).toBe(expectedStartAt.add(45, "minute").toISOString())
  })

  it("stacks the start and end controls and rejects an unordered window", async () => {
    const requests: RequestInit[] = []
    const startAt = dayjs("2026-08-05T02:30").toISOString()
    const endAt = dayjs("2026-08-05T02:29").toISOString()
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(init ?? {})
        return Promise.resolve(
          envelope({
            enabled: false,
            active: false,
            reason: null,
            start_at: startAt,
            end_at: endAt,
          })
        )
      })
    )
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MaintenanceSettingsForm />
      </QueryClientProvider>
    )

    await interaction.click(
      await screen.findByRole("switch", { name: "开启计划维护" })
    )
    expect(screen.getByTestId("maintenance-time-fields")).toHaveClass(
      "flex",
      "flex-col"
    )

    await interaction.type(screen.getByLabelText("维护原因"), "数据库升级")
    await interaction.click(
      screen.getByRole("button", { name: "保存维护设置" })
    )

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("结束时间必须晚于开始时间。")
    expect(alert).toHaveClass("mt-3")
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(
      0
    )
  })

  it("immediately disables a persisted maintenance schedule from the switch", async () => {
    const requests: RequestInit[] = []
    const settings = {
      enabled: true,
      active: true,
      reason: "数据库升级",
      start_at: dayjs().subtract(1, "hour").toISOString(),
      end_at: dayjs().add(1, "hour").toISOString(),
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(init ?? {})
        return Promise.resolve(
          envelope(
            (init?.method ?? "GET") === "PUT"
              ? {
                  code: "SYSTEM_SETTINGS_UPDATED",
                  settings: { ...settings, enabled: false, active: false },
                }
              : settings
          )
        )
      })
    )
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MaintenanceSettingsForm />
      </QueryClientProvider>
    )

    await interaction.click(
      await screen.findByRole("switch", { name: "开启计划维护" })
    )

    await waitFor(() =>
      expect(
        requests.filter((request) => request.method === "PUT")
      ).toHaveLength(1)
    )
    const putRequest = requests.find((request) => request.method === "PUT")
    expect(JSON.parse(String(putRequest?.body))).toEqual({
      enabled: false,
      reason: null,
      start_at: null,
      end_at: null,
    })
    expect(screen.queryByLabelText("维护原因")).not.toBeInTheDocument()
  })

  it("can disable the maintenance schedule immediately after enabling it", async () => {
    const requests: RequestInit[] = []
    let settings = {
      enabled: false,
      active: false,
      reason: null as string | null,
      start_at: dayjs("2026-08-05T01:00").toISOString(),
      end_at: dayjs("2026-08-05T02:30").toISOString(),
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(init ?? {})
        if ((init?.method ?? "GET") === "PUT") {
          const body = JSON.parse(String(init?.body)) as typeof settings
          settings = {
            enabled: body.enabled,
            active: false,
            reason: body.reason,
            start_at: body.start_at,
            end_at: body.end_at,
          }
          return Promise.resolve(
            envelope({ code: "SYSTEM_SETTINGS_UPDATED", settings })
          )
        }
        return Promise.resolve(envelope(settings))
      })
    )
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MaintenanceSettingsForm />
      </QueryClientProvider>
    )

    await interaction.click(
      await screen.findByRole("switch", { name: "开启计划维护" })
    )
    await interaction.type(screen.getByLabelText("维护原因"), "数据库升级")
    await interaction.click(
      screen.getByRole("button", { name: "保存维护设置" })
    )
    await waitFor(() =>
      expect(
        requests.filter((request) => request.method === "PUT")
      ).toHaveLength(1)
    )

    await interaction.click(
      screen.getByRole("switch", { name: "开启计划维护" })
    )

    await waitFor(() =>
      expect(
        requests.filter((request) => request.method === "PUT")
      ).toHaveLength(2)
    )
    expect(
      JSON.parse(
        String(requests.filter((request) => request.method === "PUT")[1]?.body)
      )
    ).toEqual({
      enabled: false,
      reason: null,
      start_at: null,
      end_at: null,
    })
  })
})
