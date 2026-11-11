import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  publicKnowledgeSettingsSchema,
  supportedLocales,
  type ApplicationIcon,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { PublicKnowledgeSettingsForm } from "./settings-form"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
vi.mock("@/features/knowledge-bases/knowledge-base-hooks", () => ({
  useKnowledgeBaseList: () => ({
    data: {
      pages: [
        {
          items: [
            {
              id: baseId,
              name: "Website knowledge",
              availability_status: "enabled",
            },
          ],
        },
      ],
    },
    isPending: false,
    isFetchingNextPage: false,
    hasNextPage: false,
  }),
}))
const baseId = "00000000-0000-4000-8000-000000000001",
  applicationId = "00000000-0000-4000-8000-000000000002",
  skillId = "00000000-0000-4000-8000-000000000003"
const settings = publicKnowledgeSettingsSchema.parse({
  name: "Website assistant",
  instructions: "Use website evidence",
  model: "test-model",
  reasoning_effort: "medium",
  knowledge_base_ids: [baseId],
  allowed_origins: ["https://website.example.test"],
})
const result = {
  application_id: applicationId,
  public_id: "public-application-identifier-1234",
  settings,
  version_number: "1.0.0",
  icon: { type: "preset", preset: "bot" } as const,
}
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
function show({
  skillError = false,
  empty = false,
  selected = false,
  creating = false,
  icon,
}: {
  skillError?: boolean
  empty?: boolean
  selected?: boolean
  creating?: boolean
  icon?: ApplicationIcon
} = {}) {
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path === "/capabilities") {
      if (skillError) throw new Error("Skill request failed")
      return {
        items: empty
          ? []
          : [
              {
                id: skillId,
                type: "skill",
                name: "Answer guide",
                description: "Guided response style",
                can_select: true,
                is_builtin: false,
              },
              {
                id: "disabled-skill",
                type: "skill",
                name: "Disabled guide",
                can_select: false,
                is_builtin: false,
              },
              {
                id: "a-plugin",
                type: "plugin",
                name: "Private plugin",
                can_select: true,
                is_builtin: false,
              },
              {
                id: "a-builtin",
                type: "skill",
                name: "Built-in guide",
                can_select: true,
                is_builtin: true,
              },
            ],
        next_cursor: null,
      }
    }
    if (path === "/me/model-preference")
      return {
        configured: true,
        models: [
          {
            id: "test-model",
            display_name: "Test model",
            enabled: true,
            context_window: null,
            supported_reasoning_efforts: ["medium"],
            default_reasoning_effort: "medium",
          },
        ],
        default_model: "test-model",
        selected_model: "test-model",
        selected_reasoning_effort: "medium",
      }
    return result
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const saved = vi.fn()
  const cancelled = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <PublicKnowledgeSettingsForm
        initial={selected ? { ...settings, skill_ids: [skillId] } : settings}
        applicationId={creating ? undefined : applicationId}
        initialIcon={icon}
        onCancel={cancelled}
        onSaved={saved}
      />
    </QueryClientProvider>
  )
  return { saved, cancelled }
}
describe("public knowledge settings", () => {
  it.each(supportedLocales)(
    "marks knowledge as required while leaving Skills optional in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      show()
      const knowledge = screen.getByRole("combobox", {
        name: i18n.t("publicKnowledge.knowledge"),
      })
      expect(knowledge).toHaveAttribute("aria-required", "true")
      const knowledgeField = knowledge.closest('[data-slot="field"]')
      const label = knowledgeField?.querySelector("label")
      if (!label) throw new Error("Missing knowledge field label")
      expect(within(label).getByText("*")).toHaveClass("text-destructive")
      const skills = screen.getByRole("combobox", {
        name: i18n.t("applications.skills"),
      })
      expect(skills).not.toHaveAttribute("aria-required", "true")
      expect(
        skills.closest('[data-slot="field"]')?.querySelector("label")
      ).not.toHaveTextContent("*")
    }
  )

  it("marks an empty knowledge selection invalid and blocks publication", async () => {
    await i18n.changeLanguage("zh-CN")
    const { saved } = show()
    const publish = screen.getByRole("button", {
      name: i18n.t("publicKnowledge.publish"),
    })
    await waitFor(() => expect(publish).toBeEnabled())
    await userEvent.click(
      screen.getByRole("button", {
        name: i18n.t("applications.removeResource", {
          name: "Website knowledge",
        }),
      })
    )
    await userEvent.click(publish)
    const knowledge = screen.getByRole("combobox", {
      name: i18n.t("publicKnowledge.knowledge"),
    })
    expect(knowledge).toHaveAttribute("aria-invalid", "true")
    expect(knowledge.closest('[data-slot="field"]')).toHaveAttribute(
      "data-invalid",
      "true"
    )
    expect(saved).not.toHaveBeenCalled()
    expect(
      await screen.findByText(i18n.t("publicKnowledge.invalid"))
    ).toBeVisible()
  })

  it.each(supportedLocales)(
    "selects and publishes an application logo in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const { saved } = show({ creating: true })
      const publish = screen.getByRole("button", {
        name: i18n.t("applications.createAndPublish"),
      })
      await waitFor(() => expect(publish).toBeEnabled())
      const preset = screen.getByRole("button", {
        name: i18n.t("applications.iconPresets.globe-2"),
      })
      await userEvent.click(preset)
      expect(preset).toHaveAttribute("aria-pressed", "true")
      await userEvent.click(publish)
      await waitFor(() => expect(saved).toHaveBeenCalledOnce())
      expect(apiRequest).toHaveBeenCalledWith(
        "/applications/public-knowledge",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            icon: { type: "preset", preset: "globe-2" },
          }),
        })
      )
    }
  )

  it("previews an existing uploaded logo and preserves it when publishing other edits", async () => {
    await i18n.changeLanguage("zh-CN")
    const icon: ApplicationIcon = {
      type: "custom",
      url: "https://icons.example.test/website.png",
      fallback_preset: "globe-2",
    }
    const images: { src: string; onload: (() => void) | null }[] = []
    vi.stubGlobal(
      "Image",
      class {
        src = ""
        onload: (() => void) | null = null
        constructor() {
          images.push(this)
        }
      }
    )
    const { saved } = show({ icon })
    act(() => images[0]?.onload?.())
    expect(screen.getByRole("presentation")).toHaveAttribute("src", icon.url)
    const publish = screen.getByRole("button", {
      name: i18n.t("publicKnowledge.publish"),
    })
    await waitFor(() => expect(publish).toBeEnabled())
    await userEvent.click(publish)
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    const request = vi
      .mocked(apiRequest)
      .mock.calls.find(
        ([path]) => path === `/applications/${applicationId}/public-knowledge`
      )
    expect(request?.[1]?.body).not.toHaveProperty("icon")
  })

  it("replaces an existing uploaded logo with a preset", async () => {
    await i18n.changeLanguage("zh-CN")
    const { saved } = show({
      icon: {
        type: "custom",
        url: "https://icons.example.test/website.png",
        fallback_preset: "bot",
      },
    })
    const publish = screen.getByRole("button", {
      name: i18n.t("publicKnowledge.publish"),
    })
    await waitFor(() => expect(publish).toBeEnabled())
    await userEvent.click(
      screen.getByRole("button", {
        name: i18n.t("applications.iconPresets.book-open"),
      })
    )
    await userEvent.click(publish)
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${applicationId}/public-knowledge`,
      expect.objectContaining({
        body: expect.objectContaining({
          icon: { type: "preset", preset: "book-open" },
        }),
      })
    )
  })

  it("rejects unsupported files and waits for logo reading before publishing the upload", async () => {
    await i18n.changeLanguage("zh-CN")
    const { saved } = show()
    const publish = screen.getByRole("button", {
      name: i18n.t("publicKnowledge.publish"),
    })
    await waitFor(() => expect(publish).toBeEnabled())
    const input = screen.getByLabelText(i18n.t("applications.uploadIcon"), {
      selector: "input",
    })
    fireEvent.change(input, {
      target: {
        files: [new File(["unsafe"], "logo.svg", { type: "image/svg+xml" })],
      },
    })
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("applications.iconFileInvalid")
    )
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([1, 2, 3])], "logo.png", {
            type: "image/png",
          }),
        ],
      },
    })
    expect(publish).toBeDisabled()
    const form = publish.closest("form")
    if (!form) throw new Error("Missing settings form")
    fireEvent.submit(form)
    expect(saved).not.toHaveBeenCalled()
    await waitFor(() => expect(publish).toBeEnabled())
    await userEvent.click(publish)
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${applicationId}/public-knowledge`,
      expect.objectContaining({
        body: expect.objectContaining({
          icon: {
            type: "upload",
            filename: "logo.png",
            mime_type: "image/png",
            data_base64: "AQID",
          },
        }),
      })
    )
  })

  it("keeps the footer pending state and prevents duplicate submission and cancellation while publishing", async () => {
    await i18n.changeLanguage("zh-CN")
    const { saved, cancelled } = show()
    const publish = screen.getByRole("button", {
      name: i18n.t("publicKnowledge.publish"),
    })
    await waitFor(() => expect(publish).toBeEnabled())
    let resolvePublish: (value: typeof result) => void = () => {
      throw new Error("Publish request was not initialized")
    }
    const pending = new Promise<typeof result>((resolve) => {
      resolvePublish = resolve
    })
    vi.mocked(apiRequest).mockReturnValueOnce(pending)
    const callsBeforeSave = vi.mocked(apiRequest).mock.calls.length
    const cancel = screen.getByRole("button", { name: i18n.t("common.cancel") })
    const user = userEvent.setup()
    await user.click(publish)
    expect(publish).toBeDisabled()
    expect(publish).toHaveAttribute("aria-busy", "true")
    expect(cancel).toBeDisabled()
    const form = publish.closest("form")
    if (!form) throw new Error("Missing settings form")
    fireEvent.submit(form)
    await user.click(cancel)
    expect(cancelled).not.toHaveBeenCalled()
    expect(apiRequest).toHaveBeenCalledTimes(callsBeforeSave + 1)
    resolvePublish(result)
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    await waitFor(() => expect(publish).toBeEnabled())
  })
  it.each(supportedLocales)(
    "publishes validated public settings with the dedicated endpoint in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const { saved } = show(),
        user = userEvent.setup()
      const publish = screen.getByRole("button", {
        name: i18n.t("publicKnowledge.publish"),
      })
      await waitFor(() => expect(publish).toBeEnabled())
      const name = screen.getByRole("textbox", {
        name: i18n.t("publicKnowledge.name"),
      })
      expect(name.closest('[data-slot="field-group"]')).toHaveClass(
        "grid",
        "grid-cols-1",
        "md:grid-cols-2"
      )
      expect(
        screen.getByRole("textbox", {
          name: i18n.t("publicKnowledge.instructions"),
        })
      ).toHaveValue(settings.instructions)
      await user.clear(name)
      await user.type(name, "Updated website")
      const concurrency = screen.getByRole("spinbutton", {
        name: i18n.t("publicKnowledge.concurrency"),
      })
      await user.clear(concurrency)
      await user.type(concurrency, "3")
      const references = screen.getByRole("switch", {
        name: i18n.t("publicKnowledge.showReferences"),
      })
      expect(references).toBeChecked()
      await user.click(references)
      await user.click(publish)
      await waitFor(() => expect(saved).toHaveBeenCalledOnce())
      expect(saved.mock.calls[0]?.[0]).toEqual(result)
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${applicationId}/public-knowledge`,
        expect.objectContaining({
          method: "PUT",
          body: expect.objectContaining({
            name: "Updated website",
            max_concurrent_turns: 3,
            show_references: false,
            knowledge_base_ids: [baseId],
            allowed_origins: ["https://website.example.test"],
            skill_ids: [],
          }),
        })
      )
    }
  )
  it("selects a permitted Skill, excludes plugins and built-ins, and publishes its identity", async () => {
    await i18n.changeLanguage("zh-CN")
    const { saved } = show(),
      user = userEvent.setup()
    const picker = await screen.findByRole("combobox", {
      name: i18n.t("applications.skills"),
    })
    await waitFor(() => expect(picker).toBeEnabled())
    await user.click(picker)
    expect(
      screen.getByRole("option", { name: /Disabled guide/u })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.queryByRole("option", { name: /Private plugin/u })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("option", { name: /Built-in guide/u })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("option", { name: /Answer guide/u }))
    await user.keyboard("{Escape}")
    await user.click(
      screen.getByRole("button", { name: i18n.t("publicKnowledge.publish") })
    )
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${applicationId}/public-knowledge`,
      expect.objectContaining({
        body: expect.objectContaining({ skill_ids: [skillId] }),
      })
    )
  })
  it("restores and removes a selected Skill when editing", async () => {
    await i18n.changeLanguage("zh-CN")
    const { saved } = show({ selected: true }),
      user = userEvent.setup()
    const remove = await screen.findByRole("button", {
      name: i18n.t("applications.removeResource", { name: "Answer guide" }),
    })
    await user.click(remove)
    await user.click(
      screen.getByRole("button", { name: i18n.t("publicKnowledge.publish") })
    )
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${applicationId}/public-knowledge`,
      expect.objectContaining({
        body: expect.objectContaining({ skill_ids: [] }),
      })
    )
  })
  it("allows publication without any installed Skills", async () => {
    await i18n.changeLanguage("zh-CN")
    show({ empty: true })
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: i18n.t("publicKnowledge.publish") })
      ).toBeEnabled()
    )
    expect(
      screen.getByRole("combobox", { name: i18n.t("applications.skills") })
    ).toBeDisabled()
  })
  it("lets a creator remove a deleted Skill before publishing the application again", async () => {
    await i18n.changeLanguage("zh-CN")
    const { saved } = show({ selected: true, empty: true }),
      user = userEvent.setup()
    const remove = await screen.findByRole("button", {
      name: i18n.t("applications.removeResource", {
        name: i18n.t("applications.dependencyUnavailableShort"),
      }),
    })
    await user.click(remove)
    await user.click(
      screen.getByRole("button", { name: i18n.t("publicKnowledge.publish") })
    )
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${applicationId}/public-knowledge`,
      expect.objectContaining({
        body: expect.objectContaining({ skill_ids: [] }),
      })
    )
  })
  it("blocks publication and displays an error when Skills cannot be loaded", async () => {
    await i18n.changeLanguage("zh-CN")
    show({ skillError: true })
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(
      screen.getByRole("button", { name: i18n.t("publicKnowledge.publish") })
    ).toBeDisabled()
  })
  it("rejects website paths and wildcards instead of publishing an invalid embedding scope", async () => {
    await i18n.changeLanguage("zh-CN")
    const { saved } = show(),
      user = userEvent.setup(),
      publish = screen.getByRole("button", {
        name: i18n.t("publicKnowledge.publish"),
      })
    await waitFor(() => expect(publish).toBeEnabled())
    const origins = screen.getByRole("textbox", {
      name: i18n.t("publicKnowledge.origins"),
    })
    await user.clear(origins)
    await user.type(origins, "https://*.example.test/path")
    await user.click(publish)
    expect(
      await screen.findByText(i18n.t("publicKnowledge.invalid"))
    ).toBeVisible()
    expect(saved).not.toHaveBeenCalled()
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.filter(([path]) => path.endsWith("/public-knowledge"))
    ).toHaveLength(0)
  })
})
