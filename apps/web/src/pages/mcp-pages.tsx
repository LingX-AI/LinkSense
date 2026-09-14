import { Fragment, useState, type FormEvent } from "react"
import {
  mcpDefaultStartupTimeoutSeconds,
  mcpDefaultToolTimeoutSeconds,
} from "@linksense/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  FlaskConicalIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { apiRequest } from "@/api/client"
import {
  mcpServerSchema,
  mcpServerTestResultSchema,
  type McpServer,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { McpLogo } from "@/components/capabilities/capability-library-item"
import { FieldShell } from "@/components/forms/form-field"
import { PageLayout } from "@/components/shell/page-layout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const mcpListSchema = z.strictObject({
  items: z.array(mcpServerSchema),
})
const emptySchema = z.unknown()
const STDIO_CONFIGURATION_EXAMPLE = `{
  "command": "npx",
  "args": [],
  "env": {}
}`
const stdioEnvironmentSchema = z.record(
  z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
    .max(120),
  z.string().max(64 * 1_024)
)
const stdioConfigurationSchema = z.strictObject({
  command: z.string().trim().min(1).max(512),
  args: z.array(z.string().max(4_096)).max(128).optional(),
  env: stdioEnvironmentSchema.optional(),
})
const stdioConfigurationEnvelopeSchema = z.strictObject({
  mcpServers: z.record(
    z.string().trim().min(1).max(160),
    stdioConfigurationSchema
  ),
})

type ParsedStdioConfiguration = {
  serverName: string | null
  command: string
  args: string[]
  environment: Record<string, string> | undefined
  environmentSpecified: boolean
}

type McpAuthType = McpServer["auth_type"]
type McpTransport = McpServer["transport"]

function isMcpAuthType(value: unknown): value is McpAuthType {
  return value === "none" || value === "bearer" || value === "api_key"
}

function isMcpTransport(value: unknown): value is McpTransport {
  return value === "streamable_http" || value === "stdio"
}

function parseStdioConfiguration(
  value: string
): ParsedStdioConfiguration | null {
  try {
    const parsed: unknown = JSON.parse(value)
    const direct = stdioConfigurationSchema.safeParse(parsed)
    if (direct.success) {
      return normalizeStdioConfiguration(null, direct.data)
    }

    const envelope = stdioConfigurationEnvelopeSchema.safeParse(parsed)
    if (!envelope.success) return null
    const entries = Object.entries(envelope.data.mcpServers)
    if (entries.length !== 1) return null
    const [serverName, configuration] = entries[0]!
    return normalizeStdioConfiguration(serverName, configuration)
  } catch {
    return null
  }
}

function normalizeStdioConfiguration(
  serverName: string | null,
  configuration: z.infer<typeof stdioConfigurationSchema>
): ParsedStdioConfiguration {
  return {
    serverName,
    command: configuration.command,
    args: configuration.args ?? [],
    environment: configuration.env,
    environmentSpecified: Object.hasOwn(configuration, "env"),
  }
}

function serializeStdioConfiguration(server: McpServer): string {
  if (server.transport !== "stdio") return STDIO_CONFIGURATION_EXAMPLE
  return JSON.stringify(
    {
      command: server.command,
      args: server.args,
    },
    null,
    2
  )
}

function McpTestStatusIndicator({
  name,
  status,
}: {
  name: string
  status: McpServer["last_test_status"]
}) {
  const { t } = useTranslation()
  const statusKey = status ?? "untested"
  const statusLabel = t(`mcp.testStatus.${statusKey}`)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            aria-label={t("mcp.testStatusLabel", {
              name,
              status: statusLabel,
            })}
          />
        }
      >
        <span
          aria-hidden="true"
          data-slot="mcp-test-status-dot"
          data-status={statusKey}
          className={cn(
            "inline-flex size-2.5 items-center justify-center rounded-full",
            status === "succeeded" && "bg-success/20",
            status === "failed" && "bg-destructive/20",
            status === null && "bg-muted-foreground/15"
          )}
        >
          <span
            data-slot="mcp-test-status-core"
            className={cn(
              "size-1.5 rounded-full",
              status === "succeeded" && "bg-success",
              status === "failed" && "bg-destructive",
              status === null && "bg-muted-foreground/55"
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{statusLabel}</TooltipContent>
    </Tooltip>
  )
}

export function McpManagementPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null)
  const [transport, setTransport] = useState<McpTransport>("streamable_http")
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [stdioConfigurationJson, setStdioConfigurationJson] = useState(
    STDIO_CONFIGURATION_EXAMPLE
  )
  const [inferredStdioName, setInferredStdioName] = useState<string | null>(
    null
  )
  const [authType, setAuthType] = useState<McpAuthType>("none")
  const [apiKeyHeader, setApiKeyHeader] = useState("X-API-Key")
  const [credential, setCredential] = useState("")
  const [startupTimeout, setStartupTimeout] = useState(
    String(mcpDefaultStartupTimeoutSeconds)
  )
  const [toolTimeout, setToolTimeout] = useState(
    String(mcpDefaultToolTimeoutSeconds)
  )
  const [httpAcknowledged, setHttpAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const normalizedCredential = credential.trim()

  const serversQuery = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: ({ signal }) =>
      apiRequest("/mcp-servers", { schema: mcpListSchema, signal }),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["mcp-servers"] })

  const resetEditor = () => {
    setEditing(null)
    setTransport("streamable_http")
    setName("")
    setUrl("")
    setStdioConfigurationJson(STDIO_CONFIGURATION_EXAMPLE)
    setInferredStdioName(null)
    setAuthType("none")
    setApiKeyHeader("X-API-Key")
    setCredential("")
    setStartupTimeout(String(mcpDefaultStartupTimeoutSeconds))
    setToolTimeout(String(mcpDefaultToolTimeoutSeconds))
    setHttpAcknowledged(false)
  }

  const openCreate = () => {
    resetEditor()
    setError(null)
    setNotice(null)
    setEditorOpen(true)
  }

  const openEdit = (server: McpServer) => {
    setEditing(server)
    setTransport(server.transport)
    setName(server.name)
    setUrl(server.url ?? "")
    setStdioConfigurationJson(serializeStdioConfiguration(server))
    setInferredStdioName(null)
    setAuthType(server.auth_type)
    setApiKeyHeader(server.api_key_header ?? "X-API-Key")
    setCredential("")
    setStartupTimeout(String(server.startup_timeout_seconds))
    setToolTimeout(String(server.tool_timeout_seconds))
    setHttpAcknowledged(server.insecure_http_acknowledged)
    setError(null)
    setNotice(null)
    setEditorOpen(true)
  }

  const parsedStdioConfiguration = parseStdioConfiguration(
    stdioConfigurationJson
  )

  const updateStdioConfigurationJson = (value: string) => {
    const nextConfiguration = parseStdioConfiguration(value)
    const nextInferredName = nextConfiguration?.serverName ?? null
    setStdioConfigurationJson(value)
    setName((currentName) => {
      if (
        nextInferredName &&
        (!currentName.trim() || currentName === inferredStdioName)
      ) {
        return nextInferredName
      }
      return currentName
    })
    setInferredStdioName(nextInferredName)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const common = {
        name: name.trim(),
        startup_timeout_seconds: Number(startupTimeout),
        tool_timeout_seconds: Number(toolTimeout),
      }
      const body =
        transport === "stdio"
          ? {
              ...common,
              ...(!editing ? { transport: "stdio" as const } : {}),
              command: parsedStdioConfiguration?.command ?? "",
              args: parsedStdioConfiguration?.args ?? [],
              ...(parsedStdioConfiguration?.environmentSpecified
                ? editing &&
                  Object.keys(parsedStdioConfiguration.environment ?? {})
                    .length === 0
                  ? { clear_environment: true }
                  : {
                      environment: parsedStdioConfiguration.environment ?? {},
                    }
                : {}),
            }
          : {
              ...common,
              ...(!editing ? { transport: "streamable_http" as const } : {}),
              url: url.trim(),
              auth_type: authType,
              ...(authType === "api_key"
                ? { api_key_header: apiKeyHeader.trim() }
                : {}),
              ...(normalizedCredential
                ? { credential: normalizedCredential }
                : {}),
              insecure_http_acknowledged: httpAcknowledged,
            }
      return apiRequest(
        editing ? `/mcp-servers/${editing.id}` : "/mcp-servers",
        {
          method: editing ? "PATCH" : "POST",
          body,
          schema: mcpServerSchema,
        }
      )
    },
    onSuccess: async () => {
      setEditorOpen(false)
      resetEditor()
      setError(null)
      setNotice(t("mcp.saved"))
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const statusMutation = useMutation({
    mutationFn: (server: McpServer) =>
      apiRequest(`/mcp-servers/${server.id}`, {
        method: "PATCH",
        body: {
          status: server.status === "active" ? "disabled" : "active",
        },
        schema: mcpServerSchema,
      }),
    onSuccess: async () => {
      setError(null)
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const testMutation = useMutation({
    mutationFn: (server: McpServer) =>
      apiRequest(`/mcp-servers/${server.id}/test`, {
        method: "POST",
        schema: mcpServerTestResultSchema,
      }),
    onSuccess: async (result) => {
      setError(null)
      setNotice(
        t("mcp.testSucceeded", {
          serverName: result.server_name,
          count: result.tool_count,
        })
      )
      await invalidate()
    },
    onError: (nextError) => {
      setNotice(null)
      setError(getErrorMessage(nextError, t))
      void invalidate()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/mcp-servers/${deleteTarget?.id}`, {
        method: "DELETE",
        schema: emptySchema,
      }),
    onSuccess: async () => {
      setDeleteTarget(null)
      setError(null)
      setNotice(t("mcp.deleted"))
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const isHttp = url.trim().toLocaleLowerCase().startsWith("http://")
  const needsNewCredential =
    transport === "streamable_http" &&
    authType !== "none" &&
    !normalizedCredential &&
    (!editing?.has_credential || editing.auth_type === "none")
  const timeoutsValid =
    Number.isInteger(Number(startupTimeout)) &&
    Number(startupTimeout) >= 1 &&
    Number(startupTimeout) <= 120 &&
    Number.isInteger(Number(toolTimeout)) &&
    Number(toolTimeout) >= 1 &&
    Number(toolTimeout) <= 600
  const canSave =
    Boolean(name.trim()) &&
    timeoutsValid &&
    (transport === "stdio"
      ? parsedStdioConfiguration !== null
      : Boolean(
          url.trim() &&
          (!isHttp || httpAcknowledged) &&
          (!needsNewCredential || normalizedCredential) &&
          (authType !== "api_key" || apiKeyHeader.trim())
        ))

  const servers = serversQuery.data?.items ?? []

  return (
    <PageLayout
      title={t("mcp.title")}
      description={t("mcp.description")}
      actions={<Button onClick={openCreate}>{t("mcp.add")}</Button>}
    >
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      {notice && <StatusBanner variant="success">{notice}</StatusBanner>}
      {serversQuery.isLoading && <LoadingState />}
      {serversQuery.isError && (
        <ErrorState
          message={getErrorMessage(serversQuery.error, t)}
          onRetry={() => void serversQuery.refetch()}
        />
      )}
      {!serversQuery.isLoading &&
        !serversQuery.isError &&
        servers.length === 0 && (
          <EmptyState
            title={t("mcp.empty")}
            description={t("mcp.emptyDescription")}
          />
        )}

      {servers.length > 0 && (
        <Card
          role="region"
          aria-label={t("mcp.title")}
          className="entity-list mcp-server-list gap-0 px-4 py-0"
        >
          {servers.map((server, index) => {
            const isTesting =
              testMutation.isPending && testMutation.variables?.id === server.id
            return (
              <Fragment key={server.id}>
                {index > 0 && <Separator className="bg-[var(--app-border)]" />}
                <article className="entity-row entity-row-top">
                  <McpLogo />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2>{server.name}</h2>
                      <Badge
                        variant={
                          server.transport === "stdio" ||
                          server.url?.startsWith("https:")
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {t(`mcp.transport.${server.transport}`)}
                      </Badge>
                      {server.transport === "streamable_http" ? (
                        <Badge variant="outline">
                          {t(`mcp.auth.${server.auth_type}`)}
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          {t("mcp.environmentCount", {
                            count: server.environment_keys.length,
                          })}
                        </Badge>
                      )}
                      <McpTestStatusIndicator
                        name={server.name}
                        status={server.last_test_status}
                      />
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {server.transport === "stdio"
                        ? [server.command, ...server.args].join(" ")
                        : server.url}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isTesting && (
                      <LoaderCircleIcon
                        className="size-4 animate-spin text-muted-foreground"
                        aria-label={t("mcp.testing", { name: server.name })}
                      />
                    )}
                    <Switch
                      name={`mcp-server-${server.id}-enabled`}
                      checked={server.status === "active"}
                      disabled={statusMutation.isPending}
                      aria-label={t("mcp.toggle", { name: server.name })}
                      onCheckedChange={() => statusMutation.mutate(server)}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("common.more")}
                          />
                        }
                      >
                        <MoreHorizontalIcon aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={isTesting}
                          onClick={() => testMutation.mutate(server)}
                        >
                          {isTesting ? (
                            <LoaderCircleIcon
                              className="animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <FlaskConicalIcon aria-hidden="true" />
                          )}
                          {t("mcp.testConnection")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(server)}>
                          <PencilIcon aria-hidden="true" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(server)}
                        >
                          <Trash2Icon aria-hidden="true" />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </article>
              </Fragment>
            )
          })}
        </Card>
      )}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) resetEditor()
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          className="min-w-0 overflow-x-hidden sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>
              {t(editing ? "mcp.editTitle" : "mcp.createTitle")}
            </DialogTitle>
            <DialogDescription>{t("mcp.editorDescription")}</DialogDescription>
          </DialogHeader>
          <form
            className="flex max-h-[70vh] min-w-0 flex-col gap-5 overflow-x-hidden overflow-y-auto pr-1"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              if (canSave) saveMutation.mutate()
            }}
          >
            <FieldShell id="mcp-transport" label={t("mcp.transportLabel")}>
              <Select
                name="mcp-transport"
                value={transport}
                disabled={Boolean(editing)}
                onValueChange={(value) => {
                  if (isMcpTransport(value)) setTransport(value)
                }}
              >
                <SelectTrigger id="mcp-transport" className="w-full">
                  <SelectValue>{t(`mcp.transport.${transport}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="streamable_http">
                      {t("mcp.transport.streamable_http")}
                    </SelectItem>
                    <SelectItem value="stdio">
                      {t("mcp.transport.stdio")}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FieldShell>
            <FieldShell id="mcp-name" label={t("mcp.name")}>
              <Input
                id="mcp-name"
                name="mcp-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                required
              />
            </FieldShell>

            {transport === "streamable_http" ? (
              <>
                <FieldShell
                  id="mcp-url"
                  label={t("mcp.url")}
                  hint={t("mcp.urlHint")}
                >
                  <Input
                    id="mcp-url"
                    name="mcp-url"
                    type="url"
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value)
                      if (event.target.value !== editing?.url) {
                        setHttpAcknowledged(false)
                      }
                    }}
                    placeholder="https://mcp.example.com/mcp"
                    required
                  />
                </FieldShell>
                {isHttp && (
                  <Alert>
                    <ShieldAlertIcon aria-hidden="true" />
                    <AlertTitle>{t("mcp.httpWarningTitle")}</AlertTitle>
                    <AlertDescription>
                      {t("mcp.httpWarningDescription")}
                    </AlertDescription>
                    <Field
                      orientation="horizontal"
                      className="col-start-2 mt-2 gap-2"
                    >
                      <Checkbox
                        id="mcp-http-acknowledgement"
                        name="mcp-http-acknowledgement"
                        checked={httpAcknowledged}
                        onCheckedChange={(checked) =>
                          setHttpAcknowledged(checked === true)
                        }
                      />
                      <FieldLabel htmlFor="mcp-http-acknowledgement">
                        {t("mcp.httpAcknowledgement")}
                      </FieldLabel>
                    </Field>
                  </Alert>
                )}
                <FieldShell id="mcp-auth" label={t("mcp.authentication")}>
                  <Select
                    name="mcp-authentication"
                    value={authType}
                    onValueChange={(value) => {
                      if (isMcpAuthType(value)) setAuthType(value)
                    }}
                  >
                    <SelectTrigger id="mcp-auth" className="w-full">
                      <SelectValue>{t(`mcp.auth.${authType}`)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="none">
                          {t("mcp.auth.none")}
                        </SelectItem>
                        <SelectItem value="bearer">
                          {t("mcp.auth.bearer")}
                        </SelectItem>
                        <SelectItem value="api_key">
                          {t("mcp.auth.api_key")}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </FieldShell>
                {authType === "api_key" && (
                  <FieldShell
                    id="mcp-api-key-header"
                    label={t("mcp.apiKeyHeader")}
                  >
                    <Input
                      id="mcp-api-key-header"
                      name="mcp-api-key-header"
                      value={apiKeyHeader}
                      onChange={(event) => setApiKeyHeader(event.target.value)}
                      autoComplete="off"
                      required
                    />
                  </FieldShell>
                )}
                {authType !== "none" && (
                  <FieldShell
                    id="mcp-credential"
                    label={t("mcp.credential")}
                    hint={t(
                      editing ? "mcp.keepCredentialHint" : "mcp.credentialHint"
                    )}
                  >
                    <Input
                      id="mcp-credential"
                      name="mcp-credential"
                      type="password"
                      value={credential}
                      onChange={(event) => setCredential(event.target.value)}
                      autoComplete="new-password"
                      required={needsNewCredential}
                    />
                  </FieldShell>
                )}
              </>
            ) : (
              <FieldShell
                id="mcp-stdio-configuration"
                label={t("mcp.stdioConfiguration")}
                hint={
                  <>
                    {t(
                      editing
                        ? "mcp.stdioConfigurationEditHint"
                        : "mcp.stdioConfigurationHint"
                    )}
                    {editing?.transport === "stdio" &&
                      editing.environment_keys.length > 0 && (
                        <>
                          <br />
                          {t("mcp.currentEnvironmentKeys", {
                            keys: editing.environment_keys.join(", "),
                          })}
                        </>
                      )}
                  </>
                }
                error={
                  stdioConfigurationJson.trim() &&
                  parsedStdioConfiguration === null
                    ? t("mcp.stdioConfigurationInvalid")
                    : undefined
                }
              >
                <Textarea
                  id="mcp-stdio-configuration"
                  name="mcp-stdio-configuration"
                  className="min-h-64 min-w-0 font-mono"
                  value={stdioConfigurationJson}
                  onChange={(event) =>
                    updateStdioConfigurationJson(event.target.value)
                  }
                  aria-invalid={parsedStdioConfiguration === null}
                  aria-describedby={
                    parsedStdioConfiguration === null
                      ? "mcp-stdio-configuration-error"
                      : undefined
                  }
                  spellCheck={false}
                />
              </FieldShell>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldShell
                id="mcp-startup-timeout"
                label={t("mcp.startupTimeout")}
              >
                <Input
                  id="mcp-startup-timeout"
                  name="mcp-startup-timeout"
                  type="number"
                  min={1}
                  max={120}
                  value={startupTimeout}
                  onChange={(event) => setStartupTimeout(event.target.value)}
                  required
                />
              </FieldShell>
              <FieldShell id="mcp-tool-timeout" label={t("mcp.toolTimeout")}>
                <Input
                  id="mcp-tool-timeout"
                  name="mcp-tool-timeout"
                  type="number"
                  min={1}
                  max={600}
                  value={toolTimeout}
                  onChange={(event) => setToolTimeout(event.target.value)}
                  required
                />
              </FieldShell>
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                {t("common.cancel")}
              </DialogClose>
              <Button
                type="submit"
                disabled={!canSave || saveMutation.isPending}
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
        title={t("mcp.deleteTitle")}
        description={t("mcp.deleteDescription")}
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </PageLayout>
  )
}
