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
import { Button } from "@/components/ui/button"
import { DesignIcon } from "@/components/ui/design-icon"
import { DialogClose } from "@/components/ui/dialog"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
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
const searchResultLineIconClassName = "size-4.5 shrink-0"
const searchResultMediaIconClassName = "size-5 shrink-0"
const searchResultCapabilityIconClassName = "size-5 shrink-0 rounded-md"

export function ConversationSearchDialog({
  open,
  onOpenChange,
  onNavigate,
  focusOnOpen = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate?: () => void
  focusOnOpen?: boolean
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
        focusOnOpen || shouldAutoFocusOnDesktop()
          ? searchInputRef.current
          : false
      }
      className="conversation-search-dialog top-1/2 max-h-[calc(100svh_-_2rem)] w-[calc(100%_-_1.5rem)] max-w-[680px]! -translate-y-1/2 gap-0 rounded-xl! border border-border bg-[var(--app-popover)] p-0 shadow-[var(--app-dialog-shadow)] ring-0"
    >
      <Command
        label={t("conversation.searchTitle")}
        shouldFilter={false}
        className="conversation-search-command group/search rounded-xl bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:min-w-0 [&_[data-slot=command-input-wrapper]]:flex-1 [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group-addon]]:hidden [&_[data-slot=input-group]]:h-10! [&_[data-slot=input-group]]:rounded-none! [&_[data-slot=input-group]]:border-transparent! [&_[data-slot=input-group]]:bg-transparent! [&_[data-slot=input-group]]:shadow-none! [&_[data-slot=input-group]]:focus-within:border-transparent! [&_[data-slot=input-group]]:focus-within:ring-0! [&_[data-slot=input-group]]:hover:border-transparent!"
      >
        <div className="flex shrink-0 items-center gap-3 p-4">
          <DesignIcon name="search" className="text-muted-foreground" />
          <CommandInput
            ref={searchInputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={t("conversation.searchPlaceholder")}
            className="h-10 min-w-0 border-0 bg-transparent p-0 text-sm font-normal shadow-none outline-none placeholder:text-[var(--app-muted)] focus-visible:ring-0 forced-colors:focus-visible:outline-solid"
          />
          <DialogClose
            onKeyDown={(event) => {
              // cmdk treats bubbling Enter as selecting the current result.
              if (event.key === "Enter") event.stopPropagation()
            }}
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={t("common.close")}
              />
            }
          >
            <DesignIcon name="close" />
          </DialogClose>
        </div>
        <div
          className="mx-4 h-px shrink-0 bg-divider group-has-[[data-slot=command-input]:focus-visible]/search:bg-ring"
          aria-hidden="true"
        />
        <CommandList className="h-[min(60svh,24rem)] max-h-[min(60svh,24rem)]! px-3 pb-4">
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
                    <SearchResultItem
                      key={`conversation:${conversation.id}`}
                      value={`conversation:${conversation.id}`}
                      title={conversation.title || t("conversation.untitled")}
                      icon={
                        conversation.application_development_role ? (
                          <ConversationDevelopmentIcon
                            role={conversation.application_development_role}
                            className={searchResultLineIconClassName}
                          />
                        ) : (
                          <MessageSquareIcon
                            className={searchResultLineIconClassName}
                            aria-hidden="true"
                          />
                        )
                      }
                      metadata={
                        <time dateTime={conversation.updated_at}>
                          {formatRelativeDate(
                            conversation.updated_at,
                            language
                          )}
                        </time>
                      }
                      onSelect={() => {
                        navigate(conversationPath(conversation))
                        closeSearch()
                      }}
                    />
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
                      <SearchResultItem
                        key={`knowledge-base:${knowledgeBase.id}`}
                        value={`knowledge-base:${knowledgeBase.id}`}
                        title={knowledgeBase.name}
                        description={supportingText}
                        icon={
                          <BookOpenIcon
                            className={searchResultLineIconClassName}
                            aria-hidden="true"
                          />
                        }
                        metadata={t("knowledge.documentCount", {
                          count: knowledgeBase.document_count,
                        })}
                        onSelect={() => {
                          navigate(`/knowledge-bases/${knowledgeBase.id}`)
                          closeSearch()
                        }}
                      />
                    )
                  })}
                </SearchResultGroup>
              )}

              {results.data.artifacts.length > 0 && (
                <SearchResultGroup heading={t("library.tabs.artifacts")}>
                  {results.data.artifacts.map((artifact) => (
                    <SearchResultItem
                      key={`artifact:${artifact.id}`}
                      value={`artifact:${artifact.id}`}
                      title={artifact.filename}
                      description={artifact.task.title}
                      icon={
                        <FileTypeIcon
                          filename={artifact.filename}
                          mimeType={artifact.mime_type}
                          className={searchResultMediaIconClassName}
                        />
                      }
                      metadata={formatFileSize(artifact.size, language)}
                      onSelect={() => {
                        const parameters = new URLSearchParams({
                          tab: "artifacts",
                          search: artifact.filename,
                        })
                        navigate(`/knowledge-bases?${parameters.toString()}`)
                        closeSearch()
                      }}
                    />
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

function SearchResultItem({
  value,
  title,
  description,
  icon,
  metadata,
  onSelect,
}: {
  value: string
  title: string
  description?: string | null
  icon: ReactNode
  metadata: ReactNode
  onSelect: () => void
}) {
  const id = `search-result-${value}`

  return (
    <CommandItem
      value={value}
      aria-labelledby={`${id}-title`}
      aria-describedby={
        description ? `${id}-description ${id}-metadata` : `${id}-metadata`
      }
      className="conversation-search-result min-h-16 gap-3 rounded-lg! px-3 py-2.5 font-normal data-selected:bg-accent/60 [&>svg:last-child]:hidden"
      onSelect={onSelect}
    >
      <span
        data-slot="search-result-icon"
        className="flex size-9 shrink-0 items-center justify-center text-muted-foreground"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-3">
          <span
            id={`${id}-title`}
            className="min-w-0 flex-1 truncate text-[length:var(--app-ui-font-size)] leading-5 font-medium"
            title={title}
          >
            {title}
          </span>
          <span
            id={`${id}-metadata`}
            className="max-w-[40%] shrink-0 truncate text-[length:var(--app-font-12)] leading-4 text-muted-foreground"
          >
            {metadata}
          </span>
        </span>
        {description && (
          <span
            id={`${id}-description`}
            className="truncate text-[length:var(--app-font-12)] leading-4 text-muted-foreground"
            title={description}
          >
            {description}
          </span>
        )}
      </span>
    </CommandItem>
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
      className="p-0 [&_[cmdk-group-items]]:space-y-1 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pt-4 **:[[cmdk-group-heading]]:pb-2 **:[[cmdk-group-heading]]:text-[length:var(--app-font-12)] **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground"
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
          <SearchResultItem
            key={`${type}:${capability.id}`}
            value={`${type}:${capability.id}`}
            title={presentation.name}
            description={presentation.description}
            metadata={sourceLabel}
            icon={
              <CapabilityIcon
                type={capability.type}
                logoUrl={capability.logo_url}
                className={searchResultCapabilityIconClassName}
              />
            }
            onSelect={() => onSelect(target)}
          />
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
