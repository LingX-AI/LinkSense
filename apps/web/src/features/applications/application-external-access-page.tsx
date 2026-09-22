import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, CopyIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"
import {
  applicationExternalAccessSchema,
  applicationExternalAccessUpdateResultSchema,
} from "@linksense/shared"

import { apiRequest } from "@/api/client"
import { applicationSchema, type Application } from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { notify } from "@/components/feedback/notification"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { PageLayout } from "@/components/shell/page-layout"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  externalAccessSecurityConfigurationChanged,
  externalIframeSnippet,
  externalIframeUrl,
} from "@/features/applications/external-access"
import { normalizeLanguage } from "@/i18n"

const applicationCenterReturnTo =
  "/capabilities?section=application&scope=personal"

type EmbedConfiguration = {
  origin: string
  iframeUrl: string
  iframeSnippet: string
}

type EditableStarterQuestion = {
  id: string
  text: string
}

const MAX_STARTER_QUESTIONS_PER_ORIGIN = 4
const MAX_STARTER_QUESTION_LENGTH = 500

function SettingsSection({
  children,
  id,
  title,
}: {
  children: ReactNode
  id: string
  title: string
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-heading text-sm font-medium">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function ApplicationExternalAccessPage() {
  const { t } = useTranslation()
  const { applicationId = "" } = useParams()
  const application = useQuery({
    queryKey: ["applications", applicationId],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}`, {
        schema: applicationSchema,
        signal,
      }),
    enabled: applicationId.length > 0,
    retry: false,
  })

  const title = t("applications.externalAccess.title")
  const description =
    application.data !== undefined
      ? t("applications.externalAccess.description", {
          name: application.data.name,
        })
      : undefined

  return (
    <PageLayout
      title={title}
      description={description}
      beforeHeader={
        <Link
          to={applicationCenterReturnTo}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {t("applications.externalAccess.backToApplications")}
        </Link>
      }
    >
      {application.isLoading ? (
        <LoadingState />
      ) : application.isError ? (
        <ErrorState
          message={getErrorMessage(application.error, t)}
          onRetry={() => void application.refetch()}
        />
      ) : application.data ? (
        <ApplicationExternalAccessSettings application={application.data} />
      ) : (
        <EmptyState title={t("common.notFound")} />
      )}
    </PageLayout>
  )
}

function ApplicationExternalAccessSettings({
  application,
}: {
  application: Application
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const applicationId = application.id
  const [enabled, setEnabled] = useState(false)
  const [authMode, setAuthMode] = useState<"required" | "public">("required")
  const [originsText, setOriginsText] = useState("")
  const [activeEmbedOrigin, setActiveEmbedOrigin] = useState("")
  const [activeStarterQuestionOrigin, setActiveStarterQuestionOrigin] =
    useState("")
  const [starterQuestionsByOrigin, setStarterQuestionsByOrigin] = useState<
    Record<string, EditableStarterQuestion[]>
  >({})
  const [pendingSecurityAction, setPendingSecurityAction] = useState<
    "save" | "rotate" | null
  >(null)
  const [error, setError] = useState<string | null>(null)

  const access = useQuery({
    queryKey: ["applications", applicationId, "external-access"],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}/external-access`, {
        schema: applicationExternalAccessSchema.nullable(),
        signal,
      }),
    retry: false,
  })

  useEffect(() => {
    if (access.data === undefined) return
    const timer = window.setTimeout(() => {
      setEnabled(access.data?.enabled ?? false)
      setAuthMode(access.data?.auth_mode ?? "required")
      setOriginsText(access.data?.allowed_origins.join("\n") ?? "")
      setStarterQuestionsByOrigin(
        editableStarterQuestions(access.data?.starter_questions_by_origin ?? [])
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [access.data])

  const origins = useMemo(
    () =>
      originsText
        .split(/\r?\n/u)
        .map((origin) => origin.trim())
        .filter(Boolean),
    [originsText]
  )
  const uniqueOrigins = [...new Set(origins)]
  const originInputValid =
    uniqueOrigins.length > 0 && uniqueOrigins.length === origins.length
  const starterQuestionsValid = uniqueOrigins.every((origin) => {
    const questions = starterQuestionsByOrigin[origin] ?? []
    const normalized = questions.map((question) => question.text.trim())
    return (
      questions.length <= MAX_STARTER_QUESTIONS_PER_ORIGIN &&
      normalized.every(
        (question) =>
          question.length > 0 && question.length <= MAX_STARTER_QUESTION_LENGTH
      ) &&
      new Set(normalized).size === normalized.length
    )
  })
  const starterQuestionSets = uniqueOrigins.flatMap((origin) => {
    const questions = (starterQuestionsByOrigin[origin] ?? []).map((question) =>
      question.text.trim()
    )
    return questions.length > 0 ? [{ origin, questions }] : []
  })
  const activeStarterQuestionOriginValue = uniqueOrigins.includes(
    activeStarterQuestionOrigin
  )
    ? activeStarterQuestionOrigin
    : (uniqueOrigins[0] ?? "")
  const configuredAccess = access.data ?? null
  const effectiveAccess = configuredAccess
    ? {
        ...configuredAccess,
        enabled,
        auth_mode: authMode,
        allowed_origins: uniqueOrigins,
      }
    : null
  const appSecret =
    authMode === "required" ? (configuredAccess?.app_secret ?? null) : null
  const embedLocale = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const embedConfigurations: EmbedConfiguration[] = effectiveAccess
    ? uniqueOrigins.map((origin) => ({
        origin,
        iframeUrl: externalIframeUrl(effectiveAccess, origin, embedLocale),
        iframeSnippet: externalIframeSnippet(
          effectiveAccess,
          origin,
          {
            title: t("applications.externalAccess.snippetTitle"),
            ticketComment: t(
              "applications.externalAccess.snippetTicketComment"
            ),
          },
          embedLocale
        ),
      }))
    : []
  const activeEmbedConfiguration =
    embedConfigurations.find(
      (configuration) => configuration.origin === activeEmbedOrigin
    ) ??
    embedConfigurations[0] ??
    null
  const nextAccessConfiguration = {
    enabled,
    auth_mode: authMode,
    allowed_origins: uniqueOrigins,
    starter_questions_by_origin: starterQuestionSets,
  } as const

  const onApplicationsChanged = async () => {
    await queryClient.invalidateQueries({ queryKey: ["applications"] })
  }

  const saveAccess = useMutation({
    mutationFn: () =>
      apiRequest(`/applications/${applicationId}/external-access`, {
        method: "PUT",
        body: nextAccessConfiguration,
        schema: applicationExternalAccessUpdateResultSchema,
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(
        ["applications", applicationId, "external-access"],
        result.access
      )
      setEnabled(result.access.enabled)
      setAuthMode(result.access.auth_mode)
      setOriginsText(result.access.allowed_origins.join("\n"))
      setStarterQuestionsByOrigin(
        editableStarterQuestions(result.access.starter_questions_by_origin)
      )
      setError(null)
      setPendingSecurityAction(null)
      notify.success(t("applications.externalAccess.saved"))
      await onApplicationsChanged()
    },
    onError: (nextError) => {
      setPendingSecurityAction(null)
      setError(getErrorMessage(nextError, t))
    },
  })

  const rotateSecret = useMutation({
    mutationFn: () =>
      apiRequest(
        `/applications/${applicationId}/external-access/rotate-secret`,
        {
          method: "POST",
          body: {},
          schema: applicationExternalAccessUpdateResultSchema,
        }
      ),
    onSuccess: (result) => {
      queryClient.setQueryData(
        ["applications", applicationId, "external-access"],
        result.access
      )
      setError(null)
      setPendingSecurityAction(null)
      notify.success(t("applications.externalAccess.secretRotated"))
    },
    onError: (nextError) => {
      setPendingSecurityAction(null)
      setError(getErrorMessage(nextError, t))
    },
  })

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      notify.success(t("common.copied"))
    } catch {
      setError(t("applications.externalAccess.copyFailed"))
    }
  }

  const requestAccessSave = () => {
    if (
      configuredAccess &&
      externalAccessSecurityConfigurationChanged(
        configuredAccess,
        nextAccessConfiguration
      )
    ) {
      setPendingSecurityAction("save")
      return
    }
    saveAccess.mutate()
  }

  return (
    <>
      <div className="flex w-full max-w-6xl flex-col gap-8 pb-8">
        {access.isLoading ? (
          <LoadingState />
        ) : access.isError ? (
          <ErrorState
            message={getErrorMessage(access.error, t)}
            onRetry={() => void access.refetch()}
          />
        ) : (
          <>
            <SettingsSection
              id="external-access-settings"
              title={t("applications.externalAccess.accessSettingsSection")}
            >
              <Card className="gap-0 py-0">
                <CardHeader className="border-b py-5">
                  <CardTitle>
                    {t("applications.externalAccess.enabled")}
                  </CardTitle>
                  <CardDescription>
                    {t("applications.externalAccess.enabledDescription")}
                  </CardDescription>
                  <CardAction className="self-center">
                    <Switch
                      id="application-external-enabled"
                      checked={enabled}
                      onCheckedChange={setEnabled}
                      aria-label={t("applications.externalAccess.enabled")}
                    />
                  </CardAction>
                </CardHeader>
                <CardContent className="px-0">
                  <FieldGroup className="gap-0">
                    <Field orientation="responsive" className="px-5 py-5">
                      <FieldContent>
                        <FieldTitle>
                          {t(
                            "applications.externalAccess.authRequirementLabel"
                          )}
                        </FieldTitle>
                        <FieldDescription>
                          {t(
                            authMode === "required"
                              ? "applications.externalAccess.authRequiredDescription"
                              : "applications.externalAccess.authPublicDescription"
                          )}
                        </FieldDescription>
                      </FieldContent>
                      <ToggleGroup
                        variant="outline"
                        spacing={0}
                        value={[authMode]}
                        onValueChange={(values) => {
                          const value = values[0]
                          if (value === "required" || value === "public") {
                            setAuthMode(value)
                          }
                        }}
                        aria-label={t(
                          "applications.externalAccess.authRequirementLabel"
                        )}
                        className="max-w-full flex-wrap"
                      >
                        <ToggleGroupItem value="required">
                          {t("applications.externalAccess.authModeRequired")}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="public">
                          {t("applications.externalAccess.authModePublic")}
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                  </FieldGroup>
                </CardContent>
              </Card>
            </SettingsSection>

            <SettingsSection
              id="external-origin-settings"
              title={t("applications.externalAccess.originSettingsSection")}
            >
              <Card className="gap-0 py-0">
                <CardHeader className="border-b py-5">
                  <CardTitle className="flex items-center gap-1">
                    {t("applications.externalAccess.allowedOrigins")}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </CardTitle>
                  <CardDescription>
                    {t("applications.externalAccess.allowedOriginsDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="py-5">
                  <Field
                    data-invalid={!originInputValid && originsText.length > 0}
                  >
                    <FieldLabel
                      htmlFor="application-external-origins"
                      className="sr-only"
                    >
                      {t("applications.externalAccess.allowedOrigins")}
                    </FieldLabel>
                    <Textarea
                      id="application-external-origins"
                      required
                      value={originsText}
                      aria-invalid={!originInputValid && originsText.length > 0}
                      className="min-h-32 border-transparent bg-field text-sm leading-6 focus-visible:bg-field"
                      placeholder={t(
                        "applications.externalAccess.allowedOriginsPlaceholder"
                      )}
                      onChange={(event) => setOriginsText(event.target.value)}
                    />
                  </Field>
                </CardContent>
              </Card>
            </SettingsSection>

            <SettingsSection
              id="external-starter-question-settings"
              title={t("applications.externalAccess.starterQuestionsSection")}
            >
              <Card className="gap-0 py-0">
                <CardHeader className="border-b py-5">
                  <CardTitle>
                    {t("applications.externalAccess.starterQuestions")}
                  </CardTitle>
                  <CardDescription>
                    {t(
                      "applications.externalAccess.starterQuestionsDescription"
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="py-5">
                  {activeStarterQuestionOriginValue ? (
                    uniqueOrigins.length > 1 ? (
                      <Tabs
                        value={activeStarterQuestionOriginValue}
                        onValueChange={setActiveStarterQuestionOrigin}
                        className="gap-4"
                      >
                        <TabsList
                          aria-label={t(
                            "applications.externalAccess.starterQuestionOriginsTabsLabel"
                          )}
                          className="max-w-full justify-start overflow-x-auto"
                        >
                          {uniqueOrigins.map((origin, index) => (
                            <TabsTrigger
                              key={origin}
                              value={origin}
                              title={origin}
                              className="flex-none"
                            >
                              {t("applications.externalAccess.embedOriginTab", {
                                index: index + 1,
                              })}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                        <TabsContent value={activeStarterQuestionOriginValue}>
                          <StarterQuestionsEditor
                            origin={activeStarterQuestionOriginValue}
                            questions={
                              starterQuestionsByOrigin[
                                activeStarterQuestionOriginValue
                              ] ?? []
                            }
                            onChange={(questions) =>
                              setStarterQuestionsByOrigin((current) => ({
                                ...current,
                                [activeStarterQuestionOriginValue]: questions,
                              }))
                            }
                          />
                        </TabsContent>
                      </Tabs>
                    ) : (
                      <StarterQuestionsEditor
                        origin={activeStarterQuestionOriginValue}
                        questions={
                          starterQuestionsByOrigin[
                            activeStarterQuestionOriginValue
                          ] ?? []
                        }
                        onChange={(questions) =>
                          setStarterQuestionsByOrigin((current) => ({
                            ...current,
                            [activeStarterQuestionOriginValue]: questions,
                          }))
                        }
                      />
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "applications.externalAccess.starterQuestionsNeedOrigin"
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>
            </SettingsSection>

            {authMode === "required" && configuredAccess && (
              <SettingsSection
                id="external-credential-settings"
                title={t(
                  "applications.externalAccess.credentialSettingsSection"
                )}
              >
                <Card className="gap-0 py-0">
                  <CardContent className="py-5">
                    <FieldGroup className="gap-5">
                      <ReadonlyCopyField
                        label={t("applications.externalAccess.appId")}
                        value={configuredAccess.app_id ?? ""}
                        onCopy={copyValue}
                      />
                      {appSecret ? (
                        <ReadonlyCopyField
                          label={t("applications.externalAccess.appSecret")}
                          value={appSecret}
                          displayValue={maskAppSecret(appSecret)}
                          onCopy={copyValue}
                          endAction={
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={rotateSecret.isPending}
                              onClick={() => setPendingSecurityAction("rotate")}
                            >
                              {t("applications.externalAccess.rotateSecret")}
                            </Button>
                          }
                        />
                      ) : (
                        <Field data-disabled>
                          <FieldLabel>
                            {t("applications.externalAccess.appSecret")}
                          </FieldLabel>
                          <InputGroup data-disabled="true" className="h-9">
                            <InputGroupInput
                              readOnly
                              disabled
                              value={t(
                                "applications.externalAccess.secretUnavailableValue"
                              )}
                            />
                            <InputGroupAddon align="inline-end">
                              <InputGroupButton
                                type="button"
                                size="icon-sm"
                                disabled
                                aria-label={t("common.copyNamed", {
                                  name: t(
                                    "applications.externalAccess.appSecret"
                                  ),
                                })}
                              >
                                <CopyIcon
                                  data-icon="inline-start"
                                  aria-hidden="true"
                                />
                              </InputGroupButton>
                            </InputGroupAddon>
                          </InputGroup>
                          <FieldDescription>
                            {t("applications.externalAccess.secretUnavailable")}
                          </FieldDescription>
                        </Field>
                      )}
                    </FieldGroup>
                  </CardContent>
                </Card>
              </SettingsSection>
            )}

            {configuredAccess && activeEmbedConfiguration && (
              <SettingsSection
                id="external-embed-settings"
                title={t("applications.externalAccess.embedSettingsSection")}
              >
                {embedConfigurations.length > 1 ? (
                  <Tabs
                    value={activeEmbedConfiguration.origin}
                    onValueChange={setActiveEmbedOrigin}
                    className="gap-4"
                  >
                    <TabsList
                      aria-label={t(
                        "applications.externalAccess.embedOriginsTabsLabel"
                      )}
                      className="max-w-full justify-start overflow-x-auto"
                    >
                      {embedConfigurations.map((configuration, index) => (
                        <TabsTrigger
                          key={configuration.origin}
                          value={configuration.origin}
                          title={configuration.origin}
                          className="flex-none"
                        >
                          {t("applications.externalAccess.embedOriginTab", {
                            index: index + 1,
                          })}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    <TabsContent value={activeEmbedConfiguration.origin}>
                      <EmbedConfigurationDetails
                        configuration={activeEmbedConfiguration}
                        authMode={authMode}
                        onCopy={copyValue}
                      />
                    </TabsContent>
                  </Tabs>
                ) : (
                  <EmbedConfigurationDetails
                    configuration={activeEmbedConfiguration}
                    authMode={authMode}
                    onCopy={copyValue}
                  />
                )}
              </SettingsSection>
            )}
            {error && <StatusBanner variant="error">{error}</StatusBanner>}
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={
                  !originInputValid ||
                  !starterQuestionsValid ||
                  saveAccess.isPending ||
                  !application.id
                }
                onClick={requestAccessSave}
              >
                {t("common.save")}
              </Button>
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={pendingSecurityAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSecurityAction(null)
        }}
        title={t(
          pendingSecurityAction === "rotate"
            ? "applications.externalAccess.rotateConfirmTitle"
            : "applications.externalAccess.changeConfirmTitle"
        )}
        description={t(
          pendingSecurityAction === "rotate"
            ? "applications.externalAccess.rotateConfirmDescription"
            : "applications.externalAccess.changeConfirmDescription"
        )}
        confirmLabel={t(
          pendingSecurityAction === "rotate"
            ? "applications.externalAccess.rotateSecret"
            : "common.save"
        )}
        pending={saveAccess.isPending || rotateSecret.isPending}
        onConfirm={() => {
          if (pendingSecurityAction === "rotate") {
            rotateSecret.mutate()
          } else if (pendingSecurityAction === "save") {
            saveAccess.mutate()
          }
        }}
      />
    </>
  )
}

function StarterQuestionsEditor({
  origin,
  questions,
  onChange,
}: {
  origin: string
  questions: EditableStarterQuestion[]
  onChange: (questions: EditableStarterQuestion[]) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <p className="truncate text-sm text-muted-foreground" title={origin}>
        {origin}
      </p>
      {questions.length > 0 ? (
        <FieldGroup>
          {questions.map((question, index) => {
            const normalized = question.text.trim()
            const duplicated = questions.some(
              (candidate) =>
                candidate.id !== question.id &&
                candidate.text.trim() === normalized &&
                normalized.length > 0
            )
            const invalid =
              normalized.length === 0 ||
              normalized.length > MAX_STARTER_QUESTION_LENGTH ||
              duplicated
            const inputId = `starter-question-${question.id}`
            return (
              <Field key={question.id} data-invalid={invalid || undefined}>
                <FieldLabel htmlFor={inputId}>
                  {t("applications.externalAccess.starterQuestionLabel", {
                    index: index + 1,
                  })}
                </FieldLabel>
                <div className="flex items-start gap-2">
                  <Textarea
                    id={inputId}
                    value={question.text}
                    maxLength={MAX_STARTER_QUESTION_LENGTH}
                    rows={2}
                    aria-invalid={invalid || undefined}
                    placeholder={t(
                      "applications.externalAccess.starterQuestionPlaceholder"
                    )}
                    onChange={(event) =>
                      onChange(
                        questions.map((candidate) =>
                          candidate.id === question.id
                            ? { ...candidate, text: event.target.value }
                            : candidate
                        )
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t(
                      "applications.externalAccess.removeStarterQuestion",
                      { index: index + 1 }
                    )}
                    onClick={() =>
                      onChange(
                        questions.filter(
                          (candidate) => candidate.id !== question.id
                        )
                      )
                    }
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
                {duplicated && (
                  <FieldDescription>
                    {t("applications.externalAccess.starterQuestionDuplicate")}
                  </FieldDescription>
                )}
              </Field>
            )
          })}
        </FieldGroup>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("applications.externalAccess.starterQuestionsEmpty")}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {t("applications.externalAccess.starterQuestionCount", {
            count: questions.length,
            max: MAX_STARTER_QUESTIONS_PER_ORIGIN,
          })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={questions.length >= MAX_STARTER_QUESTIONS_PER_ORIGIN}
          onClick={() =>
            onChange([...questions, { id: crypto.randomUUID(), text: "" }])
          }
        >
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          {t("applications.externalAccess.addStarterQuestion")}
        </Button>
      </div>
    </div>
  )
}

function editableStarterQuestions(
  sets: ReadonlyArray<{ origin: string; questions: readonly string[] }>
) {
  return Object.fromEntries(
    sets.map((set) => [
      set.origin,
      set.questions.map((text) => ({ id: crypto.randomUUID(), text })),
    ])
  )
}

function EmbedConfigurationDetails({
  configuration,
  authMode,
  onCopy,
}: {
  configuration: EmbedConfiguration
  authMode: "required" | "public"
  onCopy: (value: string) => Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-5">
        <CardTitle>
          {t("applications.externalAccess.currentEmbedOrigin")}
        </CardTitle>
        <CardDescription className="min-w-0">
          <span title={configuration.origin} className="block truncate text-sm">
            {configuration.origin}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="py-5">
        <FieldGroup className="gap-5">
          <ReadonlyCopyField
            label={t("applications.externalAccess.iframeUrl")}
            value={configuration.iframeUrl}
            onCopy={onCopy}
          />
          <Field>
            <FieldLabel>
              {t("applications.externalAccess.embedCode")}
            </FieldLabel>
            <HighlightedCodeBlock
              code={configuration.iframeSnippet}
              copyLabel={t("common.copy")}
              onCopy={() => onCopy(configuration.iframeSnippet)}
            />
          </Field>
        </FieldGroup>
      </CardContent>
      {authMode === "required" && (
        <CardFooter className="border-t py-4 text-xs text-muted-foreground">
          <p>{t("applications.externalAccess.serverCredentialWarning")}</p>
        </CardFooter>
      )}
    </Card>
  )
}

function ReadonlyCopyField({
  label,
  value,
  displayValue = value,
  onCopy,
  endAction,
}: {
  label: string
  value: string
  displayValue?: string
  onCopy: (value: string) => Promise<void>
  endAction?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex max-w-full min-w-0 items-center gap-1">
          <span
            title={displayValue}
            data-slot="external-readonly-value"
            className="min-w-0 truncate text-sm leading-8 text-foreground"
          >
            {displayValue}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.copyNamed", { name: label })}
            onClick={() => void onCopy(value)}
          >
            <CopyIcon data-icon="inline-start" aria-hidden="true" />
          </Button>
        </div>
        {endAction ? <div className="flex justify-end">{endAction}</div> : null}
      </div>
    </Field>
  )
}

function maskAppSecret(secret: string) {
  const visibleStart = 8
  const visibleEnd = 6
  if (secret.length <= visibleStart + visibleEnd) {
    return `${secret.slice(0, 4)}${"*".repeat(Math.max(secret.length - 4, 8))}`
  }
  return `${secret.slice(0, visibleStart)}${"*".repeat(12)}${secret.slice(
    -visibleEnd
  )}`
}

function HighlightedCodeBlock({
  code,
  copyLabel,
  onCopy,
}: {
  code: string
  copyLabel: string
  onCopy: () => Promise<void>
}) {
  return (
    <div data-slot="external-code-block" className="relative">
      <Button
        type="button"
        variant="ghost"
        size="default"
        className="absolute top-3 right-3 bg-background/80 backdrop-blur"
        onClick={() => void onCopy()}
      >
        <CopyIcon data-icon="inline-start" />
        {copyLabel}
      </Button>
      <pre className="max-h-80 overflow-auto rounded-xl bg-muted/30 p-4 pt-14 text-xs leading-6 whitespace-pre text-foreground">
        <code className="font-sans">{highlightCode(code)}</code>
      </pre>
    </div>
  )
}

function highlightCode(code: string) {
  const tokenPattern =
    /(\/\/[^\n]*|<\/?[\w-]+|["'`][^"'`\n]*(?:\\.[^"'`\n]*)*["'`]?|\b(?:async|await|const|document|fetch|if|return|window)\b|\b(?:true|false|null)\b|\b\d+\b|[{}()[\];,.])/gu
  const parts: ReactNode[] = []
  let cursor = 0
  for (const match of code.matchAll(tokenPattern)) {
    const token = match[0]
    const index = match.index ?? 0
    if (index > cursor) parts.push(code.slice(cursor, index))
    parts.push(
      <span
        key={`${index}:${token}`}
        data-code-token={codeTokenKind(token)}
        className={codeTokenClassName(token)}
      >
        {token}
      </span>
    )
    cursor = index + token.length
  }
  if (cursor < code.length) parts.push(code.slice(cursor))
  return parts
}

function codeTokenKind(token: string) {
  if (token.startsWith("//")) return "comment"
  if (/^["'`]/u.test(token)) return "string"
  if (/^<\/?/u.test(token)) return "tag"
  if (/^\d+$/u.test(token) || /^(?:true|false|null)$/u.test(token)) {
    return "literal"
  }
  if (/^[{}()[\];,.]$/u.test(token)) return "punctuation"
  return "keyword"
}

function codeTokenClassName(token: string) {
  const kind = codeTokenKind(token)
  if (kind === "comment") return "text-muted-foreground"
  if (kind === "string") return "text-primary"
  if (kind === "tag") return "text-foreground"
  if (kind === "literal") return "text-primary"
  if (kind === "punctuation") return "text-muted-foreground"
  return "text-foreground"
}
