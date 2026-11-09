import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  applicationCatalogPageSchema,
  applicationDetailsSchema,
  applicationCenterReleaseSchema,
  connectionListSchema,
} from "@linksense/shared"
import {
  apiRequest,
  apiUploadRequest,
  apiStreamRequest,
  downloadApiFile,
} from "@/api/client"
import {
  automationListSchema,
  capabilitySummarySchema,
  clawHubSkillCatalogPageSchema,
  marketplaceCatalogItemSchema,
  mcpServerSchema,
} from "@/api/contracts"
import { ThemeProvider } from "@/app/theme-context"
import { pluginUiDemoQueryKey } from "@/features/capabilities/plugin-ui-demo"
import { applicationCatalogKeys } from "@/features/applications/application-catalog-queries"
import {
  listKnowledgeBases,
  listKnowledgeDocuments,
} from "@/features/knowledge-bases/knowledge-base-api"
import { isKnowledgeUiDemoEnabled } from "@/features/knowledge-bases/knowledge-ui-demo-mode"
import { KnowledgeUiDemoNotice } from "@/features/knowledge-bases/knowledge-ui-demo-notice"
import i18n, { supportedLanguages } from "@/i18n"
import { AutomationPage } from "@/pages/automation-pages"
import {
  isWorkspaceUiDemoEnabled,
  rememberWorkspaceUiDemo,
  shouldUseWorkspaceUiDemo,
  workspaceUiDemoQueryKey,
} from "./workspace-ui-demo-mode"

function open(path = "/automations?workspaceDemo=1") {
  window.history.replaceState(null, "", path)
}

beforeEach(async () => {
  window.sessionStorage.clear()
  open()
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  window.sessionStorage.clear()
  open("/")
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("local workspace UI samples", () => {
  it("requires explicit local development opt-in, persists across the three modules, and excludes conversation pages", () => {
    expect(isWorkspaceUiDemoEnabled()).toBe(true)
    rememberWorkspaceUiDemo()
    for (const route of ["/capabilities", "/knowledge-bases", "/automations"]) {
      open(route)
      expect(isWorkspaceUiDemoEnabled()).toBe(true)
    }
    open("/conversations/new")
    expect(isWorkspaceUiDemoEnabled()).toBe(false)
    expect(shouldUseWorkspaceUiDemo("/capabilities")).toBe(false)
    open("/automations?workspaceDemo=0")
    expect(isWorkspaceUiDemoEnabled()).toBe(false)
    open()
    vi.stubEnv("DEV", false)
    expect(isWorkspaceUiDemoEnabled()).toBe(false)
  })

  it("does not enable fixtures on a remote host or without opt-in", () => {
    open("/automations")
    expect(isWorkspaceUiDemoEnabled()).toBe(false)
    vi.stubGlobal("window", {
      location: new URL(
        "https://linksense.example/automations?workspaceDemo=1"
      ),
    })
    expect(isWorkspaceUiDemoEnabled()).toBe(false)
  })

  it("isolates demo cache keys from live lists", () => {
    const keys = [
      workspaceUiDemoQueryKey(),
      pluginUiDemoQueryKey(),
      applicationCatalogKeys.list("owned", "", "all"),
    ]
    open("/capabilities")
    expect(pluginUiDemoQueryKey()).not.toEqual(keys[1])
    expect(applicationCatalogKeys.list("owned", "", "all")).not.toEqual(keys[2])
    expect(workspaceUiDemoQueryKey()).not.toEqual(keys[0])
  })

  it("serves contract-valid automation, capability, MCP, connector and application data without fetching", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const automations = await apiRequest("/automations", {
      schema: automationListSchema,
    })
    expect(automations.items).toHaveLength(6)
    expect(automations.items.some((item) => item.status === "paused")).toBe(
      true
    )
    const capabilities = await apiRequest("/capabilities", {
      schema: z.object({ items: z.array(capabilitySummarySchema) }),
    })
    expect(
      capabilities.items.filter((item) => item.type === "plugin")
    ).toHaveLength(6)
    expect(
      capabilities.items.filter((item) => item.type === "skill")
    ).toHaveLength(5)
    const servers = await apiRequest("/mcp-servers", {
      schema: z.strictObject({ items: z.array(mcpServerSchema) }),
    })
    expect(servers.items).toHaveLength(3)
    const connections = await apiRequest("/connections", {
      schema: connectionListSchema,
    })
    expect(connections.items).toHaveLength(5)
    expect(new Set(connections.items.map((item) => item.status)).size).toBe(3)
    const applications = await apiRequest("/applications/catalog", {
      schema: applicationCatalogPageSchema,
    })
    expect(applications.items).toHaveLength(5)
    const first = applications.items[0]
    if (first.type !== "application") throw new Error("Expected application")
    const details = await apiRequest(
      `/applications/${first.application.id}/details`,
      { schema: applicationDetailsSchema }
    )
    expect(details.resources).toHaveLength(1)
    const center = await apiRequest("/application-center", {
      schema: z.object({ items: z.array(applicationCenterReleaseSchema) }),
    })
    expect(center.items).toHaveLength(3)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("filters application types, searches marketplace entries and provides a fictional ClawHub catalog", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const apps = await apiRequest("/applications/catalog", {
      query: { state: "interactive" },
      schema: applicationCatalogPageSchema,
    })
    expect(apps.items).toHaveLength(1)
    const plugins = await apiRequest("/marketplace", {
      query: { type: "plugin", search: "weekly" },
      schema: z.object({ items: z.array(marketplaceCatalogItemSchema) }),
    })
    expect(plugins.items).toHaveLength(1)
    const skills = await apiRequest("/marketplace", {
      query: { type: "skill", search: "需求" },
      schema: z.object({ items: z.array(marketplaceCatalogItemSchema) }),
    })
    expect(skills.items).toHaveLength(1)
    expect(skills.items[0].listing.type).toBe("skill")
    const clawHub = await apiRequest("/clawhub/skills", {
      schema: clawHubSkillCatalogPageSchema,
    })
    expect(clawHub.total_count).toBe(5)
    expect(clawHub.items.every((item) => !item.installable)).toBe(true)
  })

  it("reuses knowledge fixtures after sidebar navigation without setting the legacy switch", async () => {
    vi.stubGlobal("fetch", vi.fn())
    rememberWorkspaceUiDemo()
    open("/knowledge-bases")
    expect(isKnowledgeUiDemoEnabled()).toBe(true)
    render(<KnowledgeUiDemoNotice />)
    expect(screen.getByText(i18n.t("workspaceUiDemo.readOnly"))).toBeVisible()
    const bases = await listKnowledgeBases({ lifecycle: "all", scope: "all" })
    expect(bases.items).toHaveLength(8)
    const documents = await listKnowledgeDocuments(bases.items[0].id)
    expect(documents.items.length).toBeGreaterThan(0)
    expect(
      window.sessionStorage.getItem("linksense.knowledge-ui-demo")
    ).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("blocks writes, execution, uploads, streams, downloads and unknown resource reads before network access", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    for (const [path, method] of [
      ["/automations/id/run", "POST"],
      ["/capabilities/id", "DELETE"],
      ["/connections/gmail/authorize", "POST"],
      ["/conversations", "POST"],
      ["/applications/id", "PATCH"],
    ] as const) {
      await expect(
        apiRequest(path, { method, schema: z.unknown() })
      ).rejects.toMatchObject({ errorCode: "WORKSPACE_UI_DEMO_READ_ONLY" })
    }
    await expect(
      apiUploadRequest("/capabilities", {
        method: "POST",
        body: new FormData(),
        schema: z.unknown(),
      })
    ).rejects.toMatchObject({ errorCode: "WORKSPACE_UI_DEMO_READ_ONLY" })
    await expect(
      apiStreamRequest("/conversations/id/messages", { method: "POST" })
    ).rejects.toMatchObject({ errorCode: "WORKSPACE_UI_DEMO_READ_ONLY" })
    await expect(
      downloadApiFile("/capabilities/id/export")
    ).rejects.toMatchObject({ errorCode: "WORKSPACE_UI_DEMO_READ_ONLY" })
    await expect(
      apiRequest("/mcp-servers/unknown", { schema: z.unknown() })
    ).rejects.toMatchObject({ errorCode: "WORKSPACE_UI_DEMO_READ_ONLY" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses the live API without demo opt-in", async () => {
    open("/automations")
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { items: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    expect(
      (await apiRequest("/automations", { schema: automationListSchema })).items
    ).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("renders populated automation filters and a read-only notice using the actual API adapter", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <AutomationPage />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    )
    expect(await screen.findByText("每日工作简报 · 示例")).toBeVisible()
    expect(screen.getByText(i18n.t("workspaceUiDemo.readOnly"))).toBeVisible()
    await userEvent.click(screen.getByRole("tab", { name: /暂停/u }))
    expect(screen.queryByText("每日工作简报 · 示例")).not.toBeInTheDocument()
    expect(screen.getByText("客户问题与反馈跟进 · 示例")).toBeVisible()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(supportedLanguages)(
    "provides a translated demo notice in %s",
    (language) => {
      for (const key of ["readOnly", "exit"]) {
        const value = i18n.t(`workspaceUiDemo.${key}`, { lng: language })
        expect(value).not.toBe(`workspaceUiDemo.${key}`)
        expect(value.length).toBeGreaterThan(0)
      }
    }
  )
})
