import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiUploadRequest } from "@/api/client"
import { setAccessToken } from "@/api/session"
import { ThemeProvider } from "@/app/theme-context"
import { downloadBlob } from "@/lib/download-blob"
import i18n from "@/i18n"
import { SkillUpdateDialog } from "./skill-update-dialog"
import { skillEditQueryKey } from "./skill-update-api"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiUploadRequest: vi.fn(),
}))
vi.mock("@/lib/download-blob", () => ({ downloadBlob: vi.fn() }))

const ID = "20000000-0000-4000-8000-000000000001"
const detail = {
  name: "reports",
  display_name: "报告助手",
  description: "报告说明",
  content: "# Original\n",
  revision: "a".repeat(64),
  files: [
    { path: "SKILL.md", size_bytes: 64 },
    { path: "scripts/report.py", size_bytes: 32 },
    { path: "assets/template.txt", size_bytes: 16 },
  ],
}
const risk = {
  contains_scripts: true,
  contains_mcp_server: false,
  contains_external_connections: false,
  requires_environment_variables: false,
  requires_credentials: false,
  contains_dependency_download_commands: false,
  declared_environment_keys: [],
  dependency_commands: [],
  mcp_environment_references: [],
}
const preview = {
  preview_token: "update-preview",
  expires_at: "2099-01-01T00:00:00Z",
  operation: "update" as const,
  capability_id: ID,
  source: {
    source_type: "local" as const,
    import_kind: "skill_edit" as const,
    source_url: null,
    filename: null,
  },
  type: "skill" as const,
  name: "reports",
  display_name: "报告助手",
  description: "报告说明",
  manifest: {},
  declared_capabilities: ["scripts"],
  declared_environment_keys: [],
  risk_summary: risk,
  has_logo: false,
  skill_content_preview: "# Updated",
  skill_content_truncated: false,
  skill_update: {
    mode: "edit" as const,
    base_revision: detail.revision,
    changes: {
      added: [],
      modified: ["SKILL.md"],
      deleted: [],
      unchanged_count: 2,
    },
  },
}
const saved = {
  id: ID,
  type: "skill",
  name: detail.name,
  display_name: detail.display_name,
  slug: detail.name,
  description: detail.description,
  source_type: "local",
  marketplace_listing_id: null,
  marketplace_release_id: null,
  status: "active",
  has_logo: false,
  logo_url: null,
  manifest: {},
  risk_summary: risk,
  preference_status: "enabled",
  can_manage: true,
  can_govern: false,
  is_owner: true,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
}
const envelope = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    headers: { "content-type": "application/json" },
  })
const failure = (code = "IMPORT_FAILED", status = 400) =>
  new Response(JSON.stringify({ success: false, error_code: code }), {
    status,
    headers: { "content-type": "application/json" },
  })

function setup(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
) {
  const onClose = vi.fn()
  const onCompleted = vi.fn(async () => undefined)
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SkillUpdateDialog
          capabilityId={ID}
          onClose={onClose}
          onCompleted={onCompleted}
        />
      </QueryClientProvider>
    </ThemeProvider>
  )
  return { onClose, onCompleted }
}

describe("SkillUpdateDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("skill-update-test-token")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        envelope(init?.method === "POST" ? preview : detail)
      )
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    setAccessToken(null)
  })

  it("loads existing fields, locks the identifier, explains preservation and retains edits when switching methods", async () => {
    setup()
    const user = userEvent.setup()
    const name = await screen.findByRole("textbox", { name: "技能标识" })
    const updateMethod = screen.getByRole("radiogroup", { name: "更新方式" })
    expect(updateMethod).toHaveClass("flex", "flex-wrap", "gap-2")
    for (const option of within(updateMethod).getAllByRole("radio")) {
      expect(option.closest('[data-slot="radio-group-option"]')).toHaveClass(
        "w-auto",
        "rounded-xl",
        "border",
        "border-[var(--app-border)]"
      )
    }
    expect(within(updateMethod).getAllByRole("radio")).toHaveLength(2)
    expect(
      within(updateMethod).getByRole("radio", { name: "编辑技能内容" })
    ).toBeChecked()
    expect(
      screen.queryByRole("combobox", { name: "更新方式" })
    ).not.toBeInTheDocument()
    expect(name).toHaveValue("reports")
    expect(name).toHaveAttribute("readonly")
    expect(screen.getByLabelText("展示名称（选填）")).toHaveValue("报告助手")
    expect(screen.getByLabelText("说明")).toHaveValue("报告说明")
    expect(screen.getByLabelText("技能正文")).toHaveValue("# Original\n")
    expect(
      screen.getByText(/原有脚本、模板、图片及其他附带文件都会保留/)
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "查看变更与风险" })
    ).toBeDisabled()
    await user.click(screen.getByLabelText("技能正文"))
    await user.paste("Additional instructions")
    await chooseUpdateMode(user, "替换完整技能包")
    expect(screen.getByText(/未包含在新包内的文件将被删除/)).toBeVisible()
    await user.keyboard("{ArrowLeft}")
    expect(
      within(updateMethod).getByRole("radio", { name: "编辑技能内容" })
    ).toBeChecked()
    expect(screen.getByLabelText("技能正文")).toHaveValue(
      "# Original\nAdditional instructions"
    )
    expect(screen.getByRole("button", { name: "查看变更与风险" })).toBeEnabled()
    expect(screen.getByText("scripts/report.py")).toBeVisible()
    expect(screen.getByText("assets/template.txt")).toBeVisible()
    expect(screen.getByText("assets/template.txt").closest("ul")).toHaveClass(
      "border-[var(--app-border)]"
    )
  })

  it("previews the draft with its base revision, retains it on failure and prevents duplicate confirmations", async () => {
    let resolveConfirm: (response: Response) => void = () => undefined
    const pendingConfirm = new Promise<Response>((resolve) => {
      resolveConfirm = resolve
    })
    let confirmations = 0
    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/confirm")) {
          confirmations++
          return confirmations === 1
            ? failure("CAPABILITY_UPDATE_CONFLICT", 409)
            : pendingConfirm
        }
        return envelope(init?.method === "POST" ? preview : detail)
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const { onClose, onCompleted } = setup()
    const user = userEvent.setup()
    await user.clear(await screen.findByLabelText("技能正文"))
    await user.paste("# Updated")
    await user.click(screen.getByRole("button", { name: "查看变更与风险" }))
    expect(
      await screen.findByRole("region", { name: "本次文件变更" })
    ).toHaveTextContent("2 个文件保持不变")
    const editRequest = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST"
    )
    expect(JSON.parse(String(editRequest?.[1]?.body))).toEqual({
      base_revision: detail.revision,
      display_name: "报告助手",
      description: "报告说明",
      content: "# Updated",
    })
    expect(screen.getByRole("button", { name: "确认更新" })).toBeDisabled()
    await user.click(
      screen.getByRole("checkbox", { name: i18n.t("capability.riskConfirm") })
    )
    await user.click(screen.getByRole("button", { name: "确认更新" }))
    expect(await screen.findByText(/此技能已发生变化/)).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "返回" }))
    expect(screen.getByLabelText("技能正文")).toHaveValue("# Updated")
    await user.click(screen.getByRole("button", { name: "查看变更与风险" }))
    await screen.findByRole("region", { name: "本次文件变更" })
    expect(
      screen.getByRole("checkbox", { name: i18n.t("capability.riskConfirm") })
    ).not.toBeChecked()
    await user.click(
      screen.getByRole("checkbox", { name: i18n.t("capability.riskConfirm") })
    )
    await user.click(screen.getByRole("button", { name: "确认更新" }))
    expect(screen.getByRole("button", { name: "确认更新" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
    resolveConfirm(envelope(saved))
    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    expect(confirmations).toBe(2)
  })

  it("uploads a full replacement and requires explicit acknowledgement of the files to delete", async () => {
    vi.mocked(apiUploadRequest).mockResolvedValue({
      ...preview,
      skill_update: {
        ...preview.skill_update,
        mode: "replace",
        changes: {
          added: ["assets/new.txt"],
          modified: ["SKILL.md"],
          deleted: ["scripts/report.py"],
          unchanged_count: 1,
        },
      },
    })
    const user = userEvent.setup()
    setup()
    await chooseUpdateMode(user, "替换完整技能包")
    const file = new File(["zip"], "reports.zip", { type: "application/zip" })
    await user.upload(screen.getByLabelText("ZIP 技能包"), file)
    await user.click(screen.getByRole("button", { name: "查看变更与风险" }))
    await screen.findByText("将删除的文件")
    const body = vi.mocked(apiUploadRequest).mock.calls[0]?.[1].body
    expect(body?.get("base_revision")).toBe(detail.revision)
    expect(body?.get("file")).toBe(file)
    expect(body?.get("type")).toBe("skill")
    expect(
      within(screen.getByRole("region", { name: "本次文件变更" })).getByText(
        "scripts/report.py"
      )
    ).toBeVisible()
    await user.click(
      screen.getByRole("checkbox", { name: i18n.t("capability.riskConfirm") })
    )
    expect(screen.getByRole("button", { name: "确认更新" })).toBeDisabled()
    await user.click(
      screen.getByRole("checkbox", { name: "我确认删除以上 1 个文件" })
    )
    expect(screen.getByRole("button", { name: "确认更新" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "返回" }))
    expect(screen.getByText("已选择：reports.zip")).toBeVisible()
    expect(screen.getByRole("button", { name: "查看变更与风险" })).toBeEnabled()
  })

  it("shows loading instead of cached fields and supports retry after loading fails", async () => {
    let resolveRead: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      resolveRead = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(pending)
        .mockResolvedValueOnce(envelope(detail))
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(skillEditQueryKey(ID), {
      ...detail,
      content: "stale cache",
    })
    setup(queryClient)
    expect(
      screen.getByRole("status", { name: "正在加载当前技能…" })
    ).toBeVisible()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    resolveRead(failure())
    expect(await screen.findByText("无法加载当前技能，请重试。")).toBeVisible()
    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByLabelText("技能正文")).toHaveValue(detail.content)
  })

  it("downloads the current package through the authenticated API and exposes download failures", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/package")
        ? new Response("zip-bytes", {
            headers: { "content-type": "application/zip" },
          })
        : envelope(detail)
    )
    vi.stubGlobal("fetch", fetchMock)
    setup()
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole("button", { name: "下载完整技能包" })
    )
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "reports.zip")
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/${ID}/package`),
      expect.objectContaining({ credentials: "include" })
    )
    fetchMock.mockResolvedValueOnce(failure())
    await user.click(screen.getByRole("button", { name: "下载完整技能包" }))
    expect(await screen.findByRole("alert")).toBeVisible()
  })

  it("offers complete package replacement for an oversized body without populating a truncated editor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope({ ...detail, content: null }))
    )
    setup()
    const user = userEvent.setup()
    const editOption = await screen.findByRole("radio", {
      name: "编辑技能内容",
    })
    expect(editOption).toHaveAttribute("aria-disabled", "true")
    await user.click(editOption)
    expect(screen.getByRole("radio", { name: "替换完整技能包" })).toBeChecked()
    expect(screen.queryByLabelText("技能正文")).not.toBeInTheDocument()
    expect(screen.getByLabelText("ZIP 技能包")).toBeVisible()
    expect(screen.getByRole("button", { name: "下载完整技能包" })).toBeEnabled()
  })

  it("renders the same update flow in English", async () => {
    await i18n.changeLanguage("en-US")
    setup()
    expect(
      await screen.findByRole("textbox", { name: "Skill instructions" })
    ).toHaveValue(detail.content)
    const selector = screen.getByRole("radiogroup", { name: "Update method" })
    expect(
      within(selector).getByRole("radio", { name: "Edit skill content" })
    ).toBeChecked()
    const replacement = within(selector).getByRole("radio", {
      name: "Replace complete skill package",
    })
    await userEvent.setup().click(replacement)
    expect(replacement).toBeChecked()
    expect(
      screen.queryByLabelText("Skill instructions")
    ).not.toBeInTheDocument()
  })
})

async function chooseUpdateMode(
  user: ReturnType<typeof userEvent.setup>,
  label: string
) {
  const group = await screen.findByRole("radiogroup", { name: "更新方式" })
  const option = within(group).getByRole("radio", { name: label })
  await user.click(option)
  expect(option).toBeChecked()
}
