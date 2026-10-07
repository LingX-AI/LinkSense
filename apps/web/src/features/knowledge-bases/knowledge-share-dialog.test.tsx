import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/app/theme-context"
import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import { KnowledgeShareDialog } from "@/features/knowledge-bases/knowledge-share-dialog"
import i18n from "@/i18n"

const listKnowledgeGrants = vi.hoisted(() => vi.fn())
const listKnowledgeShareTargets = vi.hoisted(() => vi.fn())
const createKnowledgeGrant = vi.hoisted(() => vi.fn())
const revokeKnowledgeGrant = vi.hoisted(() => vi.fn())

vi.mock(
  "@/features/knowledge-bases/knowledge-base-api",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/knowledge-bases/knowledge-base-api")
    >()),
    listKnowledgeGrants,
    listKnowledgeShareTargets,
    createKnowledgeGrant,
    revokeKnowledgeGrant,
  })
)

const knowledgeBaseId = "00000000-0000-4000-8000-000000000001"
const userGrantId = "00000000-0000-4000-8000-000000000002"
const groupGrantId = "00000000-0000-4000-8000-000000000003"
const userId = "00000000-0000-4000-8000-000000000004"
const groupId = "00000000-0000-4000-8000-000000000005"
const secondUserId = "00000000-0000-4000-8000-000000000006"
const secondGroupId = "00000000-0000-4000-8000-000000000007"
const firstSelectableUserId = "00000000-0000-4000-8000-000000000008"

function grantFixture(
  overrides: Partial<{
    id: string
    target_type: "user" | "user_group"
    target: { id: string; name: string; email_hint: string | null }
  }> = {}
) {
  return {
    id: userGrantId,
    knowledge_base_id: knowledgeBaseId,
    target_type: "user" as const,
    target: {
      id: userId,
      name: "测试用户",
      email_hint: "t***@example.test",
    },
    status: "active" as const,
    can_revoke: true,
    created_at: "2026-07-22T01:00:00.000Z",
    updated_at: "2026-07-22T01:00:00.000Z",
    revoked_at: null,
    ...overrides,
  }
}

const userGrant = grantFixture()
const groupGrant = grantFixture({
  id: groupGrantId,
  target_type: "user_group",
  target: { id: groupId, name: "售后组", email_hint: null },
})

function renderDialog(
  options: { canCreateGrant?: boolean; canRevokeGrant?: boolean } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const { canCreateGrant = false, canRevokeGrant = true } = options
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <KnowledgeShareDialog
          open
          onOpenChange={vi.fn()}
          knowledgeBaseId={knowledgeBaseId}
          canCreateGrant={canCreateGrant}
          canRevokeGrant={canRevokeGrant}
        />
      </QueryClientProvider>
      <NotificationCenter />
    </ThemeProvider>
  )
}

describe("knowledge share dialog", () => {
  it("keeps Chinese share-target composition local until selection is committed", async () => {
    renderDialog({ canCreateGrant: true })
    const input = screen.getByRole("combobox")
    await waitFor(() => expect(listKnowledgeShareTargets).toHaveBeenCalled())
    listKnowledgeShareTargets.mockClear()
    fireEvent.compositionStart(input)
    fireEvent.input(input, { target: { value: "lin" }, isComposing: true })
    expect(input).toHaveValue("lin")
    await act(async () => {})
    expect(listKnowledgeShareTargets).not.toHaveBeenCalled()
    fireEvent.input(input, { target: { value: "林青" }, isComposing: true })
    fireEvent.compositionEnd(input, { data: "林青" })
    expect(input).toHaveValue("林青")
    await waitFor(() =>
      expect(listKnowledgeShareTargets).toHaveBeenCalledWith(
        expect.objectContaining({ search: "林青" })
      )
    )
  })

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    listKnowledgeGrants
      .mockReset()
      .mockImplementation(
        async (_knowledgeBaseId: string, options: { cursor?: string }) =>
          options.cursor === userGrantId
            ? { items: [groupGrant], next_cursor: null }
            : { items: [userGrant], next_cursor: userGrantId }
      )
    listKnowledgeShareTargets
      .mockReset()
      .mockImplementation(
        async ({
          type,
          search = "",
        }: {
          type: "user" | "group"
          search?: string
        }) => ({
          items: (type === "user"
            ? [
                {
                  id: firstSelectableUserId,
                  type: "user" as const,
                  name: "alex",
                  secondary_label: "alex@example.test",
                },
                {
                  id: secondUserId,
                  type: "user" as const,
                  name: "林青",
                  secondary_label: "lin@example.test",
                },
              ]
            : [
                {
                  id: groupId,
                  type: "group" as const,
                  name: "售后组",
                  secondary_label: null,
                },
                {
                  id: secondGroupId,
                  type: "group" as const,
                  name: "产品组",
                  secondary_label: null,
                },
              ]
          ).filter((target) =>
            [target.name, target.secondary_label]
              .filter(Boolean)
              .some((value) =>
                value?.toLocaleLowerCase().includes(search.toLocaleLowerCase())
              )
          ),
          next_cursor: null,
        })
      )
    createKnowledgeGrant.mockReset().mockResolvedValue({})
    revokeKnowledgeGrant.mockReset()
  })

  afterEach(() => {
    notify.dismiss()
    cleanup()
  })

  it("uses the shared pill tabs for choosing the share target type", async () => {
    renderDialog({ canCreateGrant: true })

    const userToggle = await screen.findByRole("tab", { name: "用户" })
    const groupToggle = screen.getByRole("tab", { name: "用户组" })
    expect(
      document.querySelectorAll(
        "[data-slot='field-legend'] span.text-destructive[aria-hidden='true']"
      )
    ).toHaveLength(2)
    expect(
      screen.getByRole("combobox", {
        name: i18n.t("knowledge.share.selectTarget"),
      })
    ).toHaveAttribute("aria-required", "true")
    const targetTypeSelector = userToggle.closest(
      ".knowledge-share-type-options"
    )

    expect(targetTypeSelector).toHaveAttribute("data-slot", "tabs-list")
    expect(userToggle).toHaveAttribute("data-slot", "tabs-trigger")
    expect(groupToggle).toHaveAttribute("data-slot", "tabs-trigger")
    expect(userToggle).toHaveAttribute("aria-selected", "true")
    expect(userToggle).toHaveAttribute("data-active")
    expect(userToggle).toHaveClass("data-active:bg-muted/50")
    expect(groupToggle).toHaveAttribute("aria-selected", "false")
    expect(groupToggle).not.toHaveAttribute("data-active")
    expect(
      targetTypeSelector?.querySelector('[data-slot="radio-group-item"]')
    ).not.toBeInTheDocument()
    expect(targetTypeSelector?.querySelectorAll("svg")).toHaveLength(2)

    await userEvent.click(groupToggle)

    expect(userToggle).toHaveAttribute("aria-selected", "false")
    expect(userToggle).not.toHaveAttribute("data-active")
    expect(groupToggle).toHaveAttribute("aria-selected", "true")
    expect(groupToggle).toHaveAttribute("data-active")
  })

  it("selects and submits multiple users from the searchable shadcn combobox", async () => {
    const interaction = userEvent.setup()
    renderDialog({ canCreateGrant: true })

    const selector = await screen.findByRole("combobox", {
      name: "选择共享对象",
    })
    expect(selector).toHaveAttribute("placeholder", "搜索用户名称或邮箱…")
    expect(selector).toHaveAttribute("data-slot", "combobox-chip-input")

    await interaction.click(selector)
    await interaction.click(
      await screen.findByRole("option", { name: /alex/u })
    )
    await interaction.type(selector, "林")
    await waitFor(() =>
      expect(listKnowledgeShareTargets).toHaveBeenCalledWith(
        expect.objectContaining({ type: "user", search: "林" })
      )
    )
    await interaction.click(
      await screen.findByRole("option", { name: /林青/u })
    )

    expect(
      screen.getByRole("button", { name: "移除共享对象 alex" })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "移除共享对象 林青" })
    ).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "添加共享" }))

    await waitFor(() => expect(createKnowledgeGrant).toHaveBeenCalledTimes(2))
    expect(createKnowledgeGrant).toHaveBeenCalledWith(
      knowledgeBaseId,
      expect.objectContaining({ id: firstSelectableUserId, type: "user" })
    )
    expect(createKnowledgeGrant).toHaveBeenCalledWith(
      knowledgeBaseId,
      expect.objectContaining({ id: secondUserId, type: "user" })
    )
  })

  it("renders full user emails beside names and searches by email", async () => {
    const interaction = userEvent.setup()
    renderDialog({ canCreateGrant: true })

    const selector = await screen.findByRole("combobox", {
      name: "选择共享对象",
    })
    await interaction.click(selector)

    const email = await screen.findByText("alex@example.test")
    expect(email).toHaveClass("shrink-0", "text-muted-foreground")
    expect(email.parentElement).toHaveClass(
      "flex",
      "items-center",
      "whitespace-nowrap"
    )
    expect(screen.queryByText("a***@example.test")).not.toBeInTheDocument()

    await interaction.type(selector, "lin@example.test")
    await waitFor(() =>
      expect(listKnowledgeShareTargets).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "user",
          search: "lin@example.test",
        })
      )
    )
    expect(await screen.findByText("lin@example.test")).toBeVisible()
    await waitFor(() =>
      expect(screen.queryByText("alex@example.test")).not.toBeInTheDocument()
    )
  })

  it("anchors the popup to the full selector and orders users by name", async () => {
    listKnowledgeShareTargets.mockResolvedValueOnce({
      items: [
        {
          id: firstSelectableUserId,
          type: "user",
          name: "Zulu",
          secondary_label: "zulu@example.test",
        },
        {
          id: secondUserId,
          type: "user",
          name: "Alpha",
          secondary_label: "alpha@example.test",
        },
      ],
      next_cursor: null,
    })
    const interaction = userEvent.setup()
    renderDialog({ canCreateGrant: true })

    await interaction.click(
      await screen.findByRole("combobox", { name: "选择共享对象" })
    )

    const options = await screen.findAllByRole("option")
    expect(options.map((option) => option.textContent)).toEqual([
      "Alphaalpha@example.test",
      "Zuluzulu@example.test",
    ])
    expect(
      document.querySelector('[data-slot="combobox-content"]')
    ).toHaveAttribute("data-chips", "true")
  })

  it("uses the same searchable multi-selector for user groups", async () => {
    const interaction = userEvent.setup()
    renderDialog({ canCreateGrant: true })

    await interaction.click(await screen.findByRole("tab", { name: "用户组" }))
    const selector = screen.getByRole("combobox", {
      name: "选择共享对象",
    })
    expect(selector).toHaveAttribute("placeholder", "搜索用户组名称…")

    await interaction.click(selector)
    await interaction.click(
      await screen.findByRole("option", { name: "售后组" })
    )
    await interaction.click(selector)
    await interaction.click(
      await screen.findByRole("option", { name: "产品组" })
    )

    expect(
      screen.getByRole("button", { name: "移除共享对象 售后组" })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "移除共享对象 产品组" })
    ).toBeVisible()

    await interaction.type(selector, "售后")
    await waitFor(() =>
      expect(listKnowledgeShareTargets).toHaveBeenCalledWith(
        expect.objectContaining({ type: "group", search: "售后" })
      )
    )
  })

  it("loads every grant page and explains a user's remaining access sources", async () => {
    revokeKnowledgeGrant.mockResolvedValue({
      revoked_grant_id: userGrantId,
      target_type: "user",
      target_id: userId,
      remaining_access: {
        subject_type: "user",
        has_access: true,
        source_types: ["direct", "user_group"],
      },
    })
    const interaction = userEvent.setup()
    renderDialog()

    expect(await screen.findByText("测试用户")).toBeVisible()
    expect(screen.queryByText("售后组")).not.toBeInTheDocument()
    await interaction.click(screen.getByRole("button", { name: "加载更多" }))

    expect(await screen.findByText("售后组")).toBeVisible()
    expect(listKnowledgeGrants).toHaveBeenCalledWith(
      knowledgeBaseId,
      expect.objectContaining({ cursor: userGrantId })
    )

    await interaction.click(
      screen.getByRole("button", { name: "撤销对 测试用户 的共享" })
    )

    const notification = await screen.findByText(
      "已撤销对 测试用户 的共享；该用户仍可通过其他个人直接分享和其他用户组分享访问此知识库"
    )
    expect(notification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(notification.closest('[role="dialog"]')).toBeNull()
    expect(revokeKnowledgeGrant).toHaveBeenCalledWith(
      knowledgeBaseId,
      userGrantId
    )
  })

  it("shows only an aggregate result when group members retain other access", async () => {
    revokeKnowledgeGrant.mockResolvedValue({
      revoked_grant_id: groupGrantId,
      target_type: "user_group",
      target_id: groupId,
      remaining_access: {
        subject_type: "user_group",
        member_access: "some",
        source_types: ["owner", "user_group"],
      },
    })
    const interaction = userEvent.setup()
    renderDialog()

    await screen.findByText("测试用户")
    await interaction.click(screen.getByRole("button", { name: "加载更多" }))
    await interaction.click(
      await screen.findByRole("button", { name: "撤销对 售后组 的共享" })
    )

    const notification = await screen.findByText(
      "已撤销对用户组 售后组 的共享；部分启用组成员仍可通过知识库所有者身份和其他用户组分享访问。未展示成员明细"
    )
    expect(notification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(notification.closest('[role="dialog"]')).toBeNull()
    expect(screen.queryByText(/成员：/u)).not.toBeInTheDocument()
  })
})
