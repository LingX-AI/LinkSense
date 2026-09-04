import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query"
import type { ConversationOrderGroup } from "@linksense/shared"
import {
  BellIcon,
  BlocksIcon,
  BookOpenIcon,
  CalendarClockIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  LogOutIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  PanelLeftIcon,
  SearchIcon,
  Settings2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"

import { ApiError, apiRequest } from "@/api/client"
import {
  automationCompletionNotificationSchema,
  conversationOrderResultSchema,
  conversationSchema,
  paginatedSchema,
  type AutomationCompletionNotification,
  type Conversation,
  type Paginated,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ConversationSearchDialog } from "@/components/shell/conversation-search-dialog"
import { ConversationAutomationIcon } from "@/components/shell/conversation-automation-icon"
import { SidebarConversationActions } from "@/components/shell/sidebar-conversation-actions"
import { SidebarResizer } from "@/components/shell/sidebar-resizer"
import { conversationSettingsReturnState } from "@/components/shell/settings-return-navigation"
import {
  persistSidebarWidth,
  readStoredSidebarWidth,
} from "@/components/shell/sidebar-width"
import { SupportMenu } from "@/components/shell/support-menu"
import { ApplicationIconDisplay } from "@/features/applications/application-icon"
import { defaultApplicationIcon } from "@/features/applications/application-icon-default"
import { SystemUpdateNotice } from "@/features/admin/system-update"
import { ConversationRenameDialog } from "@/features/conversations/conversation-rename-dialog"
import {
  applySidebarConversationOrder,
  patchSidebarConversationExecutionStatus,
  sortSidebarConversations,
} from "@/features/conversations/conversation-order"
import {
  applyConversationExecutionTransition,
  getConversationExecutionTransition,
  isTerminalConversationExecutionStatus,
} from "@/features/conversations/conversation-execution-lifecycle"
import { conversationDetailQueryOptions } from "@/features/conversations/conversation-detail-query"
import {
  bindPendingConversationTurn,
  clearPendingConversationExecution,
  getPendingConversationExecution,
  usePendingConversationExecution,
} from "@/features/conversations/conversation-pending-execution"
import {
  clearPendingConversationTurnSubmission,
  getPendingConversationTurnSubmission,
  usePendingConversationTurnSubmission,
} from "@/features/conversations/conversation-pending-turn-submission"
import {
  conversationPath,
  isConversationPathActive,
  isInteractiveApplicationRunPath,
} from "@/features/conversations/conversation-navigation"
import {
  hasNativeReconnectFailure,
  useNativeReconnectStoreRevision,
} from "@/features/conversations/native-reconnect-simulation"
import { SortableConversationGroup } from "@/features/conversations/sortable-conversation-group"
import { useConversationEvents } from "@/features/conversations/use-conversation-events"
import { formatRelativeDate } from "@/i18n/date"
import { normalizeLanguage } from "@/i18n"
import { cn } from "@/lib/utils"

type NavItem = {
  to: string
  labelKey: string
  icon: typeof SearchIcon
  activeClassName: "sidebar-link-active" | "sidebar-link-current"
}

function formatTokenQuotaRemaining(
  period: { remaining_percentage: number } | null | undefined
) {
  return period ? `${period.remaining_percentage}%` : "-"
}

const userItems: NavItem[] = [
  {
    to: "/conversations/new",
    labelKey: "nav.newConversation",
    icon: MessageSquarePlusIcon,
    activeClassName: "sidebar-link-current",
  },
  {
    to: "/automations",
    labelKey: "nav.automations",
    icon: CalendarClockIcon,
    activeClassName: "sidebar-link-active",
  },
  {
    to: "/capabilities",
    labelKey: "nav.capabilities",
    icon: BlocksIcon,
    activeClassName: "sidebar-link-active",
  },
  {
    to: "/knowledge-bases",
    labelKey: "nav.knowledgeBases",
    icon: BookOpenIcon,
    activeClassName: "sidebar-link-active",
  },
]

const automationNotificationRefetchIntervalMs = 10_000

function BackgroundConversationExecutionEvents({
  conversationId,
}: {
  conversationId: string
}) {
  const queryClient = useQueryClient()
  const [observationReady, setObservationReady] = useState(false)
  useEffect(() => {
    // New-task promotion updates the optimistic sidebar row immediately before
    // navigation. Waiting one task prevents that row from being mistaken for a
    // background task during the brief route transition.
    const timer = window.setTimeout(() => setObservationReady(true), 0)
    return () => window.clearTimeout(timer)
  }, [])
  const conversationQuery = useQuery({
    ...conversationDetailQueryOptions(conversationId),
    enabled: observationReady,
  })
  // Keep the task event stream continuous while the active-page observer is
  // handed off to this background observer. Waiting for a refetch that was
  // already in flight before this component mounted can leave
  // `isFetchedAfterMount` false forever and permanently drop the completion
  // event. The cached detail still provides a safe replay cursor; exact turn
  // matching below rejects terminal events from older turns.
  const conversation = conversationQuery.data
  const pendingExecution = usePendingConversationExecution(conversationId)
  const pendingTurnSubmission =
    usePendingConversationTurnSubmission(conversationId)

  useEffect(() => {
    const status = conversation?.execution_status
    if (!status || status === "running") return
    if (pendingExecution || pendingTurnSubmission) {
      const pendingTurnId =
        pendingTurnSubmission?.turnId ?? pendingExecution?.turnId
      const pendingTurn = pendingTurnId
        ? conversation.turns?.find((turn) => turn.id === pendingTurnId)
        : undefined
      if (!pendingTurn || pendingTurn.status === "running") return
      clearPendingConversationExecution(queryClient, conversationId)
      clearPendingConversationTurnSubmission(queryClient, conversationId)
    }
    queryClient.setQueryData<
      InfiniteData<Paginated<Conversation>, string | undefined>
    >(["conversations", "sidebar"], (current) =>
      patchSidebarConversationExecutionStatus(
        current,
        conversationId,
        status,
        isTerminalConversationExecutionStatus(status)
          ? { hasUnreadCompletion: true }
          : undefined
      )
    )
  }, [
    conversation?.execution_status,
    conversation?.turns,
    conversationId,
    pendingExecution,
    pendingTurnSubmission,
    queryClient,
  ])

  useConversationEvents(
    conversation &&
      (conversation.execution_status === "running" ||
        pendingExecution ||
        pendingTurnSubmission)
      ? conversationId
      : undefined,
    useCallback(
      (event) => {
        const transition = getConversationExecutionTransition(event)
        if (!transition) return
        const terminal = isTerminalConversationExecutionStatus(
          transition.status
        )
        if (
          transition.status === "running" &&
          transition.turnId &&
          getPendingConversationExecution(queryClient, conversationId)
        ) {
          bindPendingConversationTurn(
            queryClient,
            conversationId,
            transition.turnId
          )
        }
        const currentPendingExecution = getPendingConversationExecution(
          queryClient,
          conversationId
        )
        const currentPendingTurnSubmission =
          getPendingConversationTurnSubmission(queryClient, conversationId)
        const pendingTurnId =
          currentPendingTurnSubmission?.turnId ??
          currentPendingExecution?.turnId
        if (
          terminal &&
          (currentPendingExecution || currentPendingTurnSubmission) &&
          (!pendingTurnId || pendingTurnId !== transition.turnId)
        ) {
          // A replayed terminal event for another turn must not stop the
          // pending submission currently represented by the sidebar. If the
          // receipt has not bound its turn yet, reconcile from persisted
          // detail rather than guessing that a replay belongs to it.
          if (!pendingTurnId) {
            void queryClient.invalidateQueries({
              queryKey: ["conversation", conversationId],
              exact: true,
            })
          }
          return
        }
        const currentConversation = queryClient.getQueryData<Conversation>([
          "conversation",
          conversationId,
        ])
        if (!currentConversation) return
        const transitionedConversation = applyConversationExecutionTransition(
          currentConversation,
          transition
        )
        // The detail boundary identifies the exact running turn. A replayed
        // terminal event for an older turn must not stop the current task. A
        // matching pending submission is newer than a lagging detail snapshot,
        // so its terminal event remains authoritative even when applying it
        // cannot mutate that older snapshot.
        if (
          terminal &&
          transitionedConversation === currentConversation &&
          !(
            (currentPendingExecution || currentPendingTurnSubmission) &&
            pendingTurnId === transition.turnId
          )
        )
          return
        queryClient.setQueryData<Conversation>(
          ["conversation", conversationId],
          transitionedConversation
        )
        queryClient.setQueryData<
          InfiniteData<Paginated<Conversation>, string | undefined>
        >(["conversations", "sidebar"], (current) =>
          patchSidebarConversationExecutionStatus(
            current,
            conversationId,
            transition.status,
            terminal ? { hasUnreadCompletion: true } : undefined
          )
        )
        if (terminal) {
          clearPendingConversationExecution(queryClient, conversationId)
          clearPendingConversationTurnSubmission(queryClient, conversationId)
          // Keep any inactive detail snapshot stale so opening the completed
          // task fetches its persisted final content, without polling it now.
          void queryClient.invalidateQueries({
            queryKey: ["conversation", conversationId],
            exact: true,
            refetchType: "none",
          })
        }
      },
      [conversationId, queryClient]
    ),
    conversation?.last_event_id
  )
  return null
}

function AppSidebarContent({
  onNavigate,
  onCollapse,
  observeBackgroundExecutions = false,
}: {
  onNavigate?: () => void
  onCollapse?: () => void
  observeBackgroundExecutions?: boolean
}) {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { user, signOut } = useAuth()
  const [searchOpen, setSearchOpen] = useState(false)
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false)
  const [signOutPending, setSignOutPending] = useState(false)
  const [conversationListScrolled, setConversationListScrolled] =
    useState(false)
  const [hoveredConversationId, setHoveredConversationId] = useState<string>()
  const [locallyReadConversationIds, setLocallyReadConversationIds] = useState(
    () => new Set<string>()
  )
  const completionReadInFlightIdsRef = useRef(new Set<string>())
  const [renameTarget, setRenameTarget] = useState<Conversation>()
  const [renameValue, setRenameValue] = useState("")
  const [actionError, setActionError] = useState<string>()
  const [unpinBlockedMessage, setUnpinBlockedMessage] = useState<string>()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const automationNotificationQueryKey = [
    "automations",
    "completion-notifications",
    user?.id,
  ] as const

  const conversationsQuery = useInfiniteQuery({
    queryKey: ["conversations", "sidebar"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiRequest("/conversations", {
        schema: paginatedSchema(conversationSchema),
        query: { archived: false, cursor: pageParam, limit: 100 },
        signal,
      }),
    getNextPageParam: (lastPage, _pages, _lastPageParam, allPageParams) => {
      const nextCursor = lastPage.next_cursor ?? undefined
      return nextCursor && !allPageParams.includes(nextCursor)
        ? nextCursor
        : undefined
    },
  })
  const automationNotificationsQuery = useQuery({
    queryKey: automationNotificationQueryKey,
    queryFn: ({ signal }) =>
      apiRequest("/automations/completion-notifications", {
        schema: automationCompletionNotificationSchema,
        signal,
      }),
    refetchInterval: automationNotificationRefetchIntervalMs,
  })
  const {
    data: conversationsData,
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
  } = conversationsQuery
  const conversations = useMemo(
    () => conversationsData?.pages.flatMap((page) => page.items) ?? [],
    [conversationsData]
  )
  const backgroundRunningConversationIds = useMemo(
    () =>
      conversations
        .filter(
          (conversation) =>
            conversation.execution_status === "running" &&
            !isConversationPathActive(location.pathname, conversation)
        )
        .map((conversation) => conversation.id),
    [conversations, location.pathname]
  )
  const pinnedConversations = useMemo(
    () =>
      sortSidebarConversations(
        conversations.filter((conversation) => Boolean(conversation.pinned_at)),
        "pinned"
      ),
    [conversations]
  )
  const recentConversations = useMemo(
    () =>
      sortSidebarConversations(
        conversations.filter((conversation) => !conversation.pinned_at),
        "recent"
      ),
    [conversations]
  )
  const nativeReconnectStoreRevision = useNativeReconnectStoreRevision()
  const reconnectFailedConversationIds = useMemo(() => {
    void nativeReconnectStoreRevision
    return new Set(
      conversations
        .filter((conversation) => hasNativeReconnectFailure(conversation.id))
        .map((conversation) => conversation.id)
    )
  }, [conversations, nativeReconnectStoreRevision])

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      apiRequest(`/conversations/${id}`, {
        method: "PATCH",
        body: { title },
        schema: conversationSchema,
      }),
    onMutate: () => setActionError(undefined),
    onSuccess: async (nextConversation) => {
      queryClient.setQueryData<Conversation>(
        ["conversation", nextConversation.id],
        (currentConversation) =>
          currentConversation
            ? { ...currentConversation, ...nextConversation }
            : nextConversation
      )
      setRenameTarget(undefined)
      setRenameValue("")
      await queryClient.invalidateQueries({ queryKey: ["conversations"] })
    },
    onError: (error) => setActionError(getErrorMessage(error, t)),
  })

  const markAutomationNotificationsReadMutation = useMutation({
    mutationFn: (through: string) =>
      apiRequest("/automations/completion-notifications/read", {
        method: "POST",
        body: { through },
        schema: automationCompletionNotificationSchema,
      }),
    onSuccess: (notification) => {
      queryClient.setQueryData<AutomationCompletionNotification>(
        automationNotificationQueryKey,
        notification
      )
    },
    onError: (error) => setActionError(getErrorMessage(error, t)),
  })

  const archiveMutation = useMutation({
    mutationFn: (conversation: Conversation) =>
      apiRequest(`/conversations/${conversation.id}`, {
        method: "PATCH",
        body: { archive_status: "archived" },
        schema: conversationSchema,
      }),
    onMutate: () => setActionError(undefined),
    onSuccess: (_nextConversation, archivedConversation) => {
      if (isConversationPathActive(location.pathname, archivedConversation)) {
        navigate("/conversations/new", { replace: true })
        onNavigate?.()
        queryClient.removeQueries({
          queryKey: ["conversation", archivedConversation.id],
          exact: true,
        })
      }
      void queryClient.invalidateQueries({ queryKey: ["conversations"] })
    },
    onError: (error) => setActionError(getErrorMessage(error, t)),
  })

  const pinMutation = useMutation({
    mutationFn: (conversation: Conversation) =>
      apiRequest(`/conversations/${conversation.id}`, {
        method: "PATCH",
        body: { pinned: !conversation.pinned_at },
        schema: conversationSchema,
      }),
    onMutate: () => {
      setActionError(undefined)
      setUnpinBlockedMessage(undefined)
    },
    onSuccess: async (nextConversation) => {
      queryClient.setQueryData<Conversation>(
        ["conversation", nextConversation.id],
        (currentConversation) =>
          currentConversation
            ? { ...currentConversation, ...nextConversation }
            : nextConversation
      )
      await queryClient.invalidateQueries({ queryKey: ["conversations"] })
    },
    onError: (error, conversation) => {
      const message = getErrorMessage(error, t)
      if (
        conversation.pinned_at &&
        error instanceof ApiError &&
        error.errorCode === "AUTOMATION_TASK_IN_USE"
      ) {
        setUnpinBlockedMessage(message)
        return
      }
      setActionError(message)
    },
  })

  const reorderMutation = useMutation({
    mutationFn: async ({
      group,
      conversationIds,
    }: {
      group: ConversationOrderGroup
      conversationIds: string[]
    }) => {
      const result = await apiRequest("/conversations/order", {
        method: "PUT",
        body: { group, conversation_ids: conversationIds },
        schema: conversationOrderResultSchema,
      })
      return result
    },
    onMutate: () => setActionError(undefined),
    onSuccess: (result) => {
      queryClient.setQueryData<
        InfiniteData<Paginated<Conversation>, string | undefined>
      >(["conversations", "sidebar"], (current) =>
        applySidebarConversationOrder(
          current,
          result.group,
          result.conversation_ids
        )
      )
    },
    onError: (error) => setActionError(getErrorMessage(error, t)),
  })

  const { mutate: persistCompletionRead } = useMutation({
    mutationFn: (conversation: Conversation) =>
      apiRequest(`/conversations/${conversation.id}`, {
        method: "PATCH",
        body: { completion_read: true },
        schema: conversationSchema,
      }),
    onMutate: (conversation) => {
      setActionError(undefined)
      setLocallyReadConversationIds((current) => {
        const next = new Set(current)
        next.add(conversation.id)
        return next
      })
    },
    onSuccess: async (nextConversation) => {
      completionReadInFlightIdsRef.current.delete(nextConversation.id)
      queryClient.setQueryData<Conversation>(
        ["conversation", nextConversation.id],
        (currentConversation) =>
          currentConversation
            ? { ...currentConversation, ...nextConversation }
            : nextConversation
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({
          queryKey: automationNotificationQueryKey,
          exact: true,
        }),
      ])
    },
    onError: (error, conversation) => {
      completionReadInFlightIdsRef.current.delete(conversation.id)
      setLocallyReadConversationIds((current) => {
        const next = new Set(current)
        next.delete(conversation.id)
        return next
      })
      setActionError(getErrorMessage(error, t))
    },
  })

  const markCompletionRead = useCallback(
    (conversation: Conversation) => {
      if (
        !conversation.has_unread_completion ||
        locallyReadConversationIds.has(conversation.id) ||
        completionReadInFlightIdsRef.current.has(conversation.id)
      ) {
        return
      }
      completionReadInFlightIdsRef.current.add(conversation.id)
      persistCompletionRead(conversation)
    },
    [locallyReadConversationIds, persistCompletionRead]
  )

  useEffect(() => {
    const activeConversation = conversations.find((conversation) =>
      isConversationPathActive(location.pathname, conversation)
    )
    if (activeConversation) markCompletionRead(activeConversation)
  }, [conversations, location.pathname, markCompletionRead])

  const openRenameDialog = (conversation: Conversation) => {
    if (conversation.application) return
    setActionError(undefined)
    setRenameValue(conversation.title || t("conversation.untitled"))
    setRenameTarget(conversation)
  }

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError) {
      return
    }
    void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage])

  const initials = useMemo(() => {
    const parts = user?.name.trim().split(/\s+/).filter(Boolean) ?? []
    return parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase()
      : (parts[0]?.slice(0, 2) ?? "LS").toUpperCase()
  }, [user?.name])
  const tokenQuotaRemainingLabel = t("nav.tokenQuotaRemaining", {
    total: formatTokenQuotaRemaining(user?.token_quota?.total),
    weekly: formatTokenQuotaRemaining(user?.token_quota?.weekly),
    monthly: formatTokenQuotaRemaining(user?.token_quota?.monthly),
  })
  const settingsReturnState = conversationSettingsReturnState(location)

  const handleSignOut = async () => {
    if (signOutPending) return
    setSignOutPending(true)
    try {
      await signOut()
      navigate("/login", { replace: true })
    } finally {
      setSignOutPending(false)
    }
  }

  const latestAutomationNotification =
    automationNotificationsQuery.data?.latest_unread
  const latestAutomationConversation = latestAutomationNotification
    ? conversations.find(
        (conversation) =>
          conversation.id === latestAutomationNotification.conversation_id
      )
    : undefined
  const visibleAutomationNotification =
    latestAutomationNotification &&
    (!latestAutomationConversation ||
      (latestAutomationConversation.has_unread_completion &&
        !locallyReadConversationIds.has(latestAutomationConversation.id)))
      ? latestAutomationNotification
      : null

  const handleOpenAutomationNotifications = () => {
    const latestUnread = visibleAutomationNotification
    if (!latestUnread) return

    if (!markAutomationNotificationsReadMutation.isPending) {
      markAutomationNotificationsReadMutation.mutate(latestUnread.completed_at)
    }
    const conversation = conversations.find(
      (item) => item.id === latestUnread.conversation_id
    )
    navigate(
      conversation
        ? conversationPath(conversation)
        : `/conversations/${latestUnread.conversation_id}`
    )
    onNavigate?.()
  }

  return (
    <>
      {observeBackgroundExecutions &&
        backgroundRunningConversationIds.map((conversationId) => (
          <BackgroundConversationExecutionEvents
            key={conversationId}
            conversationId={conversationId}
          />
        ))}
      <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 pt-3 pb-2">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-2">
          <ProductLogo
            productName={productName}
            className="sidebar-brand-logo min-w-0"
          />
          <div className="sidebar-header-actions -mr-1 flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="sidebar-nav-item border-0 bg-transparent shadow-none"
              aria-label={t("common.search")}
              onClick={() => {
                setSearchOpen(true)
              }}
            >
              <SearchIcon
                className="size-3.5"
                strokeWidth={2}
                aria-hidden="true"
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="sidebar-nav-item relative border-0 bg-transparent shadow-none"
              aria-label={t(
                visibleAutomationNotification
                  ? "nav.automationNotificationsUnread"
                  : "nav.automationNotifications"
              )}
              onClick={handleOpenAutomationNotifications}
            >
              <BellIcon
                className="size-3.5"
                strokeWidth={2}
                aria-hidden="true"
              />
              {visibleAutomationNotification && (
                <span
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-[var(--app-selection)] ring-1 ring-[var(--app-sidebar)]"
                  data-automation-unread-indicator
                  aria-hidden="true"
                />
              )}
            </Button>
            {onCollapse && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="sidebar-collapse-control sidebar-nav-item border-0 bg-transparent shadow-none"
                aria-label={t("nav.collapseSidebar")}
                aria-controls="app-sidebar"
                aria-expanded="true"
                onClick={onCollapse}
              >
                <PanelLeftIcon
                  className="size-3.5"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </Button>
            )}
          </div>
        </div>

        <nav
          aria-label={t("nav.navigationLabel", { productName })}
          className="sidebar-primary-navigation mt-2 shrink-0 space-y-0.5"
        >
          {userItems
            .slice(0, 1)
            .map(({ to, labelKey, icon: Icon, activeClassName }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn("sidebar-link font-medium", isActive && activeClassName)
                }
              >
                <Icon className="size-3.5" aria-hidden="true" />
                <span>{t(labelKey)}</span>
              </NavLink>
            ))}
        </nav>

        <div
          data-scrolled={conversationListScrolled ? "true" : undefined}
          className="sidebar-conversation-region -mr-3 flex min-h-[72px] flex-1 flex-col overflow-hidden"
        >
          <div
            className="sidebar-conversation-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-3.5"
            onScroll={(event) => {
              setConversationListScrolled(event.currentTarget.scrollTop > 0)
            }}
          >
            <nav
              aria-label={t("nav.navigationLabel", { productName })}
              className="space-y-0.5 pt-0.5"
            >
              {userItems
                .slice(1)
                .map(({ to, labelKey, icon: Icon, activeClassName }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "sidebar-link font-medium",
                        isActive && activeClassName
                      )
                    }
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    <span>{t(labelKey)}</span>
                  </NavLink>
                ))}
            </nav>
            {conversationsQuery.isLoading && (
              <p className="px-2.5 py-2 text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-medium text-[var(--app-muted)]">
                {t("common.loading")}
              </p>
            )}
            {conversationsQuery.isError && (
              <p className="px-2.5 py-2 text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-medium text-[var(--destructive)]">
                {t("conversation.unavailable")}
              </p>
            )}
            {actionError && !renameTarget && (
              <p
                role="alert"
                className="px-2.5 py-2 text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-medium text-[var(--destructive)]"
              >
                {actionError}
              </p>
            )}
            {[
              ...(pinnedConversations.length > 0
                ? [
                    {
                      key: "pinned",
                      label: t("nav.pinned"),
                      conversations: pinnedConversations,
                    },
                  ]
                : []),
              {
                key: "recent",
                label: t("nav.recent"),
                conversations: recentConversations,
              },
            ].map((group) => (
              <section
                key={group.key}
                aria-labelledby={`${group.key}-conversations-title`}
                className="space-y-0.5"
              >
                <h2
                  id={`${group.key}-conversations-title`}
                  className="px-2.5 pb-2 text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-semibold text-[var(--app-muted)]"
                >
                  {group.label}
                </h2>
                <SortableConversationGroup
                  conversations={group.conversations}
                  disabled={
                    Boolean(hasNextPage) ||
                    isFetchingNextPage ||
                    reorderMutation.isPending
                  }
                  onReorder={async (conversationIds) => {
                    await reorderMutation.mutateAsync({
                      group: group.key as ConversationOrderGroup,
                      conversationIds,
                    })
                  }}
                >
                  {(conversation, sortable) => {
                    const to = conversationPath(conversation)
                    const active = isConversationPathActive(
                      location.pathname,
                      conversation
                    )
                    const isConversationRunning =
                      conversation.execution_status === "running"
                    const hasUnreadResult =
                      conversation.has_unread_completion &&
                      !isConversationRunning &&
                      !active &&
                      !locallyReadConversationIds.has(conversation.id)
                    const hasUnreadFailure =
                      hasUnreadResult &&
                      conversation.execution_status === "failed"
                    const title =
                      conversation.title || t("conversation.untitled")
                    const pinned = Boolean(conversation.pinned_at)
                    const renameAllowed = !conversation.application
                    const reconnectFailed = reconnectFailedConversationIds.has(
                      conversation.id
                    )
                    const running = isConversationRunning && !reconnectFailed
                    const allowFocusActions =
                      hoveredConversationId === undefined ||
                      hoveredConversationId === conversation.id
                    const relativeUpdatedAt = formatRelativeDate(
                      conversation.updated_at,
                      language
                    )
                    return (
                      <div
                        ref={sortable.setNodeRef}
                        style={sortable.style}
                        data-dragging={sortable.isDragging || undefined}
                        data-running={running ? "true" : undefined}
                        data-warning={reconnectFailed ? "true" : undefined}
                        data-unread={hasUnreadResult ? "true" : undefined}
                        className={cn(
                          "sidebar-conversation-item group relative min-w-0 rounded-[10px]",
                          !sortable.sortingDisabled &&
                            "cursor-grab active:cursor-grabbing",
                          active && "sidebar-link-active",
                          sortable.isDragging && "opacity-60 shadow-sm"
                        )}
                        onPointerDown={sortable.onPointerDown}
                        onMouseEnter={() => {
                          setHoveredConversationId(conversation.id)
                        }}
                        onMouseLeave={() => {
                          setHoveredConversationId((current) =>
                            current === conversation.id ? undefined : current
                          )
                        }}
                      >
                        {sortable.keyboardActivator}
                        <HoverCard
                          onOpenChange={(_open, eventDetails) => {
                            if (
                              eventDetails.reason === "trigger-press" &&
                              eventDetails.event.detail !== 0
                            ) {
                              eventDetails.cancel()
                            }
                          }}
                        >
                          <HoverCardTrigger
                            nativeButton={false}
                            render={
                              <NavLink
                                to={to}
                                onClick={() => {
                                  markCompletionRead(conversation)
                                  onNavigate?.()
                                }}
                                onKeyDown={
                                  renameAllowed
                                    ? (event) => {
                                        if (event.key !== "F2") return
                                        event.preventDefault()
                                        openRenameDialog(conversation)
                                      }
                                    : undefined
                                }
                                aria-busy={running || undefined}
                                aria-current={active ? "page" : undefined}
                                aria-keyshortcuts={
                                  renameAllowed ? "F2" : undefined
                                }
                                className="sidebar-conversation-link min-h-9 py-2"
                              />
                            }
                          >
                            <ConversationAutomationIcon
                              hasAutomation={conversation.has_automation}
                            />
                            {conversation.application && (
                              <ApplicationIconDisplay
                                icon={
                                  conversation.application.icon ??
                                  defaultApplicationIcon
                                }
                                compact
                                className="sidebar-conversation-application-icon size-5 shrink-0"
                              />
                            )}
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              <span
                                className="sidebar-conversation-title-fade min-w-0 flex-1 text-[length:var(--app-ui-font-size)] font-medium"
                                onDoubleClick={
                                  renameAllowed
                                    ? (event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        openRenameDialog(conversation)
                                      }
                                    : undefined
                                }
                              >
                                {title}
                              </span>
                              {hasUnreadResult &&
                                (hasUnreadFailure ? (
                                  <span
                                    role="status"
                                    aria-label={t("nav.unreadFailure")}
                                    className="shrink-0 text-destructive"
                                  >
                                    <CircleAlertIcon
                                      aria-hidden="true"
                                      className="size-3.5"
                                    />
                                  </span>
                                ) : (
                                  <span
                                    role="status"
                                    aria-label={t("nav.unreadCompletion")}
                                    className="size-2 shrink-0 rounded-full bg-[var(--app-selection)]"
                                  />
                                ))}
                            </span>
                          </HoverCardTrigger>
                          <HoverCardContent
                            side="right"
                            sideOffset={2}
                            align="start"
                            aria-label={title}
                            className="sidebar-conversation-preview flex w-72 max-w-[calc(100vw-1rem)] flex-col items-stretch gap-2 shadow-md!"
                          >
                            <span className="sidebar-conversation-preview-title line-clamp-3 w-full min-w-0 text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-medium break-words whitespace-normal">
                              {title}
                            </span>
                            <time
                              dateTime={conversation.updated_at}
                              className="sidebar-conversation-preview-time block w-full text-left text-[length:var(--app-font-10-5)] leading-5 font-medium whitespace-nowrap text-[var(--app-muted)]"
                            >
                              {relativeUpdatedAt}
                            </time>
                          </HoverCardContent>
                        </HoverCard>
                        {running && (
                          <span
                            role="status"
                            aria-label={t("statuses.running")}
                            className={cn(
                              "sidebar-conversation-running pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center text-[var(--app-muted)] opacity-100 group-hover:opacity-0",
                              allowFocusActions &&
                                "group-focus-within:opacity-0"
                            )}
                          >
                            <LoaderCircleIcon
                              className="size-3.5 animate-spin motion-reduce:animate-none"
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          </span>
                        )}
                        {reconnectFailed && (
                          <span
                            role="img"
                            aria-label={t(
                              "conversation.streamDisconnectedWarning"
                            )}
                            className={cn(
                              "sidebar-conversation-warning pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center text-[var(--destructive)] opacity-100 group-hover:opacity-0",
                              allowFocusActions &&
                                "group-focus-within:opacity-0"
                            )}
                          >
                            <CircleAlertIcon
                              className="size-3.5"
                              strokeWidth={2.2}
                              aria-hidden="true"
                            />
                          </span>
                        )}
                        <SidebarConversationActions
                          title={title}
                          pinned={pinned}
                          pinDisabled={pinMutation.isPending}
                          archiveDisabled={archiveMutation.isPending}
                          focusActionsVisible={allowFocusActions}
                          onTogglePinned={() =>
                            pinMutation.mutate(conversation)
                          }
                          onArchive={() => archiveMutation.mutate(conversation)}
                        />
                      </div>
                    )
                  }}
                </SortableConversationGroup>
              </section>
            ))}
            {isFetchingNextPage && (
              <p className="px-2.5 py-2 text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-medium text-[var(--app-muted)]">
                {t("common.loading")}
              </p>
            )}
            {conversationsData && conversations.length === 0 && (
              <p className="px-2.5 py-2 text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-medium text-[var(--app-muted)]">
                {t("conversation.listEmpty")}
              </p>
            )}
          </div>
        </div>

        <div className="sidebar-account-bar mt-1 flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={user?.name}
                  className="sidebar-user-button h-auto min-w-0 flex-1 justify-start gap-2 border-0 px-2 py-1.5 text-left shadow-none"
                />
              }
            >
              <Avatar className="sidebar-account-avatar size-6 border-0">
                {user?.avatar_url && (
                  <AvatarImage src={user.avatar_url} alt="" />
                )}
                <AvatarFallback className="bg-transparent text-[length:var(--app-font-10)] font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-semibold">
                  {user?.name}
                </span>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={8}
              className="account-menu w-[calc(var(--anchor-width)+2.25rem)] max-w-[calc(100vw-24px)] border-0 p-1.5"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="account-menu-identity flex items-center gap-2.5 px-2 py-2 text-[var(--app-text)]">
                  <Avatar className="sidebar-account-avatar size-6 border-0">
                    {user?.avatar_url && (
                      <AvatarImage src={user.avatar_url} alt="" />
                    )}
                    <AvatarFallback className="bg-transparent text-[length:var(--app-font-10)] font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-semibold">
                    {user?.name}
                  </span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="account-menu-quota px-2 py-1.5 text-[length:var(--app-font-11)] leading-[var(--app-line-16)] font-medium text-[var(--app-muted)]">
                  {tokenQuotaRemainingLabel}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className="text-[length:var(--app-ui-font-size)]"
                  render={
                    <NavLink
                      to="/settings/general"
                      state={settingsReturnState}
                      onClick={onNavigate}
                    />
                  }
                >
                  <Settings2Icon className="size-3.5" aria-hidden="true" />
                  {t("common.settings")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-[length:var(--app-ui-font-size)]"
                onClick={() => setSignOutConfirmOpen(true)}
              >
                <LogOutIcon className="size-3.5" aria-hidden="true" />
                {t("common.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SupportMenu className="sidebar-help-button text-[var(--app-sidebar-muted)] hover:bg-[var(--app-sidebar-hover)] hover:text-[var(--app-text)]" />
        </div>
      </div>
      <ConversationSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onNavigate={onNavigate}
      />
      <ConversationRenameDialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (open) return
          setRenameTarget(undefined)
          setRenameValue("")
          setActionError(undefined)
        }}
        value={renameValue}
        onValueChange={setRenameValue}
        pending={renameMutation.isPending}
        error={renameTarget ? actionError : undefined}
        onSubmit={(title) => {
          if (renameTarget) {
            renameMutation.mutate({ id: renameTarget.id, title })
          }
        }}
      />
      <Dialog
        open={Boolean(unpinBlockedMessage)}
        onOpenChange={(open) => {
          if (!open) setUnpinBlockedMessage(undefined)
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("conversation.unpinBlockedTitle")}</DialogTitle>
            <DialogDescription>{unpinBlockedMessage}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t("common.gotIt")}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={signOutConfirmOpen}
        onOpenChange={(open) => {
          if (!signOutPending) setSignOutConfirmOpen(open)
        }}
        title={t("auth.signOutTitle")}
        description={t("auth.signOutDescription", { productName })}
        confirmLabel={t("common.signOut")}
        pending={signOutPending}
        onConfirm={() => void handleSignOut()}
      />
    </>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const productName = useProductName()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const usesCompactTopBar =
    location.pathname === "/conversations" ||
    location.pathname.startsWith("/conversations/") ||
    isInteractiveApplicationRunPath(location.pathname)
  const shellStyle = {
    "--app-sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties

  return (
    <div
      className="app-shell"
      data-sidebar-collapsed={sidebarCollapsed ? "true" : undefined}
      data-sidebar-resizing={sidebarResizing ? "true" : undefined}
      style={shellStyle}
    >
      <aside
        id="app-sidebar"
        className="app-sidebar hidden min-h-0 md:block"
        aria-label={t("nav.navigationLabel", { productName })}
        aria-hidden={sidebarCollapsed ? "true" : undefined}
        inert={sidebarCollapsed}
      >
        <AppSidebarContent
          observeBackgroundExecutions
          onCollapse={() => setSidebarCollapsed(true)}
        />
      </aside>
      {!sidebarCollapsed && (
        <SidebarResizer
          label={t("nav.resizeSidebar")}
          value={sidebarWidth}
          onResize={setSidebarWidth}
          onResizeStart={() => setSidebarResizing(true)}
          onResizeEnd={(width) => {
            setSidebarResizing(false)
            persistSidebarWidth(width)
          }}
        />
      )}
      <main
        className="app-main"
        data-compact-top-bar={usesCompactTopBar ? "true" : undefined}
        id="main-content"
      >
        {sidebarCollapsed && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="desktop-sidebar-trigger sidebar-collapse-control hidden border-0 bg-transparent shadow-none md:inline-flex"
            aria-label={t("nav.expandSidebar")}
            aria-controls="app-sidebar"
            aria-expanded="false"
            onClick={() => setSidebarCollapsed(false)}
          >
            <PanelLeftIcon strokeWidth={2} aria-hidden="true" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="mobile-shell-trigger md:hidden"
          aria-label={t("nav.open")}
          onClick={() => setMobileOpen(true)}
        >
          <MenuIcon aria-hidden="true" />
        </Button>
        <SystemUpdateNotice />
        <Outlet />
      </main>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          closeLabel={t("common.close")}
          closeButtonClassName="mobile-navigation-close"
          className="mobile-navigation-sheet w-[min(88vw,296px)] border-0 bg-[var(--app-sidebar)] p-0 ring-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{productName}</SheetTitle>
            <SheetDescription>
              {t("nav.navigationLabel", { productName })}
            </SheetDescription>
          </SheetHeader>
          <AppSidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
