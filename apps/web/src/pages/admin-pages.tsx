import {
  useDeferredValue,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ChevronDownIcon,
  DatabaseBackupIcon,
  DownloadIcon,
  FileUpIcon,
  ImageIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { z } from "zod"

import { ApiError, apiRequest, downloadApiFile } from "@/api/client"
import {
  auditConversationMetadataSchema,
  auditRecordSchema,
  authenticationSettingsSchema,
  authenticationSettingsUpdateResultSchema,
  healthSchema,
  imageGenerationSettingsSchema,
  imageUnderstandingSettingsSchema,
  knowledgeModelSettingsSchema,
  importResultSchema,
  modelProviderSettingsSchema,
  paginatedSchema,
  productSettingsSchema,
  registrationSettingsSchema,
  registrationSettingsUpdateResultSchema,
  retainedArtifactSummarySchema,
  roleSummarySchema,
  userGroupSchema,
  userSchema,
  type AuditConversationMetadata,
  type AuditRecord,
  type AuthenticationSettings,
  type BootstrapStatus,
  type HealthStatus,
  type ImportResult,
  type ProductSettings,
  type RegistrationSettings,
  type RetainedArtifactSummary,
  type SupportedLanguage,
  type User,
  type UserGroup,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { productFilenamePrefix, useProductName } from "@/app/product-branding"
import { downloadBlob } from "@/lib/download-blob"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { NotificationToast } from "@/components/feedback/notification-toast"
import { StatusBanner } from "@/components/feedback/status-banner"
import { DatePicker } from "@/components/forms/date-picker"
import { FieldShell } from "@/components/forms/form-field"
import { ProductLogo } from "@/components/brand/product-logo"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { PageLayout } from "@/components/shell/page-layout"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime, formatFileSize } from "@/i18n/date"
import { formatPublicTechnicalIdentifier } from "@/lib/public-copy"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"
import {
  MILLION_TOKEN_QUOTA_INPUT_PATTERN,
  millionTokenQuotaInputToTokenLimit,
  tokenLimitToMillionTokenQuotaInput,
} from "@/lib/token-quota"
import {
  InitialUserTokenQuotaSettingsForm,
  ModelProviderSettingsForm,
} from "@/features/admin/model-provider-settings-form"
import { ImageGenerationSettingsForm } from "@/features/admin/image-generation-settings-form"
import { ImageUnderstandingSettingsForm } from "@/features/admin/image-understanding-settings-form"
import { KnowledgeModelSettingsForm } from "@/features/admin/knowledge-model-settings-form"
import { MaintenanceSettingsForm } from "@/features/admin/maintenance-settings-form"

type AdminPage =
  "users" | "roles" | "groups" | "audit" | "models" | "settings" | "health"

type UsersAndGroupsTab = "groups" | "users"

const emptySchema = z.unknown()
const emptySelectValue = "__linksense_empty_select_value__"
const hiddenHealthComponentKeys = new Set([
  "minio",
  "codex_app_server",
  "codex_home",
  "codex_home_root",
])
const dockerResourceServiceTranslationKeys: Record<string, string> = {
  api: "health.resources.services.api",
  runner: "health.resources.services.runner",
  worker_pool: "health.resources.services.workerPool",
  web: "health.resources.services.web",
  gateway: "health.resources.services.gateway",
  postgres: "health.resources.services.postgres",
  redis: "health.resources.services.redis",
  "postgres-backup": "health.resources.services.postgresBackup",
  migrate: "health.resources.services.migrate",
  "backup-init": "health.resources.services.backupInit",
  "storage-init": "health.resources.services.storageInit",
  "runner-worker-image": "health.resources.services.runnerWorkerImage",
}

function formatTokenLimit(value: string | null | undefined): string {
  const formatted = tokenLimitToMillionTokenQuotaInput(value)
  return formatted ? formatted : "-"
}

type TokenQuotaRemainingFilter = "" | "total" | "weekly" | "monthly"
type UserRegistrationSourceFilter =
  "" | "self_registration" | "organization_invitation"
type UserTokenQuotaRemaining = {
  remaining_percentage: number
}

function isTokenQuotaRemainingFilter(
  value: string
): value is TokenQuotaRemainingFilter {
  return (
    value === "" ||
    value === "total" ||
    value === "weekly" ||
    value === "monthly"
  )
}

function isUserRegistrationSourceFilter(
  value: string
): value is UserRegistrationSourceFilter {
  return (
    value === "" ||
    value === "self_registration" ||
    value === "organization_invitation"
  )
}

function UserTokenLimitCell({
  limit,
  period,
}: {
  limit: string | null | undefined
  period: UserTokenQuotaRemaining | null | undefined
}) {
  const { t } = useTranslation()
  const formatted = formatTokenLimit(limit)
  if (formatted === "-") return "-"

  return (
    <span>
      <span className="table-primary">
        {t("admin.tokenLimitDisplay", { value: formatted })}
      </span>
      <span className="table-secondary">
        {typeof period?.remaining_percentage === "number"
          ? t("admin.tokenQuotaRemainingPercentage", {
              percentage: period.remaining_percentage,
            })
          : t("admin.tokenQuotaRemainingUnavailable")}
      </span>
    </span>
  )
}

const knowledgeMaintenanceTaskSchema = z.object({
  id: z.string(),
  task_type: z.string().optional(),
  scope: z.string().optional(),
  status: z.enum(["pending", "queued", "running", "completed", "failed"]),
  current_stage: z.string().nullable().optional(),
  total_count: z.number().int().nonnegative().default(0),
  succeeded_count: z.number().int().nonnegative().default(0),
  failed_count: z.number().int().nonnegative().default(0),
  stable_error_code: z.string().nullable().optional(),
  created_at: z.string().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
})

type KnowledgeMaintenanceTask = z.infer<typeof knowledgeMaintenanceTaskSchema>

const knowledgeMaintenanceResponseSchema = z
  .union([
    knowledgeMaintenanceTaskSchema,
    z.object({ task: knowledgeMaintenanceTaskSchema.nullable() }),
    z.null(),
  ])
  .transform((value): KnowledgeMaintenanceTask | null => {
    if (value && "task" in value) return value.task
    return value
  })

type AdminSelectOption = {
  value: string
  label: string
}

function AdminSelect({
  id,
  value,
  options,
  onValueChange,
  disabled,
}: {
  id: string
  value: string
  options: AdminSelectOption[]
  onValueChange: (value: string) => void
  disabled?: boolean
}) {
  const encodedValue = value || emptySelectValue
  const selectedLabel = options.find((option) => option.value === value)?.label

  return (
    <Select
      value={encodedValue}
      disabled={disabled}
      onValueChange={(nextValue) =>
        onValueChange(nextValue === emptySelectValue ? "" : (nextValue ?? ""))
      }
    >
      <SelectTrigger id={id} className="h-9! w-full">
        <SelectValue>
          <span className="truncate">{selectedLabel ?? ""}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value || emptySelectValue}
            value={option.value || emptySelectValue}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type MultiSelectOption = {
  id: string
  name: string
  secondary?: string
}

const visibleGroupChipLimit = 2

function UserGroupsCell({ groups }: { groups: User["user_groups"] }) {
  const { t } = useTranslation()
  const hiddenGroupCount = Math.max(groups.length - visibleGroupChipLimit, 0)

  if (groups.length === 0) return "-"

  return (
    <div className="flex max-w-64 flex-wrap items-center gap-1">
      {groups.slice(0, visibleGroupChipLimit).map((group) => (
        <Badge key={group.id} variant="outline">
          <span className="max-w-32 truncate">{group.name}</span>
        </Badge>
      ))}
      {hiddenGroupCount > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                variant="secondary"
                tabIndex={0}
                className="cursor-help outline-none"
                aria-label={t("admin.additionalGroups", {
                  count: hiddenGroupCount,
                })}
              />
            }
          >
            +{hiddenGroupCount}
          </TooltipTrigger>
          <TooltipContent align="start" className="items-start">
            <ul aria-label={t("admin.groups")} className="flex flex-col gap-1">
              {groups.map((group) => (
                <li key={group.id}>{group.name}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function MultiSelectList({
  label,
  values,
  options,
  onChange,
}: {
  label: string
  values: string[]
  options: MultiSelectOption[]
  onChange: (values: string[]) => void
}) {
  const { t } = useTranslation()
  const selectedOptions = options.filter((option) => values.includes(option.id))
  const hiddenGroupCount = Math.max(
    selectedOptions.length - visibleGroupChipLimit,
    0
  )

  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{label}</FieldLegend>
      <Combobox
        items={options}
        multiple
        value={selectedOptions}
        disabled={options.length === 0}
        itemToStringLabel={(option) =>
          [option.name, option.secondary].filter(Boolean).join(" ")
        }
        itemToStringValue={(option) => option.id}
        isItemEqualToValue={(option, value) => option.id === value.id}
        onValueChange={(nextOptions) =>
          onChange(nextOptions.map((option) => option.id))
        }
      >
        <ComboboxChips className="min-h-9">
          <ComboboxValue>
            {selectedOptions.slice(0, visibleGroupChipLimit).map((option) => (
              <ComboboxChip
                key={option.id}
                removeLabel={t("admin.removeGroup", {
                  name: option.name,
                })}
              >
                <span className="max-w-40 truncate">{option.name}</span>
              </ComboboxChip>
            ))}
            {hiddenGroupCount > 0 && (
              <Badge
                variant="secondary"
                aria-label={t("admin.additionalGroups", {
                  count: hiddenGroupCount,
                })}
              >
                +{hiddenGroupCount}
              </Badge>
            )}
          </ComboboxValue>
          <ComboboxChipsInput
            aria-label={label}
            disabled={options.length === 0}
            placeholder={
              options.length === 0
                ? t("common.empty")
                : selectedOptions.length === 0
                  ? t("admin.selectGroups")
                  : t("admin.searchGroups")
            }
          />
        </ComboboxChips>
        <ComboboxContent>
          <ComboboxEmpty>{t("admin.groupSearchEmpty")}</ComboboxEmpty>
          <ComboboxList>
            {(option: MultiSelectOption) => (
              <ComboboxItem key={option.id} value={option}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {option.name}
                  </span>
                  {option.secondary && (
                    <span className="block truncate text-muted-foreground">
                      {option.secondary}
                    </span>
                  )}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </FieldSet>
  )
}

function MemberMultiSelect({
  values,
  members,
  onChange,
}: {
  values: string[]
  members: User[]
  onChange: (values: string[]) => void
}) {
  const { t } = useTranslation()
  const selectedMembers = members.filter((member) => values.includes(member.id))
  const triggerLabel =
    values.length === 0
      ? t("admin.selectMembers")
      : values.length === 1 && selectedMembers.length === 1
        ? selectedMembers[0].name
        : t("admin.selectedMembers", { count: values.length })

  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{t("admin.memberSelector")}</FieldLegend>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full justify-between text-left"
            />
          }
        >
          <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
          <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(32rem,calc(100vw-3rem))] p-1"
        >
          <PopoverTitle className="sr-only">
            {t("admin.memberSelector")}
          </PopoverTitle>
          <Command>
            <CommandInput placeholder={t("admin.memberSearchPlaceholder")} />
            <CommandList>
              <CommandEmpty>{t("admin.memberSearchEmpty")}</CommandEmpty>
              <CommandGroup>
                {members.map((member) => {
                  const selected = values.includes(member.id)
                  return (
                    <CommandItem
                      key={member.id}
                      value={`${member.name} ${member.email}`}
                      onSelect={() =>
                        onChange(
                          selected
                            ? values.filter((id) => id !== member.id)
                            : [...values, member.id]
                        )
                      }
                    >
                      <Checkbox
                        checked={selected}
                        aria-hidden="true"
                        tabIndex={-1}
                        className="pointer-events-none"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {member.name}
                        </span>
                        <span className="block truncate text-muted-foreground">
                          {member.email}
                        </span>
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FieldSet>
  )
}

function UsersAndGroupsManagementLayout({
  activeTab,
  actions,
  children,
}: {
  activeTab: UsersAndGroupsTab
  actions: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <PageLayout
      title={t("admin.usersAndGroupsTitle")}
      description={t("admin.usersAndGroupsDescription")}
      actions={actions}
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === "groups" || value === "users") {
            void navigate(`/admin/${value}`)
          }
        }}
      >
        <TabsList
          aria-label={t("admin.usersAndGroupsTabsLabel")}
          className="max-w-full justify-start overflow-x-auto"
        >
          <TabsTrigger value="users">{t("admin.usersTitle")}</TabsTrigger>
          <TabsTrigger value="groups">{t("admin.groupsTitle")}</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          {activeTab === "users" ? children : null}
        </TabsContent>
        <TabsContent value="groups">
          {activeTab === "groups" ? children : null}
        </TabsContent>
      </Tabs>
    </PageLayout>
  )
}

function UserManagementPage() {
  const { t, i18n } = useTranslation()
  const { user: currentUser } = useAuth()
  const productName = useProductName()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const queryClient = useQueryClient()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [registrationSourceFilter, setRegistrationSourceFilter] =
    useState<UserRegistrationSourceFilter>("")
  const [tokenQuotaRemainingFilter, setTokenQuotaRemainingFilter] =
    useState<TokenQuotaRemainingFilter>("")
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"user" | "admin">("user")
  const [status, setStatus] = useState<"active" | "disabled">("active")
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [totalTokenLimit, setTotalTokenLimit] = useState("")
  const [weeklyTokenLimit, setWeeklyTokenLimit] = useState("")
  const [monthlyTokenLimit, setMonthlyTokenLimit] = useState("")
  const [quotaEditing, setQuotaEditing] = useState<User | null>(null)
  const [quotaTotalTokenLimit, setQuotaTotalTokenLimit] = useState("")
  const [quotaWeeklyTokenLimit, setQuotaWeeklyTokenLimit] = useState("")
  const [quotaMonthlyTokenLimit, setQuotaMonthlyTokenLimit] = useState("")
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [tokenLimitOpen, setTokenLimitOpen] = useState(false)
  const [batchTotalEnabled, setBatchTotalEnabled] = useState(false)
  const [batchWeeklyEnabled, setBatchWeeklyEnabled] = useState(true)
  const [batchMonthlyEnabled, setBatchMonthlyEnabled] = useState(true)
  const [batchTotalTokenLimit, setBatchTotalTokenLimit] = useState("")
  const [batchWeeklyTokenLimit, setBatchWeeklyTokenLimit] = useState("")
  const [batchMonthlyTokenLimit, setBatchMonthlyTokenLimit] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [templateDownloading, setTemplateDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const users = useQuery({
    queryKey: [
      "admin",
      "users",
      search,
      roleFilter,
      statusFilter,
      registrationSourceFilter,
      tokenQuotaRemainingFilter,
    ],
    queryFn: ({ signal }) =>
      apiRequest("/admin/users", {
        schema: paginatedSchema(userSchema),
        query: {
          q: search,
          role: roleFilter,
          status: statusFilter,
          registration_source: registrationSourceFilter,
          token_quota_remaining_zero: tokenQuotaRemainingFilter,
          limit: 100,
        },
        signal,
      }),
  })
  const groups = useQuery({
    queryKey: ["admin", "user-groups", "options"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/user-groups", {
        schema: paginatedSchema(userGroupSchema),
        query: { limit: 200 },
        signal,
      }),
  })
  const roleSummary = useQuery({
    queryKey: ["admin", "roles", "summary"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/users/role-summary", {
        schema: paginatedSchema(roleSummarySchema),
        signal,
      }),
  })
  const activeAdminCount = roleSummary.data?.items.find(
    (summary) => summary.role === "admin"
  )?.active_count
  const visibleUsers = users.data?.items ?? []
  const selectedUserIdSet = new Set(selectedUserIds)
  const allVisibleUsersSelected =
    visibleUsers.length > 0 &&
    visibleUsers.every((user) => selectedUserIdSet.has(user.id))

  const getStatusRestriction = (managedUser: User) => {
    if (managedUser.id === currentUser?.id) return "self" as const
    if (managedUser.role !== "admin" || managedUser.status !== "active") {
      return null
    }
    if (activeAdminCount === undefined) return "verifying-admins" as const
    if (activeAdminCount <= 1) return "last-admin" as const
    return null
  }

  const getStatusRestrictionMessage = (
    restriction: ReturnType<typeof getStatusRestriction>
  ) => {
    if (restriction === "self") return t("admin.userStatusSelfLocked")
    if (restriction === "last-admin") {
      return t("admin.lastEnabledAdminStatusLocked")
    }
    if (restriction === "verifying-admins") {
      return t("admin.userStatusVerifyingAdmins")
    }
    return null
  }
  const refreshUserManagementData = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
      queryClient.invalidateQueries({
        queryKey: ["admin", "roles", "summary"],
      }),
    ])
  const reset = () => {
    setEditing(null)
    setName("")
    setEmail("")
    setRole("user")
    setStatus("active")
    setGroupIds([])
    setTotalTokenLimit("")
    setWeeklyTokenLimit("")
    setMonthlyTokenLimit("")
  }

  const openCreate = () => {
    reset()
    setEditorOpen(true)
  }

  const openEdit = (user: User) => {
    setEditing(user)
    setName(user.name)
    setEmail(user.email)
    setRole(user.role)
    setStatus(user.status)
    setGroupIds(user.user_group_ids ?? [])
    setTotalTokenLimit(
      tokenLimitToMillionTokenQuotaInput(user.total_token_limit)
    )
    setWeeklyTokenLimit(
      tokenLimitToMillionTokenQuotaInput(user.weekly_token_limit)
    )
    setMonthlyTokenLimit(
      tokenLimitToMillionTokenQuotaInput(user.monthly_token_limit)
    )
    setEditorOpen(true)
  }

  const resetQuotaEditor = () => {
    setQuotaEditing(null)
    setQuotaTotalTokenLimit("")
    setQuotaWeeklyTokenLimit("")
    setQuotaMonthlyTokenLimit("")
  }

  const openQuotaEdit = (user: User) => {
    setQuotaEditing(user)
    setQuotaTotalTokenLimit(
      tokenLimitToMillionTokenQuotaInput(user.total_token_limit)
    )
    setQuotaWeeklyTokenLimit(
      tokenLimitToMillionTokenQuotaInput(user.weekly_token_limit)
    )
    setQuotaMonthlyTokenLimit(
      tokenLimitToMillionTokenQuotaInput(user.monthly_token_limit)
    )
  }

  const toggleUserSelection = (userId: string, selected: boolean) => {
    setSelectedUserIds((current) => {
      const next = new Set(current)
      if (selected) next.add(userId)
      else next.delete(userId)
      return [...next]
    })
  }

  const toggleVisibleUserSelection = (selected: boolean) => {
    setSelectedUserIds((current) => {
      const next = new Set(current)
      for (const user of visibleUsers) {
        if (selected) next.add(user.id)
        else next.delete(user.id)
      }
      return [...next]
    })
  }

  const saveMutation = useMutation({
    mutationFn: (tokenLimits?: {
      total_token_limit: string | null
      weekly_token_limit: string | null
      monthly_token_limit: string | null
    }) =>
      apiRequest(editing ? `/admin/users/${editing.id}` : "/admin/users", {
        method: editing ? "PATCH" : "POST",
        body: {
          name: name.trim(),
          email: email.trim(),
          role,
          ...(editing ? { status, ...tokenLimits } : {}),
          user_group_ids: groupIds,
        },
        schema: userSchema,
      }),
    onMutate: () => {
      setMessage(null)
      setError(null)
    },
    onSuccess: async () => {
      setEditorOpen(false)
      setMessage(
        t(
          editing && editing.email !== email.trim()
            ? "admin.emailUpdated"
            : "admin.userSaved"
        )
      )
      reset()
      await refreshUserManagementData()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const tokenLimitMutation = useMutation({
    mutationFn: (tokenLimits: {
      total_token_limit?: string | null
      weekly_token_limit?: string | null
      monthly_token_limit?: string | null
    }) =>
      apiRequest("/admin/users/token-limits", {
        method: "PATCH",
        body: {
          user_ids: selectedUserIds,
          ...tokenLimits,
        },
        schema: paginatedSchema(userSchema),
      }),
    onMutate: () => {
      setMessage(null)
      setError(null)
    },
    onSuccess: async () => {
      setTokenLimitOpen(false)
      setSelectedUserIds([])
      setMessage(t("admin.tokenLimitsSaved", { count: selectedUserIds.length }))
      await refreshUserManagementData()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const singleTokenLimitMutation = useMutation({
    mutationFn: ({
      targetUser,
      tokenLimits,
    }: {
      targetUser: User
      tokenLimits: {
        total_token_limit: string | null
        weekly_token_limit: string | null
        monthly_token_limit: string | null
      }
    }) =>
      apiRequest(`/admin/users/${targetUser.id}`, {
        method: "PATCH",
        body: tokenLimits,
        schema: userSchema,
      }),
    onMutate: () => {
      setMessage(null)
      setError(null)
    },
    onSuccess: async (_, variables) => {
      resetQuotaEditor()
      setMessage(
        t("admin.singleTokenLimitsSaved", { name: variables.targetUser.name })
      )
      await refreshUserManagementData()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const statusMutation = useMutation({
    mutationFn: ({
      managedUser,
      nextStatus,
    }: {
      managedUser: User
      nextStatus: "active" | "disabled"
    }) =>
      apiRequest(`/admin/users/${managedUser.id}`, {
        method: "PATCH",
        body: { status: nextStatus },
        schema: userSchema,
      }),
    onMutate: () => {
      setMessage(null)
      setError(null)
    },
    onSuccess: async (_, variables) => {
      setMessage(
        t(
          variables.nextStatus === "active"
            ? "admin.userEnabled"
            : "admin.userDisabled",
          { name: variables.managedUser.name }
        )
      )
      await refreshUserManagementData()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const importMutation = useMutation({
    mutationFn: () => {
      const formData = new FormData()
      if (importFile) formData.append("file", importFile)
      return apiRequest("/admin/users/import", {
        method: "POST",
        body: formData,
        schema: importResultSchema,
      })
    },
    onSuccess: async (result) => {
      setImportResult(result)
      if (result.errors.length === 0) {
        notify.success(t("admin.importResult"), {
          id: "admin-user-import-success",
          description: t("admin.importCounts", {
            imported: result.imported_count,
            skipped: result.skipped_count,
          }),
        })
      }
      await refreshUserManagementData()
    },
    onError: (nextError) => {
      const parsed =
        nextError instanceof ApiError
          ? z
              .object({
                errors: z.array(
                  z.object({
                    row: z.number().int().positive(),
                    field: z.string(),
                    code: z.string(),
                  })
                ),
              })
              .safeParse(nextError.params)
          : null
      if (parsed?.success) {
        const errors = parsed.data.errors.map((issue) => {
          const messageKey =
            issue.code === "duplicate_in_file"
              ? "admin.importErrors.duplicateInFile"
              : issue.code === "USER_EMAIL_ALREADY_EXISTS"
                ? "admin.importErrors.emailExists"
                : issue.code === "user_group_not_found"
                  ? "admin.importErrors.groupNotFound"
                  : issue.field === "email"
                    ? "admin.importErrors.invalidEmail"
                    : issue.field === "role"
                      ? "admin.importErrors.invalidRole"
                      : issue.field === "name"
                        ? "admin.importErrors.invalidName"
                        : "admin.importErrors.invalidRow"
          return {
            row: issue.row,
            error_code: issue.code,
            message: t(messageKey),
          }
        })
        setImportResult({
          imported_count: 0,
          skipped_count: new Set(errors.map((issue) => issue.row)).size,
          errors,
        })
        return
      }
      setError(getErrorMessage(nextError, t))
    },
  })

  const downloadTemplate = async () => {
    if (templateDownloading) return
    setTemplateDownloading(true)
    setError(null)
    try {
      const source = await downloadApiFile("/admin/users/import-template.xlsx")
      downloadBlob(
        source,
        t("admin.templateFilename", {
          productPrefix: productFilenamePrefix(productName),
        })
      )
    } catch (nextError) {
      setError(getErrorMessage(nextError, t))
    } finally {
      setTemplateDownloading(false)
    }
  }

  return (
    <UsersAndGroupsManagementLayout
      activeTab="users"
      actions={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setImportResult(null)
              setImportOpen(true)
            }}
          >
            <FileUpIcon aria-hidden="true" /> {t("admin.importUsers")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={selectedUserIds.length === 0}
            onClick={() => setTokenLimitOpen(true)}
          >
            <SlidersHorizontalIcon aria-hidden="true" />
            {t("admin.batchTokenLimits", { count: selectedUserIds.length })}
          </Button>
          <Button type="button" onClick={openCreate}>
            {t("admin.createUser")}
          </Button>
        </>
      }
    >
      <NotificationToast id="admin-user-saved" message={message} />
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <div className="filter-row user-management-filters">
        <FieldShell id="user-search" label={t("common.search")}>
          <div className="input-with-icon">
            <SearchIcon aria-hidden="true" />
            <Input
              id="user-search"
              className="h-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("admin.userSearchPlaceholder")}
            />
          </div>
        </FieldShell>
        <FieldShell id="user-role-filter" label={t("admin.role")}>
          <AdminSelect
            id="user-role-filter"
            value={roleFilter}
            onValueChange={setRoleFilter}
            options={[
              { value: "", label: t("common.all") },
              { value: "user", label: t("common.user") },
              { value: "admin", label: t("common.admin") },
            ]}
          />
        </FieldShell>
        <FieldShell id="user-status-filter" label={t("common.status")}>
          <AdminSelect
            id="user-status-filter"
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={[
              { value: "", label: t("common.all") },
              { value: "active", label: t("statuses.active") },
              { value: "disabled", label: t("statuses.disabled") },
            ]}
          />
        </FieldShell>
        <FieldShell
          id="user-registration-source-filter"
          label={t("admin.registrationSource")}
        >
          <AdminSelect
            id="user-registration-source-filter"
            value={registrationSourceFilter}
            onValueChange={(value) =>
              setRegistrationSourceFilter(
                isUserRegistrationSourceFilter(value) ? value : ""
              )
            }
            options={[
              { value: "", label: t("common.all") },
              {
                value: "self_registration",
                label: t("admin.registrationSources.selfRegistration"),
              },
              {
                value: "organization_invitation",
                label: t("admin.registrationSources.organizationInvitation"),
              },
            ]}
          />
        </FieldShell>
        <FieldShell
          id="user-token-quota-remaining-filter"
          label={t("admin.tokenQuotaRemainingFilter")}
        >
          <AdminSelect
            id="user-token-quota-remaining-filter"
            value={tokenQuotaRemainingFilter}
            onValueChange={(value) =>
              setTokenQuotaRemainingFilter(
                isTokenQuotaRemainingFilter(value) ? value : ""
              )
            }
            options={[
              { value: "", label: t("common.all") },
              {
                value: "total",
                label: t("admin.totalTokenQuotaRemainingZero"),
              },
              {
                value: "weekly",
                label: t("admin.weeklyTokenQuotaRemainingZero"),
              },
              {
                value: "monthly",
                label: t("admin.monthlyTokenQuotaRemainingZero"),
              },
            ]}
          />
        </FieldShell>
      </div>
      {users.isLoading && <LoadingState />}
      {users.isError && (
        <ErrorState
          message={getErrorMessage(users.error, t)}
          onRetry={() => void users.refetch()}
        />
      )}
      {users.data?.items.length === 0 && (
        <EmptyState title={t("admin.usersEmpty")} />
      )}
      {users.data && users.data.items.length > 0 && (
        <div className="data-table-scroll">
          <Table className="data-table user-management-table [&_td]:align-middle!">
            <TableHeader>
              <TableRow>
                <TableHead className="user-management-selection-column">
                  <Checkbox
                    checked={allVisibleUsersSelected}
                    aria-label={t("admin.selectVisibleUsers")}
                    onCheckedChange={(checked) =>
                      toggleVisibleUserSelection(checked === true)
                    }
                  />
                </TableHead>
                <TableHead className="user-management-name-column">
                  {t("common.name")}
                </TableHead>
                <TableHead>{t("admin.role")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("admin.registrationSource")}</TableHead>
                <TableHead>{t("admin.loginMethod")}</TableHead>
                <TableHead>{t("admin.groups")}</TableHead>
                <TableHead>{t("admin.totalTokenLimit")}</TableHead>
                <TableHead>{t("admin.weeklyTokenLimit")}</TableHead>
                <TableHead>{t("admin.monthlyTokenLimit")}</TableHead>
                <TableHead className="user-management-last-login-column">
                  {t("admin.lastLogin")}
                </TableHead>
                <TableHead className="user-management-actions-column">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.items.map((user) => {
                const statusRestriction = getStatusRestriction(user)
                const statusRestrictionMessage =
                  getStatusRestrictionMessage(statusRestriction)
                const statusActionLabel = t(
                  user.status === "active"
                    ? "admin.disableUserNamed"
                    : "admin.enableUserNamed",
                  { name: user.name }
                )

                return (
                  <TableRow key={user.id}>
                    <TableCell className="user-management-selection-column">
                      <Checkbox
                        checked={selectedUserIdSet.has(user.id)}
                        aria-label={t("admin.selectUser", {
                          name: user.name,
                        })}
                        onCheckedChange={(checked) =>
                          toggleUserSelection(user.id, checked === true)
                        }
                      />
                    </TableCell>
                    <TableCell className="user-management-name-column">
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar className="size-7 bg-[var(--app-avatar)]">
                          {user.avatar_url && (
                            <AvatarImage src={user.avatar_url} alt="" />
                          )}
                          <AvatarFallback className="text-xs font-semibold">
                            {user.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0">
                          <span className="table-primary truncate">
                            {user.name}
                          </span>
                          <span className="table-secondary truncate">
                            {user.email}
                          </span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {t(
                        user.role === "admin" ? "common.admin" : "common.user"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          user.status === "active" ? "secondary" : "outline"
                        }
                      >
                        {t(`statuses.${user.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          user.registration_source === "self_registration"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {t(
                          user.registration_source === "self_registration"
                            ? "admin.registrationSources.selfRegistration"
                            : "admin.registrationSources.organizationInvitation"
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.login_method
                        ? t(`loginMethods.${user.login_method}`)
                        : t("common.notAvailable")}
                    </TableCell>
                    <TableCell>
                      <UserGroupsCell groups={user.user_groups} />
                    </TableCell>
                    <TableCell className="table-metadata">
                      <UserTokenLimitCell
                        limit={user.total_token_limit}
                        period={user.token_quota?.total}
                      />
                    </TableCell>
                    <TableCell className="table-metadata">
                      <UserTokenLimitCell
                        limit={user.weekly_token_limit}
                        period={user.token_quota?.weekly}
                      />
                    </TableCell>
                    <TableCell className="table-metadata">
                      <UserTokenLimitCell
                        limit={user.monthly_token_limit}
                        period={user.token_quota?.monthly}
                      />
                    </TableCell>
                    <TableCell className="table-metadata user-management-last-login-column">
                      {formatDateTime(
                        user.last_login_at ?? undefined,
                        language
                      )}
                    </TableCell>
                    <TableCell className="user-management-actions-column">
                      <div className="flex items-center justify-end gap-2">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="text-muted-foreground"
                                aria-label={t("admin.adjustUserTokenLimits", {
                                  name: user.name,
                                })}
                                onClick={() => openQuotaEdit(user)}
                              />
                            }
                          >
                            <SlidersHorizontalIcon aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t("admin.adjustTokenLimits")}</p>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="text-muted-foreground"
                                aria-label={t("common.edit")}
                                onClick={() => openEdit(user)}
                              />
                            }
                          >
                            <PencilIcon aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t("common.edit")}</p>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={<span className="inline-flex" />}
                          >
                            <Switch
                              size="sm"
                              checked={user.status === "active"}
                              disabled={
                                statusRestriction !== null ||
                                statusMutation.isPending
                              }
                              aria-label={statusActionLabel}
                              aria-busy={
                                statusMutation.isPending &&
                                statusMutation.variables?.managedUser.id ===
                                  user.id
                              }
                              onCheckedChange={(checked) =>
                                statusMutation.mutate({
                                  managedUser: user,
                                  nextStatus: checked ? "active" : "disabled",
                                })
                              }
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              {statusRestrictionMessage ?? statusActionLabel}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) reset()
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>
              {t(editing ? "admin.editUser" : "admin.createUser")}
            </DialogTitle>
            <DialogDescription>{t("admin.noPasswordNotice")}</DialogDescription>
          </DialogHeader>
          <form
            className="form-stack"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              if (editing) {
                let tokenLimits: {
                  total_token_limit: string | null
                  weekly_token_limit: string | null
                  monthly_token_limit: string | null
                }
                try {
                  tokenLimits = {
                    total_token_limit:
                      millionTokenQuotaInputToTokenLimit(totalTokenLimit),
                    weekly_token_limit:
                      millionTokenQuotaInputToTokenLimit(weeklyTokenLimit),
                    monthly_token_limit:
                      millionTokenQuotaInputToTokenLimit(monthlyTokenLimit),
                  }
                } catch {
                  setError(t("admin.tokenLimitInputInvalid"))
                  return
                }
                saveMutation.mutate(tokenLimits)
                return
              }
              saveMutation.mutate(undefined)
            }}
          >
            <div className="form-grid">
              <FieldShell id="user-name" label={t("common.name")}>
                <Input
                  id="user-name"
                  className="h-9"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </FieldShell>
              <FieldShell id="user-email" label={t("common.email")}>
                <Input
                  id="user-email"
                  className="h-9"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </FieldShell>
              <FieldShell id="user-role" label={t("admin.role")}>
                <AdminSelect
                  id="user-role"
                  value={role}
                  onValueChange={(nextRole) => setRole(nextRole as typeof role)}
                  options={[
                    { value: "user", label: t("common.user") },
                    { value: "admin", label: t("common.admin") },
                  ]}
                />
              </FieldShell>
              {editing && (
                <FieldShell id="user-status" label={t("common.status")}>
                  <AdminSelect
                    id="user-status"
                    value={status}
                    disabled={getStatusRestriction(editing) !== null}
                    onValueChange={(nextStatus) =>
                      setStatus(nextStatus as typeof status)
                    }
                    options={[
                      { value: "active", label: t("statuses.active") },
                      { value: "disabled", label: t("statuses.disabled") },
                    ]}
                  />
                  {getStatusRestriction(editing) !== null && (
                    <p className="text-xs text-muted-foreground">
                      {getStatusRestrictionMessage(
                        getStatusRestriction(editing)
                      )}
                    </p>
                  )}
                </FieldShell>
              )}
            </div>
            <MultiSelectList
              label={t("admin.groups")}
              values={groupIds}
              onChange={setGroupIds}
              options={(groups.data?.items ?? []).map((group) => ({
                id: group.id,
                name: group.name,
                secondary: group.description,
              }))}
            />
            {editing && (
              <section
                className="grid gap-3"
                aria-labelledby="user-token-quota-title"
              >
                <div className="grid gap-1">
                  <h3 id="user-token-quota-title" className="form-label">
                    {t("admin.userTokenLimits")}
                  </h3>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("admin.userTokenLimitsDescription")}
                  </p>
                </div>
                <div className="form-grid">
                  <FieldShell
                    id="user-total-token-limit"
                    label={t("admin.totalTokenLimit")}
                    hint={t("admin.tokenLimitHint")}
                  >
                    <Input
                      id="user-total-token-limit"
                      className="h-9"
                      inputMode="decimal"
                      pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                      value={totalTokenLimit}
                      onChange={(event) =>
                        setTotalTokenLimit(event.target.value)
                      }
                      placeholder={t("admin.inheritTokenLimit")}
                    />
                  </FieldShell>
                  <FieldShell
                    id="user-weekly-token-limit"
                    label={t("admin.weeklyTokenLimit")}
                    hint={t("admin.tokenLimitHint")}
                  >
                    <Input
                      id="user-weekly-token-limit"
                      className="h-9"
                      inputMode="decimal"
                      pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                      value={weeklyTokenLimit}
                      onChange={(event) =>
                        setWeeklyTokenLimit(event.target.value)
                      }
                      placeholder={t("admin.inheritTokenLimit")}
                    />
                  </FieldShell>
                  <FieldShell
                    id="user-monthly-token-limit"
                    label={t("admin.monthlyTokenLimit")}
                    hint={t("admin.tokenLimitHint")}
                  >
                    <Input
                      id="user-monthly-token-limit"
                      className="h-9"
                      inputMode="decimal"
                      pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                      value={monthlyTokenLimit}
                      onChange={(event) =>
                        setMonthlyTokenLimit(event.target.value)
                      }
                      placeholder={t("admin.inheritTokenLimit")}
                    />
                  </FieldShell>
                </div>
              </section>
            )}
            {editing && (
              <section
                className="settings-section"
                aria-labelledby="user-metadata-title"
              >
                <h3 id="user-metadata-title">{t("admin.accountMetadata")}</h3>
                <dl className="definition-list">
                  <div>
                    <dt>{t("common.createdAt")}</dt>
                    <dd>{formatDateTime(editing.created_at, language)}</dd>
                  </div>
                  <div>
                    <dt>{t("admin.passwordUpdated")}</dt>
                    <dd>
                      {formatDateTime(
                        editing.password_updated_at ?? undefined,
                        language
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("admin.personalPlugins")}</dt>
                    <dd>{editing.personal_plugin_count ?? 0}</dd>
                  </div>
                  <div>
                    <dt>{t("admin.personalSkills")}</dt>
                    <dd>{editing.personal_skill_count ?? 0}</dd>
                  </div>
                  <div>
                    <dt>{t("admin.personalCredentials")}</dt>
                    <dd>{editing.personal_credential_count ?? 0}</dd>
                  </div>
                </dl>
              </section>
            )}
            {editing &&
              ((editing.status === "active" && status === "disabled") ||
                (editing.role === "admin" && role === "user")) && (
                <StatusBanner variant="warning">
                  {t("admin.userPrivilegeChangeWarning")}
                </StatusBanner>
              )}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                {t("common.cancel")}
              </DialogClose>
              <Button
                type="submit"
                variant={
                  editing &&
                  ((editing.status === "active" && status === "disabled") ||
                    (editing.role === "admin" && role === "user"))
                    ? "destructive"
                    : "default"
                }
                disabled={
                  !name.trim() || !email.trim() || saveMutation.isPending
                }
                aria-busy={saveMutation.isPending || undefined}
              >
                {saveMutation.isPending && <Spinner data-icon="inline-start" />}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={quotaEditing !== null}
        onOpenChange={(open) => {
          if (!open) resetQuotaEditor()
        }}
      >
        <DialogContent closeLabel={t("common.close")} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("admin.singleTokenLimitsTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin.singleTokenLimitsDescription", {
                name: quotaEditing?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <form
            className="form-stack"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              if (!quotaEditing) return
              let tokenLimits: {
                total_token_limit: string | null
                weekly_token_limit: string | null
                monthly_token_limit: string | null
              }
              try {
                tokenLimits = {
                  total_token_limit:
                    millionTokenQuotaInputToTokenLimit(quotaTotalTokenLimit),
                  weekly_token_limit: millionTokenQuotaInputToTokenLimit(
                    quotaWeeklyTokenLimit
                  ),
                  monthly_token_limit: millionTokenQuotaInputToTokenLimit(
                    quotaMonthlyTokenLimit
                  ),
                }
              } catch {
                setError(t("admin.tokenLimitInputInvalid"))
                return
              }
              singleTokenLimitMutation.mutate({
                targetUser: quotaEditing,
                tokenLimits,
              })
            }}
          >
            <div className="form-grid">
              <FieldShell
                id="single-total-token-limit"
                label={t("admin.totalTokenLimit")}
                hint={t("admin.tokenLimitHint")}
              >
                <Input
                  id="single-total-token-limit"
                  className="h-9"
                  inputMode="decimal"
                  pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                  value={quotaTotalTokenLimit}
                  disabled={singleTokenLimitMutation.isPending}
                  onChange={(event) =>
                    setQuotaTotalTokenLimit(event.target.value)
                  }
                  placeholder={t("admin.inheritTokenLimit")}
                />
              </FieldShell>
              <FieldShell
                id="single-weekly-token-limit"
                label={t("admin.weeklyTokenLimit")}
                hint={t("admin.tokenLimitHint")}
              >
                <Input
                  id="single-weekly-token-limit"
                  className="h-9"
                  inputMode="decimal"
                  pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                  value={quotaWeeklyTokenLimit}
                  disabled={singleTokenLimitMutation.isPending}
                  onChange={(event) =>
                    setQuotaWeeklyTokenLimit(event.target.value)
                  }
                  placeholder={t("admin.inheritTokenLimit")}
                />
              </FieldShell>
              <FieldShell
                id="single-monthly-token-limit"
                label={t("admin.monthlyTokenLimit")}
                hint={t("admin.tokenLimitHint")}
              >
                <Input
                  id="single-monthly-token-limit"
                  className="h-9"
                  inputMode="decimal"
                  pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                  value={quotaMonthlyTokenLimit}
                  disabled={singleTokenLimitMutation.isPending}
                  onChange={(event) =>
                    setQuotaMonthlyTokenLimit(event.target.value)
                  }
                  placeholder={t("admin.inheritTokenLimit")}
                />
              </FieldShell>
            </div>
            {quotaEditing?.registration_source === "self_registration" && (
              <p className="text-xs leading-5 text-muted-foreground">
                {t("admin.selfRegisteredTotalQuotaOverrideHint")}
              </p>
            )}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                {t("common.cancel")}
              </DialogClose>
              <Button
                type="submit"
                disabled={singleTokenLimitMutation.isPending}
                aria-busy={singleTokenLimitMutation.isPending || undefined}
              >
                {singleTokenLimitMutation.isPending && (
                  <Spinner data-icon="inline-start" />
                )}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tokenLimitOpen}
        onOpenChange={(open) => {
          setTokenLimitOpen(open)
          if (!open) {
            setBatchTotalEnabled(false)
            setBatchWeeklyEnabled(true)
            setBatchMonthlyEnabled(true)
            setBatchTotalTokenLimit("")
            setBatchWeeklyTokenLimit("")
            setBatchMonthlyTokenLimit("")
          }
        }}
      >
        <DialogContent closeLabel={t("common.close")} className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("admin.batchTokenLimitsTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin.batchTokenLimitsDescription", {
                count: selectedUserIds.length,
              })}
            </DialogDescription>
          </DialogHeader>
          <form
            className="form-stack"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              const tokenLimits: {
                total_token_limit?: string | null
                weekly_token_limit?: string | null
                monthly_token_limit?: string | null
              } = {}
              try {
                if (batchTotalEnabled) {
                  tokenLimits.total_token_limit =
                    millionTokenQuotaInputToTokenLimit(batchTotalTokenLimit)
                }
                if (batchWeeklyEnabled) {
                  tokenLimits.weekly_token_limit =
                    millionTokenQuotaInputToTokenLimit(batchWeeklyTokenLimit)
                }
                if (batchMonthlyEnabled) {
                  tokenLimits.monthly_token_limit =
                    millionTokenQuotaInputToTokenLimit(batchMonthlyTokenLimit)
                }
              } catch {
                setError(t("admin.tokenLimitInputInvalid"))
                return
              }
              tokenLimitMutation.mutate(tokenLimits)
            }}
          >
            <FieldSet className="grid gap-3">
              <FieldLegend>{t("admin.tokenLimitFields")}</FieldLegend>
              <FieldLabel className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={batchTotalEnabled}
                  onCheckedChange={(checked) =>
                    setBatchTotalEnabled(checked === true)
                  }
                />
                <span>{t("admin.updateTotalTokenLimit")}</span>
              </FieldLabel>
              <FieldShell
                id="batch-total-token-limit"
                label={t("admin.totalTokenLimit")}
                hint={t("admin.tokenLimitHint")}
              >
                <Input
                  id="batch-total-token-limit"
                  className="h-9"
                  inputMode="decimal"
                  pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                  value={batchTotalTokenLimit}
                  disabled={!batchTotalEnabled}
                  onChange={(event) =>
                    setBatchTotalTokenLimit(event.target.value)
                  }
                  placeholder={t("admin.clearTokenLimit")}
                />
              </FieldShell>
              <FieldLabel className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={batchWeeklyEnabled}
                  onCheckedChange={(checked) =>
                    setBatchWeeklyEnabled(checked === true)
                  }
                />
                <span>{t("admin.updateWeeklyTokenLimit")}</span>
              </FieldLabel>
              <FieldShell
                id="batch-weekly-token-limit"
                label={t("admin.weeklyTokenLimit")}
                hint={t("admin.tokenLimitHint")}
              >
                <Input
                  id="batch-weekly-token-limit"
                  className="h-9"
                  inputMode="decimal"
                  pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                  value={batchWeeklyTokenLimit}
                  disabled={!batchWeeklyEnabled}
                  onChange={(event) =>
                    setBatchWeeklyTokenLimit(event.target.value)
                  }
                  placeholder={t("admin.clearTokenLimit")}
                />
              </FieldShell>
              <FieldLabel className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={batchMonthlyEnabled}
                  onCheckedChange={(checked) =>
                    setBatchMonthlyEnabled(checked === true)
                  }
                />
                <span>{t("admin.updateMonthlyTokenLimit")}</span>
              </FieldLabel>
              <FieldShell
                id="batch-monthly-token-limit"
                label={t("admin.monthlyTokenLimit")}
                hint={t("admin.tokenLimitHint")}
              >
                <Input
                  id="batch-monthly-token-limit"
                  className="h-9"
                  inputMode="decimal"
                  pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                  value={batchMonthlyTokenLimit}
                  disabled={!batchMonthlyEnabled}
                  onChange={(event) =>
                    setBatchMonthlyTokenLimit(event.target.value)
                  }
                  placeholder={t("admin.clearTokenLimit")}
                />
              </FieldShell>
            </FieldSet>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                {t("common.cancel")}
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  selectedUserIds.length === 0 ||
                  (!batchTotalEnabled &&
                    !batchWeeklyEnabled &&
                    !batchMonthlyEnabled) ||
                  tokenLimitMutation.isPending
                }
                aria-busy={tokenLimitMutation.isPending || undefined}
              >
                {tokenLimitMutation.isPending && (
                  <Spinner data-icon="inline-start" />
                )}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) {
            setImportFile(null)
            setImportResult(null)
          }
        }}
      >
        <DialogContent closeLabel={t("common.close")} className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("admin.importUsers")}</DialogTitle>
            <DialogDescription>
              {t("admin.importDescription")}
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={importInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label={t("admin.chooseExcel")}
            className="sr-only"
            onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
          />
          <div
            data-slot="excel-import-actions"
            className="flex flex-col items-start gap-2 sm:flex-row sm:items-center"
          >
            <Button
              type="button"
              variant="outline"
              className="w-full min-w-0 justify-start sm:flex-1"
              onClick={() => importInputRef.current?.click()}
            >
              <FileUpIcon data-icon="inline-start" aria-hidden="true" />
              <span className="truncate" title={importFile?.name}>
                {importFile?.name ?? t("admin.chooseExcel")}
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={templateDownloading}
              aria-busy={templateDownloading}
              onClick={() => void downloadTemplate()}
            >
              {templateDownloading ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <DownloadIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {t("admin.downloadTemplate")}
            </Button>
          </div>
          {importResult && importResult.errors.length > 0 && (
            <StatusBanner variant="warning" title={t("admin.importResult")}>
              <p>
                {t("admin.importCounts", {
                  imported: importResult.imported_count,
                  skipped: importResult.skipped_count,
                })}
              </p>
              {importResult.errors.length > 0 && (
                <ul className="feedback-list">
                  {importResult.errors.map((item, index) => (
                    <li key={`${item.row ?? "x"}-${index}`}>
                      {t("admin.importErrorRow", {
                        row: item.row ?? "—",
                        message:
                          item.message ??
                          item.error_code ??
                          t("errors.unknown"),
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </StatusBanner>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("common.close")}
            </DialogClose>
            <Button
              type="button"
              disabled={!importFile || importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              {t("admin.importSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UsersAndGroupsManagementLayout>
  )
}

const rolePermissionMatrix = [
  ["ownConversations", true, true],
  ["personalSettings", true, true],
  ["personalCapabilities", true, true],
  ["usePluginCenter", true, true],
  ["personalCredentials", true, true],
  ["personalKnowledgeBases", true, true],
  ["manageUsersAndGroups", false, true],
  ["governStoreCapabilities", false, true],
  ["governKnowledgeBases", false, true],
  ["manageKnowledgeSources", false, true],
  ["manageModelsAndPricing", false, true],
  ["manageSystemSettings", false, true],
  ["manageSystemHealth", false, true],
  ["viewAuditMetadata", false, true],
  ["viewUsageAnalytics", false, true],
] as const

function RoleOverviewPage() {
  const { t } = useTranslation()
  const productName = useProductName()
  const summaryQuery = useQuery({
    queryKey: ["admin", "roles", "summary"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/users/role-summary", {
        schema: paginatedSchema(roleSummarySchema),
        signal,
      }),
  })
  const summaryByRole = new Map(
    (summaryQuery.data?.items ?? []).map((summary) => [summary.role, summary])
  )
  return (
    <PageLayout
      title={t("admin.rolesTitle")}
      description={t("admin.rolesDescription", { productName })}
      className="role-permission-page"
    >
      {summaryQuery.isLoading && <LoadingState />}
      {summaryQuery.isError && (
        <ErrorState
          message={getErrorMessage(summaryQuery.error, t)}
          onRetry={() => void summaryQuery.refetch()}
        />
      )}
      <div className="role-overview-grid">
        <section
          className="settings-section role-summary"
          aria-labelledby="role-user-title"
        >
          <div className="flex items-center gap-2">
            <h2 id="role-user-title">{t("common.user")}</h2>
            <Badge variant="secondary">user</Badge>
          </div>
          <p>{t("admin.roleUserDescription")}</p>
          <RoleAccountCount summary={summaryByRole.get("user")} />
        </section>
        <section
          className="settings-section role-summary"
          aria-labelledby="role-admin-title"
        >
          <div className="flex items-center gap-2">
            <h2 id="role-admin-title">{t("common.admin")}</h2>
            <Badge variant="secondary">admin</Badge>
          </div>
          <p>{t("admin.roleAdminDescription")}</p>
          <RoleAccountCount summary={summaryByRole.get("admin")} />
        </section>
      </div>
      <section
        className="settings-section role-permission-section"
        aria-labelledby="permission-matrix-title"
      >
        <h2 id="permission-matrix-title">{t("admin.permissionMatrix")}</h2>
        <div className="data-table-scroll">
          <Table
            className="data-table"
            aria-label={t("admin.permissionMatrix")}
          >
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.permission")}</TableHead>
                <TableHead>{t("common.user")}</TableHead>
                <TableHead>{t("common.admin")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rolePermissionMatrix.map(
                ([permission, userAllowed, adminAllowed]) => (
                  <TableRow key={permission}>
                    <TableCell>
                      {t(`admin.rolePermissions.${permission}`)}
                    </TableCell>
                    <TableCell>
                      {t(userAllowed ? "common.yes" : "common.no")}
                    </TableCell>
                    <TableCell>
                      {t(adminAllowed ? "common.yes" : "common.no")}
                    </TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </PageLayout>
  )
}

function RoleAccountCount({
  summary,
}: {
  summary?: {
    active_count: number
    disabled_count: number
    total_count: number
  }
}) {
  const { t } = useTranslation()
  return (
    <div
      className="role-account-count"
      aria-label={t("admin.roleAccountBreakdown")}
    >
      <strong>
        {summary
          ? t("admin.roleAccountCount", { count: summary.total_count })
          : "—"}
      </strong>
      {summary && (
        <span>
          {t("admin.roleActiveAccountCount", { count: summary.active_count })} ·{" "}
          {t("admin.roleDisabledAccountCount", {
            count: summary.disabled_count,
          })}
        </span>
      )}
    </div>
  )
}

function UserGroupManagementPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<UserGroup | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [memberListTarget, setMemberListTarget] = useState<UserGroup | null>(
    null
  )
  const [deleteTarget, setDeleteTarget] = useState<UserGroup | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const groups = useQuery({
    queryKey: ["admin", "user-groups"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/user-groups", {
        schema: paginatedSchema(userGroupSchema),
        query: { limit: 200 },
        signal,
      }),
  })
  const users = useQuery({
    queryKey: ["admin", "users", "group-options"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/users", {
        schema: paginatedSchema(userSchema),
        query: { limit: 500 },
        signal,
      }),
  })
  const groupMembers = useInfiniteQuery({
    queryKey: ["admin", "user-groups", memberListTarget?.id, "members"],
    initialPageParam: undefined as string | undefined,
    enabled: Boolean(memberListTarget),
    queryFn: ({ pageParam, signal }) => {
      if (!memberListTarget) {
        throw new Error("User group is required")
      }
      return apiRequest("/admin/users", {
        schema: paginatedSchema(userSchema),
        query: {
          user_group_id: memberListTarget.id,
          cursor: pageParam,
          limit: 100,
        },
        signal,
      })
    },
    getNextPageParam: (lastPage, _pages, _lastPageParam, allPageParams) => {
      const nextCursor = lastPage.next_cursor ?? undefined
      return nextCursor && !allPageParams.includes(nextCursor)
        ? nextCursor
        : undefined
    },
  })
  const visibleGroupMembers =
    groupMembers.data?.pages.flatMap((page) => page.items) ?? []
  const reset = () => {
    setEditing(null)
    setName("")
    setDescription("")
    setMemberIds([])
  }
  const openCreate = () => {
    reset()
    setEditorOpen(true)
  }
  const openEdit = (group: UserGroup) => {
    setEditing(group)
    setName(group.name)
    setDescription(group.description ?? "")
    setMemberIds(group.member_ids ?? [])
    setEditorOpen(true)
  }
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "user-groups"] })

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        editing ? `/admin/user-groups/${editing.id}` : "/admin/user-groups",
        {
          method: editing ? "PATCH" : "POST",
          body: {
            name: name.trim(),
            description: description.trim() || null,
            member_ids: memberIds,
          },
          schema: userGroupSchema,
        }
      ),
    onSuccess: async () => {
      setEditorOpen(false)
      reset()
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/admin/user-groups/${deleteTarget?.id}`, {
        method: "DELETE",
        schema: emptySchema,
      }),
    onSuccess: async () => {
      setDeleteTarget(null)
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  return (
    <UsersAndGroupsManagementLayout
      activeTab="groups"
      actions={<Button onClick={openCreate}>{t("admin.createGroup")}</Button>}
    >
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      {groups.isLoading && <LoadingState />}
      {groups.isError && (
        <ErrorState
          message={getErrorMessage(groups.error, t)}
          onRetry={() => void groups.refetch()}
        />
      )}
      {groups.data?.items.length === 0 && (
        <EmptyState title={t("admin.groupsEmpty")} />
      )}
      <div className="entity-list">
        {groups.data?.items.map((group) => (
          <article key={group.id} className="entity-row">
            <div className="min-w-0 flex-1">
              <h2>{group.name}</h2>
              {group.description && <p>{group.description}</p>}
              <div className="entity-meta">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-muted-foreground"
                  aria-label={t("admin.viewGroupMembers", {
                    name: group.name,
                    count: group.member_count ?? group.member_ids?.length ?? 0,
                  })}
                  onClick={() => setMemberListTarget(group)}
                >
                  {t("admin.members")}:{" "}
                  {group.member_count ?? group.member_ids?.length ?? 0}
                </Button>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("common.actions")}
                  />
                }
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(group)}>
                  {t("common.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteTarget(group)}
                >
                  {t("common.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </article>
        ))}
      </div>
      <Dialog
        open={Boolean(memberListTarget)}
        onOpenChange={(open) => !open && setMemberListTarget(null)}
      >
        <DialogContent closeLabel={t("common.close")} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("admin.groupMembersTitle", {
                name: memberListTarget?.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("admin.groupMembersDescription", {
                count:
                  memberListTarget?.member_count ??
                  memberListTarget?.member_ids?.length ??
                  0,
              })}
            </DialogDescription>
          </DialogHeader>
          {groupMembers.isLoading && <LoadingState />}
          {groupMembers.isError && (
            <ErrorState
              message={getErrorMessage(groupMembers.error, t)}
              onRetry={() => void groupMembers.refetch()}
            />
          )}
          {!groupMembers.isLoading &&
            !groupMembers.isError &&
            visibleGroupMembers.length === 0 && (
              <EmptyState title={t("admin.groupMembersEmpty")} />
            )}
          {visibleGroupMembers.length > 0 && (
            <div className="max-h-[min(60vh,32rem)] overflow-y-auto rounded-xl border border-border/50">
              <ul
                className="divide-y divide-border/50"
                aria-label={t("admin.memberListLabel")}
              >
                {visibleGroupMembers.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <Avatar className="size-8 bg-[var(--app-avatar)]">
                      {member.avatar_url && (
                        <AvatarImage src={member.avatar_url} alt="" />
                      )}
                      <AvatarFallback className="text-xs font-semibold">
                        {member.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {member.name}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {member.email}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">
                        {t(
                          member.role === "admin"
                            ? "common.admin"
                            : "common.user"
                        )}
                      </Badge>
                      <Badge
                        variant={
                          member.status === "active" ? "secondary" : "outline"
                        }
                      >
                        {t(`statuses.${member.status}`)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {groupMembers.isFetchNextPageError && (
            <StatusBanner variant="error">
              {getErrorMessage(groupMembers.error, t)}
            </StatusBanner>
          )}
          {groupMembers.hasNextPage && (
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={groupMembers.isFetchingNextPage}
                onClick={() => void groupMembers.fetchNextPage()}
              >
                {groupMembers.isFetchingNextPage
                  ? t("common.loading")
                  : t("admin.loadMoreMembers")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) reset()
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>
              {t(editing ? "admin.editGroup" : "admin.createGroup")}
            </DialogTitle>
          </DialogHeader>
          <form
            className="form-stack"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              saveMutation.mutate()
            }}
          >
            <FieldShell id="group-name" label={t("common.name")}>
              <Input
                id="group-name"
                className="h-9"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </FieldShell>
            <FieldShell
              id="group-description"
              label={t("capability.descriptionLabel")}
            >
              <Textarea
                id="group-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FieldShell>
            <MemberMultiSelect
              values={memberIds}
              onChange={setMemberIds}
              members={users.data?.items ?? []}
            />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                {t("common.cancel")}
              </DialogClose>
              <Button
                type="submit"
                disabled={!name.trim() || saveMutation.isPending}
                aria-busy={saveMutation.isPending || undefined}
              >
                {saveMutation.isPending && <Spinner data-icon="inline-start" />}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("admin.deleteGroupTitle")}
        description={t("admin.parentDeleteDescription")}
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </UsersAndGroupsManagementLayout>
  )
}

type AuditSurface = "events" | "conversations" | "retainedArtifacts"

function AuditPage() {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [surface, setSurface] = useState<AuditSurface>("events")
  const [search, setSearch] = useState("")
  const [action, setAction] = useState("")
  const [result, setResult] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([])
  const [conversationSearch, setConversationSearch] = useState("")
  const [conversationStatus, setConversationStatus] = useState("")
  const [conversationPlugin, setConversationPlugin] = useState("")
  const [conversationSkill, setConversationSkill] = useState("")
  const [conversationErrorCode, setConversationErrorCode] = useState("")
  const [conversationRunnerStatus, setConversationRunnerStatus] = useState("")
  const [conversationArchiveStatus, setConversationArchiveStatus] = useState("")
  const [conversationCreatedFrom, setConversationCreatedFrom] = useState("")
  const [conversationCreatedTo, setConversationCreatedTo] = useState("")
  const [conversationLastRunFrom, setConversationLastRunFrom] = useState("")
  const [conversationLastRunTo, setConversationLastRunTo] = useState("")
  const [conversationCursor, setConversationCursor] = useState<
    string | undefined
  >()
  const [conversationCursorStack, setConversationCursorStack] = useState<
    (string | undefined)[]
  >([])
  const [retainedSearch, setRetainedSearch] = useState("")
  const [retainedDateFrom, setRetainedDateFrom] = useState("")
  const [retainedDateTo, setRetainedDateTo] = useState("")
  const [retainedCursor, setRetainedCursor] = useState<string | undefined>()
  const [retainedCursorStack, setRetainedCursorStack] = useState<
    (string | undefined)[]
  >([])
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const exportingRef = useRef(false)
  const deferredSearch = useDeferredValue(search.trim())
  const deferredConversationSearch = useDeferredValue(conversationSearch.trim())
  const deferredRetainedSearch = useDeferredValue(retainedSearch.trim())
  const queryParams = {
    search: deferredSearch,
    action: action.trim(),
    result,
    date_from: dateFrom,
    date_to: dateTo,
    cursor,
    limit: 50,
  }
  const auditQuery = useQuery({
    queryKey: ["admin", "audit", "events", queryParams],
    enabled: surface === "events",
    queryFn: ({ signal }) =>
      apiRequest("/admin/audit", {
        schema: paginatedSchema(auditRecordSchema),
        query: queryParams,
        signal,
      }),
  })
  const conversationParams = {
    search: deferredConversationSearch,
    status: conversationStatus,
    plugin_name: conversationPlugin.trim(),
    skill_name: conversationSkill.trim(),
    error_code: conversationErrorCode.trim(),
    runner_status: conversationRunnerStatus,
    archive_status: conversationArchiveStatus,
    created_from: conversationCreatedFrom,
    created_to: conversationCreatedTo,
    last_run_from: conversationLastRunFrom,
    last_run_to: conversationLastRunTo,
    cursor: conversationCursor,
    limit: 50,
  }
  const conversationExportFilters = {
    view: "conversations",
    search: deferredConversationSearch,
    status: conversationStatus,
    plugin_name: conversationPlugin.trim(),
    skill_name: conversationSkill.trim(),
    error_code: conversationErrorCode.trim(),
    runner_status: conversationRunnerStatus,
    archive_status: conversationArchiveStatus,
    created_from: conversationCreatedFrom,
    created_to: conversationCreatedTo,
    last_run_from: conversationLastRunFrom,
    last_run_to: conversationLastRunTo,
  }
  const conversationQuery = useQuery({
    queryKey: ["admin", "audit", "conversations", conversationParams],
    enabled: surface === "conversations",
    queryFn: ({ signal }) =>
      apiRequest("/admin/audit/conversations", {
        schema: paginatedSchema(auditConversationMetadataSchema),
        query: conversationParams,
        signal,
      }),
  })
  const retainedParams = {
    search: deferredRetainedSearch,
    date_from: retainedDateFrom,
    date_to: retainedDateTo,
    cursor: retainedCursor,
    limit: 50,
  }
  const retainedQuery = useQuery({
    queryKey: ["admin", "audit", "retained-artifacts", retainedParams],
    enabled: surface === "retainedArtifacts",
    queryFn: ({ signal }) =>
      apiRequest("/admin/audit/retained-artifacts", {
        schema: paginatedSchema(retainedArtifactSummarySchema),
        query: retainedParams,
        signal,
      }),
  })
  const exportAudit = async () => {
    if (exportingRef.current) return
    exportingRef.current = true
    setExporting(true)
    setError(null)
    try {
      const filters =
        surface === "conversations"
          ? conversationExportFilters
          : surface === "retainedArtifacts"
            ? {
                view: "retained_artifacts",
                search: deferredRetainedSearch,
                date_from: retainedDateFrom,
                date_to: retainedDateTo,
              }
            : {
                view: "audit_logs",
                search: deferredSearch,
                action: action.trim(),
                result,
                date_from: dateFrom,
                date_to: dateTo,
              }
      const source = await downloadApiFile("/admin/audit/export.csv", filters)
      downloadBlob(
        source,
        `${productFilenamePrefix(productName)}-${surface}-${new Date()
          .toISOString()
          .slice(0, 10)}.csv`
      )
    } catch (nextError) {
      setError(getErrorMessage(nextError, t))
    } finally {
      exportingRef.current = false
      setExporting(false)
    }
  }
  const resetEventPagination = () => {
    setCursor(undefined)
    setCursorStack([])
  }
  const resetConversationPagination = () => {
    setConversationCursor(undefined)
    setConversationCursorStack([])
  }
  const resetRetainedPagination = () => {
    setRetainedCursor(undefined)
    setRetainedCursorStack([])
  }
  const records = auditQuery.data?.items ?? []
  const conversations = conversationQuery.data?.items ?? []
  const retainedArtifacts = retainedQuery.data?.items ?? []

  return (
    <PageLayout
      title={t("admin.auditTitle")}
      description={t("admin.auditDescription")}
      actions={
        <Button
          variant="secondary"
          aria-busy={exporting || undefined}
          disabled={exporting}
          onClick={() => void exportAudit()}
        >
          <DownloadIcon aria-hidden="true" />{" "}
          {t(exporting ? "admin.exporting" : "admin.export")}
        </Button>
      }
    >
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <Tabs
        value={surface}
        onValueChange={(nextSurface) =>
          setSurface(nextSurface as typeof surface)
        }
      >
        <TabsList
          className="mt-[18px] max-w-full overflow-x-auto"
          aria-label={t("admin.auditDataSurfaces")}
        >
          {(["events", "conversations", "retainedArtifacts"] as const).map(
            (value) => (
              <TabsTrigger key={value} value={value}>
                {t(`admin.auditSurfaces.${value}`)}
              </TabsTrigger>
            )
          )}
        </TabsList>

        {surface === "events" && (
          <TabsContent value="events">
            <div className="filter-row audit-filters">
              <FieldShell id="audit-search" label={t("common.search")}>
                <Input
                  id="audit-search"
                  className="h-9"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    resetEventPagination()
                  }}
                  placeholder={t("admin.auditSearchPlaceholder")}
                />
              </FieldShell>
              <FieldShell id="audit-action" label={t("admin.action")}>
                <Input
                  id="audit-action"
                  className="h-9"
                  value={action}
                  onChange={(event) => {
                    setAction(event.target.value)
                    resetEventPagination()
                  }}
                />
              </FieldShell>
              <FieldShell id="audit-result" label={t("admin.result")}>
                <AdminSelect
                  id="audit-result"
                  value={result}
                  onValueChange={(nextResult) => {
                    setResult(nextResult)
                    resetEventPagination()
                  }}
                  options={[
                    { value: "", label: t("common.all") },
                    { value: "success", label: t("statuses.success") },
                    { value: "rejected", label: t("statuses.rejected") },
                    { value: "failure", label: t("statuses.failure") },
                  ]}
                />
              </FieldShell>
              <FieldShell id="audit-from" label={t("admin.dateFrom")}>
                <DatePicker
                  id="audit-from"
                  value={dateFrom}
                  max={dateTo || undefined}
                  placeholder={t("common.select")}
                  clearLabel={`${t("common.delete")} ${t("admin.dateFrom")}`}
                  onValueChange={(nextDate) => {
                    setDateFrom(nextDate)
                    resetEventPagination()
                  }}
                />
              </FieldShell>
              <FieldShell id="audit-to" label={t("admin.dateTo")}>
                <DatePicker
                  id="audit-to"
                  value={dateTo}
                  min={dateFrom || undefined}
                  placeholder={t("common.select")}
                  clearLabel={`${t("common.delete")} ${t("admin.dateTo")}`}
                  onValueChange={(nextDate) => {
                    setDateTo(nextDate)
                    resetEventPagination()
                  }}
                />
              </FieldShell>
            </div>
            {auditQuery.isLoading && <LoadingState />}
            {auditQuery.isError && (
              <ErrorState
                message={getErrorMessage(auditQuery.error, t)}
                onRetry={() => void auditQuery.refetch()}
              />
            )}
            {auditQuery.data && records.length === 0 && (
              <EmptyState title={t("admin.auditEmpty")} />
            )}
            {records.length > 0 && (
              <AuditTable records={records} language={language} />
            )}
            <div className="pagination-row">
              <Button
                variant="ghost"
                disabled={!cursorStack.length}
                onClick={() => {
                  const previous = cursorStack.at(-1)
                  setCursorStack((values) => values.slice(0, -1))
                  setCursor(previous)
                }}
              >
                {t("common.previous")}
              </Button>
              <Button
                variant="ghost"
                disabled={!auditQuery.data?.next_cursor}
                onClick={() => {
                  if (!auditQuery.data?.next_cursor) return
                  setCursorStack((values) => [...values, cursor])
                  setCursor(auditQuery.data.next_cursor ?? undefined)
                }}
              >
                {t("common.next")}
              </Button>
            </div>
          </TabsContent>
        )}

        {surface === "conversations" && (
          <TabsContent value="conversations">
            <p className="audit-surface-description">
              {t("admin.auditConversationDescription")}
            </p>
            <div className="filter-row compact-audit-filters">
              <FieldShell
                id="audit-conversation-search"
                label={t("common.search")}
              >
                <Input
                  id="audit-conversation-search"
                  className="h-9"
                  value={conversationSearch}
                  onChange={(event) => {
                    setConversationSearch(event.target.value)
                    resetConversationPagination()
                  }}
                  placeholder={t("admin.auditConversationSearchPlaceholder")}
                />
              </FieldShell>
              <FieldShell
                id="audit-conversation-status"
                label={t("common.status")}
              >
                <AdminSelect
                  id="audit-conversation-status"
                  value={conversationStatus}
                  onValueChange={(nextStatus) => {
                    setConversationStatus(nextStatus)
                    resetConversationPagination()
                  }}
                  options={[
                    { value: "", label: t("common.all") },
                    ...[
                      "idle",
                      "running",
                      "pending",
                      "completed",
                      "failed",
                      "interrupted",
                    ].map((status) => ({
                      value: status,
                      label: t(`statuses.${status}`),
                    })),
                  ]}
                />
              </FieldShell>
            </div>
            <Collapsible className="audit-advanced-filters">
              <CollapsibleTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-[length:var(--app-font-13)] text-[var(--app-muted)]"
                  />
                }
              >
                {t("admin.advancedFilters")}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="filter-row audit-detail-filters">
                  <FieldShell id="audit-plugin" label={t("admin.pluginName")}>
                    <Input
                      id="audit-plugin"
                      className="h-9"
                      value={conversationPlugin}
                      onChange={(event) => {
                        setConversationPlugin(event.target.value)
                        resetConversationPagination()
                      }}
                    />
                  </FieldShell>
                  <FieldShell id="audit-skill" label={t("admin.skillName")}>
                    <Input
                      id="audit-skill"
                      className="h-9"
                      value={conversationSkill}
                      onChange={(event) => {
                        setConversationSkill(event.target.value)
                        resetConversationPagination()
                      }}
                    />
                  </FieldShell>
                  <FieldShell
                    id="audit-error-code"
                    label={t("admin.errorCode")}
                  >
                    <Input
                      id="audit-error-code"
                      className="h-9"
                      value={conversationErrorCode}
                      onChange={(event) => {
                        setConversationErrorCode(event.target.value)
                        resetConversationPagination()
                      }}
                    />
                  </FieldShell>
                  <FieldShell id="audit-runner" label={t("admin.runnerStatus")}>
                    <AdminSelect
                      id="audit-runner"
                      value={conversationRunnerStatus}
                      onValueChange={(nextStatus) => {
                        setConversationRunnerStatus(nextStatus)
                        resetConversationPagination()
                      }}
                      options={[
                        { value: "", label: t("common.all") },
                        {
                          value: "available",
                          label: t("admin.runnerStatuses.available"),
                        },
                        {
                          value: "unavailable",
                          label: t("admin.runnerStatuses.unavailable"),
                        },
                      ]}
                    />
                  </FieldShell>
                  <FieldShell
                    id="audit-archive"
                    label={t("admin.archiveStatus")}
                  >
                    <AdminSelect
                      id="audit-archive"
                      value={conversationArchiveStatus}
                      onValueChange={(nextStatus) => {
                        setConversationArchiveStatus(nextStatus)
                        resetConversationPagination()
                      }}
                      options={[
                        { value: "", label: t("common.all") },
                        {
                          value: "active",
                          label: t("admin.activeConversation"),
                        },
                        {
                          value: "archived",
                          label: t("admin.archivedConversation"),
                        },
                      ]}
                    />
                  </FieldShell>
                  <FieldShell
                    id="audit-created-from"
                    label={t("admin.createdFrom")}
                  >
                    <DatePicker
                      id="audit-created-from"
                      value={conversationCreatedFrom}
                      max={conversationCreatedTo || undefined}
                      placeholder={t("common.select")}
                      clearLabel={`${t("common.delete")} ${t("admin.createdFrom")}`}
                      onValueChange={(nextDate) => {
                        setConversationCreatedFrom(nextDate)
                        resetConversationPagination()
                      }}
                    />
                  </FieldShell>
                  <FieldShell
                    id="audit-created-to"
                    label={t("admin.createdTo")}
                  >
                    <DatePicker
                      id="audit-created-to"
                      value={conversationCreatedTo}
                      min={conversationCreatedFrom || undefined}
                      placeholder={t("common.select")}
                      clearLabel={`${t("common.delete")} ${t("admin.createdTo")}`}
                      onValueChange={(nextDate) => {
                        setConversationCreatedTo(nextDate)
                        resetConversationPagination()
                      }}
                    />
                  </FieldShell>
                  <FieldShell
                    id="audit-run-from"
                    label={t("admin.lastRunFrom")}
                  >
                    <DatePicker
                      id="audit-run-from"
                      value={conversationLastRunFrom}
                      max={conversationLastRunTo || undefined}
                      placeholder={t("common.select")}
                      clearLabel={`${t("common.delete")} ${t("admin.lastRunFrom")}`}
                      onValueChange={(nextDate) => {
                        setConversationLastRunFrom(nextDate)
                        resetConversationPagination()
                      }}
                    />
                  </FieldShell>
                  <FieldShell id="audit-run-to" label={t("admin.lastRunTo")}>
                    <DatePicker
                      id="audit-run-to"
                      value={conversationLastRunTo}
                      min={conversationLastRunFrom || undefined}
                      placeholder={t("common.select")}
                      clearLabel={`${t("common.delete")} ${t("admin.lastRunTo")}`}
                      onValueChange={(nextDate) => {
                        setConversationLastRunTo(nextDate)
                        resetConversationPagination()
                      }}
                    />
                  </FieldShell>
                </div>
              </CollapsibleContent>
            </Collapsible>
            {conversationQuery.isLoading && <LoadingState />}
            {conversationQuery.isError && (
              <ErrorState
                message={getErrorMessage(conversationQuery.error, t)}
                onRetry={() => void conversationQuery.refetch()}
              />
            )}
            {conversationQuery.data && conversations.length === 0 && (
              <EmptyState title={t("admin.auditConversationsEmpty")} />
            )}
            {conversations.length > 0 && (
              <AuditConversationTable
                records={conversations}
                language={language}
              />
            )}
            <div className="pagination-row">
              <Button
                variant="ghost"
                disabled={!conversationCursorStack.length}
                onClick={() => {
                  const previous = conversationCursorStack.at(-1)
                  setConversationCursorStack((values) => values.slice(0, -1))
                  setConversationCursor(previous)
                }}
              >
                {t("common.previous")}
              </Button>
              <Button
                variant="ghost"
                disabled={!conversationQuery.data?.next_cursor}
                onClick={() => {
                  if (!conversationQuery.data?.next_cursor) return
                  setConversationCursorStack((values) => [
                    ...values,
                    conversationCursor,
                  ])
                  setConversationCursor(
                    conversationQuery.data.next_cursor ?? undefined
                  )
                }}
              >
                {t("common.next")}
              </Button>
            </div>
          </TabsContent>
        )}

        {surface === "retainedArtifacts" && (
          <TabsContent value="retainedArtifacts">
            <p className="audit-surface-description">
              {t("admin.retainedArtifactsDescription")}
            </p>
            <div className="filter-row">
              <FieldShell
                id="retained-artifact-search"
                label={t("common.search")}
              >
                <Input
                  id="retained-artifact-search"
                  className="h-9"
                  value={retainedSearch}
                  onChange={(event) => {
                    setRetainedSearch(event.target.value)
                    resetRetainedPagination()
                  }}
                  placeholder={t("admin.retainedArtifactsSearchPlaceholder")}
                />
              </FieldShell>
              <FieldShell id="retained-from" label={t("admin.dateFrom")}>
                <DatePicker
                  id="retained-from"
                  value={retainedDateFrom}
                  max={retainedDateTo || undefined}
                  placeholder={t("common.select")}
                  clearLabel={`${t("common.delete")} ${t("admin.dateFrom")}`}
                  onValueChange={(nextDate) => {
                    setRetainedDateFrom(nextDate)
                    resetRetainedPagination()
                  }}
                />
              </FieldShell>
              <FieldShell id="retained-to" label={t("admin.dateTo")}>
                <DatePicker
                  id="retained-to"
                  value={retainedDateTo}
                  min={retainedDateFrom || undefined}
                  placeholder={t("common.select")}
                  clearLabel={`${t("common.delete")} ${t("admin.dateTo")}`}
                  onValueChange={(nextDate) => {
                    setRetainedDateTo(nextDate)
                    resetRetainedPagination()
                  }}
                />
              </FieldShell>
            </div>
            {retainedQuery.isLoading && <LoadingState />}
            {retainedQuery.isError && (
              <ErrorState
                message={getErrorMessage(retainedQuery.error, t)}
                onRetry={() => void retainedQuery.refetch()}
              />
            )}
            {retainedQuery.data && retainedArtifacts.length === 0 && (
              <EmptyState title={t("admin.retainedArtifactsEmpty")} />
            )}
            {retainedArtifacts.length > 0 && (
              <RetainedArtifactTable
                records={retainedArtifacts}
                language={language}
              />
            )}
            <div className="pagination-row">
              <Button
                variant="ghost"
                disabled={!retainedCursorStack.length}
                onClick={() => {
                  const previous = retainedCursorStack.at(-1)
                  setRetainedCursorStack((values) => values.slice(0, -1))
                  setRetainedCursor(previous)
                }}
              >
                {t("common.previous")}
              </Button>
              <Button
                variant="ghost"
                disabled={!retainedQuery.data?.next_cursor}
                onClick={() => {
                  if (!retainedQuery.data?.next_cursor) return
                  setRetainedCursorStack((values) => [
                    ...values,
                    retainedCursor,
                  ])
                  setRetainedCursor(retainedQuery.data.next_cursor ?? undefined)
                }}
              >
                {t("common.next")}
              </Button>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </PageLayout>
  )
}

function AuditTable({
  records,
  language,
}: {
  records: AuditRecord[]
  language: SupportedLanguage
}) {
  const { t } = useTranslation()
  return (
    <div className="data-table-scroll">
      <Table className="data-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t("admin.action")}</TableHead>
            <TableHead>{t("admin.actor")}</TableHead>
            <TableHead>{t("admin.target")}</TableHead>
            <TableHead>{t("admin.result")}</TableHead>
            <TableHead>{t("admin.sourceIp")}</TableHead>
            <TableHead>{t("common.createdAt")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id}>
              <TableCell>
                <span className="table-primary">
                  {formatPublicTechnicalIdentifier(record.action)}
                </span>
                {record.error_code && (
                  <span className="table-secondary table-metadata">
                    {formatPublicTechnicalIdentifier(record.error_code)}
                  </span>
                )}
              </TableCell>
              <TableCell>{record.actor_name ?? t("common.system")}</TableCell>
              <TableCell>
                <span className="table-primary">
                  {record.target_type
                    ? formatPublicTechnicalIdentifier(record.target_type)
                    : "—"}
                </span>
                <span className="table-secondary table-metadata">
                  {record.target_id ?? "—"}
                </span>
              </TableCell>
              <TableCell>{record.result ?? "—"}</TableCell>
              <TableCell className="table-metadata">
                {record.source_ip ?? t("common.system")}
              </TableCell>
              <TableCell className="table-metadata">
                {formatDateTime(record.created_at, language)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AuditConversationTable({
  records,
  language,
}: {
  records: AuditConversationMetadata[]
  language: SupportedLanguage
}) {
  const { t } = useTranslation()
  return (
    <div className="data-table-scroll">
      <Table className="data-table audit-conversation-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t("admin.conversation")}</TableHead>
            <TableHead>{t("admin.owner")}</TableHead>
            <TableHead>{t("common.status")}</TableHead>
            <TableHead>{t("admin.capabilitiesUsed")}</TableHead>
            <TableHead>{t("admin.files")}</TableHead>
            <TableHead>{t("admin.execution")}</TableHead>
            <TableHead>{t("admin.lastRun")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.conversation_id}>
              <TableCell>
                <span className="table-primary break-all">
                  {record.conversation_id}
                </span>
                <span className="table-secondary">
                  {t(
                    record.archive_status === "archived"
                      ? "admin.archivedConversation"
                      : "admin.activeConversation"
                  )}
                </span>
              </TableCell>
              <TableCell>
                <span className="table-primary">
                  {record.owner_name ?? record.owner_id}
                </span>
                <span className="table-secondary">
                  {record.owner_email ?? record.owner_id}
                </span>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    record.execution_status === "failed"
                      ? "outline"
                      : "secondary"
                  }
                >
                  {t(`statuses.${record.execution_status}`)}
                </Badge>
                {record.error_type && (
                  <span className="table-secondary">
                    {t(`admin.errorTypes.${record.error_type}`, {
                      defaultValue: t("admin.executionError"),
                    })}
                  </span>
                )}
                {record.error_code && (
                  <span className="table-secondary table-metadata break-all">
                    {formatPublicTechnicalIdentifier(record.error_code)}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <span className="table-secondary">
                  {t("capability.plugin")}:{" "}
                  {record.plugin_names.join(", ") || "-"}
                </span>
                <span className="table-secondary">
                  {t("capability.skill")}:{" "}
                  {record.skill_names.join(", ") || "-"}
                </span>
              </TableCell>
              <TableCell>
                <span className="table-secondary">
                  {t("admin.attachmentsSummary", {
                    count: record.attachment_count,
                    size: formatFileSize(
                      record.attachment_size_bytes,
                      language
                    ),
                  })}
                </span>
                <span className="table-secondary">
                  {t("admin.artifactsSummary", {
                    count: record.artifact_count,
                    size: formatFileSize(record.artifact_size_bytes, language),
                  })}
                </span>
              </TableCell>
              <TableCell>
                <span className="table-primary">
                  {formatDuration(record.execution_duration_ms, language)}
                </span>
                <span className="table-secondary">
                  {t(`admin.runnerStatuses.${record.runner_status}`, {
                    defaultValue: t("common.notAvailable"),
                  })}
                </span>
              </TableCell>
              <TableCell className="table-metadata">
                <span className="table-primary">
                  {formatDateTime(record.last_run_at, language)}
                </span>
                <span className="table-secondary">
                  {t("common.createdAt")}:{" "}
                  {formatDateTime(record.created_at, language)}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function RetainedArtifactTable({
  records,
  language,
}: {
  records: RetainedArtifactSummary[]
  language: SupportedLanguage
}) {
  const { t } = useTranslation()
  return (
    <div className="data-table-scroll">
      <Table className="data-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t("admin.conversation")}</TableHead>
            <TableHead>{t("admin.owner")}</TableHead>
            <TableHead>{t("admin.retainedArtifactCount")}</TableHead>
            <TableHead>{t("admin.totalSize")}</TableHead>
            <TableHead>{t("admin.checksum")}</TableHead>
            <TableHead>{t("admin.deletedAt")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.conversation_id}>
              <TableCell className="table-metadata break-all">
                {record.conversation_id}
              </TableCell>
              <TableCell>
                <span className="table-primary">
                  {record.owner_name ?? record.owner_id}
                </span>
                <span className="table-secondary">
                  {record.owner_email ?? record.owner_id}
                </span>
              </TableCell>
              <TableCell>
                <span className="table-primary">{record.artifact_count}</span>
                {record.first_artifact_created_at && (
                  <span className="table-secondary table-metadata">
                    {formatDateTime(record.first_artifact_created_at, language)}{" "}
                    –{" "}
                    {formatDateTime(record.last_artifact_created_at, language)}
                  </span>
                )}
              </TableCell>
              <TableCell className="table-metadata">
                {formatFileSize(record.total_size_bytes, language)}
              </TableCell>
              <TableCell>
                {t(record.checksum_present ? "common.yes" : "common.no")}
              </TableCell>
              <TableCell className="table-metadata">
                {formatDateTime(record.conversation_deleted_at, language)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function formatDuration(value: number, language: SupportedLanguage): string {
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value / 1_000)
}

function ProductSettingsPage() {
  const { t } = useTranslation()
  const productQuery = useQuery({
    queryKey: ["admin", "product-settings"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/product-settings", {
        schema: productSettingsSchema,
        signal,
      }),
  })
  const authenticationQuery = useQuery({
    queryKey: ["admin", "authentication-settings"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/authentication-settings", {
        schema: authenticationSettingsSchema,
        signal,
      }),
  })
  const registrationQuery = useQuery({
    queryKey: ["admin", "registration-settings"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/registration-settings", {
        schema: registrationSettingsSchema,
        signal,
      }),
  })
  const error =
    productQuery.error ?? authenticationQuery.error ?? registrationQuery.error
  return (
    <PageLayout
      title={t("admin.managementTitle")}
      description={t("settings.systemSettingsDescription")}
    >
      {(productQuery.isLoading ||
        authenticationQuery.isLoading ||
        registrationQuery.isLoading) && <LoadingState />}
      {Boolean(error) && (
        <ErrorState
          message={getErrorMessage(error, t)}
          onRetry={() => {
            void productQuery.refetch()
            void authenticationQuery.refetch()
            void registrationQuery.refetch()
          }}
        />
      )}
      {productQuery.data &&
        authenticationQuery.data &&
        registrationQuery.data && (
          <ProductSettingsEditor
            key={`${productQuery.data.system_name}:${productQuery.data.logo_url ?? ""}`}
            settings={productQuery.data}
            authenticationSettings={authenticationQuery.data}
            registrationSettings={registrationQuery.data}
          />
        )}
    </PageLayout>
  )
}

function ProductSettingsEditor({
  settings,
  authenticationSettings,
  registrationSettings,
}: {
  settings: ProductSettings
  authenticationSettings: AuthenticationSettings
  registrationSettings: RegistrationSettings
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState(settings.system_name)
  const [logoUrl, setLogoUrl] = useState(settings.logo_url)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement | null>(null)
  const applyProductSettings = async (
    updatedSettings: ProductSettings,
    successMessage: string
  ) => {
    setName(updatedSettings.system_name)
    setLogoUrl(updatedSettings.logo_url)
    setMessage(successMessage)
    queryClient.setQueryData<BootstrapStatus>(
      ["system", "bootstrap"],
      (current) =>
        current
          ? {
              ...current,
              system_name: updatedSettings.system_name,
              organization_display_name: updatedSettings.system_name,
              logo_url: updatedSettings.logo_url,
              logo_updated_at: updatedSettings.logo_updated_at,
            }
          : current
    )
    await queryClient.invalidateQueries({
      queryKey: ["admin", "product-settings"],
    })
    await queryClient.invalidateQueries({ queryKey: ["system", "bootstrap"] })
  }
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/admin/product-settings", {
        method: "PATCH",
        body: {
          organization_display_name: name.trim(),
        },
        schema: productSettingsSchema,
      }),
    onSuccess: async (updatedSettings) => {
      await applyProductSettings(updatedSettings, t("admin.settingsSaved"))
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const uploadLogoMutation = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.set("file", file)
      return apiRequest("/admin/product-settings/logo", {
        method: "POST",
        body,
        schema: productSettingsSchema,
      })
    },
    onSuccess: async (updatedSettings) => {
      await applyProductSettings(updatedSettings, t("admin.systemLogoSaved"))
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const deleteLogoMutation = useMutation({
    mutationFn: () =>
      apiRequest("/admin/product-settings/logo", {
        method: "DELETE",
        schema: productSettingsSchema,
      }),
    onSuccess: async (updatedSettings) => {
      await applyProductSettings(updatedSettings, t("admin.systemLogoRemoved"))
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const logoBusy = uploadLogoMutation.isPending || deleteLogoMutation.isPending
  return (
    <Tabs defaultValue="product" className="gap-4">
      <TabsList
        aria-label={t("admin.settingsTabsLabel")}
        className="max-w-full justify-start overflow-x-auto"
      >
        <TabsTrigger value="product">
          {t("admin.settingsTabs.product")}
        </TabsTrigger>
        <TabsTrigger value="smtp">{t("admin.settingsTabs.smtp")}</TabsTrigger>
        <TabsTrigger value="registration">
          {t("admin.settingsTabs.registration")}
        </TabsTrigger>
        <TabsTrigger value="oidc">{t("admin.settingsTabs.oidc")}</TabsTrigger>
        <TabsTrigger value="teams">{t("admin.settingsTabs.teams")}</TabsTrigger>
        <TabsTrigger value="maintenance">
          {t("admin.settingsTabs.maintenance")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="product" className="min-w-0" keepMounted>
        <NotificationToast id="product-settings-saved" message={message} />
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        <section
          className="settings-section"
          aria-labelledby="editable-settings"
        >
          <SettingsSectionHeader
            id="editable-settings"
            title={t("admin.editableSettings")}
            description={t("admin.settingsDescription")}
          />
          <form
            className="form-stack settings-form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              setMessage(null)
              setError(null)
              mutation.mutate()
            }}
          >
            <FieldShell id="system-name" label={t("admin.systemName")}>
              <Input
                id="system-name"
                className="h-9"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </FieldShell>
            <FieldShell
              id="system-logo"
              label={t("admin.systemLogo")}
              hint={t("admin.systemLogoHint")}
            >
              <div className="product-logo-setting">
                <div className="product-logo-preview" aria-hidden="true">
                  <ProductLogo
                    productName={name.trim() || settings.system_name}
                    logoUrl={logoUrl}
                    className="product-settings-logo-preview"
                  />
                </div>
                <div className="product-logo-actions">
                  <p className="product-logo-description">
                    {t("admin.systemLogoDescription")}
                  </p>
                  <div className="product-logo-buttons">
                    <Input
                      ref={logoInputRef}
                      id="system-logo"
                      className="sr-only"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0]
                        event.currentTarget.value = ""
                        if (!file) return
                        setMessage(null)
                        setError(null)
                        uploadLogoMutation.mutate(file)
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={logoBusy}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      <ImageIcon data-icon="inline-start" />
                      {logoUrl
                        ? t("admin.replaceSystemLogo")
                        : t("admin.uploadSystemLogo")}
                    </Button>
                    {logoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={logoBusy}
                        onClick={() => {
                          setMessage(null)
                          setError(null)
                          deleteLogoMutation.mutate()
                        }}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        {t("admin.removeSystemLogo")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </FieldShell>
            <div>
              <Button
                type="submit"
                size="lg"
                disabled={!name.trim() || mutation.isPending || logoBusy}
                aria-busy={mutation.isPending || logoBusy || undefined}
              >
                {(mutation.isPending || logoBusy) && (
                  <Spinner data-icon="inline-start" />
                )}
                {t("common.save")}
              </Button>
            </div>
          </form>
        </section>
      </TabsContent>

      <TabsContent value="maintenance" className="min-w-0">
        <MaintenanceSettingsForm />
      </TabsContent>
      <TabsContent value="smtp" className="min-w-0" keepMounted>
        <SmtpAuthenticationSettingsForm
          settings={authenticationSettings.smtp}
        />
      </TabsContent>
      <TabsContent value="registration" className="min-w-0" keepMounted>
        <RegistrationSettingsForm settings={registrationSettings} />
      </TabsContent>
      <TabsContent value="oidc" className="min-w-0" keepMounted>
        <OidcAuthenticationSettingsForm
          settings={authenticationSettings.oidc}
        />
      </TabsContent>
      <TabsContent value="teams" className="min-w-0" keepMounted>
        <TeamsAuthenticationSettingsForm
          settings={authenticationSettings.teams}
        />
      </TabsContent>
    </Tabs>
  )
}

function RegistrationSettingsForm({
  settings,
}: {
  settings: RegistrationSettings
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const totalTokenLimitRef = useRef<HTMLInputElement>(null)
  const [enabled, setEnabled] = useState(settings.enabled)
  const [totalTokenLimit, setTotalTokenLimit] = useState(() =>
    tokenLimitToMillionTokenQuotaInput(settings.total_token_limit)
  )
  const [totalTokenLimitError, setTotalTokenLimitError] = useState<
    string | null
  >(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: (nextSettings: RegistrationSettings) =>
      apiRequest("/admin/registration-settings", {
        method: "PUT",
        body: nextSettings,
        schema: registrationSettingsUpdateResultSchema,
      }),
    onSuccess: async (result) => {
      setError(null)
      setMessage(t("admin.registration.saved"))
      queryClient.setQueryData(
        ["admin", "registration-settings"],
        result.settings
      )
      queryClient.setQueryData<BootstrapStatus>(
        ["system", "bootstrap"],
        (current) =>
          current
            ? {
                ...current,
                registration: { enabled: result.settings.enabled },
              }
            : current
      )
      await queryClient.invalidateQueries({ queryKey: ["system", "bootstrap"] })
    },
    onError: (nextError) => {
      setMessage(null)
      setError(getErrorMessage(nextError, t))
    },
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setError(null)
    setTotalTokenLimitError(null)
    let totalTokenLimitValue: string | null
    try {
      totalTokenLimitValue = millionTokenQuotaInputToTokenLimit(totalTokenLimit)
    } catch {
      setTotalTokenLimitError(t("admin.registration.totalTokenLimitInvalid"))
      totalTokenLimitRef.current?.focus()
      return
    }
    if (enabled && totalTokenLimitValue === null) {
      setTotalTokenLimitError(t("admin.registration.totalTokenLimitRequired"))
      totalTokenLimitRef.current?.focus()
      return
    }
    const nextSettings = registrationSettingsSchema.safeParse({
      enabled,
      total_token_limit: totalTokenLimitValue,
    })
    if (!nextSettings.success) {
      setTotalTokenLimitError(t("admin.registration.totalTokenLimitInvalid"))
      totalTokenLimitRef.current?.focus()
      return
    }
    mutation.mutate(nextSettings.data)
  }

  return (
    <section
      className="settings-section"
      aria-label={t("admin.settingsTabs.registration")}
    >
      <NotificationToast id="registration-settings-saved" message={message} />
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <form onSubmit={submit} noValidate>
        <FieldGroup>
          <Field
            orientation="horizontal"
            data-disabled={mutation.isPending || undefined}
          >
            <FieldContent>
              <FieldTitle id="open-registration-label">
                {t("admin.registration.enabled")}
              </FieldTitle>
              <FieldDescription id="open-registration-description">
                {t("admin.registration.enabledDescription")}
              </FieldDescription>
            </FieldContent>
            <Switch
              checked={enabled}
              disabled={mutation.isPending}
              aria-labelledby="open-registration-label"
              aria-describedby="open-registration-description"
              aria-busy={mutation.isPending || undefined}
              onCheckedChange={(nextEnabled) => {
                setMessage(null)
                setError(null)
                setEnabled(nextEnabled)
              }}
            />
          </Field>
          <Field data-invalid={totalTokenLimitError ? true : undefined}>
            <FieldLabel htmlFor="open-registration-total-token-limit">
              {t("admin.registration.totalTokenLimit")}
            </FieldLabel>
            <InputGroup
              className="max-w-sm"
              data-disabled={mutation.isPending || undefined}
            >
              <InputGroupInput
                ref={totalTokenLimitRef}
                id="open-registration-total-token-limit"
                name="total_token_limit"
                inputMode="decimal"
                pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                value={totalTokenLimit}
                disabled={mutation.isPending}
                aria-invalid={totalTokenLimitError ? true : undefined}
                aria-describedby="open-registration-total-token-limit-description open-registration-total-token-limit-error"
                placeholder={t("admin.registration.totalTokenLimitPlaceholder")}
                onChange={(event) => {
                  setMessage(null)
                  setTotalTokenLimitError(null)
                  setTotalTokenLimit(event.target.value)
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText className="whitespace-nowrap">
                  {t("admin.registration.totalTokenLimitUnit")}
                </InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription id="open-registration-total-token-limit-description">
              {t("admin.registration.totalTokenLimitDescription")}
            </FieldDescription>
            <FieldError id="open-registration-total-token-limit-error">
              {totalTokenLimitError}
            </FieldError>
          </Field>
          <Field orientation="horizontal">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner data-icon="inline-start" />}
              {t("common.save")}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </section>
  )
}

function ModelSettingsPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ModelSettingsTab>("channels")
  const [tabRenderVersions, setTabRenderVersions] = useState<
    Record<ModelSettingsTab, number>
  >({ channels: 0, knowledge: 0, imageGeneration: 0, initialQuota: 0 })
  const modelProviderQuery = useQuery({
    queryKey: ["admin", "model-provider-settings"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/model-provider-settings", {
        schema: modelProviderSettingsSchema,
        signal,
      }),
  })
  const imageUnderstandingQuery = useQuery({
    queryKey: ["admin", "image-understanding-settings"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/image-understanding-settings", {
        schema: imageUnderstandingSettingsSchema,
        signal,
      }),
  })
  const imageGenerationQuery = useQuery({
    queryKey: ["admin", "image-generation-settings"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/image-generation-settings", {
        schema: imageGenerationSettingsSchema,
        signal,
      }),
  })
  const knowledgeModelQuery = useQuery({
    queryKey: ["admin", "knowledge-model-settings"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/knowledge-model-settings", {
        schema: knowledgeModelSettingsSchema,
        signal,
      }),
  })
  const refreshTab = (nextTab: ModelSettingsTab) => {
    setActiveTab(nextTab)
    const queries =
      nextTab === "knowledge"
        ? [modelProviderQuery, knowledgeModelQuery, imageUnderstandingQuery]
        : nextTab === "imageGeneration"
          ? [modelProviderQuery, imageGenerationQuery]
          : [modelProviderQuery]
    const markRefreshed = () => {
      setTabRenderVersions((current) => ({
        ...current,
        [nextTab]: current[nextTab] + 1,
      }))
    }
    void Promise.all(queries.map((query) => query.refetch())).then(
      markRefreshed,
      markRefreshed
    )
  }
  const channelsLoading =
    modelProviderQuery.isLoading ||
    (activeTab === "channels" && modelProviderQuery.isFetching)
  const knowledgeLoading =
    knowledgeModelQuery.isLoading ||
    imageUnderstandingQuery.isLoading ||
    modelProviderQuery.isLoading ||
    (activeTab === "knowledge" &&
      (knowledgeModelQuery.isFetching ||
        imageUnderstandingQuery.isFetching ||
        modelProviderQuery.isFetching))
  const imageGenerationLoading =
    imageGenerationQuery.isLoading ||
    modelProviderQuery.isLoading ||
    (activeTab === "imageGeneration" &&
      (imageGenerationQuery.isFetching || modelProviderQuery.isFetching))
  const initialQuotaLoading =
    modelProviderQuery.isLoading ||
    (activeTab === "initialQuota" && modelProviderQuery.isFetching)

  return (
    <PageLayout
      title={t("settings.modelSettings")}
      description={t("settings.modelSettingsDescription")}
    >
      {modelProviderQuery.data?.management_enabled === false && (
        <StatusBanner>{t("admin.modelProvider.readOnlyNotice")}</StatusBanner>
      )}
      <Tabs
        value={activeTab}
        onValueChange={(value) => refreshTab(value as ModelSettingsTab)}
        className="gap-4"
      >
        <TabsList aria-label={t("admin.modelTabs.label")}>
          <TabsTrigger value="channels">
            {t("admin.modelTabs.channels")}
          </TabsTrigger>
          <TabsTrigger value="knowledge">
            {t("admin.modelTabs.knowledge")}
          </TabsTrigger>
          <TabsTrigger value="imageGeneration">
            {t("admin.modelTabs.imageGeneration")}
          </TabsTrigger>
          <TabsTrigger value="initialQuota">
            {t("admin.modelTabs.initialQuota")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="channels" className="min-w-0" keepMounted>
          {channelsLoading && <LoadingState />}
          {!channelsLoading && modelProviderQuery.error && (
            <ErrorState
              message={getErrorMessage(modelProviderQuery.error, t)}
              onRetry={() => {
                void modelProviderQuery.refetch()
              }}
            />
          )}
          {!channelsLoading &&
            !modelProviderQuery.error &&
            modelProviderQuery.data && (
              <ModelProviderSettingsForm
                key={`model-channels-${modelProviderQuery.data.revision}-${tabRenderVersions.channels}`}
                settings={modelProviderQuery.data}
              />
            )}
        </TabsContent>
        <TabsContent value="knowledge" className="min-w-0" keepMounted>
          {knowledgeLoading && <LoadingState />}
          {!knowledgeLoading && modelProviderQuery.error && (
            <ErrorState
              message={getErrorMessage(modelProviderQuery.error, t)}
              onRetry={() => {
                void modelProviderQuery.refetch()
              }}
            />
          )}
          {!knowledgeLoading && knowledgeModelQuery.error && (
            <ErrorState
              message={getErrorMessage(knowledgeModelQuery.error, t)}
              onRetry={() => {
                void knowledgeModelQuery.refetch()
              }}
            />
          )}
          {!knowledgeLoading &&
            !modelProviderQuery.error &&
            !knowledgeModelQuery.error &&
            knowledgeModelQuery.data &&
            modelProviderQuery.data && (
              <KnowledgeModelSettingsForm
                key={`knowledge-models-${knowledgeModelQuery.data.revision}-${modelProviderQuery.data.revision}-${tabRenderVersions.knowledge}`}
                settings={knowledgeModelQuery.data}
                modelSettings={modelProviderQuery.data}
              />
            )}
          {!knowledgeLoading && imageUnderstandingQuery.error && (
            <ErrorState
              message={getErrorMessage(imageUnderstandingQuery.error, t)}
              onRetry={() => {
                void imageUnderstandingQuery.refetch()
              }}
            />
          )}
          {!knowledgeLoading &&
            !modelProviderQuery.error &&
            !imageUnderstandingQuery.error &&
            imageUnderstandingQuery.data &&
            modelProviderQuery.data && (
              <ImageUnderstandingSettingsForm
                key={`image-understanding-${imageUnderstandingQuery.data.revision}-${modelProviderQuery.data.revision}-${tabRenderVersions.knowledge}`}
                settings={imageUnderstandingQuery.data}
                modelSettings={modelProviderQuery.data}
              />
            )}
        </TabsContent>
        <TabsContent value="imageGeneration" className="min-w-0" keepMounted>
          {imageGenerationLoading && <LoadingState />}
          {!imageGenerationLoading && modelProviderQuery.error && (
            <ErrorState
              message={getErrorMessage(modelProviderQuery.error, t)}
              onRetry={() => {
                void modelProviderQuery.refetch()
              }}
            />
          )}
          {!imageGenerationLoading && imageGenerationQuery.error && (
            <ErrorState
              message={getErrorMessage(imageGenerationQuery.error, t)}
              onRetry={() => {
                void imageGenerationQuery.refetch()
              }}
            />
          )}
          {!imageGenerationLoading &&
            !modelProviderQuery.error &&
            !imageGenerationQuery.error &&
            imageGenerationQuery.data &&
            modelProviderQuery.data && (
              <ImageGenerationSettingsForm
                key={`image-generation-${imageGenerationQuery.data.revision}-${modelProviderQuery.data.revision}-${tabRenderVersions.imageGeneration}`}
                settings={imageGenerationQuery.data}
                modelSettings={modelProviderQuery.data}
              />
            )}
        </TabsContent>
        <TabsContent value="initialQuota" className="min-w-0" keepMounted>
          {initialQuotaLoading && <LoadingState />}
          {!initialQuotaLoading && modelProviderQuery.error && (
            <ErrorState
              message={getErrorMessage(modelProviderQuery.error, t)}
              onRetry={() => {
                void modelProviderQuery.refetch()
              }}
            />
          )}
          {!initialQuotaLoading &&
            !modelProviderQuery.error &&
            modelProviderQuery.data && (
              <InitialUserTokenQuotaSettingsForm
                key={`initial-token-quota-${modelProviderQuery.data.revision}-${tabRenderVersions.initialQuota}`}
                settings={modelProviderQuery.data}
              />
            )}
        </TabsContent>
      </Tabs>
    </PageLayout>
  )
}

type ModelSettingsTab =
  "channels" | "knowledge" | "imageGeneration" | "initialQuota"

type AuthenticationProvider = "smtp" | "oidc" | "teams"
type AuthenticationMode = AuthenticationSettings["smtp"]["mode"]
const MASKED_AUTHENTICATION_SECRET = "••••••••••••"

function useAuthenticationSettingsMutation(
  provider: AuthenticationProvider,
  onSaved: () => void,
  onError: (error: unknown) => void
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest(`/admin/authentication-settings/${provider}`, {
        method: "PUT",
        body,
        schema: authenticationSettingsUpdateResultSchema,
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(
        ["admin", "authentication-settings"],
        result.settings
      )
      onSaved()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "health"] }),
        queryClient.invalidateQueries({ queryKey: ["system", "bootstrap"] }),
      ])
    },
    onError,
  })
}

function AuthenticationProviderHeading({
  id,
  title,
  description,
  status,
}: {
  id: string
  title: string
  description: string
  status: AuthenticationSettings["smtp"]["status"]
}) {
  const { t } = useTranslation()
  return (
    <SettingsSectionHeader
      id={id}
      title={title}
      description={description}
      status={
        <Badge variant={status === "configured" ? "secondary" : "outline"}>
          {t(
            `admin.authSettings.status.${status === "not_configured" ? "notConfigured" : status}`
          )}
        </Badge>
      }
    />
  )
}

function AuthenticationModeField({
  id,
  value,
  onValueChange,
  disabled,
}: {
  id: string
  value: AuthenticationMode
  onValueChange: (mode: AuthenticationMode) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  return (
    <FieldShell id={id} label={t("admin.authSettings.modeLabel")}>
      <AdminSelect
        id={id}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onValueChange(next as AuthenticationMode)}
        options={[
          { value: "inherit", label: t("admin.authSettings.modes.inherit") },
          { value: "managed", label: t("admin.authSettings.modes.managed") },
          { value: "disabled", label: t("admin.authSettings.modes.disabled") },
        ]}
      />
    </FieldShell>
  )
}

function ProviderModeNotice({ mode }: { mode: AuthenticationMode }) {
  const { t } = useTranslation()
  if (mode === "managed") return null
  return (
    <p className="authentication-mode-notice">
      {t(`admin.authSettings.modeNotices.${mode}`)}
    </p>
  )
}

function requiresProviderConfirmation(
  currentMode: AuthenticationMode,
  nextMode: AuthenticationMode,
  currentStatus: AuthenticationSettings["smtp"]["status"]
) {
  return (
    currentMode !== nextMode &&
    (currentMode === "managed" ||
      (nextMode === "disabled" && currentStatus === "configured"))
  )
}

function ProviderChangeConfirmation({
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("admin.authSettings.confirmTitle")}
      description={t("admin.authSettings.confirmDescription")}
      confirmLabel={t("common.continue")}
      destructive
      pending={pending}
      onConfirm={onConfirm}
    />
  )
}

function SmtpAuthenticationSettingsForm({
  settings,
}: {
  settings: AuthenticationSettings["smtp"]
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AuthenticationMode>(settings.mode)
  const [host, setHost] = useState(settings.host ?? "")
  const [port, setPort] = useState(String(settings.port ?? 587))
  const [security, setSecurity] = useState<"tls" | "starttls">(
    settings.security ?? "starttls"
  )
  const [username, setUsername] = useState(settings.username ?? "")
  const [password, setPassword] = useState("")
  const [from, setFrom] = useState(settings.from ?? "")
  const [loadedRevision, setLoadedRevision] = useState(settings.revision)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingBody, setPendingBody] = useState<Record<
    string,
    unknown
  > | null>(null)
  if (loadedRevision !== settings.revision) {
    setLoadedRevision(settings.revision)
    setMode(settings.mode)
    setHost(settings.host ?? "")
    setPort(String(settings.port ?? 587))
    setSecurity(settings.security ?? "starttls")
    setUsername(settings.username ?? "")
    setPassword("")
    setFrom(settings.from ?? "")
  }
  const mutation = useAuthenticationSettingsMutation(
    "smtp",
    () => {
      setPassword("")
      setMessage(t("admin.authSettings.saved"))
      setError(null)
      setConfirmOpen(false)
    },
    (nextError) => setError(getErrorMessage(nextError, t))
  )
  const secretCanBePreserved =
    settings.mode === "managed" && settings.password_configured
  const parsedPort = Number(port)
  const valid =
    mode !== "managed" ||
    (host.trim().length > 0 &&
      Number.isInteger(parsedPort) &&
      parsedPort >= 1 &&
      parsedPort <= 65_535 &&
      from.trim().length > 0 &&
      (!username.trim() || password.length > 0 || secretCanBePreserved))

  const submit = () => {
    setMessage(null)
    setError(null)
    if (!valid) {
      setError(t("errors.validation"))
      return
    }
    const body: Record<string, unknown> = {
      mode,
      expected_revision: settings.revision,
      ...(mode === "managed"
        ? {
            host: host.trim(),
            port: parsedPort,
            security,
            username: username.trim() || null,
            ...(password ? { password } : {}),
            from: from.trim(),
          }
        : {}),
    }
    if (requiresProviderConfirmation(settings.mode, mode, settings.status)) {
      setPendingBody(body)
      setConfirmOpen(true)
      return
    }
    mutation.mutate(body)
  }

  return (
    <section className="settings-section" aria-labelledby="smtp-settings">
      <AuthenticationProviderHeading
        id="smtp-settings"
        title={t("admin.authSettings.smtpTitle")}
        description={t("admin.authSettings.smtpDescription")}
        status={settings.status}
      />
      <NotificationToast
        id="smtp-authentication-settings-saved"
        message={message}
      />
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <form
        className="form-stack settings-form"
        noValidate
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          submit()
        }}
      >
        <AuthenticationModeField
          id="smtp-mode"
          value={mode}
          onValueChange={setMode}
          disabled={mutation.isPending}
        />
        <ProviderModeNotice mode={mode} />
        {mode === "managed" && (
          <>
            <div className="form-grid">
              <FieldShell
                id="smtp-host"
                label={t("admin.authSettings.smtpHost")}
              >
                <Input
                  id="smtp-host"
                  className="h-9"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  required
                />
              </FieldShell>
              <FieldShell
                id="smtp-port"
                label={t("admin.authSettings.smtpPort")}
              >
                <Input
                  id="smtp-port"
                  className="h-9"
                  type="number"
                  min={1}
                  max={65_535}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  required
                />
              </FieldShell>
            </div>
            <FieldShell
              id="smtp-security"
              label={t("admin.authSettings.smtpSecurity")}
            >
              <AdminSelect
                id="smtp-security"
                value={security}
                onValueChange={(next) =>
                  setSecurity(next as "tls" | "starttls")
                }
                options={[
                  {
                    value: "starttls",
                    label: t("admin.authSettings.starttls"),
                  },
                  { value: "tls", label: t("admin.authSettings.tls") },
                ]}
              />
            </FieldShell>
            <FieldShell id="smtp-from" label={t("admin.authSettings.smtpFrom")}>
              <Input
                id="smtp-from"
                className="h-9"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                required
              />
            </FieldShell>
            <FieldShell
              id="smtp-username"
              label={t("admin.authSettings.smtpUsername")}
              hint={t("admin.authSettings.smtpUsernameHint")}
            >
              <Input
                id="smtp-username"
                className="h-9"
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </FieldShell>
            <FieldShell
              id="smtp-password"
              label={t("admin.authSettings.smtpPassword")}
              hint={t(
                secretCanBePreserved
                  ? "admin.authSettings.secretPreserved"
                  : "admin.authSettings.secretRequiredWhenUsed"
              )}
            >
              <Input
                id="smtp-password"
                className="h-9 placeholder:text-foreground placeholder:opacity-100"
                type="password"
                autoComplete="new-password"
                value={password}
                placeholder={
                  secretCanBePreserved
                    ? MASKED_AUTHENTICATION_SECRET
                    : undefined
                }
                onChange={(event) => setPassword(event.target.value)}
              />
            </FieldShell>
          </>
        )}
        <div>
          <Button
            type="submit"
            size="lg"
            disabled={!valid || mutation.isPending}
            aria-busy={mutation.isPending || undefined}
          >
            {mutation.isPending && <Spinner data-icon="inline-start" />}
            {t("common.save")}
          </Button>
        </div>
      </form>
      <ProviderChangeConfirmation
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pending={mutation.isPending}
        onConfirm={() => pendingBody && mutation.mutate(pendingBody)}
      />
    </section>
  )
}

function OidcAuthenticationSettingsForm({
  settings,
}: {
  settings: AuthenticationSettings["oidc"]
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AuthenticationMode>(settings.mode)
  const [issuerUrl, setIssuerUrl] = useState(settings.issuer_url ?? "")
  const [clientId, setClientId] = useState(settings.client_id ?? "")
  const [clientSecret, setClientSecret] = useState("")
  const [loadedRevision, setLoadedRevision] = useState(settings.revision)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingBody, setPendingBody] = useState<Record<
    string,
    unknown
  > | null>(null)
  if (loadedRevision !== settings.revision) {
    setLoadedRevision(settings.revision)
    setMode(settings.mode)
    setIssuerUrl(settings.issuer_url ?? "")
    setClientId(settings.client_id ?? "")
    setClientSecret("")
  }
  const mutation = useAuthenticationSettingsMutation(
    "oidc",
    () => {
      setClientSecret("")
      setMessage(t("admin.authSettings.saved"))
      setError(null)
      setConfirmOpen(false)
    },
    (nextError) => setError(getErrorMessage(nextError, t))
  )
  const secretCanBePreserved =
    settings.mode === "managed" && settings.client_secret_configured
  const normalizedClientSecret = clientSecret.trim()
  const valid =
    mode !== "managed" ||
    (isHttpsUrl(issuerUrl) &&
      clientId.trim().length > 0 &&
      (normalizedClientSecret.length > 0 || secretCanBePreserved))

  const submit = () => {
    setMessage(null)
    setError(null)
    if (!valid) {
      setError(t("errors.validation"))
      return
    }
    const body: Record<string, unknown> = {
      mode,
      expected_revision: settings.revision,
      ...(mode === "managed"
        ? {
            issuer_url: issuerUrl.trim(),
            client_id: clientId.trim(),
            ...(normalizedClientSecret
              ? { client_secret: normalizedClientSecret }
              : {}),
          }
        : {}),
    }
    if (requiresProviderConfirmation(settings.mode, mode, settings.status)) {
      setPendingBody(body)
      setConfirmOpen(true)
      return
    }
    mutation.mutate(body)
  }

  return (
    <section className="settings-section" aria-labelledby="oidc-settings">
      <AuthenticationProviderHeading
        id="oidc-settings"
        title={t("admin.authSettings.oidcTitle")}
        description={t("admin.authSettings.oidcDescription")}
        status={settings.status}
      />
      <NotificationToast
        id="oidc-authentication-settings-saved"
        message={message}
      />
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <form
        className="form-stack settings-form"
        noValidate
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          submit()
        }}
      >
        <AuthenticationModeField
          id="oidc-mode"
          value={mode}
          onValueChange={setMode}
          disabled={mutation.isPending}
        />
        <ProviderModeNotice mode={mode} />
        {mode === "managed" && (
          <>
            <FieldShell
              id="oidc-issuer-url"
              label={t("admin.authSettings.oidcIssuer")}
            >
              <Input
                id="oidc-issuer-url"
                className="h-9"
                type="url"
                value={issuerUrl}
                onChange={(event) => setIssuerUrl(event.target.value)}
                required
              />
            </FieldShell>
            <FieldShell
              id="oidc-client-id"
              label={t("admin.authSettings.oidcClientId")}
            >
              <Input
                id="oidc-client-id"
                className="h-9"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                required
              />
            </FieldShell>
            <FieldShell
              id="oidc-client-secret"
              label={t("admin.authSettings.oidcClientSecret")}
              hint={t(
                secretCanBePreserved
                  ? "admin.authSettings.secretPreserved"
                  : "admin.authSettings.secretRequired"
              )}
            >
              <Input
                id="oidc-client-secret"
                className="h-9 placeholder:text-foreground placeholder:opacity-100"
                type="password"
                autoComplete="new-password"
                value={clientSecret}
                placeholder={
                  secretCanBePreserved
                    ? MASKED_AUTHENTICATION_SECRET
                    : undefined
                }
                onChange={(event) => setClientSecret(event.target.value)}
              />
            </FieldShell>
            <FieldShell
              id="oidc-redirect-uri"
              label={t("admin.authSettings.oidcRedirectUri")}
              hint={t("admin.authSettings.oidcRedirectHint")}
            >
              <Input
                id="oidc-redirect-uri"
                className="h-9"
                value={settings.redirect_uri}
                readOnly
              />
            </FieldShell>
          </>
        )}
        <div>
          <Button
            type="submit"
            size="lg"
            disabled={!valid || mutation.isPending}
            aria-busy={mutation.isPending || undefined}
          >
            {mutation.isPending && <Spinner data-icon="inline-start" />}
            {t("common.save")}
          </Button>
        </div>
      </form>
      <ProviderChangeConfirmation
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pending={mutation.isPending}
        onConfirm={() => pendingBody && mutation.mutate(pendingBody)}
      />
    </section>
  )
}

function TeamsAuthenticationSettingsForm({
  settings,
}: {
  settings: AuthenticationSettings["teams"]
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AuthenticationMode>(settings.mode)
  const [tenantId, setTenantId] = useState(settings.tenant_id ?? "")
  const [clientId, setClientId] = useState(settings.client_id ?? "")
  const [loadedRevision, setLoadedRevision] = useState(settings.revision)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingBody, setPendingBody] = useState<Record<
    string,
    unknown
  > | null>(null)
  if (loadedRevision !== settings.revision) {
    setLoadedRevision(settings.revision)
    setMode(settings.mode)
    setTenantId(settings.tenant_id ?? "")
    setClientId(settings.client_id ?? "")
  }
  const mutation = useAuthenticationSettingsMutation(
    "teams",
    () => {
      setMessage(t("admin.authSettings.saved"))
      setError(null)
      setConfirmOpen(false)
    },
    (nextError) => setError(getErrorMessage(nextError, t))
  )
  const valid =
    mode !== "managed" ||
    (z.uuid().safeParse(tenantId.trim()).success &&
      z.uuid().safeParse(clientId.trim()).success)

  const submit = () => {
    setMessage(null)
    setError(null)
    if (!valid) {
      setError(t("errors.validation"))
      return
    }
    const body: Record<string, unknown> = {
      mode,
      expected_revision: settings.revision,
      ...(mode === "managed"
        ? { tenant_id: tenantId.trim(), client_id: clientId.trim() }
        : {}),
    }
    if (requiresProviderConfirmation(settings.mode, mode, settings.status)) {
      setPendingBody(body)
      setConfirmOpen(true)
      return
    }
    mutation.mutate(body)
  }

  return (
    <section className="settings-section" aria-labelledby="teams-settings">
      <AuthenticationProviderHeading
        id="teams-settings"
        title={t("admin.authSettings.teamsTitle")}
        description={t("admin.authSettings.teamsDescription")}
        status={settings.status}
      />
      <NotificationToast
        id="teams-authentication-settings-saved"
        message={message}
      />
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <form
        className="form-stack settings-form"
        noValidate
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          submit()
        }}
      >
        <AuthenticationModeField
          id="teams-mode"
          value={mode}
          onValueChange={setMode}
          disabled={mutation.isPending}
        />
        <ProviderModeNotice mode={mode} />
        {mode === "managed" && (
          <>
            <FieldShell
              id="teams-tenant-id"
              label={t("admin.authSettings.teamsTenantId")}
            >
              <Input
                id="teams-tenant-id"
                className="h-9"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                required
              />
            </FieldShell>
            <FieldShell
              id="teams-client-id"
              label={t("admin.authSettings.teamsClientId")}
              hint={t("admin.authSettings.teamsExternalHint")}
            >
              <Input
                id="teams-client-id"
                className="h-9"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                required
              />
            </FieldShell>
          </>
        )}
        <div>
          <Button
            type="submit"
            size="lg"
            disabled={!valid || mutation.isPending}
            aria-busy={mutation.isPending || undefined}
          >
            {mutation.isPending && <Spinner data-icon="inline-start" />}
            {t("common.save")}
          </Button>
        </div>
      </form>
      <ProviderChangeConfirmation
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pending={mutation.isPending}
        onConfirm={() => pendingBody && mutation.mutate(pendingBody)}
      />
    </section>
  )
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === "https:"
  } catch {
    return false
  }
}

function HealthPage() {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [rebuildOpen, setRebuildOpen] = useState(false)
  const [cleanupRetryAllOpen, setCleanupRetryAllOpen] = useState(false)
  const [rebuildReason, setRebuildReason] = useState("")
  const query = useQuery({
    queryKey: ["admin", "health"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/health", { schema: healthSchema, signal }),
    refetchInterval: 30_000,
  })
  const retryCleanup = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/admin/health/cleanup/${id}/retry`, {
        method: "POST",
        schema: emptySchema,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["admin", "health"] }),
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const retryAllCleanup = useMutation({
    mutationFn: () =>
      apiRequest("/admin/health/cleanup/retry-all", {
        method: "POST",
        body: { confirmed: true },
        schema: z.object({
          code: z.literal("CLEANUP_BULK_RETRY_REQUESTED"),
          requested_count: z.number().int().nonnegative(),
          rejected_count: z.number().int().nonnegative(),
        }),
      }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setCleanupRetryAllOpen(false)
      await queryClient.invalidateQueries({ queryKey: ["admin", "health"] })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const maintenance = useQuery({
    queryKey: ["admin", "knowledge-maintenance", "rebuild-all"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/knowledge-maintenance/rebuild-all", {
        schema: knowledgeMaintenanceResponseSchema,
        signal,
      }),
    refetchInterval: (queryState) => {
      const status = queryState.state.data?.status
      return status === "pending" || status === "queued" || status === "running"
        ? 5_000
        : false
    },
  })
  const rebuild = useMutation({
    mutationFn: () =>
      apiRequest("/admin/knowledge-maintenance/rebuild-all", {
        method: "POST",
        body: { reason: rebuildReason.trim(), confirmed: true },
        schema: knowledgeMaintenanceResponseSchema,
      }),
    onMutate: () => setError(null),
    onSuccess: async (task) => {
      queryClient.setQueryData(
        ["admin", "knowledge-maintenance", "rebuild-all"],
        task
      )
      setRebuildOpen(false)
      setRebuildReason("")
      await queryClient.invalidateQueries({
        queryKey: ["admin", "health"],
      })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  return (
    <PageLayout
      className="health-page"
      title={t("health.title")}
      description={t("health.description", { productName })}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("common.refresh")}
          title={t("common.refresh")}
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCwIcon
            className={query.isFetching ? "animate-spin" : undefined}
            aria-hidden="true"
          />
        </Button>
      }
    >
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      {query.isLoading && <LoadingState />}
      {query.isError && (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && (
        <>
          <HealthContent
            health={query.data}
            language={language}
            onRetryCleanup={(id) => retryCleanup.mutate(id)}
            pendingCleanup={retryCleanup.variables}
            onRetryAllCleanup={() => setCleanupRetryAllOpen(true)}
            retryingAllCleanup={retryAllCleanup.isPending}
          />
          <KnowledgeMaintenanceSection
            task={maintenance.data}
            loading={maintenance.isLoading}
            error={maintenance.error}
            onRetryLoad={() => void maintenance.refetch()}
            onStart={() => setRebuildOpen(true)}
          />
        </>
      )}
      <Dialog
        open={rebuildOpen}
        onOpenChange={(open) => {
          setRebuildOpen(open)
          if (!open) setRebuildReason("")
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>
              {t("health.knowledgeRebuild.confirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("health.knowledgeRebuild.confirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <StatusBanner variant="warning">
            {t("health.knowledgeRebuild.confirmWarning")}
          </StatusBanner>
          <FieldShell
            id="knowledge-rebuild-reason"
            label={t("health.knowledgeRebuild.reason")}
            hint={t("health.knowledgeRebuild.reasonHint")}
          >
            <Textarea
              id="knowledge-rebuild-reason"
              value={rebuildReason}
              maxLength={1000}
              autoFocus={shouldAutoFocusOnDesktop()}
              required
              onChange={(event) => setRebuildReason(event.currentTarget.value)}
            />
          </FieldShell>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={!rebuildReason.trim() || rebuild.isPending}
              onClick={() => rebuild.mutate()}
            >
              {rebuild.isPending && (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              {t("health.knowledgeRebuild.confirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={cleanupRetryAllOpen}
        onOpenChange={setCleanupRetryAllOpen}
        title={t("health.cleanupRetryAllConfirmTitle")}
        description={t("health.cleanupRetryAllConfirmDescription")}
        confirmLabel={t("health.retryAllCleanup")}
        pendingLabel={t("health.retryingCleanup")}
        pending={retryAllCleanup.isPending}
        onConfirm={() => retryAllCleanup.mutate()}
      />
    </PageLayout>
  )
}

function KnowledgeMaintenanceSection({
  task,
  loading,
  error,
  onRetryLoad,
  onStart,
}: {
  task: KnowledgeMaintenanceTask | null | undefined
  loading: boolean
  error: unknown
  onRetryLoad: () => void
  onStart: () => void
}) {
  const { t } = useTranslation()
  const running =
    task?.status === "pending" ||
    task?.status === "queued" ||
    task?.status === "running"
  const stage = getKnowledgeMaintenanceStage(task?.current_stage, t)

  return (
    <section
      className="settings-section"
      aria-labelledby="knowledge-maintenance-title"
    >
      <div className="knowledge-section-heading">
        <div>
          <h2 id="knowledge-maintenance-title">
            {t("health.knowledgeRebuild.title")}
          </h2>
          <p>{t("health.knowledgeRebuild.description")}</p>
        </div>
        <Button
          type="button"
          variant={task?.status === "failed" ? "destructive" : "secondary"}
          disabled={running || loading}
          onClick={onStart}
        >
          <DatabaseBackupIcon data-icon="inline-start" aria-hidden="true" />
          {t(
            task?.status === "failed"
              ? "health.knowledgeRebuild.retry"
              : "health.knowledgeRebuild.action"
          )}
        </Button>
      </div>
      {loading && <LoadingState />}
      {Boolean(error) && (
        <ErrorState message={getErrorMessage(error, t)} onRetry={onRetryLoad} />
      )}
      {!loading && !error && !task && (
        <EmptyState title={t("health.knowledgeRebuild.empty")} />
      )}
      {task && (
        <div className="entity-list">
          <article className="entity-row">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3>{stage}</h3>
                <Badge
                  variant={
                    task.status === "failed" ? "destructive" : "secondary"
                  }
                >
                  {t(`health.knowledgeRebuild.status.${task.status}`)}
                </Badge>
              </div>
              <div className="entity-meta">
                <span>
                  {t("health.knowledgeRebuild.total")}: {task.total_count}
                </span>
                <span>
                  {t("health.knowledgeRebuild.succeeded")}:{" "}
                  {task.succeeded_count}
                </span>
                <span>
                  {t("health.knowledgeRebuild.failed")}: {task.failed_count}
                </span>
              </div>
              {task.stable_error_code && (
                <p className="text-[var(--destructive)]">
                  {t("health.knowledgeRebuild.errorSummary", {
                    code: task.stable_error_code,
                  })}
                </p>
              )}
            </div>
          </article>
        </div>
      )}
    </section>
  )
}

function getKnowledgeMaintenanceStage(
  stage: string | null | undefined,
  t: ReturnType<typeof useTranslation>["t"]
) {
  const knownStages = new Set([
    "queued",
    "preparing",
    "recreating_index",
    "rebuilding_documents",
    "validating",
    "activating",
    "completed",
    "failed",
  ])
  return t(
    knownStages.has(stage ?? "")
      ? `health.knowledgeRebuild.stage.${stage}`
      : "health.knowledgeRebuild.stage.processing"
  )
}

function HealthContent({
  health,
  language,
  onRetryCleanup,
  pendingCleanup,
  onRetryAllCleanup,
  retryingAllCleanup,
}: {
  health: HealthStatus
  language: SupportedLanguage
  onRetryCleanup: (id: string) => void
  pendingCleanup?: string
  onRetryAllCleanup: () => void
  retryingAllCleanup: boolean
}) {
  const { t } = useTranslation()
  const visibleComponents = health.components.filter(
    (component) => !hiddenHealthComponentKeys.has(component.key)
  )
  const isAvailable = (component: HealthStatus["components"][number]) =>
    component.status === "healthy"
  const knowledgeCapabilityKeys = new Set([
    "document_parsing",
    "knowledge_search_and_indexing",
    "rerank",
  ])
  const displayStatus = (component: HealthStatus["components"][number]) =>
    knowledgeCapabilityKeys.has(component.key)
      ? component.reported_status
      : component.status
  const componentMessage = (component: HealthStatus["components"][number]) => {
    if (component.reason_code === "PUBLIC_URL_INSECURE") {
      return t("health.reasons.public_url_insecure")
    }
    if (component.reason_code === "AUTH_HTTPS_REQUIRED") {
      return t("health.reasons.auth_https_required")
    }
    if (component.reason_code === "EMBEDDING_DIMENSION_MISMATCH") {
      return t("health.reasons.embedding_dimension_mismatch")
    }
    if (component.message_key) return t(component.message_key)
    if (component.summary) return component.summary
    if (
      (component.key === "redis" || component.key === "local_password_login") &&
      !isAvailable(component)
    ) {
      return t("health.reasons.login_protection_unavailable")
    }
    if (
      (component.key === "smtp" || component.key === "auth_email") &&
      !isAvailable(component)
    ) {
      return t("health.reasons.email_unavailable")
    }
    if (
      ["workspace", "workspace_root", "capability_root"].includes(
        component.key
      ) &&
      !isAvailable(component)
    ) {
      return t("health.reasons.read_write_failed")
    }
    if (component.status === "not_configured")
      return t("health.reasons.not_configured")
    if (component.status === "not_observed")
      return t("health.reasons.not_observed")
    if (knowledgeCapabilityKeys.has(component.key) && !isAvailable(component)) {
      return t(`health.reasons.${component.key}_unavailable`)
    }
    if (!isAvailable(component)) return t("health.reasons.connection_failed")
    return t("health.reasons.available")
  }
  return (
    <>
      <section className="health-summary" aria-label={t("health.overall")}>
        <div>
          <span>{t("health.overall")}</span>
          <strong>{t(`health.${health.overall_status}`)}</strong>
        </div>
        <div>
          <span>{t("health.runningTurns")}</span>
          <strong>{health.running_turn_count ?? 0}</strong>
        </div>
        <div>
          <span>{t("health.processes")}</span>
          <strong>{health.app_server_process_count ?? 0}</strong>
        </div>
        <div>
          <span>{t("health.concurrency")}</span>
          <strong>{health.concurrency_limit ?? "—"}</strong>
        </div>
      </section>
      <DockerResourceUsageSection
        usage={health.docker_resource_usage}
        language={language}
      />
      <div className="entity-list">
        {visibleComponents.map((component) => (
          <article key={component.key} className="entity-row">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2>{t(`health.components.${component.key}`)}</h2>
                <Badge
                  variant={isAvailable(component) ? "secondary" : "outline"}
                >
                  {t(
                    `health.${
                      displayStatus(component) === "not_configured"
                        ? "notConfigured"
                        : displayStatus(component) === "not_observed"
                          ? "notObserved"
                          : displayStatus(component)
                    }`
                  )}
                </Badge>
              </div>
              <p>{componentMessage(component)}</p>
              <div className="entity-meta">
                <span>
                  {t("health.checkedAt")}:{" "}
                  {formatDateTime(component.checked_at, language)}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
      {Boolean(health.cleanup_failures?.length) && (
        <section className="settings-section">
          <div className="knowledge-section-heading">
            <div>
              <h2>{t("health.cleanupFailures")}</h2>
              <p>{t("health.cleanupDescription")}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={retryingAllCleanup}
              onClick={onRetryAllCleanup}
            >
              {retryingAllCleanup && <Spinner data-icon="inline-start" />}
              {t("health.retryAllCleanup")}
            </Button>
          </div>
          <div className="entity-list">
            {health.cleanup_failures?.map((failure) => (
              <article key={failure.id} className="entity-row">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3>{t(`health.cleanupTypes.${failure.resource_type}`)}</h3>
                    <Badge variant="destructive">
                      {t("health.cleanupFailed")}
                    </Badge>
                  </div>
                  <div className="entity-meta">
                    <span>{failure.conversation_id ?? t("common.system")}</span>
                    <span>{formatDateTime(failure.failed_at, language)}</span>
                    <span>
                      {t("health.cleanupAttempts", {
                        current: failure.attempts_made,
                        total: failure.max_attempts,
                      })}
                    </span>
                  </div>
                  <p>
                    {t(
                      `health.cleanupStages.${failure.cleanup_stage ?? "reconcile"}`
                    )}
                    {" · "}
                    {t(`health.cleanupReasons.${failure.reason_code}`, {
                      defaultValue: t("health.cleanupReasons.unknown"),
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pendingCleanup === failure.id}
                  onClick={() => onRetryCleanup(failure.id)}
                >
                  {t("health.retryCleanup")}
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function DockerResourceUsageSection({
  usage,
  language,
}: {
  usage: HealthStatus["docker_resource_usage"]
  language: SupportedLanguage
}) {
  const { t } = useTranslation()
  if (!usage) return null
  const statusKey = dockerResourceStatusKey(usage.status)
  return (
    <section
      className="settings-section docker-resource-section"
      aria-labelledby="docker-resource-usage-title"
    >
      <div className="docker-resource-heading">
        <div>
          <div className="docker-resource-title-row">
            <h2 id="docker-resource-usage-title">
              {t("health.resources.title")}
            </h2>
            <Badge
              variant={usage.status === "available" ? "secondary" : "outline"}
            >
              {t(`health.resources.status.${statusKey}`)}
            </Badge>
          </div>
          <p>{t("health.resources.description")}</p>
          {usage.status !== "available" && (
            <p>
              {t(
                usage.status === "not_observed"
                  ? "health.resources.reasons.notObserved"
                  : "health.resources.reasons.unavailable"
              )}
            </p>
          )}
        </div>
      </div>
      <div className="entity-meta docker-resource-sampled-at">
        <span>
          {t("health.resources.checkedAt")}:{" "}
          {formatDateTime(usage.checked_at, language)}
        </span>
      </div>
      {usage.services.length === 0 ? (
        <EmptyState title={t("health.resources.empty")} />
      ) : (
        <div className="docker-resource-list">
          {usage.services.map((service) => (
            <article
              key={`${service.service_type}:${service.key}`}
              className="docker-resource-row"
            >
              <div className="docker-resource-service">
                <div className="docker-resource-title-row">
                  <h3>{dockerResourceServiceLabel(service.key, t)}</h3>
                  <Badge
                    variant={
                      service.status === "available" ? "secondary" : "outline"
                    }
                  >
                    {t(
                      `health.resources.status.${dockerResourceStatusKey(service.status)}`
                    )}
                  </Badge>
                </div>
                <div className="entity-meta docker-resource-service-meta">
                  <span>
                    {t("health.resources.containers", {
                      running: service.running_container_count,
                      total: service.container_count,
                    })}
                  </span>
                  {service.pids !== null && (
                    <span>
                      {t("health.resources.pids", { count: service.pids })}
                    </span>
                  )}
                  {service.state && (
                    <span>
                      {t("health.resources.state", { state: service.state })}
                    </span>
                  )}
                </div>
              </div>
              <DockerResourceMeter
                label={t("health.resources.cpu")}
                value={formatResourcePercent(service.cpu_percent, language)}
                percent={service.cpu_percent}
              />
              <DockerResourceMeter
                label={t("health.resources.memory")}
                value={formatResourceMemory(service, language)}
                percent={service.memory_percent}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function DockerResourceMeter({
  label,
  value,
  percent,
}: {
  label: string
  value: string
  percent: number | null
}) {
  const boundedValue =
    percent === null || Number.isNaN(percent)
      ? 0
      : Math.max(0, Math.min(percent, 100))
  const usageLevel = dockerResourceUsageLevel(percent)
  return (
    <div className="docker-resource-meter">
      <div className="docker-resource-meter-label">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Progress
        value={boundedValue}
        aria-label={`${label} ${value}`}
        data-usage-level={usageLevel}
        className={percent === null ? "docker-resource-meter-empty" : undefined}
      />
    </div>
  )
}

function dockerResourceUsageLevel(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown"
  }
  if (value >= 80) return "high"
  if (value >= 60) return "medium"
  return "low"
}

function dockerResourceServiceLabel(
  key: string,
  t: ReturnType<typeof useTranslation>["t"]
) {
  const translationKey = dockerResourceServiceTranslationKeys[key]
  return translationKey ? t(translationKey) : key
}

function dockerResourceStatusKey(
  status: "available" | "unavailable" | "not_observed"
) {
  return status === "not_observed" ? "notObserved" : status
}

function formatResourcePercent(
  value: number | null | undefined,
  language: SupportedLanguage
) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—"
  return new Intl.NumberFormat(language, {
    style: "percent",
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value / 100)
}

function formatResourceMemory(
  service: NonNullable<
    HealthStatus["docker_resource_usage"]
  >["services"][number],
  language: SupportedLanguage
) {
  const used = formatResourceBytes(service.memory_used_bytes, language)
  const limit = formatResourceBytes(service.memory_limit_bytes, language)
  if (used === "—" && limit === "—") return "—"
  if (limit === "—") return used
  return `${used} / ${limit}`
}

function formatResourceBytes(
  value: number | null | undefined,
  language: SupportedLanguage
) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—"
  const gib = 1024 * 1024 * 1024
  const mib = 1024 * 1024
  const kib = 1024
  const [unit, divisor] =
    value >= gib
      ? (["gigabyte", gib] as const)
      : value >= mib
        ? (["megabyte", mib] as const)
        : (["kilobyte", kib] as const)
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: value / divisor >= 10 ? 0 : 1,
  }).format(value / divisor)
}

export function AdminPages({ page }: { page: AdminPage }) {
  if (page === "users") return <UserManagementPage />
  if (page === "roles") return <RoleOverviewPage />
  if (page === "groups") return <UserGroupManagementPage />
  if (page === "audit") return <AuditPage />
  if (page === "models") return <ModelSettingsPage />
  if (page === "settings") return <ProductSettingsPage />
  return <HealthPage />
}
