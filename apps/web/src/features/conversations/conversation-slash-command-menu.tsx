import { Fragment, forwardRef, useMemo, type ReactNode } from "react"
import {
  AppWindowIcon,
  BlocksIcon,
  BookOpenIcon,
  BoxIcon,
  ChevronsDownIcon,
  LoaderCircleIcon,
  MessageSquarePlusIcon,
  Minimize2Icon,
  ServerCogIcon,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import type { Application, CapabilitySummary, McpServer } from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { useProductName } from "@/app/product-branding"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  useConversationSlashApplications,
  useConversationSlashMcpServers,
} from "@/features/conversations/conversation-slash-command-data"
import { capabilityPresentation } from "@/features/capabilities/built-in-presentation"
import {
  canSelectConversationCapability,
  orderConversationSkills,
} from "@/features/conversations/conversation-capability-selection"
import type {
  KnowledgeBase,
  KnowledgeSearchCapability,
} from "@/features/knowledge-bases/knowledge-base-contracts"
import { getKnowledgeSearchUnavailableDescriptionKey } from "@/features/knowledge-bases/knowledge-search-status"

export type ConversationSlashCommandPanel =
  "plugins" | "skills" | "applications" | "knowledge-bases" | "mcp"

type ConversationSlashCommandView = "root" | ConversationSlashCommandPanel

type RootCommand = Readonly<{
  id: string
  label: string
  description: string
  keywords: readonly string[]
  icon: LucideIcon
  panel?: ConversationSlashCommandPanel
  disabled?: boolean
}>

type SlashCapabilityOption = Readonly<{
  capability: CapabilitySummary
  presentation: ReturnType<typeof capabilityPresentation>
}>

type ConversationSlashCommandMenuProps = Readonly<{
  panel: ConversationSlashCommandView
  query: string
  capabilities: CapabilitySummary[]
  capabilitiesLoading?: boolean
  capabilitiesError?: boolean
  selectedCapabilityIds: string[]
  onRetryCapabilities?: () => void
  onSelectCapability: (id: string) => void
  knowledgeBases: KnowledgeBase[]
  knowledgeBasesLoading?: boolean
  knowledgeBasesError?: boolean
  knowledgeSearchCapability?: KnowledgeSearchCapability
  selectedKnowledgeBaseIds: string[]
  hasMoreKnowledgeBases?: boolean
  loadingMoreKnowledgeBases?: boolean
  onRetryKnowledgeBases?: () => void
  onLoadMoreKnowledgeBases?: () => void
  onSelectKnowledgeBase: (id: string) => void
  managedApplicationName?: string
  startingApplicationId?: string
  onStartApplication: (application: Application) => void
  onSelectPanel: (panel: ConversationSlashCommandPanel) => void
  onStartNewTask: () => void
  onCompact?: () => void
  compactAvailable?: boolean
  compacting?: boolean
  taskStartDisabled?: boolean
}>

type ConversationSkillCommandMenuProps = Readonly<{
  query: string
  capabilities: CapabilitySummary[]
  capabilitiesLoading?: boolean
  capabilitiesError?: boolean
  selectedCapabilityIds: string[]
  onRetryCapabilities?: () => void
  onSelectCapability: (id: string) => void
}>

type SlashInlinePanelProps = Readonly<{
  id: string
  label: string
  children: ReactNode
}>

type Translate = ReturnType<typeof useTranslation>["t"]

function matchesSlashQuery(
  normalizedQuery: string,
  language: string,
  values: readonly (string | null | undefined)[]
) {
  if (!normalizedQuery) return true
  return values.some((value) =>
    value?.toLocaleLowerCase(language).includes(normalizedQuery)
  )
}

function capabilitySearchOptions({
  capabilities,
  type,
  normalizedQuery,
  language,
  t,
  productName,
}: Readonly<{
  capabilities: readonly CapabilitySummary[]
  type: "plugin" | "skill"
  normalizedQuery: string
  language: string
  t: Translate
  productName: string
}>): SlashCapabilityOption[] {
  const items = capabilities
    .filter(
      (capability) =>
        capability.type === type &&
        capability.status === "active" &&
        !capability.personally_disabled
    )
    .map((capability) => ({
      capability,
      presentation: capabilityPresentation(capability, t, productName),
    }))
    .filter(({ capability, presentation }) =>
      matchesSlashQuery(normalizedQuery, language, [
        capability.name,
        capability.slug,
        capability.description,
        presentation.name,
        presentation.description,
      ])
    )

  return type === "skill"
    ? orderConversationSkills(items.map(({ capability }) => capability)).map(
        (capability) =>
          items.find((item) => item.capability.id === capability.id) ?? {
            capability,
            presentation: capabilityPresentation(capability, t, productName),
          }
      )
    : items
}

function knowledgeBaseSearchOptions({
  knowledgeBases,
  normalizedQuery,
  language,
}: Readonly<{
  knowledgeBases: readonly KnowledgeBase[]
  normalizedQuery: string
  language: string
}>) {
  return knowledgeBases.filter(
    (knowledgeBase) =>
      knowledgeBase.lifecycle_status === "active" &&
      knowledgeBase.availability_status === "enabled" &&
      matchesSlashQuery(normalizedQuery, language, [
        knowledgeBase.name,
        knowledgeBase.description,
        knowledgeBase.owner.name,
      ])
  )
}

function SlashInlinePanel({ id, label, children }: SlashInlinePanelProps) {
  return (
    <CommandGroup
      id={id}
      className="composer-slash-inline-panel"
      aria-label={label}
    >
      {children}
    </CommandGroup>
  )
}

function SlashLoadingState() {
  const { t } = useTranslation()
  return (
    <div className="composer-slash-state" role="status">
      <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
      <span>{t("common.loading")}</span>
    </div>
  )
}

function SlashErrorState({
  message,
  onRetry,
}: Readonly<{ message: string; onRetry?: () => void }>) {
  const { t } = useTranslation()
  return (
    <div className="composer-slash-state" role="alert">
      <span>{message}</span>
      {onRetry && (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  )
}

function CapabilityCommandItem({
  option,
  selectedIds,
  onSelect,
}: Readonly<{
  option: SlashCapabilityOption
  selectedIds: string[]
  onSelect: (id: string) => void
}>) {
  const { t } = useTranslation()
  const selected = selectedIds.includes(option.capability.id)
  const selectable = canSelectConversationCapability(option.capability)

  return (
    <CommandItem
      key={option.capability.id}
      value={`capability:${option.capability.id}`}
      className="composer-slash-detail-item"
      data-checked={selected || undefined}
      disabled={!selectable}
      onSelect={() => {
        if (selectable) onSelect(option.capability.id)
      }}
    >
      <span className="composer-slash-item-copy">
        <span className="composer-slash-item-title">
          {option.presentation.name}
        </span>
        <span className="composer-slash-item-description">
          {option.presentation.description || t("marketplace.noDescription")}
        </span>
      </span>
      <span className="composer-slash-item-meta">
        {t(
          selected
            ? "conversation.slashCommands.selected"
            : option.capability.is_builtin
              ? "capability.builtIn"
              : "conversation.slashCommands.personal"
        )}
      </span>
    </CommandItem>
  )
}

function KnowledgeBaseCommandItem({
  knowledgeBase,
  selectedIds,
  onSelect,
}: Readonly<{
  knowledgeBase: KnowledgeBase
  selectedIds: string[]
  onSelect: (id: string) => void
}>) {
  const { t } = useTranslation()
  const selected = selectedIds.includes(knowledgeBase.id)

  return (
    <CommandItem
      key={knowledgeBase.id}
      value={`knowledge-base:${knowledgeBase.id}`}
      className="composer-slash-detail-item"
      data-checked={selected || undefined}
      onSelect={() => onSelect(knowledgeBase.id)}
    >
      <span className="composer-slash-item-copy">
        <span className="composer-slash-item-title">{knowledgeBase.name}</span>
        <span className="composer-slash-item-description">
          {knowledgeBase.description || t("knowledge.noDescription")}
        </span>
      </span>
      <span className="composer-slash-item-meta">
        {t(
          selected
            ? "conversation.slashCommands.selected"
            : "conversation.slashCommands.available"
        )}
      </span>
    </CommandItem>
  )
}

function CapabilityPanel({
  panelId,
  label,
  type,
  capabilities,
  loading,
  error,
  selectedIds,
  onRetry,
  onSelect,
  query = "",
  selectableOnly = false,
  emptyMessage,
}: Readonly<{
  panelId: string
  label: string
  type: "plugin" | "skill"
  capabilities: CapabilitySummary[]
  loading?: boolean
  error?: boolean
  selectedIds: string[]
  onRetry?: () => void
  onSelect: (id: string) => void
  query?: string
  selectableOnly?: boolean
  emptyMessage?: string
}>) {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const items = capabilitySearchOptions({
    capabilities,
    type,
    normalizedQuery: query.trim().toLocaleLowerCase(i18n.language),
    language: i18n.language,
    t,
    productName,
  }).filter(
    ({ capability }) =>
      !selectableOnly || canSelectConversationCapability(capability)
  )

  if (loading) {
    return (
      <SlashInlinePanel id={panelId} label={label}>
        <SlashLoadingState />
      </SlashInlinePanel>
    )
  }
  if (error) {
    return (
      <SlashInlinePanel id={panelId} label={label}>
        <SlashErrorState
          message={t("conversation.capabilityUnavailable")}
          onRetry={onRetry}
        />
      </SlashInlinePanel>
    )
  }

  return (
    <SlashInlinePanel id={panelId} label={label}>
      {items.length === 0 && (
        <div className="composer-slash-state" role="status">
          {emptyMessage ??
            t("conversation.slashCommands.emptyCapabilities", {
              type: t(
                type === "plugin"
                  ? "conversation.slashCommands.pluginsTitle"
                  : "conversation.slashCommands.skillsTitle"
              ),
            })}
        </div>
      )}
      {items.map((option) => (
        <CapabilityCommandItem
          key={option.capability.id}
          option={option}
          selectedIds={selectedIds}
          onSelect={onSelect}
        />
      ))}
    </SlashInlinePanel>
  )
}

export const ConversationSkillCommandMenu = forwardRef<
  HTMLDivElement,
  ConversationSkillCommandMenuProps
>(function ConversationSkillCommandMenu(
  {
    query,
    capabilities,
    capabilitiesLoading,
    capabilitiesError,
    selectedCapabilityIds,
    onRetryCapabilities,
    onSelectCapability,
  },
  ref
) {
  const { t } = useTranslation()
  const label = t("conversation.slashCommands.skillsTitle")

  return (
    <div
      ref={ref}
      id="conversation-skill-command-menu"
      className="composer-slash-menu"
      data-panel="skills"
    >
      <Command
        loop
        shouldFilter={false}
        className="composer-slash-command"
        aria-label={t("conversation.skillCommands.menuLabel")}
      >
        <CommandList className="composer-slash-list">
          <CapabilityPanel
            panelId="conversation-skill-command-options"
            label={label}
            type="skill"
            capabilities={capabilities}
            loading={capabilitiesLoading}
            error={capabilitiesError}
            selectedIds={selectedCapabilityIds}
            onRetry={onRetryCapabilities}
            onSelect={onSelectCapability}
            query={query}
            selectableOnly
            emptyMessage={t("conversation.skillCommands.noMatches")}
          />
        </CommandList>
      </Command>
    </div>
  )
})

function KnowledgeBasePanel({
  panelId,
  label,
  knowledgeBases,
  loading,
  error,
  searchCapability,
  selectedIds,
  hasMore,
  loadingMore,
  onRetry,
  onLoadMore,
  onSelect,
}: Readonly<{
  panelId: string
  label: string
  knowledgeBases: KnowledgeBase[]
  loading?: boolean
  error?: boolean
  searchCapability?: KnowledgeSearchCapability
  selectedIds: string[]
  hasMore?: boolean
  loadingMore?: boolean
  onRetry?: () => void
  onLoadMore?: () => void
  onSelect: (id: string) => void
}>) {
  const { t, i18n } = useTranslation()
  const items = knowledgeBaseSearchOptions({
    knowledgeBases,
    normalizedQuery: "",
    language: i18n.language,
  })

  if (searchCapability?.status === "unavailable") {
    return (
      <SlashInlinePanel id={panelId} label={label}>
        <SlashErrorState
          message={`${t("knowledge.searchCapability.unavailableTitle")}：${t(
            getKnowledgeSearchUnavailableDescriptionKey(searchCapability)
          )}`}
          onRetry={onRetry}
        />
      </SlashInlinePanel>
    )
  }
  if (loading) {
    return (
      <SlashInlinePanel id={panelId} label={label}>
        <SlashLoadingState />
      </SlashInlinePanel>
    )
  }
  if (error) {
    return (
      <SlashInlinePanel id={panelId} label={label}>
        <SlashErrorState
          message={t("conversation.knowledgeBasesUnavailable")}
          onRetry={onRetry}
        />
      </SlashInlinePanel>
    )
  }

  return (
    <SlashInlinePanel id={panelId} label={label}>
      {items.length === 0 && (
        <div className="composer-slash-state" role="status">
          {t("conversation.noKnowledgeBases")}
        </div>
      )}
      {items.map((knowledgeBase) => (
        <KnowledgeBaseCommandItem
          key={knowledgeBase.id}
          knowledgeBase={knowledgeBase}
          selectedIds={selectedIds}
          onSelect={onSelect}
        />
      ))}
      {hasMore && onLoadMore && (
        <CommandItem
          value="knowledge-base:load-more"
          className="composer-slash-load-more"
          disabled={loadingMore}
          onSelect={onLoadMore}
        >
          {loadingMore ? (
            <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
          ) : (
            <ChevronsDownIcon aria-hidden="true" />
          )}
          <span>{t("knowledge.loadMore")}</span>
        </CommandItem>
      )}
    </SlashInlinePanel>
  )
}

function DirectResourceSearchResults({
  query,
  capabilities,
  selectedCapabilityIds,
  onSelectCapability,
  knowledgeBases,
  selectedKnowledgeBaseIds,
  onSelectKnowledgeBase,
  resourcesManagedByApplication,
}: Readonly<{
  query: string
  capabilities: CapabilitySummary[]
  selectedCapabilityIds: string[]
  onSelectCapability: (id: string) => void
  knowledgeBases: KnowledgeBase[]
  selectedKnowledgeBaseIds: string[]
  onSelectKnowledgeBase: (id: string) => void
  resourcesManagedByApplication: boolean
}>) {
  const { t, i18n } = useTranslation()
  const productName = useProductName()

  if (resourcesManagedByApplication) return null

  const plugins = capabilitySearchOptions({
    capabilities,
    type: "plugin",
    normalizedQuery: query,
    language: i18n.language,
    t,
    productName,
  })
  const skills = capabilitySearchOptions({
    capabilities,
    type: "skill",
    normalizedQuery: query,
    language: i18n.language,
    t,
    productName,
  })
  const searchableKnowledgeBases = knowledgeBaseSearchOptions({
    knowledgeBases,
    normalizedQuery: query,
    language: i18n.language,
  })

  return (
    <>
      {plugins.length > 0 && (
        <SlashInlinePanel
          id="conversation-slash-direct-plugins"
          label={t("conversation.slashCommands.pluginsTitle")}
        >
          {plugins.map((option) => (
            <CapabilityCommandItem
              key={option.capability.id}
              option={option}
              selectedIds={selectedCapabilityIds}
              onSelect={onSelectCapability}
            />
          ))}
        </SlashInlinePanel>
      )}
      {skills.length > 0 && (
        <SlashInlinePanel
          id="conversation-slash-direct-skills"
          label={t("conversation.slashCommands.skillsTitle")}
        >
          {skills.map((option) => (
            <CapabilityCommandItem
              key={option.capability.id}
              option={option}
              selectedIds={selectedCapabilityIds}
              onSelect={onSelectCapability}
            />
          ))}
        </SlashInlinePanel>
      )}
      {searchableKnowledgeBases.length > 0 && (
        <SlashInlinePanel
          id="conversation-slash-direct-knowledge-bases"
          label={t("conversation.slashCommands.knowledgeBasesTitle")}
        >
          {searchableKnowledgeBases.map((knowledgeBase) => (
            <KnowledgeBaseCommandItem
              key={knowledgeBase.id}
              knowledgeBase={knowledgeBase}
              selectedIds={selectedKnowledgeBaseIds}
              onSelect={onSelectKnowledgeBase}
            />
          ))}
        </SlashInlinePanel>
      )}
    </>
  )
}

function ApplicationsPanel({
  panelId,
  label,
  startingApplicationId,
  onStartApplication,
  taskStartDisabled,
}: Readonly<{
  panelId: string
  label: string
  startingApplicationId?: string
  onStartApplication: (application: Application) => void
  taskStartDisabled?: boolean
}>) {
  const { t } = useTranslation()
  const applications = useConversationSlashApplications()

  if (applications.isLoading) {
    return (
      <SlashInlinePanel id={panelId} label={label}>
        <SlashLoadingState />
      </SlashInlinePanel>
    )
  }
  if (applications.isError) {
    return (
      <SlashInlinePanel id={panelId} label={label}>
        <SlashErrorState
          message={getErrorMessage(applications.error, t)}
          onRetry={() => void applications.refetch()}
        />
      </SlashInlinePanel>
    )
  }

  const items = applications.data?.items ?? []
  return (
    <SlashInlinePanel id={panelId} label={label}>
      {items.length === 0 && (
        <div className="composer-slash-state" role="status">
          {t("applications.emptyTitle")}
        </div>
      )}
      {items.map((application) => {
        const starting = startingApplicationId === application.id
        const unavailable =
          application.status !== "active" || !application.dependencies_available
        return (
          <CommandItem
            key={application.id}
            value={`application:${application.id}`}
            className="composer-slash-detail-item"
            disabled={
              taskStartDisabled || unavailable || Boolean(startingApplicationId)
            }
            onSelect={() => {
              if (!taskStartDisabled) onStartApplication(application)
            }}
          >
            <span className="composer-slash-item-copy">
              <span className="composer-slash-item-title">
                {application.name}
              </span>
              <span className="composer-slash-item-description">
                {application.description || t("applications.noDescription")}
              </span>
            </span>
            <span className="composer-slash-item-meta">
              {starting ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
              ) : (
                t(
                  unavailable
                    ? "conversation.slashCommands.unavailable"
                    : taskStartDisabled
                      ? "conversation.slashCommands.unavailable"
                      : application.is_owner
                        ? "conversation.slashCommands.owned"
                        : "conversation.slashCommands.shared"
                )
              )}
            </span>
          </CommandItem>
        )
      })}
    </SlashInlinePanel>
  )
}

function mcpAuthenticationDescription(
  server: McpServer,
  t: ReturnType<typeof useTranslation>["t"]
) {
  if (server.transport === "stdio") {
    return t("conversation.slashCommands.mcpStdioConfigured", {
      count: server.environment_keys.length,
    })
  }
  if (server.auth_type === "none") {
    return t("conversation.slashCommands.mcpNoAuthentication")
  }
  if (!server.has_credential) {
    return t("conversation.slashCommands.mcpCredentialMissing")
  }
  return t("conversation.slashCommands.mcpAuthenticationConfigured", {
    method: t(`mcp.auth.${server.auth_type}`),
  })
}

function McpStatusPanel({
  panelId,
  label,
}: Readonly<{
  panelId: string
  label: string
}>) {
  const { t } = useTranslation()
  const servers = useConversationSlashMcpServers()

  if (servers.isLoading) {
    return (
      <SlashInlinePanel id={panelId} label={label}>
        <SlashLoadingState />
      </SlashInlinePanel>
    )
  }
  if (servers.isError) {
    return (
      <SlashInlinePanel id={panelId} label={label}>
        <SlashErrorState
          message={getErrorMessage(servers.error, t)}
          onRetry={() => void servers.refetch()}
        />
      </SlashInlinePanel>
    )
  }

  const items = servers.data?.items ?? []
  return (
    <SlashInlinePanel id={panelId} label={label}>
      {items.length === 0 && (
        <div className="composer-slash-state">
          <span>{t("mcp.empty")}</span>
        </div>
      )}
      {items.map((server) => {
        const testStatus = server.last_test_status ?? "untested"
        return (
          <CommandItem
            key={server.id}
            value={`mcp:${server.id}`}
            className="composer-slash-status-row"
            disabled
          >
            <span className="composer-slash-item-copy">
              <span className="composer-slash-item-title">{server.name}</span>
              <span className="composer-slash-item-description">
                {mcpAuthenticationDescription(server, t)}
                {testStatus !== "succeeded" && (
                  <span aria-hidden="true"> · </span>
                )}
                <span
                  className="composer-slash-mcp-test"
                  data-status={testStatus}
                >
                  {testStatus === "succeeded" ? (
                    <span
                      className="composer-slash-mcp-status-dot"
                      role="img"
                      aria-label={t("mcp.testStatus.succeeded")}
                    />
                  ) : (
                    t(`mcp.testStatus.${testStatus}`)
                  )}
                </span>
              </span>
            </span>
            <span className="composer-slash-item-meta">
              {t(
                server.status === "active"
                  ? "conversation.slashCommands.enabled"
                  : "conversation.slashCommands.disabled"
              )}
            </span>
          </CommandItem>
        )
      })}
    </SlashInlinePanel>
  )
}

export const ConversationSlashCommandMenu = forwardRef<
  HTMLDivElement,
  ConversationSlashCommandMenuProps
>(function ConversationSlashCommandMenu(
  {
    panel,
    query,
    capabilities,
    capabilitiesLoading,
    capabilitiesError,
    selectedCapabilityIds,
    onRetryCapabilities,
    onSelectCapability,
    knowledgeBases,
    knowledgeBasesLoading,
    knowledgeBasesError,
    knowledgeSearchCapability,
    selectedKnowledgeBaseIds,
    hasMoreKnowledgeBases,
    loadingMoreKnowledgeBases,
    onRetryKnowledgeBases,
    onLoadMoreKnowledgeBases,
    onSelectKnowledgeBase,
    managedApplicationName,
    startingApplicationId,
    onStartApplication,
    onSelectPanel,
    onStartNewTask,
    onCompact = () => undefined,
    compactAvailable = false,
    compacting = false,
    taskStartDisabled = false,
  },
  ref
) {
  const { t, i18n } = useTranslation()
  const resourcesManagedByApplication = Boolean(managedApplicationName)
  const rootCommands = useMemo<RootCommand[]>(
    () => [
      {
        id: "new-task",
        label: t("conversation.slashCommands.newTask"),
        description: t("conversation.slashCommands.newTaskDescription"),
        keywords: ["new", "task", "新建", "任务"],
        icon: MessageSquarePlusIcon,
        disabled: taskStartDisabled,
      },
      {
        id: "compact",
        label: t("conversation.slashCommands.compact"),
        description: t("conversation.slashCommands.compactDescription"),
        keywords: ["compact", "compress", "压缩", "上下文"],
        icon: Minimize2Icon,
        disabled: !compactAvailable || compacting,
      },
      {
        id: "plugins",
        label: t("conversation.slashCommands.plugins"),
        description: t(
          resourcesManagedByApplication
            ? "conversation.slashCommands.applicationManagedDescription"
            : "conversation.slashCommands.pluginsDescription"
        ),
        keywords: ["plugin", "plugins", "插件"],
        icon: BlocksIcon,
        panel: "plugins",
        disabled: resourcesManagedByApplication,
      },
      {
        id: "skills",
        label: t("conversation.slashCommands.skills"),
        description: t(
          resourcesManagedByApplication
            ? "conversation.slashCommands.applicationManagedDescription"
            : "conversation.slashCommands.skillsDescription"
        ),
        keywords: ["skill", "skills", "技能"],
        icon: BoxIcon,
        panel: "skills",
        disabled: resourcesManagedByApplication,
      },
      {
        id: "applications",
        label: t("conversation.slashCommands.applications"),
        description: t("conversation.slashCommands.applicationsDescription"),
        keywords: ["app", "apps", "application", "applications", "应用"],
        icon: AppWindowIcon,
        panel: "applications",
        disabled: taskStartDisabled,
      },
      {
        id: "knowledge-bases",
        label: t("conversation.slashCommands.knowledgeBases"),
        description: t(
          resourcesManagedByApplication
            ? "conversation.slashCommands.applicationManagedDescription"
            : "conversation.slashCommands.knowledgeBasesDescription"
        ),
        keywords: ["knowledge", "kb", "知识", "知识库"],
        icon: BookOpenIcon,
        panel: "knowledge-bases",
        disabled: resourcesManagedByApplication,
      },
      {
        id: "mcp",
        label: t("conversation.slashCommands.mcp"),
        description: t("conversation.slashCommands.mcpDescription"),
        keywords: ["mcp", "server", "status", "服务器", "状态"],
        icon: ServerCogIcon,
        panel: "mcp",
      },
    ],
    [
      compactAvailable,
      compacting,
      resourcesManagedByApplication,
      taskStartDisabled,
      t,
    ]
  )
  const normalizedQuery = query.trim().toLocaleLowerCase(i18n.language)
  const visibleRootCommands = rootCommands.filter((command) => {
    if (!normalizedQuery) return true
    return [command.label, command.description, ...command.keywords].some(
      (value) =>
        value.toLocaleLowerCase(i18n.language).includes(normalizedQuery)
    )
  })
  const panelTitles: Record<ConversationSlashCommandPanel, string> = {
    plugins: t("conversation.slashCommands.pluginsTitle"),
    skills: t("conversation.slashCommands.skillsTitle"),
    applications: t("conversation.slashCommands.applicationsTitle"),
    "knowledge-bases": t("conversation.slashCommands.knowledgeBasesTitle"),
    mcp: t("conversation.slashCommands.mcpTitle"),
  }
  const renderPanel = (selectedPanel: ConversationSlashCommandPanel) => {
    const panelId = `conversation-slash-panel-${selectedPanel}`
    const label = panelTitles[selectedPanel]

    switch (selectedPanel) {
      case "plugins":
        return (
          <CapabilityPanel
            panelId={panelId}
            label={label}
            type="plugin"
            capabilities={capabilities}
            loading={capabilitiesLoading}
            error={capabilitiesError}
            selectedIds={selectedCapabilityIds}
            onRetry={onRetryCapabilities}
            onSelect={onSelectCapability}
          />
        )
      case "skills":
        return (
          <CapabilityPanel
            panelId={panelId}
            label={label}
            type="skill"
            capabilities={capabilities}
            loading={capabilitiesLoading}
            error={capabilitiesError}
            selectedIds={selectedCapabilityIds}
            onRetry={onRetryCapabilities}
            onSelect={onSelectCapability}
          />
        )
      case "applications":
        return (
          <ApplicationsPanel
            panelId={panelId}
            label={label}
            startingApplicationId={startingApplicationId}
            onStartApplication={onStartApplication}
            taskStartDisabled={taskStartDisabled}
          />
        )
      case "knowledge-bases":
        return (
          <KnowledgeBasePanel
            panelId={panelId}
            label={label}
            knowledgeBases={knowledgeBases}
            loading={knowledgeBasesLoading}
            error={knowledgeBasesError}
            searchCapability={knowledgeSearchCapability}
            selectedIds={selectedKnowledgeBaseIds}
            hasMore={hasMoreKnowledgeBases}
            loadingMore={loadingMoreKnowledgeBases}
            onRetry={onRetryKnowledgeBases}
            onLoadMore={onLoadMoreKnowledgeBases}
            onSelect={onSelectKnowledgeBase}
          />
        )
      case "mcp":
        return <McpStatusPanel panelId={panelId} label={label} />
    }
  }

  return (
    <div
      ref={ref}
      id="conversation-slash-command-menu"
      className="composer-slash-menu"
      data-panel={panel}
    >
      <Command
        loop
        shouldFilter={false}
        className="composer-slash-command"
        aria-label={t("conversation.slashCommands.menuLabel")}
      >
        <CommandList className="composer-slash-list">
          <CommandEmpty>
            {t("conversation.slashCommands.noMatches")}
          </CommandEmpty>
          {visibleRootCommands.map((command) => {
            const Icon = command.icon
            const expanded = command.panel === panel
            const panelId = command.panel
              ? `conversation-slash-panel-${command.panel}`
              : undefined
            return (
              <Fragment key={command.id}>
                <CommandGroup className="composer-slash-root-section">
                  <CommandItem
                    value={`slash:${command.id}`}
                    className="composer-slash-root-item"
                    disabled={command.disabled}
                    data-expanded={expanded || undefined}
                    aria-expanded={command.panel ? expanded : undefined}
                    aria-controls={command.panel ? panelId : undefined}
                    onSelect={() => {
                      if (command.disabled) return
                      if (command.id === "new-task") {
                        onStartNewTask()
                        return
                      }
                      if (command.id === "compact") {
                        onCompact()
                        return
                      }
                      if (command.panel) onSelectPanel(command.panel)
                    }}
                  >
                    <span className="composer-slash-root-icon">
                      <Icon aria-hidden="true" />
                    </span>
                    <span className="composer-slash-root-label">
                      {command.label}
                    </span>
                    <span className="composer-slash-root-description">
                      {command.description}
                    </span>
                  </CommandItem>
                </CommandGroup>
                {command.panel === panel && renderPanel(command.panel)}
              </Fragment>
            )
          })}
          {panel === "root" && normalizedQuery && (
            <DirectResourceSearchResults
              query={normalizedQuery}
              capabilities={capabilities}
              selectedCapabilityIds={selectedCapabilityIds}
              onSelectCapability={onSelectCapability}
              knowledgeBases={knowledgeBases}
              selectedKnowledgeBaseIds={selectedKnowledgeBaseIds}
              onSelectKnowledgeBase={onSelectKnowledgeBase}
              resourcesManagedByApplication={resourcesManagedByApplication}
            />
          )}
        </CommandList>
      </Command>
    </div>
  )
})
