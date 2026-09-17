import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import dayjs from "dayjs"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { bootstrapSchema } from "@/api/contracts"
import { setAccessToken } from "@/api/session"
import { notify } from "@/components/feedback/notification"
import { MaintenanceSettingsForm } from "@/features/admin/maintenance-settings-form"
import i18n from "@/i18n"

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function renderForm(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MaintenanceSettingsForm />
    </QueryClientProvider>
  )
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
    vi.useRealTimers()
  })

  it.each(["zh-CN", "en-US", "fr-FR"])(
    "refreshes an expired plan and clears every field without saving in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const t = i18n.t.bind(i18n)
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] })
      vi.setSystemTime(new Date("2026-09-17T12:59:59.000Z"))
      const endAt = "2026-09-17T13:00:00.000Z"
      const fetch = vi.fn(() =>
        Promise.resolve(
          envelope(
            Date.now() < Date.parse(endAt)
              ? {
                  enabled: true,
                  active: true,
                  reason: "Upgrade",
                  start_at: "2026-09-17T12:00:00.000Z",
                  end_at: endAt,
                }
              : {
                  enabled: false,
                  active: false,
                  reason: null,
                  start_at: null,
                  end_at: null,
                }
          )
        )
      )
      vi.stubGlobal("fetch", fetch)
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      renderForm(queryClient)
      expect(
        await screen.findByRole("switch", {
          name: t("admin.maintenance.enabled"),
        })
      ).toBeChecked()
      expect(screen.getByLabelText(t("admin.maintenance.reason"))).toHaveValue(
        "Upgrade"
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
      await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked())
      expect(
        screen.getByText(t("admin.maintenance.status.disabled"))
      ).toBeVisible()
      expect(
        screen.queryByLabelText(t("admin.maintenance.reason"))
      ).not.toBeInTheDocument()
      expect(
        queryClient.getQueryData(["admin", "maintenance-settings"])
      ).toEqual({
        enabled: false,
        active: false,
        reason: null,
        start_at: null,
        end_at: null,
      })

      fireEvent.click(screen.getByRole("switch"))
      expect(screen.getByLabelText(t("admin.maintenance.reason"))).toHaveValue(
        ""
      )
      expect(
        screen.getByLabelText(t("admin.maintenance.duration"))
      ).toHaveValue(null)
      expect(
        screen.getAllByText(t("admin.maintenance.datePlaceholder"))
      ).toHaveLength(2)
      for (const button of within(
        screen.getByRole("group", {
          name: t("admin.maintenance.durationPresetsLabel"),
        })
      ).getAllByRole("button")) {
        expect(button).toHaveAttribute("aria-pressed", "false")
      }
      queryClient.clear()
    }
  )

  it("keeps unsaved edits when polling returns the same plan", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          envelope({
            enabled: true,
            active: true,
            reason: "Upgrade",
            start_at: "2026-09-17T12:00:00.000Z",
            end_at: "2026-09-17T13:00:00.000Z",
          })
        )
      )
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    renderForm(queryClient)
    fireEvent.change(await screen.findByLabelText("维护原因"), {
      target: { value: "Draft" },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.getByLabelText("维护原因")).toHaveValue("Draft")
    queryClient.clear()
  })

  it("keeps unsaved edits through a failed background refresh", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const fetch = vi.fn().mockResolvedValue(
      envelope({
        enabled: true,
        active: true,
        reason: "Upgrade",
        start_at: "2026-09-17T12:00:00.000Z",
        end_at: "2026-09-17T13:00:00.000Z",
      })
    )
    vi.stubGlobal("fetch", fetch)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    renderForm(queryClient)
    fireEvent.change(await screen.findByLabelText("维护原因"), {
      target: { value: "Draft" },
    })
    fetch.mockRejectedValueOnce(new Error("Network unavailable"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["admin", "maintenance-settings"])?.status
      ).toBe("error")
    )
    expect(screen.getByLabelText("维护原因")).toHaveValue("Draft")
    queryClient.clear()
  })

  it("saves an enabled maintenance window without a reason", async () => {
    const successNotification = vi
      .spyOn(notify, "success")
      .mockReturnValue("maintenance-settings-feedback")
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
    queryClient.setQueryData(
      ["system", "bootstrap"],
      bootstrapSchema.parse({
        initialized: true,
        maintenance_id: "01900000-0000-7000-8000-000000000001",
      })
    )
    renderForm(queryClient)

    const maintenanceSwitch = await screen.findByRole("switch", {
      name: "开启计划维护",
    })
    const toggleRow = maintenanceSwitch.parentElement
    expect(toggleRow).toHaveClass("flex", "items-center", "justify-between")
    expect(toggleRow).not.toHaveClass("border")
    expect(toggleRow).not.toHaveClass("rounded-card")
    expect(toggleRow).not.toHaveClass("px-4")
    expect(toggleRow).not.toHaveClass("py-3")
    expect(toggleRow?.closest('[data-slot="card"]')).toHaveClass(
      "rounded-card",
      "border"
    )
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
    await waitFor(() =>
      expect(queryClient.getQueryData(["system", "bootstrap"])).toMatchObject({
        maintenance_id: null,
      })
    )
    expect(
      queryClient.getQueryState(["system", "bootstrap"])?.isInvalidated
    ).toBe(true)
    expect(payload.enabled).toBe(true)
    expect(payload.reason).toBeNull()
    expect(Date.parse(payload.end_at)).toBeGreaterThan(
      Date.parse(payload.start_at)
    )
    await waitFor(() =>
      expect(successNotification).toHaveBeenCalledWith(
        "维护设置已保存",
        expect.objectContaining({ id: "maintenance-settings-feedback" })
      )
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
    renderForm(queryClient)

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
    renderForm(queryClient)

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
    renderForm(queryClient)

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
    expect(alert.parentElement).toHaveClass("grid", "gap-4")
    expect(alert).not.toHaveClass("mt-3")
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(
      0
    )
  })

  it("immediately disables a persisted maintenance schedule from the switch", async () => {
    const successNotification = vi
      .spyOn(notify, "success")
      .mockReturnValue("maintenance-settings-feedback")
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
    renderForm(queryClient)

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
    await waitFor(() =>
      expect(successNotification).toHaveBeenCalledWith(
        "系统维护已关闭",
        expect.objectContaining({ id: "maintenance-settings-feedback" })
      )
    )
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
    renderForm(queryClient)

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
