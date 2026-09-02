import { act, cleanup, render, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import type { ReactNode, Ref } from "react"

import type {
  ConversationFile,
  ModelPreference,
  ReasoningEffort,
} from "@/api/contracts"
import { setAppLanguage } from "@/i18n"
import type { EmbedFrameConfig } from "./config"

type MockComposerProps = Readonly<{
  value: string
  modelPreference?: ModelPreference
  modelPreferencePending?: boolean
  planModeAvailable?: boolean
  allowManagedApplicationModelSelection?: boolean
  attachments?: ConversationFile[]
  attachmentOperationPending?: boolean
  onAttach?: (files: File[]) => Promise<unknown> | boolean | void
  onClearAttachments?: (files: readonly ConversationFile[]) => Promise<void>
  onSubmit?: (value: string) => void
  onModelPreferenceChange?: (
    model: string,
    reasoningEffort: ReasoningEffort
  ) => void
  requestVoiceTranscription?: (
    body: unknown,
    signal: AbortSignal
  ) => Promise<Response>
}>

type MockThreadProps = Readonly<{
  scrollContainerRef?: Ref<HTMLDivElement>
  emptyStateContent?: ReactNode
}>

const composerState = vi.hoisted(() => ({
  props: null as MockComposerProps | null,
  focus: vi.fn(),
}))
const threadState = vi.hoisted(() => ({
  props: null as MockThreadProps | null,
}))
const clientState = vi.hoisted(() => ({
  modelPreferenceUpdates: [] as Array<Record<string, unknown>>,
  conversationChanges: [] as Array<{
    path: string
    method: string | undefined
  }>,
  attachments: [] as ConversationFile[],
  attachmentDeletes: [] as Array<{ file_ids: string[] }>,
  attachmentDeleteGate: null as Promise<void> | null,
  uploadError: null as Error | null,
  turnStarts: 0,
}))

vi.mock("@/features/applications/application-icon", () => ({
  ApplicationIconDisplay: () => <div data-testid="application-icon" />,
}))

vi.mock("@/features/conversations/conversation-composer", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    ConversationComposer: forwardRef(function MockConversationComposer(
      props: MockComposerProps,
      ref
    ) {
      composerState.props = props
      useImperativeHandle(ref, () => ({ focus: composerState.focus }))
      return <div data-testid="conversation-composer" />
    }),
  }
})

vi.mock("@/features/conversations/conversation-thread", () => ({
  ConversationThread: (props: MockThreadProps) => {
    threadState.props = props
    return (
      <div
        ref={props.scrollContainerRef}
        data-testid="conversation-thread"
        className="conversation-scroll conversation-scroll-embedded"
      >
        {props.emptyStateContent}
      </div>
    )
  },
}))

vi.mock(
  "@/features/conversations/conversation-user-input-request-card",
  () => ({
    ConversationUserInputRequestCard: () => null,
  })
)

vi.mock("./session-client", () => {
  class EmbedRequestError extends Error {
    status = 500
  }

  class EmbedSessionClient {
    authenticated = true

    async startPublicSession() {}

    async changeConversation(path: string, init?: RequestInit) {
      clientState.conversationChanges.push({ path, method: init?.method })
      return {
        session_id: "50000000-0000-4000-8000-000000000001",
        session_expires_at: "2026-08-25T18:00:00.000Z",
        conversation_id: "40000000-0000-4000-8000-000000000001",
        access_token: null,
        renewal_token: null,
        access_token_expires_at: null,
        renewal_token_expires_at: null,
      }
    }

    async request(path: string, _schema: unknown, init?: RequestInit) {
      if (path === "/api/v1/embed/session") {
        return {
          session_id: "50000000-0000-4000-8000-000000000001",
          session_expires_at: "2026-08-25T18:00:00.000Z",
          conversation: conversation(),
        }
      }
      if (path === "/api/v1/embed/session/conversations") {
        return {
          items: [
            {
              id: "40000000-0000-4000-8000-000000000001",
              title: "Summarize admissions follow-up",
              updated_at: "2026-08-25T10:00:00.000Z",
              created_at: "2026-08-25T09:00:00.000Z",
              execution_status: "completed",
              current: true,
            },
          ],
        }
      }
      if (path === "/api/v1/embed/session/model-preference") {
        if (init?.method === "PUT") {
          const update = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >
          clientState.modelPreferenceUpdates.push(update)
          return modelPreference(
            String(update.selected_model),
            update.selected_reasoning_effort as ReasoningEffort
          )
        }
        return modelPreference("gpt-5.6-terra", "medium")
      }
      if (
        path === "/api/v1/embed/session/attachments" &&
        init?.method === "DELETE"
      ) {
        clientState.attachmentDeletes.push(
          JSON.parse(String(init.body)) as { file_ids: string[] }
        )
        await clientState.attachmentDeleteGate
        clientState.attachments.length = 0
        return undefined
      }
      if (path === "/api/v1/embed/session/turns" && init?.method === "POST") {
        clientState.turnStarts += 1
        return {
          turn_id: "50000000-0000-4000-8000-000000000002",
          accepted: true,
          status: "starting",
        }
      }
      throw new Error(`Unexpected embed request: ${path}`)
    }

    async upload() {
      if (clientState.uploadError) throw clientState.uploadError
      return attachment("60000000-0000-4000-8000-000000000099", "上传完成.pdf")
    }

    async requestStream() {
      return new Response(
        `${JSON.stringify({ type: "done", text: "嵌入识别" })}\n`,
        { status: 200 }
      )
    }

    connectEvents() {
      return () => undefined
    }

    destroy() {}
  }

  return { EmbedRequestError, EmbedSessionClient }
})

import { EmbedApp } from "./embed-app"

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  })
})

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo")
})

afterEach(() => {
  cleanup()
  composerState.props = null
  composerState.focus.mockReset()
  threadState.props = null
  clientState.modelPreferenceUpdates.length = 0
  clientState.conversationChanges.length = 0
  clientState.attachments.length = 0
  clientState.attachmentDeletes.length = 0
  clientState.attachmentDeleteGate = null
  clientState.uploadError = null
  clientState.turnStarts = 0
})

describe("embedded application chat", () => {
  it("presents conversations as a task list with permanent deletion", async () => {
    const interaction = userEvent.setup()
    const view = render(<EmbedApp config={frameConfig()} />)
    sendLocale("en-US")

    const trigger = await view.findByRole("button", { name: "Task list" })
    expect(trigger.querySelector(".lucide-list-todo")).not.toBeNull()

    await interaction.click(trigger)

    expect(await view.findByText("New task")).toBeVisible()
    expect(view.getByText("Summarize admissions follow-up")).toBeVisible()

    await interaction.click(
      view.getByRole("button", {
        name: "Delete task “Summarize admissions follow-up”",
      })
    )
    expect(
      await view.findByRole("heading", {
        name: "Permanently delete task?",
      })
    ).toBeVisible()

    await interaction.click(
      view.getByRole("button", { name: "Delete permanently" })
    )

    await waitFor(() => {
      expect(clientState.conversationChanges).toContainEqual({
        path: "/api/v1/embed/session/conversations/40000000-0000-4000-8000-000000000001",
        method: "DELETE",
      })
    })
  })

  it("uses the conversation thread as the only scroll container", async () => {
    const view = render(<EmbedApp config={frameConfig()} />)

    await waitFor(() => {
      expect(view.getByTestId("conversation-thread")).toBeInTheDocument()
    })

    expect(threadState.props?.scrollContainerRef).toBeDefined()
    expect(
      view.queryByRole("group", { name: "常用问题" })
    ).not.toBeInTheDocument()
    expect(view.container.querySelector(".embed-thread")).not.toHaveAttribute(
      "style"
    )
  })

  it("loads and updates the model selector when the application delegates model choice", async () => {
    const view = render(<EmbedApp config={frameConfig()} />)

    await waitFor(() => {
      expect(view.getByTestId("conversation-composer")).toBeInTheDocument()
      expect(composerState.props?.modelPreference?.selected_model).toBe(
        "gpt-5.6-terra"
      )
    })
    expect(composerState.props?.allowManagedApplicationModelSelection).toBe(
      true
    )
    expect(composerState.props?.requestVoiceTranscription).toEqual(
      expect.any(Function)
    )
    expect(composerState.props?.modelPreferencePending).toBe(false)

    await act(async () => {
      composerState.props?.onModelPreferenceChange?.("gpt-5.6-sol", "high")
    })

    await waitFor(() => {
      expect(clientState.modelPreferenceUpdates).toEqual([
        {
          selected_model: "gpt-5.6-sol",
          selected_reasoning_effort: "high",
        },
      ])
      expect(composerState.props?.modelPreference?.selected_model).toBe(
        "gpt-5.6-sol"
      )
    })
  })

  it("fills and focuses the composer without sending when a built-in question is selected", async () => {
    const interaction = userEvent.setup()
    const view = render(
      <EmbedApp
        config={frameConfig({
          starter_questions: ["学费包含哪些项目？", "How do I apply?"],
        })}
      />
    )

    const starterQuestion = await view.findByRole("button", {
      name: "学费包含哪些项目？",
    })
    expect(
      starterQuestion.querySelector(".lucide-arrow-up-right")
    ).toHaveAttribute("stroke-width", "1.5")

    await interaction.click(starterQuestion)

    await waitFor(() => {
      expect(composerState.props?.value).toBe("学费包含哪些项目？")
    })
    expect(composerState.focus).toHaveBeenCalledOnce()
    expect(clientState.conversationChanges).toEqual([])
  })

  it("uses the URL locale and applies dedicated host locale updates", async () => {
    await setAppLanguage("en-US", { persist: false })
    const view = render(<EmbedApp config={frameConfig({ locale: "en-US" })} />)

    expect(await view.findByRole("button", { name: "Task list" })).toBeVisible()
    sendLocale("zh-CN")
    expect(await view.findByRole("button", { name: "任务列表" })).toBeVisible()
    sendLocale("unsupported")
    expect(await view.findByRole("button", { name: "任务列表" })).toBeVisible()
  })

  it("removes Plan mode from the embedded composer", async () => {
    render(<EmbedApp config={frameConfig()} />)

    await waitFor(() => {
      expect(composerState.props?.planModeAvailable).toBe(false)
    })
  })

  it("clears all attachments through one atomic embedded request", async () => {
    const attachments = [
      attachment("60000000-0000-4000-8000-000000000011", "一.pdf"),
      attachment("60000000-0000-4000-8000-000000000012", "二.pdf"),
      attachment("60000000-0000-4000-8000-000000000013", "三.pdf"),
    ]
    clientState.attachments.push(...attachments)
    let releaseDelete!: () => void
    clientState.attachmentDeleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve
    })
    render(<EmbedApp config={frameConfig()} />)

    await waitFor(() => {
      expect(composerState.props?.attachments).toHaveLength(3)
    })
    let clearOperation: Promise<void> | undefined
    act(() => {
      clearOperation = composerState.props?.onClearAttachments?.(attachments)
      composerState.props?.onSubmit?.("不应在清理期间发送")
    })

    expect(clientState.attachmentDeletes).toEqual([
      { file_ids: attachments.map((file) => file.id) },
    ])
    expect(clientState.turnStarts).toBe(0)
    await waitFor(() => {
      expect(composerState.props?.attachmentOperationPending).toBe(true)
    })
    await act(async () => {
      releaseDelete()
      await clearOperation
    })
    await waitFor(() => {
      expect(composerState.props?.attachments).toHaveLength(0)
      expect(composerState.props?.attachmentOperationPending).toBe(false)
    })
  })

  it("rejects a failed embedded upload so pasted content can be restored", async () => {
    clientState.uploadError = new Error("upload failed")
    render(<EmbedApp config={frameConfig()} />)

    await waitFor(() => expect(composerState.props?.onAttach).toBeDefined())
    const upload = composerState.props?.onAttach?.([
      new File(["pdf"], "失败.pdf", { type: "application/pdf" }),
    ])

    await expect(upload).rejects.toThrow("upload failed")
    await waitFor(() => {
      expect(composerState.props?.attachmentOperationPending).toBe(false)
    })
  })
})

function frameConfig(
  overrides: Partial<EmbedFrameConfig> = {}
): EmbedFrameConfig {
  const base: EmbedFrameConfig = {
    app_id: "lsa_application_identifier_1234",
    parent_origin: "https://partner.example.test",
    auth_mode: "public",
    locale: "zh-CN",
    starter_questions: [],
    application: {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Partner operations",
      description: null,
      icon: { type: "preset", preset: "bot" },
      allows_user_model_selection: true,
    },
  }
  return { ...base, ...overrides }
}

function sendLocale(locale: string) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://partner.example.test",
        source: window,
        data: {
          type: "linksense:locale",
          appId: "lsa_application_identifier_1234",
          locale,
        },
      })
    )
  })
}

function conversation() {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    title: "Partner operations",
    archived: false,
    updated_at: "2026-08-25T10:00:00.000Z",
    execution_status: "idle",
    has_unread_completion: false,
    collaboration_mode: "default",
    draft_input: "",
    draft_capability_ids: [],
    selected_knowledge_base_ids: [],
    draft_knowledge_base_ids: [],
    messages: [],
    attachments: [...clientState.attachments],
    artifacts: [],
    turns: [],
    running_turn: null,
    pending_requests: [],
    user_input_requests: [],
    plan_reviews: [],
    activities: [],
    events: [],
    turn_file_change_counts: {},
  }
}

function attachment(id: string, name: string): ConversationFile {
  return {
    id,
    name,
    mime_type: "application/pdf",
    size: 1_024,
    kind: "attachment",
    draft_id: "70000000-0000-4000-8000-000000000001",
    turn_id: null,
    status: "draft",
    download_available: false,
  }
}

function modelPreference(
  selectedModel: string,
  reasoningEffort: ReasoningEffort
): ModelPreference {
  return {
    configured: true,
    default_model: "gpt-5.6-terra",
    selected_model: selectedModel,
    selected_reasoning_effort: reasoningEffort,
    models: [
      {
        id: "gpt-5.6-terra",
        display_name: "GPT-5.6 Terra",
        enabled: true,
        context_window: null,
        supported_reasoning_efforts: ["medium", "high"],
        default_reasoning_effort: "medium",
      },
      {
        id: "gpt-5.6-sol",
        display_name: "GPT-5.6 Sol",
        enabled: true,
        context_window: null,
        supported_reasoning_efforts: ["medium", "high"],
        default_reasoning_effort: "medium",
      },
    ],
  }
}
