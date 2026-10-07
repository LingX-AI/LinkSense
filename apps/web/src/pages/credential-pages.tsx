import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  credentialEnvironmentKeySchema,
  credentialPluginConfigurationSchema,
  credentialProviderTypeSchema,
} from "@linksense/shared"
import {
  KeyRoundIcon,
  LinkIcon,
  MoreHorizontalIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { apiRequest } from "@/api/client"
import {
  capabilitySummarySchema,
  credentialBindingSchema,
  credentialSchema,
  paginatedSchema,
  type Credential,
  type CredentialBinding,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { useProductName } from "@/app/product-branding"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { notify } from "@/components/feedback/notification"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { capabilityPresentation } from "@/features/capabilities/built-in-presentation"
import { PageLayout } from "@/components/shell/page-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CredentialPluginAssociation } from "@/features/credentials/credential-plugin-association"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"

const emptySchema = z.unknown()
const credentialNameSchema = z.string().trim().min(1).max(160)
const credentialSecretValueSchema = z
  .string()
  .min(1)
  .max(64 * 1024)
const maskedSecretPlaceholder = "••••••••"
const credentialBindingToastId = "credential-binding"
const credentialBindingSyncResultSchema = z.strictObject({
  items: z.array(credentialBindingSchema),
})

type SecretEntry = {
  id: number
  key: string
  value: string
  savedKey?: string
}
type CredentialSaveBody = {
  name: string
  provider_type: string
  secret_payload?: Record<string, string>
  secret_fields?: Array<{
    key: string
    previous_key?: string
    value?: string
  }>
}
type CredentialBindingSyncBody = {
  credential_id: string
  capability_id: string
  mappings: Array<{ env_key: string; credential_key: string }>
}
let secretEntryId = 0

function createSecretEntry(): SecretEntry {
  secretEntryId += 1
  return { id: secretEntryId, key: "", value: "" }
}

function createSavedSecretEntry(key: string): SecretEntry {
  secretEntryId += 1
  return { id: secretEntryId, key, value: "", savedKey: key }
}

export function CredentialManagementPage() {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Credential | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Credential | null>(null)
  const [statusTarget, setStatusTarget] = useState<Credential | null>(null)
  const [detailTarget, setDetailTarget] = useState<Credential | null>(null)
  const [bindingTarget, setBindingTarget] = useState<Credential | null>(null)
  const [unbindTarget, setUnbindTarget] = useState<CredentialBinding | null>(
    null
  )
  const [name, setName] = useState("")
  const [providerType, setProviderType] = useState("")
  const [secretEntries, setSecretEntries] = useState<SecretEntry[]>(() => [
    createSecretEntry(),
  ])
  const [capabilityId, setCapabilityId] = useState("")
  const [bindingMappings, setBindingMappings] = useState<
    Record<string, string>
  >({})
  const [mappingDetailsOpen, setMappingDetailsOpen] = useState(false)
  const [removePluginTarget, setRemovePluginTarget] = useState<{
    credentialId: string
    capabilityId: string
    name: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)

  const credentialQuery = useQuery({
    queryKey: ["credentials"],
    queryFn: ({ signal }) =>
      apiRequest("/credentials", {
        schema: paginatedSchema(credentialSchema),
        signal,
      }),
  })

  const bindingQuery = useQuery({
    queryKey: ["credential-bindings"],
    queryFn: ({ signal }) =>
      apiRequest("/credentials/bindings", {
        schema: paginatedSchema(credentialBindingSchema),
        signal,
      }),
  })

  const capabilityQuery = useQuery({
    queryKey: ["capabilities", "credential-binding"],
    queryFn: ({ signal }) =>
      apiRequest("/capabilities", {
        schema: paginatedSchema(capabilitySummarySchema),
        query: { view: "available" },
        signal,
      }),
  })

  const configurationQuery = useQuery({
    queryKey: ["credentials", "plugin-configurations"],
    queryFn: ({ signal }) =>
      apiRequest("/credentials/plugin-configurations", {
        schema: paginatedSchema(credentialPluginConfigurationSchema),
        signal,
      }),
  })

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["credentials"] }),
      queryClient.invalidateQueries({ queryKey: ["credential-bindings"] }),
      queryClient.invalidateQueries({ queryKey: ["applications"] }),
    ])

  const resetEditor = () => {
    setEditing(null)
    setName("")
    setProviderType("")
    setSecretEntries([createSecretEntry()])
    setEditorError(null)
  }

  const openCreate = () => {
    resetEditor()
    setEditorOpen(true)
  }

  const openEdit = (credential: Credential) => {
    setEditing(credential)
    setName(credential.name)
    setProviderType(credential.type)
    setSecretEntries(credential.secret_keys.map(createSavedSecretEntry))
    setEditorError(null)
    setEditorOpen(true)
  }

  const openBinding = (credential: Credential, pluginId = "") => {
    setBindingTarget(credential)
    setMappingDetailsOpen(false)
    selectBindingCapability(pluginId, credential)
  }

  const closeBinding = () => {
    setBindingTarget(null)
    setCapabilityId("")
    setBindingMappings({})
  }

  const saveMutation = useMutation({
    mutationFn: (body: CredentialSaveBody) => {
      return apiRequest(
        editing ? `/credentials/${editing.id}` : "/credentials",
        {
          method: editing ? "PATCH" : "POST",
          body,
          schema: credentialSchema,
        }
      )
    },
    onSuccess: async () => {
      setEditorOpen(false)
      resetEditor()
      await invalidate()
    },
    onError: (nextError) => setEditorError(getErrorMessage(nextError, t)),
  })

  const buildSaveBody = (): CredentialSaveBody | null => {
    const parsedName = credentialNameSchema.safeParse(name)
    if (!parsedName.success) {
      setEditorError(t("credential.nameInvalid"))
      return null
    }
    const parsedProviderType =
      credentialProviderTypeSchema.safeParse(providerType)
    if (!parsedProviderType.success) {
      setEditorError(t("credential.providerTypeFormat"))
      return null
    }

    const body: CredentialSaveBody = {
      name: parsedName.data,
      provider_type: parsedProviderType.data,
    }

    const secretKeys = secretEntries.map((entry) => entry.key.trim())
    if (new Set(secretKeys).size !== secretKeys.length) {
      setEditorError(t("credential.secretKeyDuplicate"))
      return null
    }

    if (!editing) {
      const secretPayload: Record<string, string> = {}
      for (const entry of secretEntries) {
        const parsedKey = credentialEnvironmentKeySchema.safeParse(
          entry.key.trim()
        )
        if (!parsedKey.success) {
          setEditorError(t("credential.secretKeyFormat"))
          return null
        }
        if (!credentialSecretValueSchema.safeParse(entry.value).success) {
          setEditorError(t("credential.secretRequired"))
          return null
        }
        secretPayload[parsedKey.data] = entry.value
      }
      body.secret_payload = secretPayload
      return body
    }

    const secretFieldsChanged =
      secretEntries.length !== editing.secret_keys.length ||
      secretEntries.some(
        (entry, index) =>
          entry.savedKey !== editing.secret_keys[index] ||
          entry.key.trim() !== entry.savedKey ||
          Boolean(entry.value)
      )
    if (!secretFieldsChanged) return body
    if (secretEntries.length === 0) {
      setEditorError(t("credential.secretRequired"))
      return null
    }

    const secretFields: NonNullable<CredentialSaveBody["secret_fields"]> = []
    for (const entry of secretEntries) {
      const parsedKey = credentialEnvironmentKeySchema.safeParse(
        entry.key.trim()
      )
      if (!parsedKey.success) {
        setEditorError(t("credential.secretKeyFormat"))
        return null
      }
      if (entry.value) {
        if (!credentialSecretValueSchema.safeParse(entry.value).success) {
          setEditorError(t("credential.secretRequired"))
          return null
        }
        secretFields.push({ key: parsedKey.data, value: entry.value })
        continue
      }
      if (!entry.savedKey) {
        setEditorError(t("credential.secretRequired"))
        return null
      }
      secretFields.push({
        key: parsedKey.data,
        previous_key: entry.savedKey,
      })
    }
    body.secret_fields = secretFields
    return body
  }

  const statusMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/credentials/${statusTarget?.id}`, {
        method: "PATCH",
        body: {
          status: statusTarget?.status === "active" ? "disabled" : "active",
        },
        schema: credentialSchema,
      }),
    onSuccess: async () => {
      setStatusTarget(null)
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/credentials/${deleteTarget?.id}`, {
        method: "DELETE",
        schema: emptySchema,
      }),
    onSuccess: async () => {
      setDeleteTarget(null)
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const bindMutation = useMutation({
    mutationFn: (body: CredentialBindingSyncBody) =>
      apiRequest("/credentials/bindings", {
        method: "PUT",
        body,
        schema: credentialBindingSyncResultSchema,
      }),
    onSuccess: async () => {
      await invalidate()
      notify.success(t("credential.bindingSucceeded"), {
        id: credentialBindingToastId,
      })
    },
    onError: (nextError) =>
      notify.error(getErrorMessage(nextError, t), {
        id: credentialBindingToastId,
      }),
  })

  const unbindMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/credentials/bindings/${unbindTarget?.id}`, {
        method: "DELETE",
        schema: emptySchema,
      }),
    onSuccess: async () => {
      setUnbindTarget(null)
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const removePluginMutation = useMutation({
    mutationFn: (target: { credentialId: string; capabilityId: string }) =>
      apiRequest("/credentials/bindings", {
        method: "DELETE",
        query: {
          credential_id: target.credentialId,
          capability_id: target.capabilityId,
        },
        schema: emptySchema,
      }),
    onSuccess: async () => {
      setRemovePluginTarget(null)
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const credentialItems = credentialQuery.data?.items ?? []

  const bindingsByCredential = useMemo(() => {
    const groups = new Map<string, CredentialBinding[]>()
    const bindingItems = bindingQuery.data?.items ?? []
    for (const binding of bindingItems) {
      if (binding.status === "revoked") continue
      groups.set(binding.credential_id, [
        ...(groups.get(binding.credential_id) ?? []),
        binding,
      ])
    }
    return groups
  }, [bindingQuery.data?.items])

  const capabilityNameById = useMemo(
    () =>
      new Map(
        (capabilityQuery.data?.items ?? []).map((capability) => [
          capability.id,
          capabilityPresentation(capability, t, productName).name,
        ])
      ),
    [capabilityQuery.data?.items, productName, t]
  )

  const selectedCapability = (capabilityQuery.data?.items ?? []).find(
    (capability) => capability.id === capabilityId
  )
  const selectedDeclaredEnvironmentKeys =
    selectedCapability?.risk_summary?.declared_environment_keys ?? []

  const selectBindingCapability = (
    nextCapabilityId: string | null,
    target = bindingTarget
  ) => {
    const normalizedCapabilityId = nextCapabilityId ?? ""
    setCapabilityId(normalizedCapabilityId)

    const capability = (capabilityQuery.data?.items ?? []).find(
      (item) => item.id === normalizedCapabilityId
    )
    const declaredEnvironmentKeys =
      capability?.risk_summary?.declared_environment_keys ?? []
    const existingMappings = new Map(
      (bindingQuery.data?.items ?? [])
        .filter(
          (binding) =>
            binding.status === "active" &&
            binding.capability_id === normalizedCapabilityId &&
            binding.credential_id === target?.id
        )
        .map((binding) => [binding.env_key, binding.credential_key])
    )
    const credentialKeys = new Set(target?.secret_keys ?? [])

    setBindingMappings(
      Object.fromEntries(
        declaredEnvironmentKeys.map((envKey) => {
          const existingCredentialKey = existingMappings.get(envKey)
          if (
            existingCredentialKey &&
            credentialKeys.has(existingCredentialKey)
          ) {
            return [envKey, existingCredentialKey]
          }
          return [envKey, credentialKeys.has(envKey) ? envKey : ""]
        })
      )
    )
  }

  const submitBindingMappings = () => {
    if (!bindingTarget || !capabilityId) return

    const body: CredentialBindingSyncBody = {
      credential_id: bindingTarget.id,
      capability_id: capabilityId,
      mappings: selectedDeclaredEnvironmentKeys.flatMap((envKey) => {
        const credentialKey = bindingMappings[envKey]
        return credentialKey
          ? [{ env_key: envKey, credential_key: credentialKey }]
          : []
      }),
    }

    closeBinding()
    notify.loading(t("credential.bindingInProgress"), {
      id: credentialBindingToastId,
    })
    bindMutation.mutate(body)
  }

  const hasSecretValue = secretEntries.some((entry) => entry.value)
  const providerTypeValid =
    !providerType.trim() ||
    credentialProviderTypeSchema.safeParse(providerType).success
  const submittedSecretKeys = secretEntries.map((entry) => entry.key.trim())
  const duplicateSecretKeys = new Set(
    submittedSecretKeys.filter(
      (key, index) => key && submittedSecretKeys.indexOf(key) !== index
    )
  )
  const editingSecretFieldsChanged =
    Boolean(editing) &&
    (secretEntries.length !== (editing?.secret_keys.length ?? 0) ||
      secretEntries.some(
        (entry, index) =>
          entry.savedKey !== editing?.secret_keys[index] ||
          entry.key.trim() !== entry.savedKey ||
          Boolean(entry.value)
      ))
  const secretEntriesValid = editing
    ? !editingSecretFieldsChanged ||
      (secretEntries.length > 0 &&
        secretEntries.every(
          (entry) =>
            credentialEnvironmentKeySchema.safeParse(entry.key.trim())
              .success &&
            !duplicateSecretKeys.has(entry.key.trim()) &&
            (Boolean(entry.savedKey) || Boolean(entry.value))
        ))
    : secretEntries.every(
        (entry) =>
          Boolean(entry.value) &&
          credentialEnvironmentKeySchema.safeParse(entry.key.trim()).success &&
          !duplicateSecretKeys.has(entry.key.trim())
      )
  const canSave =
    Boolean(name.trim() && providerType.trim() && providerTypeValid) &&
    secretEntriesValid &&
    Boolean(editing || hasSecretValue)

  const providerTypeError =
    providerType.trim() && !providerTypeValid
      ? t("credential.providerTypeFormat")
      : undefined
  const secretKeyErrorFor = (entry: SecretEntry) => {
    if (!entry.key.trim()) return undefined
    if (!credentialEnvironmentKeySchema.safeParse(entry.key.trim()).success) {
      return t("credential.secretKeyFormat")
    }
    if (duplicateSecretKeys.has(entry.key.trim())) {
      return t("credential.secretKeyDuplicate")
    }
    return undefined
  }

  return (
    <PageLayout
      title={t("credential.title")}
      description={t("credential.description")}
      actions={<Button onClick={openCreate}>{t("credential.add")}</Button>}
    >
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      {(credentialQuery.isLoading || bindingQuery.isLoading) && (
        <LoadingState />
      )}
      {(credentialQuery.isError || bindingQuery.isError) && (
        <ErrorState
          message={getErrorMessage(
            credentialQuery.error ?? bindingQuery.error,
            t
          )}
          onRetry={() => {
            void credentialQuery.refetch()
            void bindingQuery.refetch()
          }}
        />
      )}
      {credentialQuery.isSuccess && credentialItems.length === 0 && (
        <EmptyState title={t("credential.empty")} />
      )}

      <div className="flex min-w-0 flex-col gap-4">
        {bindingQuery.isSuccess &&
          credentialItems.map((credential) => {
            const bindings = bindingsByCredential.get(credential.id) ?? []
            const plugins = new Map<string, CredentialBinding[]>()
            for (const binding of bindings) {
              const group = plugins.get(binding.capability_id) ?? []
              group.push(binding)
              plugins.set(binding.capability_id, group)
            }
            return (
              <article
                key={credential.id}
                aria-labelledby={`credential-${credential.id}`}
              >
                <Card size="sm">
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <KeyRoundIcon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                          <h2
                            id={`credential-${credential.id}`}
                            className="min-w-0 font-semibold wrap-anywhere"
                          >
                            {credential.name}
                          </h2>
                          <Badge
                            variant={
                              credential.status === "active"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {t(`statuses.${credential.status}`)}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <span>
                            {t("credential.lastUsed")}:{" "}
                            {formatDateTime(
                              credential.last_used_at ?? undefined,
                              language
                            )}
                          </span>
                          <span>
                            {t("credential.pluginCount", {
                              count: plugins.size,
                            })}
                          </span>
                        </CardDescription>
                      </div>
                    </div>
                    <CardAction className="flex shrink-0 items-center gap-1 max-sm:pl-12">
                      <Button
                        type="button"
                        size="default"
                        variant="secondary"
                        disabled={
                          credential.status !== "active" ||
                          bindMutation.isPending
                        }
                        onClick={() => openBinding(credential)}
                      >
                        <LinkIcon data-icon="inline-start" aria-hidden="true" />{" "}
                        {t("credential.bind")}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t("common.actions")}
                            />
                          }
                        >
                          <MoreHorizontalIcon aria-hidden="true" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              onClick={() => setDetailTarget(credential)}
                            >
                              {t("credential.credentialDetails")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openEdit(credential)}
                            >
                              {t("common.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setStatusTarget(credential)}
                            >
                              {t(
                                credential.status === "active"
                                  ? "common.disable"
                                  : "common.enable"
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteTarget(credential)}
                            >
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex min-w-0 flex-col gap-2 sm:pl-16">
                    {plugins.size > 0 && (
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("credential.bindings")}
                      </p>
                    )}
                    {plugins.size === 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("credential.notAssociated")}
                      </p>
                    )}
                    {[...plugins].map(([pluginId, pluginBindings]) => (
                      <CredentialPluginAssociation
                        key={pluginId}
                        name={
                          capabilityNameById.get(pluginId) ??
                          t("credential.unavailablePlugin")
                        }
                        bindings={pluginBindings}
                        configuration={configurationQuery.data?.items.find(
                          (item) => item.capability_id === pluginId
                        )}
                        disabled={credential.status !== "active"}
                        loading={
                          configurationQuery.isPending ||
                          capabilityQuery.isPending
                        }
                        failed={
                          configurationQuery.isError || capabilityQuery.isError
                        }
                        pending={
                          bindMutation.isPending ||
                          unbindMutation.isPending ||
                          removePluginMutation.isPending ||
                          statusMutation.isPending
                        }
                        onManage={() => openBinding(credential, pluginId)}
                        onEnable={() => setStatusTarget(credential)}
                        onRemove={() =>
                          setRemovePluginTarget({
                            credentialId: credential.id,
                            capabilityId: pluginId,
                            name:
                              capabilityNameById.get(pluginId) ??
                              t("credential.unavailablePlugin"),
                          })
                        }
                        onRemoveField={setUnbindTarget}
                        onRetry={() => {
                          void configurationQuery.refetch()
                          void capabilityQuery.refetch()
                        }}
                      />
                    ))}
                  </CardContent>
                </Card>
              </article>
            )
          })}
      </div>

      <Dialog
        open={detailTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDetailTarget(null)
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("credential.credentialDetails")}</DialogTitle>
            <DialogDescription className="wrap-anywhere">
              {detailTarget?.name}
            </DialogDescription>
          </DialogHeader>
          <dl className="flex min-w-0 flex-col gap-1 text-sm">
            <dt className="text-muted-foreground">
              {t("credential.providerType")}
            </dt>
            <dd>
              <code translate="no" className="wrap-anywhere">
                {detailTarget?.type}
              </code>
            </dd>
          </dl>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) resetEditor()
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>
              {t(editing ? "credential.edit" : "credential.add")}
            </DialogTitle>
            <DialogDescription>{t("credential.secretHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="form-stack"
            noValidate
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              setEditorError(null)
              const body = buildSaveBody()
              if (body) saveMutation.mutate(body)
            }}
          >
            {editorError && (
              <StatusBanner variant="error">{editorError}</StatusBanner>
            )}
            <FieldShell id="credential-name" label={t("common.name")} required>
              <Input
                id="credential-name"
                name="credential-name"
                className="h-9"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setEditorError(null)
                }}
                maxLength={160}
                required
              />
            </FieldShell>
            <FieldShell
              id="credential-provider"
              label={t("credential.providerType")}
              required
              hint={t("credential.providerTypeHint")}
              error={providerTypeError}
            >
              <Input
                id="credential-provider"
                name="credential-provider"
                spellCheck={false}
                autoComplete="off"
                className="h-9"
                value={providerType}
                onChange={(event) => {
                  setProviderType(event.target.value)
                  setEditorError(null)
                }}
                placeholder={t("credential.providerPlaceholder")}
                maxLength={80}
                aria-invalid={providerTypeError ? true : undefined}
                aria-describedby={
                  providerTypeError ? "credential-provider-error" : undefined
                }
                required
              />
            </FieldShell>
            <div className="form-stack">
              {secretEntries.map((entry, index) => {
                const secretKeyError = secretKeyErrorFor(entry)
                const secretKeyErrorId = `credential-secret-key-${entry.id}-error`
                const canRemoveSecretEntry = secretEntries.length > 1
                return (
                  <div
                    key={entry.id}
                    data-slot="credential-secret-row"
                    className={`grid gap-3 sm:items-start ${
                      canRemoveSecretEntry
                        ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                        : "sm:grid-cols-2"
                    }`}
                  >
                    <FieldShell
                      id={`credential-secret-key-${entry.id}`}
                      label={t("credential.secretKey")}
                      required
                      hint={t("credential.secretKeyHint")}
                      error={secretKeyError}
                    >
                      <Input
                        id={`credential-secret-key-${entry.id}`}
                        aria-required="true"
                        name={`credential-secret-fields[${index}].key`}
                        spellCheck={false}
                        autoComplete="off"
                        className="h-9"
                        value={entry.key}
                        onChange={(event) => {
                          setSecretEntries((entries) =>
                            entries.map((item) =>
                              item.id === entry.id
                                ? { ...item, key: event.target.value }
                                : item
                            )
                          )
                          setEditorError(null)
                        }}
                        maxLength={120}
                        aria-invalid={secretKeyError ? true : undefined}
                        aria-describedby={
                          secretKeyError ? secretKeyErrorId : undefined
                        }
                        required={!editing || Boolean(entry.value)}
                      />
                    </FieldShell>
                    <FieldShell
                      id={`credential-secret-${entry.id}`}
                      label={t("credential.secret")}
                      required={!entry.savedKey}
                      hint={
                        index === 0
                          ? t(
                              editing
                                ? "credential.keepSecretHint"
                                : "credential.secretHint"
                            )
                          : undefined
                      }
                    >
                      <Input
                        id={`credential-secret-${entry.id}`}
                        aria-required={!entry.savedKey}
                        name={`credential-secret-fields[${index}].value`}
                        className="h-9"
                        type="password"
                        autoComplete="new-password"
                        value={entry.value}
                        placeholder={
                          entry.savedKey ? maskedSecretPlaceholder : undefined
                        }
                        onChange={(event) => {
                          setSecretEntries((entries) =>
                            entries.map((item) =>
                              item.id === entry.id
                                ? { ...item, value: event.target.value }
                                : item
                            )
                          )
                          setEditorError(null)
                        }}
                        maxLength={64 * 1024}
                        required={!editing}
                      />
                    </FieldShell>
                    {canRemoveSecretEntry && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="justify-self-end sm:mt-[25px]"
                        aria-label={t("credential.removeSecretField")}
                        onClick={() =>
                          setSecretEntries((entries) =>
                            entries.filter((item) => item.id !== entry.id)
                          )
                        }
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                )
              })}
              {editing && secretEntries.length === 0 && (
                <p className="form-hint">{t("credential.savedSecretHint")}</p>
              )}
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="default"
                  onClick={() =>
                    setSecretEntries((entries) => [
                      ...entries,
                      createSecretEntry(),
                    ])
                  }
                >
                  {t("credential.addSecretField")}
                </Button>
              </div>
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
                {t(
                  editing
                    ? "credential.confirmUpdate"
                    : "credential.confirmCreate"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(bindingTarget)}
        onOpenChange={(open) => !open && closeBinding()}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          closeLabel={t("common.close")}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                capabilityId
                  ? "credential.manageAssociation"
                  : "credential.bind"
              )}
            </DialogTitle>
            <DialogDescription>
              {t("credential.bindingPriority", { productName })}
            </DialogDescription>
          </DialogHeader>
          <form
            className="form-stack"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              submitBindingMappings()
            }}
          >
            <FieldShell
              id="binding-capability"
              label={t("credential.plugin")}
              required
            >
              <Select
                name="binding-capability"
                value={capabilityId || null}
                onValueChange={(value) => selectBindingCapability(value)}
                required
              >
                <SelectTrigger id="binding-capability" className="h-9! w-full">
                  <SelectValue>
                    {capabilityNameById.get(capabilityId) ?? t("common.select")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={null}>{t("common.select")}</SelectItem>
                    {capabilityQuery.data?.items
                      .filter(
                        (item) =>
                          item.type === "plugin" && item.status === "active"
                      )
                      .map((capability) => (
                        <SelectItem
                          key={capability.id}
                          value={capability.id}
                          disabled={!capability.can_select}
                        >
                          {
                            capabilityPresentation(capability, t, productName)
                              .name
                          }
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FieldShell>
            {capabilityId && selectedDeclaredEnvironmentKeys.length === 0 && (
              <StatusBanner variant="info">
                {t("credential.noDeclaredKeys")}
              </StatusBanner>
            )}
            {selectedDeclaredEnvironmentKeys.length > 0 && (
              <Collapsible
                open={mappingDetailsOpen}
                onOpenChange={setMappingDetailsOpen}
                className="flex flex-col gap-3"
              >
                <div>
                  <h3 className="text-sm font-semibold">
                    {t("credential.mappingTitle")}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("credential.mappingDescription")}
                  </p>
                </div>
                <p className="text-sm">
                  {t("credential.mappingSummary", {
                    configured: selectedDeclaredEnvironmentKeys.filter((key) =>
                      Boolean(bindingMappings[key])
                    ).length,
                    total: selectedDeclaredEnvironmentKeys.length,
                  })}
                </p>
                {selectedDeclaredEnvironmentKeys.some(
                  (key) => !bindingMappings[key]
                ) && (
                  <p className="text-sm text-muted-foreground">
                    {t("credential.unselectedFields")}{" "}
                    <code translate="no" className="wrap-anywhere">
                      {selectedDeclaredEnvironmentKeys
                        .filter((key) => !bindingMappings[key])
                        .join(", ")}
                    </code>
                  </p>
                )}
                <CollapsibleTrigger
                  render={<Button variant="secondary" size="default" />}
                  className="self-start"
                >
                  {t("credential.selectInformation")}
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-3">
                  {selectedDeclaredEnvironmentKeys.map((envKey) => (
                    <div
                      key={envKey}
                      className="grid gap-2 border-b border-border/60 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-2 sm:items-end"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("credential.pluginEnvironmentKey")}
                        </p>
                        <div className="flex min-h-9 items-center rounded-lg bg-muted/50 px-3">
                          <code
                            translate="no"
                            className="text-sm wrap-anywhere"
                          >
                            {envKey}
                          </code>
                        </div>
                      </div>
                      <FieldShell
                        id={`binding-credential-key-${envKey}`}
                        label={t("credential.credentialField")}
                      >
                        <Select
                          name={`binding-mappings[${envKey}]`}
                          value={bindingMappings[envKey] || null}
                          onValueChange={(value) =>
                            setBindingMappings((current) => ({
                              ...current,
                              [envKey]: value ?? "",
                            }))
                          }
                        >
                          <SelectTrigger
                            id={`binding-credential-key-${envKey}`}
                            className="h-9! w-full"
                          >
                            <SelectValue>
                              {bindingMappings[envKey] ||
                                t("credential.notMapped")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value={null}>
                                {t("credential.notMapped")}
                              </SelectItem>
                              {bindingTarget?.secret_keys.map(
                                (credentialKey) => (
                                  <SelectItem
                                    key={credentialKey}
                                    value={credentialKey}
                                  >
                                    {credentialKey}
                                  </SelectItem>
                                )
                              )}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FieldShell>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                {t("common.cancel")}
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  !capabilityId ||
                  selectedDeclaredEnvironmentKeys.length === 0 ||
                  bindMutation.isPending
                }
                aria-busy={bindMutation.isPending || undefined}
              >
                {bindMutation.isPending && <Spinner data-icon="inline-start" />}
                {t("credential.confirmBind")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(statusTarget)}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={t(
          statusTarget?.status === "active"
            ? "credential.disableTitle"
            : "credential.enableTitle"
        )}
        description={t(
          statusTarget?.status === "active"
            ? "credential.disableDescription"
            : "credential.enableDescription"
        )}
        confirmLabel={t(
          statusTarget?.status === "active" ? "common.disable" : "common.enable"
        )}
        destructive={statusTarget?.status === "active"}
        pending={statusMutation.isPending}
        onConfirm={() => statusMutation.mutate()}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("credential.deleteTitle")}
        description={t("credential.deleteDescription")}
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
      <ConfirmDialog
        open={Boolean(removePluginTarget)}
        onOpenChange={(open) => !open && setRemovePluginTarget(null)}
        title={t("credential.removeAssociationTitle")}
        description={t("credential.removeAssociationDescription", {
          name: removePluginTarget?.name,
        })}
        confirmLabel={t("credential.removeAssociation")}
        destructive
        pending={removePluginMutation.isPending}
        onConfirm={() => {
          if (removePluginTarget)
            removePluginMutation.mutate(removePluginTarget)
        }}
      />
      <ConfirmDialog
        open={Boolean(unbindTarget)}
        onOpenChange={(open) => !open && setUnbindTarget(null)}
        title={t("credential.unbindTitle")}
        description={t("credential.unbindDescription", {
          name: unbindTarget?.env_key,
          plugin: unbindTarget
            ? (capabilityNameById.get(unbindTarget.capability_id) ??
              t("credential.unavailablePlugin"))
            : "",
        })}
        confirmLabel={t("credential.confirmUnbind")}
        destructive
        pending={unbindMutation.isPending}
        onConfirm={() => unbindMutation.mutate()}
      />
    </PageLayout>
  )
}
