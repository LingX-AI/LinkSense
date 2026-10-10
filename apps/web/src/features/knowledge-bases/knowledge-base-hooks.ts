import { useEffect, useEffectEvent, useRef, useState } from "react"
import {
  replaceEqualDeep,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query"

import { ApiError } from "@/api/client"
import {
  getKnowledgeBase,
  getKnowledgeBaseCreationCapability,
  getKnowledgeSearchCapability,
  getKnowledgeUploadLimits,
  getKnowledgeDocument,
  getKnowledgeDocumentContent,
  knowledgeBaseQueryKeys,
  listKnowledgeBaseEntries,
  listKnowledgeBases,
  listKnowledgeDocuments,
  listKnowledgeGrants,
  listKnowledgeShareTargets,
  type KnowledgeBaseListLifecycle,
  type KnowledgeBaseScope,
} from "@/features/knowledge-bases/knowledge-base-api"
import {
  type KnowledgeBaseEvent,
  type KnowledgeBaseCreationCapability,
  type KnowledgeBaseEntryPage,
  type KnowledgeDocument,
  type KnowledgeSearchCapability,
  type KnowledgeShareTarget,
} from "@/features/knowledge-bases/knowledge-base-contracts"
import { connectKnowledgeBaseEvents } from "@/features/knowledge-bases/knowledge-base-events"

type KnowledgeDocumentPage = {
  items: KnowledgeDocument[]
  next_cursor?: string | null
  has_processing_documents: boolean
}

const reconnectingDocumentRefetchIntervalMs = 5_000

export function useKnowledgeBaseList(
  filters: {
    lifecycle: KnowledgeBaseListLifecycle
    scope: KnowledgeBaseScope
    search: string
  },
  options: { enabled?: boolean } = {}
) {
  return useInfiniteQuery({
    queryKey: knowledgeBaseQueryKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listKnowledgeBases({ ...filters, cursor: pageParam, signal }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: options.enabled !== false,
  })
}

export function useKnowledgeUploadLimits(enabled = true) {
  return useQuery({
    queryKey: knowledgeBaseQueryKeys.config(),
    queryFn: ({ signal }) => getKnowledgeUploadLimits(signal),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function useKnowledgeSearchCapability(enabled = true) {
  const query = useQuery({
    queryKey: knowledgeBaseQueryKeys.searchCapability(),
    queryFn: ({ signal }) => getKnowledgeSearchCapability(signal),
    staleTime: (state) => knowledgeSearchCapabilityStaleTime(state.state.data),
    refetchInterval: (state) =>
      knowledgeSearchCapabilityRefetchInterval(state.state.data),
    refetchOnWindowFocus: true,
    enabled,
  })
  return {
    ...query,
    capability: resolveKnowledgeSearchCapability(
      query.data,
      query.isError || query.isRefetchError,
      query.errorUpdatedAt
    ),
  }
}

export function useKnowledgeBaseCreationCapability(enabled = true) {
  const forceRefresh = useRef(false)
  const query = useQuery({
    queryKey: knowledgeBaseQueryKeys.creationCapability(),
    queryFn: ({ signal }) => {
      const refresh = forceRefresh.current
      forceRefresh.current = false
      return getKnowledgeBaseCreationCapability({ refresh, signal })
    },
    staleTime: (state) =>
      knowledgeBaseCreationCapabilityStaleTime(state.state.data),
    refetchInterval: (state) =>
      knowledgeBaseCreationCapabilityRefetchInterval(state.state.data),
    refetchOnWindowFocus: true,
    enabled,
  })
  const requestFailed = query.isError || query.isRefetchError
  return {
    ...query,
    capability: requestFailed ? undefined : query.data,
    requestFailed,
    retry: () => {
      forceRefresh.current = true
      return query.refetch()
    },
  }
}

export function knowledgeBaseCreationCapabilityStaleTime(
  capability: KnowledgeBaseCreationCapability | undefined
): number {
  return capability?.status === "ready" ? 60_000 : 0
}

export function knowledgeBaseCreationCapabilityRefetchInterval(
  capability: KnowledgeBaseCreationCapability | undefined
): number | false {
  return capability?.status === "ready" ||
    capability?.status === "not_installed"
    ? false
    : 10_000
}

export function knowledgeSearchCapabilityStaleTime(
  capability: KnowledgeSearchCapability | undefined
): number {
  return capability?.status === "available" ? 5 * 60_000 : 0
}

export function knowledgeSearchCapabilityRefetchInterval(
  capability: KnowledgeSearchCapability | undefined
): number | false {
  return capability?.status === "available" ||
    capability?.status === "not_installed"
    ? false
    : 10_000
}

export function resolveKnowledgeSearchCapability(
  capability: KnowledgeSearchCapability | undefined,
  requestFailed: boolean,
  checkedAtMs: number
): KnowledgeSearchCapability | undefined {
  if (!requestFailed) return capability
  return {
    status: "unavailable",
    reason_code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
    checked_at: new Date(checkedAtMs).toISOString(),
  }
}

export function useKnowledgeBaseDetail(knowledgeBaseId: string | undefined) {
  return useQuery({
    queryKey: knowledgeBaseQueryKeys.detail(knowledgeBaseId ?? ""),
    queryFn: ({ signal }) => getKnowledgeBase(knowledgeBaseId ?? "", signal),
    enabled: Boolean(knowledgeBaseId),
  })
}

export function useKnowledgeDocuments(
  knowledgeBaseId: string | undefined,
  options: { polling?: boolean; enabled?: boolean } = {}
) {
  return useInfiniteQuery({
    queryKey: knowledgeBaseQueryKeys.documents(knowledgeBaseId ?? ""),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listKnowledgeDocuments(knowledgeBaseId ?? "", {
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(knowledgeBaseId) && options.enabled !== false,
    refetchInterval: (query) =>
      knowledgeDocumentRefetchInterval(query.state.data, options.polling),
    structuralSharing: (current, incoming) =>
      reconcileKnowledgeDocumentPages(
        current as InfiniteData<KnowledgeDocumentPage> | undefined,
        incoming as InfiniteData<KnowledgeDocumentPage>
      ),
  })
}

export function hasActiveKnowledgeDocumentProcessing(
  data: InfiniteData<KnowledgeDocumentPage> | undefined
): boolean {
  return Boolean(
    data?.pages.some(
      (page) =>
        page.has_processing_documents ||
        page.items.some(
          (document) =>
            document.status === "processing" || document.processing !== null
        )
    )
  )
}

export function knowledgeDocumentRefetchInterval(
  data: InfiniteData<KnowledgeDocumentPage> | undefined,
  polling = false
): number | false {
  if (!polling) return false
  if (data === undefined || hasActiveKnowledgeDocumentProcessing(data)) {
    return reconnectingDocumentRefetchIntervalMs
  }
  return false
}

export function useKnowledgeBaseEntries(
  knowledgeBaseId: string | undefined,
  parentEntryId?: string,
  options: {
    enabled?: boolean
    view?: "directory" | "flat"
  } = {}
) {
  const view = options.view ?? "directory"
  return useInfiniteQuery({
    queryKey: knowledgeBaseQueryKeys.entryDirectory(
      knowledgeBaseId ?? "",
      parentEntryId,
      view
    ),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listKnowledgeBaseEntries(knowledgeBaseId ?? "", {
        parentEntryId,
        view,
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage: KnowledgeBaseEntryPage) =>
      lastPage.next_cursor ?? undefined,
    enabled: Boolean(knowledgeBaseId) && options.enabled !== false,
  })
}

export function useKnowledgeDocument(
  knowledgeBaseId: string | undefined,
  documentId: string | undefined,
  documentVersionId?: string
) {
  return useQuery({
    queryKey: knowledgeBaseQueryKeys.document(
      knowledgeBaseId ?? "",
      documentId ?? "",
      documentVersionId
    ),
    queryFn: ({ signal }) =>
      getKnowledgeDocument(
        knowledgeBaseId ?? "",
        documentId ?? "",
        documentVersionId,
        signal
      ),
    enabled: Boolean(knowledgeBaseId && documentId),
  })
}

export function useKnowledgeDocumentContent(
  knowledgeBaseId: string | undefined,
  documentId: string | undefined,
  enabled: boolean,
  documentVersionId?: string
) {
  return useQuery({
    queryKey: knowledgeBaseQueryKeys.content(
      knowledgeBaseId ?? "",
      documentId ?? "",
      documentVersionId
    ),
    queryFn: ({ signal }) =>
      getKnowledgeDocumentContent(
        knowledgeBaseId ?? "",
        documentId ?? "",
        documentVersionId,
        signal
      ),
    enabled: Boolean(knowledgeBaseId && documentId && enabled),
  })
}

export function useKnowledgeGrants(
  knowledgeBaseId: string | undefined,
  enabled: boolean
) {
  return useInfiniteQuery({
    queryKey: knowledgeBaseQueryKeys.grants(knowledgeBaseId ?? ""),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listKnowledgeGrants(knowledgeBaseId ?? "", {
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(knowledgeBaseId && enabled),
  })
}

export function useKnowledgeShareTargets(
  knowledgeBaseId: string,
  type: KnowledgeShareTarget["type"],
  search: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: knowledgeBaseQueryKeys.shareTargets(
      knowledgeBaseId,
      type,
      search
    ),
    queryFn: ({ signal }) =>
      listKnowledgeShareTargets({ knowledgeBaseId, type, search, signal }),
    enabled,
  })
}

export function useKnowledgeBaseEvents(
  knowledgeBaseId: string | undefined,
  enabled: boolean
) {
  const queryClient = useQueryClient()
  const [connectionState, setConnectionState] = useState<
    "connected" | "reconnecting" | "stopped" | "access_lost"
  >("connected")
  const [hasConnected, setHasConnected] = useState(false)
  const reconcilingRef = useRef(false)
  const reconciliationGenerationRef = useRef(0)
  const bufferedEventsRef = useRef(new Map<string, KnowledgeBaseEvent>())
  const applyDocumentEvent = useEffectEvent((event: KnowledgeBaseEvent) => {
    const hasActiveProcessing = isActiveKnowledgeDocumentProcessingEvent(event)
    let needsReconciliation =
      !hasActiveProcessing || event.stable_error_code !== null
    queryClient.setQueryData<InfiniteData<KnowledgeDocumentPage>>(
      knowledgeBaseQueryKeys.documents(event.knowledge_base_id),
      (current) => {
        if (
          hasActiveProcessing &&
          !current?.pages.some((page) =>
            page.items.some(
              (document) =>
                document.id === event.document_id &&
                document.processing !== null
            )
          )
        ) {
          needsReconciliation = true
        }
        return applyKnowledgeBaseEvent(current, event)
      }
    )
    queryClient.setQueryData<KnowledgeDocument>(
      knowledgeBaseQueryKeys.document(
        event.knowledge_base_id,
        event.document_id
      ),
      (current) => (current ? applyEventToDocument(current, event) : current)
    )
    queryClient.setQueriesData<InfiniteData<KnowledgeBaseEntryPage>>(
      { queryKey: knowledgeBaseQueryKeys.entries(event.knowledge_base_id) },
      (current) => applyKnowledgeBaseEntryEvent(current, event)
    )
    if (needsReconciliation) {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: knowledgeBaseQueryKeys.detail(event.knowledge_base_id),
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeBaseQueryKeys.documents(event.knowledge_base_id),
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeBaseQueryKeys.entries(event.knowledge_base_id),
        }),
      ])
    }
  })
  const updateDocument = useEffectEvent((event: KnowledgeBaseEvent) => {
    if (reconcilingRef.current) {
      const buffered = bufferedEventsRef.current.get(event.document_id)
      if (!buffered || buffered.revision < event.revision) {
        bufferedEventsRef.current.set(event.document_id, event)
      }
      return
    }
    applyDocumentEvent(event)
  })
  const reconcileSnapshot = useEffectEvent(async () => {
    if (!knowledgeBaseId) return
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: knowledgeBaseQueryKeys.detail(knowledgeBaseId),
      }),
      queryClient.invalidateQueries({
        queryKey: knowledgeBaseQueryKeys.documents(knowledgeBaseId),
      }),
      queryClient.invalidateQueries({
        queryKey: knowledgeBaseQueryKeys.entries(knowledgeBaseId),
      }),
    ])
  })
  const stopForCurrentAccess = useEffectEvent(
    async (signal: AbortSignal): Promise<boolean> => {
      if (!knowledgeBaseId || signal.aborted) return false
      try {
        const knowledgeBase = await getKnowledgeBase(knowledgeBaseId, signal)
        if (
          (knowledgeBase.lifecycle_status === "active" ||
            knowledgeBase.lifecycle_status === "archived") &&
          knowledgeBase.availability_status === "enabled" &&
          knowledgeBase.permissions.view_content
        ) {
          return true
        }
        queryClient.setQueryData(
          knowledgeBaseQueryKeys.detail(knowledgeBaseId),
          knowledgeBase
        )
        clearKnowledgeBaseContentQueries(queryClient, knowledgeBaseId)
        reconciliationGenerationRef.current += 1
        reconcilingRef.current = false
        bufferedEventsRef.current.clear()
        void queryClient.invalidateQueries({
          queryKey: knowledgeBaseQueryKeys.lists(),
        })
        setConnectionState("stopped")
        return false
      } catch (error) {
        if (signal.aborted) return false
        if (
          error instanceof ApiError &&
          (error.status === 401 ||
            error.status === 403 ||
            error.status === 404 ||
            error.status === 410)
        ) {
          clearKnowledgeBaseQueries(queryClient, knowledgeBaseId)
          reconciliationGenerationRef.current += 1
          reconcilingRef.current = false
          bufferedEventsRef.current.clear()
          void queryClient.invalidateQueries({
            queryKey: knowledgeBaseQueryKeys.lists(),
          })
          setConnectionState("access_lost")
          return false
        }
        return true
      }
    }
  )

  useEffect(() => {
    if (!knowledgeBaseId || !enabled) return
    let disposed = false
    const bufferedEvents = bufferedEventsRef.current
    const disconnect = connectKnowledgeBaseEvents(knowledgeBaseId, {
      onEvent: updateDocument,
      shouldReconnect: stopForCurrentAccess,
      onConnectionChange: (nextState) => {
        if (nextState === "connected") {
          const reconciliationGeneration =
            reconciliationGenerationRef.current + 1
          reconciliationGenerationRef.current = reconciliationGeneration
          reconcilingRef.current = true
          void reconcileSnapshot().finally(() => {
            if (
              disposed ||
              reconciliationGenerationRef.current !== reconciliationGeneration
            ) {
              return
            }
            reconcilingRef.current = false
            const bufferedEvents = [...bufferedEventsRef.current.values()].sort(
              (left, right) => left.revision - right.revision
            )
            bufferedEventsRef.current.clear()
            for (const event of bufferedEvents) applyDocumentEvent(event)
            setConnectionState("connected")
            setHasConnected(true)
          })
        } else {
          setConnectionState("reconnecting")
        }
      },
    })
    return () => {
      disposed = true
      reconciliationGenerationRef.current += 1
      reconcilingRef.current = false
      bufferedEvents.clear()
      disconnect()
    }
  }, [enabled, knowledgeBaseId])

  return { connectionState, hasConnected }
}

function clearKnowledgeBaseContentQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  knowledgeBaseId: string
) {
  queryClient.removeQueries({
    predicate: (query) => {
      const [scope, resource, queryKnowledgeBaseId] = query.queryKey
      return (
        scope === "knowledge-bases" &&
        queryKnowledgeBaseId === knowledgeBaseId &&
        (resource === "documents" ||
          resource === "entries" ||
          resource === "document" ||
          resource === "content" ||
          resource === "grants")
      )
    },
  })
  clearKnowledgeCitationQueries(queryClient)
}

function clearKnowledgeBaseQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  knowledgeBaseId: string
) {
  queryClient.removeQueries({
    predicate: (query) => {
      const [scope, resource, queryKnowledgeBaseId] = query.queryKey
      return (
        scope === "knowledge-bases" &&
        queryKnowledgeBaseId === knowledgeBaseId &&
        (resource === "detail" ||
          resource === "documents" ||
          resource === "entries" ||
          resource === "document" ||
          resource === "content" ||
          resource === "grants")
      )
    },
  })
  clearKnowledgeCitationQueries(queryClient)
}

function clearKnowledgeCitationQueries(
  queryClient: ReturnType<typeof useQueryClient>
) {
  // Citation previews intentionally omit source ids. Clearing every citation
  // body is the only safe client-side response to an authoritative knowledge
  // access-loss signal.
  queryClient.removeQueries({ queryKey: ["knowledge-citations"] })
}

export function applyKnowledgeBaseEvent(
  current: InfiniteData<KnowledgeDocumentPage> | undefined,
  event: KnowledgeBaseEvent
) {
  if (!current) return current
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      items:
        event.type === "knowledge_document_deleted" ||
        event.status === "deleted"
          ? page.items.filter((document) => document.id !== event.document_id)
          : page.items.map((document) =>
              document.id === event.document_id
                ? applyEventToDocument(document, event)
                : document
            ),
    })),
  }
}

export function applyKnowledgeBaseEntryEvent(
  current: InfiniteData<KnowledgeBaseEntryPage> | undefined,
  event: KnowledgeBaseEvent
) {
  if (!current) return current
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((entry) => {
        if (
          entry.entry_type !== "document" ||
          entry.document.id !== event.document_id
        ) {
          return [entry]
        }
        if (
          event.type === "knowledge_document_deleted" ||
          event.status === "deleted"
        ) {
          return []
        }
        return [
          {
            ...entry,
            document: applyEventToDocument(entry.document, event),
          },
        ]
      }),
    })),
  }
}

export function reconcileKnowledgeDocumentPages(
  current: InfiniteData<KnowledgeDocumentPage> | undefined,
  incoming: InfiniteData<KnowledgeDocumentPage>
): InfiniteData<KnowledgeDocumentPage> {
  if (!current) return incoming

  const currentDocuments = new Map(
    current.pages.flatMap((page) =>
      page.items.map((document) => [document.id, document] as const)
    )
  )
  const reconciled = {
    ...incoming,
    pages: incoming.pages.map((page) => ({
      ...page,
      items: page.items.map((document) => {
        const currentDocument = currentDocuments.get(document.id)
        if (!currentDocument) return document
        return reconcileKnowledgeDocumentSnapshot(currentDocument, document)
      }),
    })),
  }

  return replaceEqualDeep(current, reconciled)
}

function reconcileKnowledgeDocumentSnapshot(
  current: KnowledgeDocument,
  incoming: KnowledgeDocument
): KnowledgeDocument {
  const currentProcessing = current.processing
  const incomingProcessing = incoming.processing
  if (
    !currentProcessing ||
    !incomingProcessing ||
    currentProcessing.processing_generation !==
      incomingProcessing.processing_generation
  ) {
    return incoming
  }

  const currentRevision = current.event_revision ?? currentProcessing.revision
  if (incomingProcessing.revision > currentRevision) return incoming

  return replaceEqualDeep(current, {
    ...incoming,
    status: current.status,
    processing: currentProcessing,
    searchable: current.searchable,
    rebuild_required: current.rebuild_required,
    candidate_failure: current.candidate_failure,
    updated_at:
      incomingProcessing.revision === currentRevision
        ? incoming.updated_at
        : current.updated_at,
    event_revision: current.event_revision,
  })
}

export function applyEventToDocument(
  document: KnowledgeDocument,
  event: KnowledgeBaseEvent
) {
  const currentRevision =
    document.event_revision ?? document.processing?.revision ?? -1
  if (event.revision <= currentRevision) return document

  const generationChanged = Boolean(
    event.processing_generation &&
    document.processing?.processing_generation &&
    event.processing_generation !== document.processing.processing_generation
  )

  const processing =
    event.status === "deleted" ||
    (event.status === "ready" &&
      !isActiveKnowledgeDocumentProcessingEvent(event))
      ? null
      : document.processing
        ? {
            ...document.processing,
            processing_generation:
              event.processing_generation ??
              document.processing.processing_generation,
            stage: event.stage ?? document.processing.stage,
            progress_percent:
              event.progress_percent === null
                ? document.processing.progress_percent
                : generationChanged
                  ? event.progress_percent
                  : Math.max(
                      document.processing.progress_percent,
                      event.progress_percent
                    ),
            revision: event.revision,
            stable_error_code: event.stable_error_code ?? null,
            retry_at: event.retry_at ?? null,
            retry_attempt: event.retry_attempt,
          }
        : null

  return {
    ...document,
    status: event.status,
    processing,
    event_revision: event.revision,
    searchable: event.status === "deleted" ? false : document.searchable,
    rebuild_required:
      event.status === "deleted" ? false : document.rebuild_required,
    updated_at: event.updated_at,
  }
}

function isActiveKnowledgeDocumentProcessingEvent(
  event: KnowledgeBaseEvent
): boolean {
  // The current version stays ready while a replacement or rebuild is running.
  return (
    event.status !== "deleted" &&
    event.status !== "failed" &&
    event.stage !== null &&
    event.stage !== "completed" &&
    event.stage !== "failed"
  )
}
