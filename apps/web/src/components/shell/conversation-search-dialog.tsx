import type { ReactNode } from "react"
import { useDeferredValue, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BookOpenIcon, LoaderCircleIcon, MessageSquareIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router-dom"

import { apiRequest } from "@/api/client"
import {
  capabilitySummarySchema,
  conversationSchema,
  paginatedSchema,
  type CapabilitySummary,
  type Conversation,
} from "@/api/contracts"
import { useProductName } from "@/app/product-branding"
import { CapabilityIcon } from "@/components/capabilities/capability-icon"
import { ConversationDevelopmentIcon } from "@/components/shell/conversation-development-icon"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { capabilityPresentation } from "@/features/capabilities/built-in-presentation"
import { capabilityCenterPath } from "@/features/capabilities/capability-center-navigation"
import { conversationPath } from "@/features/conversations/conversation-navigation"
import { listKnowledgeBases } from "@/features/knowledge-bases/knowledge-base-api"
import type { KnowledgeBase } from "@/features/knowledge-bases/knowledge-base-contracts"
import {
  getTaskArtifacts,
  type TaskArtifact,
} from "@/features/task-artifacts/task-artifact-api"
import { normalizeLanguage } from "@/i18n"
import { formatFileSize, formatRelativeDate } from "@/i18n/date"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"

type GlobalSearchResults = {
  conversations: Conversation[]
  knowledgeBases: KnowledgeBase[]
  artifacts: TaskArtifact[]
  plugins: CapabilitySummary[]
  skills: CapabilitySummary[]
}

const searchResultLimit = 6
const searchResultItemClassName =
  "conversation-search-result min-h-8 gap-3 rounded-xl! px-2 py-1.5 text-[length:var(--app-ui-font-size)] data-selected:bg-[color-mix(in_srgb,var(--app-hover)_64%,var(--app-popover))]"
const searchResultLineIconClassName =
  "ml-3 size-3.5 shrink-0 text-[var(--app-muted)] opacity-60"
const searchResultMediaIconClassName = "ml-3 size-4 shrink-0 opacity-70"
const searchResultCapabilityIconClassName =
  "ml-3 size-4 shrink-0 rounded-[6px] opacity-70"

export function ConversationSearchDialog({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate?: () => void
}) {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const location = useLocation()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const deferredQuery = useDeferredValue(query.trim())
  const archived = location.pathname.startsWith("/archived")
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"

  const results = useQuery({
    queryKey: ["global-search", archived, deferredQuery],
    enabled: open,
    queryFn: ({ signal }) =>
      getGlobalSearchResults({
        archived,
        search: deferredQuery,
        signal,
      }),
  })

  const hasResults =
    (results.data?.conversations.length ?? 0) > 0 ||
    (results.data?.knowledgeBases.length ?? 0) > 0 ||
    (results.data?.artifacts.length ?? 0) > 0 ||
    (results.data?.plugins.length ?? 0) > 0 ||
    (results.data?.skills.length ?? 0) > 0

  const closeSearch = () => {
    onOpenChange(false)
    setQuery("")
    onNavigate?.()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) setQuery("")
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("conversation.searchTitle")}
      description={t("conversation.searchPlaceholder")}
      initialFocus={() =>
        shouldAutoFocusOnDesktop() ? searchInputRef.current : false
      }
      className="conversation-search-dialog top-1/2 max-h-[calc(100svh_-_2rem)] w-[calc(100%_-_1.5rem)] max-w-[640px]! -translate-y-1/2 gap-0 rounded-[20px]! border-0 bg-[var(--app-popover)] p-0 shadow-[0_22px_64px_rgb(0_0_0/18%)] ring-0"
    >
      <Command
        shouldFilter={false}
        className="conversation-search-command rounded-[20px] bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:px-5 [&_[data-slot=command-input-wrapper]]:pt-4 [&_[data-slot=command-input-wrapper]]:pb-3 [&_[data-slot=input-group-addon]]:hidden [&_[data-slot=input-group]]:h-10! [&_[data-slot=input-group]]:rounded-none! [&_[data-slot=input-group]]:border-transparent! [&_[data-slot=input-group]]:bg-transparent! [&_[data-slot=input-group]]:shadow-none!"
      >
        <CommandInput
          ref={searchInputRef}
          value={query}
          onValueChange={setQuery}
          placeholder={t("conversation.searchPlaceholder")}
          className="text-[length:var(--app-font-15)] font-medium placeholder:text-[var(--app-muted)]"
        />
        <CommandList className="h-[min(76svh,34rem)] max-h-[min(76svh,34rem)]! px-3 pb-4">
          {results.isLoading && (
            <div
              className="flex min-h-20 items-center justify-center gap-2 px-3 text-[length:var(--app-font-12)] text-[var(--app-muted)]"
              role="status"
            >
              <LoaderCircleIcon
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
              {t("common.loading")}
            </div>
          )}
          {results.isError && (
            <p
              className="min-h-20 px-3 py-6 text-center text-[length:var(--app-font-12)] text-[var(--destructive)]"
              role="alert"
            >
              {t("conversation.unavailable")}
            </p>
          )}
          {!results.isLoading && !results.isError && !hasResults && (
            <CommandEmpty className="min-h-20 py-6 text-[length:var(--app-font-12)] text-[var(--app-muted)]">
              {t("conversation.searchEmpty")}
            </CommandEmpty>
          )}
          {!results.isLoading && !results.isError && results.data && (
            <>
              {results.data.conversations.length > 0 && (
                <SearchResultGroup heading={t("conversation.title")}>
                  {results.data.conversations.map((conversation) => (
                    <CommandItem
                      key={`conversation:${conversation.id}`}
                      value={`conversation:${conversation.id}`}
                      className={searchResultItemClassName}
                      onSelect={() => {
                        navigate(conversationPath(conversation))
                        closeSearch()
                      }}
                    >
                      {conversation.application_development_role ? (
                        <ConversationDevelopmentIcon
                          role={conversation.application_development_role}
                          className={searchResultLineIconClassName}
                        />
                      ) : (
                        <MessageSquareIcon
                          className={searchResultLineIconClassName}
                          aria-hidden="true"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {conversation.title || t("conversation.untitled")}
                      </span>
                      <CommandShortcut className="shrink-0 text-[length:var(--app-font-12)] font-normal tracking-normal text-[var(--app-muted)] max-sm:hidden">
                        <time dateTime={conversation.updated_at}>
                          {formatRelativeDate(
                            conversation.updated_at,
                            language
                          )}
                        </time>
                      </CommandShortcut>
                    </CommandItem>
                  ))}
                </SearchResultGroup>
              )}

              {results.data.knowledgeBases.length > 0 && (
                <SearchResultGroup heading={t("library.tabs.knowledge")}>
                  {results.data.knowledgeBases.map((knowledgeBase) => {
                    const supportingText =
                      knowledgeBase.description ||
                      t(
                        knowledgeBase.is_owner
                          ? "knowledge.ownerNamedSelf"
                          : "knowledge.ownerNamed",
                        { name: knowledgeBase.owner.name }
                      )

                    return (
                      <CommandItem
                        key={`knowledge-base:${knowledgeBase.id}`}
                        value={`knowledge-base:${knowledgeBase.id}`}
                        className={searchResultItemClassName}
                        onSelect={() => {
                          navigate(`/knowledge-bases/${knowledgeBase.id}`)
                          closeSearch()
                        }}
                      >
                        <BookOpenIcon
                          className={searchResultLineIconClassName}
                          aria-hidden="true"
                        />
                        <span className="flex min-w-0 flex-1 items-baseline gap-2">
                          <span className="max-w-[52%] shrink-0 truncate font-medium">
                            {knowledgeBase.name}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-12)] leading-[var(--app-line-16)] text-[var(--app-muted)]">
                            {supportingText}
                          </span>
                        </span>
                        <CommandShortcut className="shrink-0 text-[length:var(--app-font-12)] font-normal tracking-normal text-[var(--app-muted)] max-sm:hidden">
                          {t("knowledge.documentCount", {
                            count: knowledgeBase.document_count,
                          })}
                        </CommandShortcut>
                      </CommandItem>
                    )
                  })}
                </SearchResultGroup>
              )}

              {results.data.artifacts.length > 0 && (
                <SearchResultGroup heading={t("library.tabs.artifacts")}>
                  {results.data.artifacts.map((artifact) => (
                    <CommandItem
                      key={`artifact:${artifact.id}`}
                      value={`artifact:${artifact.id}`}
                      className={searchResultItemClassName}
                      onSelect={() => {
                        const parameters = new URLSearchParams({
                          tab: "artifacts",
                          search: artifact.filename,
                        })
                        navigate(`/knowledge-bases?${parameters.toString()}`)
                        closeSearch()
                      }}
                    >
                      <FileTypeIcon
                        filename={artifact.filename}
                        mimeType={artifact.mime_type}
                        className={searchResultMediaIconClassName}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {artifact.filename}
                        </span>
                        <span className="mt-0.5 block truncate text-[length:var(--app-font-12)] leading-[var(--app-line-16)] text-[var(--app-muted)]">
                          {artifact.task.title}
                        </span>
                      </span>
                      <CommandShortcut className="shrink-0 text-[length:var(--app-font-12)] font-normal tracking-normal text-[var(--app-muted)] max-sm:hidden">
                        {formatFileSize(artifact.size, language)}
                      </CommandShortcut>
                    </CommandItem>
                  ))}
                </SearchResultGroup>
              )}

              {results.data.plugins.length > 0 && (
                <CapabilitySearchResultGroup
                  heading={t("marketplace.catalogTabs.plugin")}
                  capabilities={results.data.plugins}
                  type="plugin"
                  search={deferredQuery}
                  productName={productName}
                  onSelect={(path) => {
                    navigate(path)
                    closeSearch()
                  }}
                />
              )}

              {results.data.skills.length > 0 && (
                <CapabilitySearchResultGroup
                  heading={t("marketplace.catalogTabs.skill")}
                  capabilities={results.data.skills}
                  type="skill"
                  search={deferredQuery}
                  productName={productName}
                  onSelect={(path) => {
                    navigate(path)
                    closeSearch()
                  }}
                />
              )}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function SearchResultGroup({
  heading,
  children,
}: {
  heading: string
  children: ReactNode
}) {
  return (
    <CommandGroup
      heading={heading}
      className="p-0 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-[length:var(--app-font-12)] **:[[cmdk-group-heading]]:font-semibold"
    >
      {children}
    </CommandGroup>
  )
}

function CapabilitySearchResultGroup({
  heading,
  capabilities,
  type,
  search,
  productName,
  onSelect,
}: {
  heading: string
  capabilities: CapabilitySummary[]
  type: CapabilitySummary["type"]
  search: string
  productName: string
  onSelect: (path: string) => void
}) {
  const { t } = useTranslation()

  return (
    <SearchResultGroup heading={heading}>
      {capabilities.map((capability) => {
        const presentation = capabilityPresentation(capability, t, productName)
        const sourceLabel = capability.is_builtin
          ? t("capability.builtIn")
          : capability.source_type === "marketplace"
            ? t("marketplace.storeOrigin")
            : capability.source_type === "clawhub"
              ? t("clawHub.origin")
              : t(`capability.sourceTypes.${capability.source_type}`)
        const target = capabilityCenterPath({
          section: type,
          scope: "personal",
          search: search || presentation.name,
        })

        return (
          <CommandItem
            key={`${type}:${capability.id}`}
            value={`${type}:${capability.id}`}
            className={searchResultItemClassName}
            onSelect={() => onSelect(target)}
          >
            <CapabilityIcon
              type={capability.type}
              logoUrl={capability.logo_url}
              className={searchResultCapabilityIconClassName}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {presentation.name}
              </span>
              {presentation.description && (
                <span className="mt-0.5 block truncate text-[length:var(--app-font-12)] leading-[var(--app-line-16)] text-[var(--app-muted)]">
                  {presentation.description}
                </span>
              )}
            </span>
            <CommandShortcut className="shrink-0 text-[length:var(--app-font-12)] font-normal tracking-normal text-[var(--app-muted)] max-sm:hidden">
              {sourceLabel}
            </CommandShortcut>
          </CommandItem>
        )
      })}
    </SearchResultGroup>
  )
}

async function getGlobalSearchResults({
  archived,
  search,
  signal,
}: {
  archived: boolean
  search: string
  signal?: AbortSignal
}): Promise<GlobalSearchResults> {
  const searchQuery = search || undefined
  const [conversations, knowledgeBases, artifacts, plugins, skills] =
    await Promise.allSettled([
      apiRequest("/conversations", {
        schema: paginatedSchema(conversationSchema),
        query: { archived, search: searchQuery, limit: searchResultLimit },
        signal,
      }),
      listKnowledgeBases({
        lifecycle: "active",
        scope: "all",
        search: searchQuery,
        limit: searchResultLimit,
        signal,
      }),
      getTaskArtifacts({
        search: searchQuery,
        limit: searchResultLimit,
        signal,
      }),
      apiRequest("/capabilities", {
        schema: paginatedSchema(capabilitySummarySchema),
        query: {
          view: "managed",
          type: "plugin",
          search: searchQuery,
          limit: searchResultLimit,
        },
        signal,
      }),
      apiRequest("/capabilities", {
        schema: paginatedSchema(capabilitySummarySchema),
        query: {
          view: "managed",
          type: "skill",
          search: searchQuery,
          limit: searchResultLimit,
        },
        signal,
      }),
    ])

  if (
    conversations.status === "rejected" &&
    knowledgeBases.status === "rejected" &&
    artifacts.status === "rejected" &&
    plugins.status === "rejected" &&
    skills.status === "rejected"
  ) {
    throw conversations.reason
  }

  return {
    conversations: pageItems(conversations),
    knowledgeBases: pageItems(knowledgeBases),
    artifacts: pageItems(artifacts),
    plugins: pageItems(plugins),
    skills: pageItems(skills),
  }
}

function pageItems<T>(result: PromiseSettledResult<{ items: T[] }>): T[] {
  return result.status === "fulfilled" ? result.value.items : []
}
