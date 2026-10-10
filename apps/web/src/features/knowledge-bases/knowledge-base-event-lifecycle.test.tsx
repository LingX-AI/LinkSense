import type { ReactNode } from "react"
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import { knowledgeBaseQueryKeys } from "@/features/knowledge-bases/knowledge-base-api"
import {
  knowledgeBaseEventSchema,
  knowledgeBaseSchema,
  knowledgeDocumentSchema,
  type KnowledgeBaseEvent,
  type KnowledgeBaseEntryPage,
  type KnowledgeDocument,
} from "@/features/knowledge-bases/knowledge-base-contracts"
import { useKnowledgeBaseEvents } from "@/features/knowledge-bases/knowledge-base-hooks"

const getKnowledgeBase = vi.hoisted(() => vi.fn())
const connectKnowledgeBaseEvents = vi.hoisted(() => vi.fn())

vi.mock(
  "@/features/knowledge-bases/knowledge-base-api",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/knowledge-bases/knowledge-base-api")
    >()),
    getKnowledgeBase,
  })
)

vi.mock("@/features/knowledge-bases/knowledge-base-events", () => ({
  connectKnowledgeBaseEvents,
}))

const knowledgeBaseId = "00000000-0000-4000-8000-000000000001"
const documentId = "00000000-0000-4000-8000-000000000011"
const versionId = "00000000-0000-4000-8000-000000000031"
const generationId = "00000000-0000-4000-8000-000000000021"

type EventHandlers = {
  onEvent(event: KnowledgeBaseEvent): void
  onConnectionChange?(state: "connected" | "reconnecting"): void
  shouldReconnect?(signal: AbortSignal): boolean | Promise<boolean>
}

let handlers: EventHandlers | undefined

function baseFixture(overrides: Record<string, unknown> = {}) {
  return knowledgeBaseSchema.parse({
    id: knowledgeBaseId,
    name: "制度库",
    description: null,
    lifecycle_status: "active",
    availability_status: "enabled",
    owner: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Owner",
    },
    is_owner: false,
    access_sources: [
      {
        type: "direct",
        id: "00000000-0000-4000-8000-000000000003",
      },
    ],
    document_count: 1,
    ready_document_count: 0,
    storage_used_bytes: 4_096,
    storage_reserved_bytes: 0,
    storage_quota_bytes: 10_000,
    permissions: {
      view_content: true,
      update: false,
      manage_documents: false,
      manage_grants: false,
      create_grants: false,
      revoke_grants: false,
      archive: false,
      restore: false,
      delete: false,
      remove_direct_share: true,
    },
    archived_at: null,
    disabled_reason: null,
    created_at: "2026-07-22T01:00:00.000Z",
    updated_at: "2026-07-22T01:00:00.000Z",
    ...overrides,
  })
}

function documentFixture(revision = 8) {
  return knowledgeDocumentSchema.parse({
    id: documentId,
    knowledge_base_id: knowledgeBaseId,
    display_name: "制度.pdf",
    canonical_extension: "pdf",
    mime_type: "application/pdf",
    size_bytes: 4_096,
    status: "processing",
    current_version_id: versionId,
    searchable: false,
    rebuild_required: false,
    processing: {
      operation: "replace",
      processing_generation: generationId,
      stage: "embedding",
      progress_percent: 80,
      revision,
      stable_error_code: null,
      retry_at: null,
      retry_attempt: 0,
      cancellable: true,
    },
    candidate_failure: null,
    preview: {
      parsed: true,
      original_supported: true,
      renderer: "file",
    },
    created_at: "2026-07-22T01:00:00.000Z",
    updated_at: "2026-07-22T01:01:00.000Z",
  })
}

function terminalEvent() {
  return knowledgeBaseEventSchema.parse({
    type: "knowledge_document_processing_updated",
    knowledge_base_id: knowledgeBaseId,
    document_id: documentId,
    processing_generation: generationId,
    status: "ready",
    stage: null,
    progress_percent: 100,
    revision: 12,
    retry_at: null,
    retry_attempt: 0,
    stable_error_code: null,
    updated_at: "2026-07-22T01:02:00.000Z",
  })
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

describe("knowledge base event lifecycle", () => {
  beforeEach(() => {
    handlers = undefined
    getKnowledgeBase.mockReset()
    connectKnowledgeBaseEvents
      .mockReset()
      .mockImplementation(
        (_knowledgeBaseId: string, nextHandlers: EventHandlers) => {
          handlers = nextHandlers
          return vi.fn()
        }
      )
  })

  afterEach(() => cleanup())

  it("updates reprocessing progress in every loaded view without refetching each ready event", async () => {
    const queryClient = createQueryClient()
    const fixture = documentFixture()
    const document = knowledgeDocumentSchema.parse({
      ...fixture,
      status: "ready",
      searchable: true,
      processing: { ...fixture.processing, operation: "reprocess" },
    })
    const documentsKey = knowledgeBaseQueryKeys.documents(knowledgeBaseId)
    const documentKey = knowledgeBaseQueryKeys.document(
      knowledgeBaseId,
      documentId
    )
    const entriesKey = knowledgeBaseQueryKeys.entryDirectory(knowledgeBaseId)
    queryClient.setQueryData(documentsKey, {
      pages: [
        {
          items: [document],
          next_cursor: null,
          has_processing_documents: true,
        },
      ],
      pageParams: [undefined],
    })
    queryClient.setQueryData(documentKey, document)
    queryClient.setQueryData<InfiniteData<KnowledgeBaseEntryPage>>(entriesKey, {
      pages: [
        {
          breadcrumbs: [],
          items: [
            {
              id: documentId,
              knowledge_base_id: knowledgeBaseId,
              parent_entry_id: null,
              entry_type: "document",
              name: document.display_name,
              document,
              updated_at: document.updated_at,
            },
          ],
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    })
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")
    renderHook(() => useKnowledgeBaseEvents(knowledgeBaseId, true), {
      wrapper: wrapper(queryClient),
    })
    await waitFor(() => expect(handlers).toBeDefined())

    act(() =>
      handlers?.onEvent(
        knowledgeBaseEventSchema.parse({
          ...terminalEvent(),
          stage: "embedding",
          progress_percent: 84,
          revision: 9,
        })
      )
    )

    const expected = {
      status: "ready",
      searchable: true,
      processing: { stage: "embedding", progress_percent: 84, revision: 9 },
    }
    expect(
      queryClient.getQueryData<InfiniteData<{ items: KnowledgeDocument[] }>>(
        documentsKey
      )?.pages[0]?.items[0]
    ).toMatchObject(expected)
    expect(
      queryClient.getQueryData<KnowledgeDocument>(documentKey)
    ).toMatchObject(expected)
    const entry =
      queryClient.getQueryData<InfiniteData<KnowledgeBaseEntryPage>>(entriesKey)
        ?.pages[0]?.items[0]
    expect(entry?.document).toMatchObject(expected)
    expect(invalidateQueries).not.toHaveBeenCalled()

    act(() =>
      handlers?.onEvent(
        knowledgeBaseEventSchema.parse({
          ...terminalEvent(),
          stage: "completed",
        })
      )
    )

    expect(
      queryClient.getQueryData<KnowledgeDocument>(documentKey)?.processing
    ).toBeNull()
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: documentsKey })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: knowledgeBaseQueryKeys.entries(knowledgeBaseId),
    })
  })

  it("fetches the processing snapshot when a ready progress event starts a previously idle document", async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(
      knowledgeBaseQueryKeys.documents(knowledgeBaseId),
      {
        pages: [
          {
            items: [
              knowledgeDocumentSchema.parse({
                ...documentFixture(),
                status: "ready",
                searchable: true,
                processing: null,
              }),
            ],
            next_cursor: null,
            has_processing_documents: false,
          },
        ],
        pageParams: [undefined],
      }
    )
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")
    renderHook(() => useKnowledgeBaseEvents(knowledgeBaseId, true), {
      wrapper: wrapper(queryClient),
    })
    await waitFor(() => expect(handlers).toBeDefined())

    act(() =>
      handlers?.onEvent(
        knowledgeBaseEventSchema.parse({
          ...terminalEvent(),
          stage: "embedding",
          progress_percent: 80,
        })
      )
    )

    for (const queryKey of [
      knowledgeBaseQueryKeys.detail(knowledgeBaseId),
      knowledgeBaseQueryKeys.documents(knowledgeBaseId),
      knowledgeBaseQueryKeys.entries(knowledgeBaseId),
    ]) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
  })

  it("replays newer SSE events after a stale reconnect snapshot finishes", async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(
      knowledgeBaseQueryKeys.documents(knowledgeBaseId),
      {
        pages: [{ items: [documentFixture()], next_cursor: null }],
        pageParams: [undefined],
      }
    )
    let finishSnapshot: (() => void) | undefined
    const snapshot = new Promise<void>((resolve) => {
      finishSnapshot = resolve
    })
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(snapshot)
    renderHook(() => useKnowledgeBaseEvents(knowledgeBaseId, true), {
      wrapper: wrapper(queryClient),
    })
    await waitFor(() => expect(handlers).toBeDefined())

    act(() => handlers?.onConnectionChange?.("connected"))
    act(() => handlers?.onEvent(terminalEvent()))
    act(() => {
      queryClient.setQueryData(
        knowledgeBaseQueryKeys.documents(knowledgeBaseId),
        {
          pages: [{ items: [documentFixture(10)], next_cursor: null }],
          pageParams: [undefined],
        }
      )
    })
    expect(
      queryClient.getQueryData<{
        pages: Array<{ items: Array<{ status: string }> }>
      }>(knowledgeBaseQueryKeys.documents(knowledgeBaseId))?.pages[0]?.items[0]
        ?.status
    ).toBe("processing")

    await act(async () => finishSnapshot?.())

    await waitFor(() => {
      expect(
        queryClient.getQueryData<{
          pages: Array<{
            items: Array<{ status: string; event_revision?: number }>
          }>
        }>(knowledgeBaseQueryKeys.documents(knowledgeBaseId))?.pages[0]
          ?.items[0]
      ).toMatchObject({ status: "ready", event_revision: 12 })
    })
  })

  it("stops reconnecting and clears loaded content after access is revoked", async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(
      knowledgeBaseQueryKeys.detail(knowledgeBaseId),
      baseFixture()
    )
    queryClient.setQueryData(
      knowledgeBaseQueryKeys.documents(knowledgeBaseId),
      {
        pages: [{ items: [documentFixture()], next_cursor: null }],
        pageParams: [undefined],
      }
    )
    queryClient.setQueryData(
      knowledgeBaseQueryKeys.document(knowledgeBaseId, documentId),
      documentFixture()
    )
    queryClient.setQueryData(
      knowledgeBaseQueryKeys.content(knowledgeBaseId, documentId),
      { markdown: "private" }
    )
    queryClient.setQueryData(knowledgeBaseQueryKeys.grants(knowledgeBaseId), {
      items: [],
    })
    queryClient.setQueryData(
      knowledgeBaseQueryKeys.citation("00000000-0000-4000-8000-000000000099"),
      { parent_excerpt: "private citation" }
    )
    getKnowledgeBase.mockRejectedValue(
      new ApiError({
        status: 403,
        errorCode: "KNOWLEDGE_BASE_ACCESS_DENIED",
      })
    )
    const rendered = renderHook(
      () => useKnowledgeBaseEvents(knowledgeBaseId, true),
      { wrapper: wrapper(queryClient) }
    )
    await waitFor(() => expect(handlers?.shouldReconnect).toBeDefined())

    let reconnect = true
    await act(async () => {
      reconnect =
        (await handlers?.shouldReconnect?.(new AbortController().signal)) ??
        true
    })

    expect(reconnect).toBe(false)
    expect(rendered.result.current.connectionState).toBe("access_lost")
    for (const key of [
      knowledgeBaseQueryKeys.detail(knowledgeBaseId),
      knowledgeBaseQueryKeys.documents(knowledgeBaseId),
      knowledgeBaseQueryKeys.document(knowledgeBaseId, documentId),
      knowledgeBaseQueryKeys.content(knowledgeBaseId, documentId),
      knowledgeBaseQueryKeys.grants(knowledgeBaseId),
      knowledgeBaseQueryKeys.citation("00000000-0000-4000-8000-000000000099"),
    ]) {
      expect(queryClient.getQueryData(key)).toBeUndefined()
    }
  })

  it("keeps an archived preview stream authorized so later access loss stays observable", async () => {
    const queryClient = createQueryClient()
    const archived = baseFixture({
      lifecycle_status: "archived",
      archived_at: "2026-07-22T02:00:00.000Z",
    })
    queryClient.setQueryData(
      knowledgeBaseQueryKeys.detail(knowledgeBaseId),
      archived
    )
    queryClient.setQueryData(
      knowledgeBaseQueryKeys.documents(knowledgeBaseId),
      {
        pages: [{ items: [documentFixture()], next_cursor: null }],
        pageParams: [undefined],
      }
    )
    getKnowledgeBase.mockResolvedValue(archived)
    const rendered = renderHook(
      () => useKnowledgeBaseEvents(knowledgeBaseId, true),
      { wrapper: wrapper(queryClient) }
    )
    await waitFor(() => expect(handlers?.shouldReconnect).toBeDefined())

    let reconnect = true
    await act(async () => {
      reconnect =
        (await handlers?.shouldReconnect?.(new AbortController().signal)) ??
        true
    })

    expect(reconnect).toBe(true)
    expect(rendered.result.current.connectionState).toBe("connected")
    expect(
      queryClient.getQueryData(knowledgeBaseQueryKeys.detail(knowledgeBaseId))
    ).toEqual(archived)
    expect(
      queryClient.getQueryData(
        knowledgeBaseQueryKeys.documents(knowledgeBaseId)
      )
    ).toBeDefined()
  })
})
