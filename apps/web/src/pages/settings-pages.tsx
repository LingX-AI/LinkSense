import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import {
  BrainIcon,
  EyeIcon,
  FileTextIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { SocialAccounts } from "@/features/social-auth/social-accounts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  useBeforeUnload,
  useBlocker,
  useLocation,
  useNavigate,
} from "react-router-dom"
import { z } from "zod"

import { apiRequest } from "@/api/client"
import {
  personalizationSettingsSchema,
  personalUsageProfileSchema,
  resetMemoriesResultSchema,
  userSchema,
  type RunningMessageAction,
} from "@/api/contracts"
import {
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  type TaskAutoNaming,
} from "@linksense/shared"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { useProductName } from "@/app/product-branding"
import { themePreferences, type ThemePreference } from "@/app/theme"
import { useTheme } from "@/app/theme-state"
import {
  clampUiFontSize,
  MAX_UI_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  normalizeUiFontSize,
} from "@/app/ui-font-size"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import {
  FieldShell,
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field"
import { PasswordInput } from "@/components/forms/password-input"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { TaskAutoNamingSettings } from "@/components/settings/task-auto-naming-settings"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupOption,
} from "@/components/ui/radio-group"
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
import { ProfileOverview } from "@/features/profile/profile-overview"
import { BrowserNotificationSettings } from "@/features/browser-notifications/browser-notification-settings"
import { BrowserExtensionSettings } from "@/features/local-browser/browser-extension-settings"
import { normalizeLanguage, supportedLanguages } from "@/i18n"
import { useLanguageSelection } from "@/features/onboarding/use-language-selection"
import { passwordSchema } from "@/lib/password"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"
import { cn } from "@/lib/utils"
import { languageLabelKey } from "@/features/onboarding/language-labels"
import {
  personalizationQueryKey,
  usePersonalization,
} from "@/features/personalization/use-personalization"

const resetMemoriesNotificationId = "personalization-memories-reset"
export function SettingsGeneralPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const { user, refreshUser } = useAuth()
  useEffect(() => {
    if (location.hash !== "#browser-extension") return
    const target = document.getElementById("browser-extension")
    target?.scrollIntoView({ block: "start", behavior: "instant" })
    target?.focus({ preventScroll: true })
  }, [location.key, location.hash])
  const {
    language,
    pending: languagePending,
    error: languageError,
    change: changeLanguage,
  } = useLanguageSelection({ notifyErrors: false })
  const currentRunningMessageAction = user?.running_message_action ?? "queue"
  const [runningMessageAction, setRunningMessageAction] =
    useState<RunningMessageAction>(currentRunningMessageAction)
  const [savedRunningMessageAction, setSavedRunningMessageAction] =
    useState<RunningMessageAction>(currentRunningMessageAction)
  const [error, setError] = useState<string | null>(null)
  const runningMessageActionMutation = useMutation({
    mutationFn: (nextAction: RunningMessageAction) =>
      apiRequest("/me", {
        method: "PATCH",
        body: { running_message_action: nextAction },
        schema: userSchema,
      }),
    onSuccess: async (_nextUser, nextAction) => {
      setSavedRunningMessageAction(nextAction)
      await refreshUser()
      setError(null)
    },
    onError: (nextError) => {
      setRunningMessageAction(savedRunningMessageAction)
      setError(getErrorMessage(nextError, t))
    },
  })

  return (
    <SettingsPageFrame
      title={t("settings.general")}
      description={t("settings.generalPageDescription")}
    >
      {(languageError || error) && (
        <StatusBanner variant="error">{languageError || error}</StatusBanner>
      )}
      <div className="grid min-w-0 gap-8">
        <SettingsCard
          layout="split"
          icon={<SlidersHorizontalIcon />}
          header={
            <SettingsSectionHeader
              id="interface-preferences-heading"
              title={t("settingsInterface.preferences")}
              description={t("settingsInterface.description")}
            />
          }
        >
          <section
            className="py-4 sm:py-5"
            aria-labelledby="interface-language-heading"
          >
            <SettingsSectionHeader
              id="interface-language-heading"
              title={t("settings.interfaceLanguage")}
              description={t("settings.interfaceLanguageDescription")}
              descriptionId="interface-language-description"
              actionAlignment="center"
              action={
                <Select
                  value={language}
                  onValueChange={changeLanguage}
                  disabled={languagePending}
                >
                  <SelectTrigger
                    id="settings-language"
                    aria-labelledby="interface-language-heading"
                    aria-describedby="interface-language-description"
                    className="w-full rounded-md @2xl/settings-section:w-44"
                  >
                    <SelectValue>{t(languageLabelKey(language))}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {supportedLanguages.map((supportedLanguage) => (
                        <SelectItem
                          key={supportedLanguage}
                          value={supportedLanguage}
                        >
                          {t(languageLabelKey(supportedLanguage))}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              }
            />
          </section>
          <Separator className="bg-[var(--app-divider)]" />
          <section
            className="py-4 sm:py-5"
            aria-labelledby="running-message-action-heading"
          >
            <SettingsSectionHeader
              id="running-message-action-heading"
              title={t("settings.runningMessageAction")}
              description={t("settings.runningMessageActionDescription")}
              descriptionId="running-message-action-description"
              actionAlignment="center"
              action={
                <Select
                  value={runningMessageAction}
                  onValueChange={(value) => {
                    if (value !== "steer" && value !== "queue") return
                    setRunningMessageAction(value)
                    setError(null)
                    runningMessageActionMutation.mutate(value)
                  }}
                  disabled={runningMessageActionMutation.isPending}
                >
                  <SelectTrigger
                    id="settings-running-message-action"
                    aria-labelledby="running-message-action-heading"
                    aria-describedby="running-message-action-description"
                    className="w-full @2xl/settings-section:w-56"
                  >
                    <SelectValue className="min-w-0 truncate">
                      {t(
                        runningMessageAction === "steer"
                          ? "settings.runningMessageActionSteer"
                          : "settings.runningMessageActionQueue"
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="steer">
                        {t("settings.runningMessageActionSteer")}
                      </SelectItem>
                      <SelectItem value="queue">
                        {t("settings.runningMessageActionQueue")}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              }
            />
          </section>
        </SettingsCard>
        <BrowserNotificationSettings userId={user?.id} />
        <BrowserExtensionSettings userId={user?.id} />
      </div>
    </SettingsPageFrame>
  )
}

export function SettingsProfilePage() {
  const { t, i18n } = useTranslation()
  const { user, refreshUser } = useAuth()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState(user?.name ?? "")
  const [nameDialogOpen, setNameDialogOpen] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const timeZone = useMemo(() => resolveBrowserTimeZone(), [])
  const initials = useMemo(
    () =>
      (
        user?.name
          .trim()
          .split(/\s+/u)
          .map((part) => part[0])
          .join("")
          .slice(0, 2) || "LS"
      ).toUpperCase(),
    [user?.name]
  )
  const usageQuery = useQuery({
    queryKey: ["me", "usage", timeZone],
    queryFn: () =>
      apiRequest(`/me/usage?time_zone=${encodeURIComponent(timeZone)}`, {
        schema: personalUsageProfileSchema,
      }),
  })
  const profileMutation = useMutation({
    mutationFn: () =>
      apiRequest("/me", {
        method: "PATCH",
        body: { name: name.trim() },
        schema: userSchema,
      }),
    onSuccess: async () => {
      await refreshUser()
      setNameError(null)
      setNameDialogOpen(false)
      notify.success(t("profile.profileSaved"), { id: "profile-saved" })
    },
    onError: (nextError) => setNameError(getErrorMessage(nextError, t)),
  })
  const avatarMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      return apiRequest("/me/avatar", {
        method: "POST",
        body: formData,
        schema: userSchema,
      })
    },
    onSuccess: async () => {
      await refreshUser()
      setAvatarError(null)
      notify.success(t("profile.avatarSaved"), { id: "profile-avatar-saved" })
    },
    onError: (nextError) => setAvatarError(getErrorMessage(nextError, t)),
  })

  if (!user) {
    return (
      <SettingsPageFrame
        title={t("settings.profile")}
        description={t("settings.profilePageDescription")}
        className="profile-page"
      >
        <div className="profile-usage-loading" role="status">
          <Spinner />
          <span>{t("common.loading")}</span>
        </div>
      </SettingsPageFrame>
    )
  }

  return (
    <SettingsPageFrame
      title={t("settings.profile")}
      description={t("settings.profilePageDescription")}
      className="profile-page"
    >
      <ProfileOverview
        avatarUploadPending={avatarMutation.isPending}
        initials={initials}
        language={language}
        onAvatarUploadRequest={() => avatarInputRef.current?.click()}
        onNameEditRequest={() => {
          setName(user.name)
          setNameError(null)
          setNameDialogOpen(true)
        }}
        profileError={avatarError}
        usage={usageQuery.data}
        usageError={
          usageQuery.error ? getErrorMessage(usageQuery.error, t) : null
        }
        usagePending={usageQuery.isPending}
        user={user}
      />
      <Input
        ref={avatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={t("profile.uploadAvatar")}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) avatarMutation.mutate(file)
          event.target.value = ""
        }}
      />
      <Dialog
        open={nameDialogOpen}
        onOpenChange={(open) => {
          if (profileMutation.isPending) return
          setNameDialogOpen(open)
          if (!open) setNameError(null)
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <form
            className="grid gap-6"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              setNameError(null)
              if (!name.trim()) {
                setNameError(t("validation.required"))
                return
              }
              profileMutation.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("profile.editNameTitle")}</DialogTitle>
              <DialogDescription>
                {t("profile.editNameDescription")}
              </DialogDescription>
            </DialogHeader>
            {nameError && (
              <StatusBanner variant="error">{nameError}</StatusBanner>
            )}
            <FieldShell id="profile-name" label={t("common.name")} required>
              <Input
                id="profile-name"
                className="h-9"
                autoComplete="name"
                autoFocus={shouldAutoFocusOnDesktop()}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </FieldShell>
            <DialogFooter>
              <DialogClose
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={profileMutation.isPending}
                  />
                }
              >
                {t("common.cancel")}
              </DialogClose>
              <Button
                type="submit"
                disabled={profileMutation.isPending}
                aria-busy={profileMutation.isPending || undefined}
              >
                {profileMutation.isPending && (
                  <Spinner data-icon="inline-start" />
                )}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsPageFrame>
  )
}

export function SettingsPersonalizationPage() {
  const { t } = useTranslation()
  const [customInstructionsDraft, setCustomInstructions] = useState<
    string | null
  >(null)
  const [savedCustomInstructionsOverride, setSavedCustomInstructions] =
    useState<string | null>(null)
  const [memoriesEnabledOverride, setMemoriesEnabled] = useState<
    boolean | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const personalizationQuery = usePersonalization()
  const customInstructions =
    customInstructionsDraft ??
    personalizationQuery.data?.custom_instructions ??
    ""
  const savedCustomInstructions =
    savedCustomInstructionsOverride ??
    personalizationQuery.data?.custom_instructions ??
    ""
  const memoriesEnabled =
    memoriesEnabledOverride ??
    personalizationQuery.data?.memories_enabled ??
    false

  const customInstructionsMutation = useMutation({
    mutationFn: (nextInstructions: string) =>
      apiRequest("/me/personalization", {
        method: "PATCH",
        body: { custom_instructions: nextInstructions },
        schema: personalizationSettingsSchema,
      }),
    onSuccess: (settings) => {
      setCustomInstructions(settings.custom_instructions)
      setSavedCustomInstructions(settings.custom_instructions)
      setMemoriesEnabled(settings.memories_enabled)
      setError(null)
      notify.success(t("settings.customInstructionsSaved"), {
        id: "personalization-instructions-saved",
      })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const memoriesMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      apiRequest("/me/personalization", {
        method: "PATCH",
        body: { memories_enabled: enabled },
        schema: personalizationSettingsSchema,
      }),
    onSuccess: (settings) => {
      setMemoriesEnabled(settings.memories_enabled)
      setError(null)
    },
    onError: (nextError, enabled) => {
      setMemoriesEnabled(!enabled)
      setError(getErrorMessage(nextError, t))
    },
  })

  const resetMemoriesMutation = useMutation({
    mutationFn: () =>
      apiRequest("/me/personalization/memories/reset", {
        method: "POST",
        body: {},
        schema: resetMemoriesResultSchema,
      }),
    onMutate: () => {
      notify.loading(t("settings.resettingMemories"), {
        id: resetMemoriesNotificationId,
      })
    },
    onSuccess: () => {
      setResetDialogOpen(false)
      setError(null)
      notify.success(t("settings.memoriesReset"), {
        id: resetMemoriesNotificationId,
      })
    },
    onError: (nextError) => {
      const message = getErrorMessage(nextError, t)
      setError(message)
      notify.error(message, { id: resetMemoriesNotificationId })
    },
  })

  const hasUnsavedInstructions = customInstructions !== savedCustomInstructions
  const queryClient = useQueryClient()
  const reasoningVisibilityMutation = useMutation({
    mutationFn: (show_reasoning: boolean) =>
      apiRequest("/me/personalization", {
        method: "PATCH",
        body: { show_reasoning },
        schema: personalizationSettingsSchema,
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(personalizationQueryKey, settings)
      setError(null)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const taskAutoNamingMutation = useMutation({
    mutationFn: (task_auto_naming: TaskAutoNaming) =>
      apiRequest("/me/personalization", {
        method: "PATCH",
        body: { task_auto_naming },
        schema: personalizationSettingsSchema,
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(personalizationQueryKey, settings)
      setError(null)
      notify.success(t("settings.taskAutoNamingSaved"))
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedInstructions &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash)
  )
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!hasUnsavedInstructions) return
        event.preventDefault()
        event.returnValue = ""
      },
      [hasUnsavedInstructions]
    ),
    { capture: true }
  )
  const loading = personalizationQuery.isPending

  return (
    <SettingsPageFrame
      title={t("settings.personalization")}
      description={t("settings.personalizationPageDescription")}
    >
      {(error || personalizationQuery.error) && (
        <StatusBanner variant="error">
          {error ?? getErrorMessage(personalizationQuery.error, t)}
        </StatusBanner>
      )}
      {loading ? (
        <div className="personalization-loading" role="status">
          <Spinner />
          <span>{t("common.loading")}</span>
        </div>
      ) : (
        <div className="grid min-w-0 gap-8">
          <SettingsCard
            aria-labelledby="custom-instructions-heading"
            layout="split"
            icon={<FileTextIcon />}
            header={
              <SettingsSectionHeader
                id="custom-instructions-heading"
                title={t("settings.customInstructions")}
                description={t("settings.customInstructionsDescription")}
              />
            }
          >
            <form
              id="custom-instructions-form"
              className="grid min-w-0 gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                setError(null)
                customInstructionsMutation.mutate(customInstructions)
              }}
            >
              <Textarea
                id="custom-instructions"
                aria-labelledby="custom-instructions-heading"
                className="min-h-56 resize-y bg-transparent focus-visible:bg-transparent"
                value={customInstructions}
                maxLength={MAX_CUSTOM_INSTRUCTIONS_LENGTH}
                disabled={customInstructionsMutation.isPending}
                aria-describedby="custom-instructions-count"
                placeholder={t("settings.customInstructionsPlaceholder")}
                onChange={(event) => setCustomInstructions(event.target.value)}
              />
              <div className="personalization-instructions-footer">
                <span id="custom-instructions-count">
                  {t("settings.customInstructionsCount", {
                    count: customInstructions.length,
                    max: MAX_CUSTOM_INSTRUCTIONS_LENGTH,
                  })}
                </span>
                <Button
                  type="submit"
                  aria-busy={customInstructionsMutation.isPending || undefined}
                  disabled={
                    !hasUnsavedInstructions ||
                    customInstructionsMutation.isPending
                  }
                >
                  {customInstructionsMutation.isPending && (
                    <Spinner data-icon="inline-start" />
                  )}
                  {t("common.save")}
                </Button>
              </div>
            </form>
          </SettingsCard>

          <SettingsCard
            aria-labelledby="memory-heading"
            layout="split"
            icon={<BrainIcon />}
            header={
              <SettingsSectionHeader
                id="memory-heading"
                title={t("settings.memory")}
                description={t("settings.memoryDescription")}
              />
            }
          >
            <SettingsFieldGroup>
              <SettingsFieldRow
                id="enable-memories"
                label={t("settings.enableMemories")}
                hint={t("settings.enableMemoriesDescription")}
                controlWidth="compact"
              >
                <Switch
                  id="enable-memories"
                  checked={memoriesEnabled}
                  disabled={
                    personalizationQuery.isFetching ||
                    memoriesMutation.isPending
                  }
                  onCheckedChange={(checked) => {
                    setError(null)
                    setMemoriesEnabled(checked)
                    memoriesMutation.mutate(checked)
                  }}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                id="reset-memories"
                label={t("settings.resetMemories")}
                hint={t("settings.resetMemoriesDescription")}
                controlWidth="compact"
              >
                <Button
                  type="button"
                  variant="destructive-ghost"
                  disabled={resetMemoriesMutation.isPending}
                  onClick={() => setResetDialogOpen(true)}
                >
                  {t("settings.reset")}
                </Button>
              </SettingsFieldRow>
            </SettingsFieldGroup>
          </SettingsCard>

          <SettingsCard
            header={
              <SettingsSectionHeader
                id="thinking-display-heading"
                title={t("settings.thinkingDisplay")}
                description={t("settings.thinkingDisplayDescription")}
              />
            }
            layout="split"
            icon={<EyeIcon />}
          >
            <SettingsFieldGroup>
              <SettingsFieldRow
                id="show-reasoning"
                label={t("settings.showReasoning")}
                hint={t("settings.showReasoningDescription")}
                controlWidth="compact"
              >
                <Switch
                  id="show-reasoning"
                  checked={personalizationQuery.data?.show_reasoning ?? false}
                  disabled={
                    !personalizationQuery.data ||
                    personalizationQuery.isFetching ||
                    reasoningVisibilityMutation.isPending
                  }
                  onCheckedChange={(checked) => {
                    setError(null)
                    reasoningVisibilityMutation.mutate(checked)
                  }}
                />
              </SettingsFieldRow>
            </SettingsFieldGroup>
          </SettingsCard>

          {personalizationQuery.data && (
            <TaskAutoNamingSettings
              value={personalizationQuery.data.task_auto_naming}
              pending={
                taskAutoNamingMutation.isPending ||
                personalizationQuery.isFetching
              }
              onChange={(value) => {
                setError(null)
                taskAutoNamingMutation.mutate(value)
              }}
            />
          )}
        </div>
      )}

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.resetMemoriesConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.resetMemoriesConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetMemoriesMutation.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={resetMemoriesMutation.isPending}
              onClick={() => {
                setResetDialogOpen(false)
                resetMemoriesMutation.mutate()
              }}
            >
              {t("settings.reset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.unsavedChangesTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.unsavedChangesDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.stayOnPage")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (blocker.state === "blocked") blocker.proceed()
              }}
            >
              {t("settings.discardChanges")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPageFrame>
  )
}

export function SettingsAppearancePage() {
  const { t } = useTranslation()
  const productName = useProductName()
  const { theme, setTheme, uiFontSize, setUiFontSize } = useTheme()
  const [uiFontSizeInput, setUiFontSizeInput] = useState(String(uiFontSize))

  const themeLabelKeys: Record<ThemePreference, string> = {
    system: "settings.themeSystem",
    light: "settings.themeLight",
    dark: "settings.themeDark",
  }

  const updateUiFontSizeInput = (value: string) => {
    setUiFontSizeInput(value)
    const fontSize = normalizeUiFontSize(value)
    if (fontSize !== null) setUiFontSize(fontSize)
  }

  const commitUiFontSizeInput = () => {
    const parsed = Number(uiFontSizeInput)
    const fontSize =
      uiFontSizeInput.trim() && Number.isFinite(parsed)
        ? clampUiFontSize(parsed)
        : uiFontSize
    setUiFontSize(fontSize)
    setUiFontSizeInput(String(fontSize))
  }

  return (
    <SettingsPageFrame
      title={t("settings.appearance")}
      description={t("settings.appearancePageDescription", { productName })}
    >
      <div className="grid min-w-0 gap-6">
        <div className="min-w-0 rounded-card border border-border bg-card p-6">
          <FieldSet className="min-w-0 gap-5">
            <FieldLegend className="mb-0 text-lg font-medium text-heading">
              {t("settings.theme")}
            </FieldLegend>
            <RadioGroup
              className="grid grid-cols-1 gap-4 sm:grid-cols-3"
              aria-label={t("settings.theme")}
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark")
                  setTheme(value)
              }}
            >
              {themePreferences.map((preference) => (
                <RadioGroupOption
                  key={preference}
                  htmlFor={`appearance-theme-${preference}`}
                  className="group/theme-option flex w-full min-w-0 flex-col items-stretch gap-3 rounded-xl border border-border bg-card p-3 has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-card"
                >
                  <ThemePreview
                    preference={preference}
                    selected={theme === preference}
                  />
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    <span>{t(themeLabelKeys[preference])}</span>
                    <RadioGroupItem
                      id={`appearance-theme-${preference}`}
                      value={preference}
                    />
                  </span>
                </RadioGroupOption>
              ))}
            </RadioGroup>
          </FieldSet>
        </div>
        <SettingsCard>
          <SettingsFieldGroup>
            <SettingsFieldRow
              id="appearance-font-size"
              label={t("settings.uiFontSize")}
              hint={t("settings.uiFontSizeDescription", {
                productName,
                min: MIN_UI_FONT_SIZE,
                max: MAX_UI_FONT_SIZE,
              })}
              controlWidth="compact"
            >
              <div className="appearance-font-size-control">
                <Input
                  id="appearance-font-size"
                  type="number"
                  inputMode="numeric"
                  min={MIN_UI_FONT_SIZE}
                  max={MAX_UI_FONT_SIZE}
                  step={1}
                  value={uiFontSizeInput}
                  className="h-9 w-18 text-center max-[420px]:w-16"
                  onChange={(event) =>
                    updateUiFontSizeInput(event.target.value)
                  }
                  onBlur={commitUiFontSizeInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                  }}
                />
                <span aria-hidden="true">{t("settings.uiFontSizeUnit")}</span>
              </div>
            </SettingsFieldRow>
          </SettingsFieldGroup>
          <p className="border-t border-divider py-4 text-sm text-foreground">
            {t("workspaceHome.description")}
          </p>
        </SettingsCard>
      </div>
    </SettingsPageFrame>
  )
}

function ThemePreview({
  preference,
  selected,
}: {
  preference: ThemePreference
  selected: boolean
}) {
  const previews = preference === "system" ? ["light", "dark"] : [preference]
  return (
    <span
      className={cn(
        "appearance-theme-preview flex aspect-[12/5] w-full overflow-hidden rounded-md border transition-colors",
        selected ? "border-primary/30" : "border-border"
      )}
      data-preview-theme={preference}
      aria-hidden="true"
    >
      {previews.map((preview) => (
        <span
          key={preview}
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            preview === "dark" ? "bg-[#141414]" : "bg-white"
          )}
        >
          <span
            className={cn(
              "flex h-4 shrink-0 items-center gap-1 px-2",
              preview === "dark" ? "bg-[#202020]" : "bg-[#f7f8fa]"
            )}
          >
            {[0, 1, 2].map((dot) => (
              <span key={dot} className="size-1 rounded-full bg-[#69758d]/40" />
            ))}
          </span>
          <span className="flex min-h-0 flex-1">
            <span
              className={cn(
                "flex w-1/4 flex-col gap-2 p-2",
                preview === "dark" ? "bg-[#202020]" : "bg-[#f7f8fa]"
              )}
            >
              <span className="h-1 w-full rounded-full bg-[#69758d]/40" />
              <span className="h-1 w-4/5 rounded-full bg-[#69758d]/20" />
              <span className="h-1 w-3/5 rounded-full bg-[#69758d]/20" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-2 p-3">
              <span className="h-1.5 w-2/5 rounded-full bg-[#69758d]" />
              <span className="h-1 w-full rounded-full bg-[#69758d]/20" />
              <span className="h-1 w-4/5 rounded-full bg-[#69758d]/20" />
              <span
                className={cn(
                  "mt-auto flex h-7 items-center rounded border px-2",
                  preview === "dark"
                    ? "border-[#383e4b] bg-[#202020]"
                    : "border-[#e5e8f0] bg-white"
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-xs",
                    preview === "dark" ? "bg-[#8bb6ff]" : "bg-[#0874ff]"
                  )}
                />
              </span>
            </span>
          </span>
        </span>
      ))}
    </span>
  )
}

export function SettingsSecurityPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const passwordMutation = useMutation({
    mutationFn: () =>
      apiRequest("/auth/change-password", {
        method: "POST",
        body: { current_password: currentPassword, new_password: newPassword },
        schema: z.unknown(),
      }),
    onSuccess: async () => {
      await signOut()
      navigate("/login", { replace: true, state: { passwordChanged: true } })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  return (
    <SettingsPageFrame
      title={t("settings.security")}
      description={t("settings.securityPageDescription")}
    >
      <div className="grid min-w-0 gap-8">
        <SocialAccounts />
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        <SettingsCard
          aria-labelledby="change-password-heading"
          layout="split"
          icon={<ShieldCheckIcon />}
          header={
            <SettingsSectionHeader
              id="change-password-heading"
              title={t("auth.changePassword")}
              description={t("profile.passwordDescription")}
            />
          }
        >
          <form
            className="grid gap-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              setError(null)
              if (newPassword !== confirmation) {
                setError(t("validation.passwordMismatch"))
                return
              }
              if (!passwordSchema.safeParse(newPassword).success) {
                setError(t("errors.passwordPolicy"))
                return
              }
              passwordMutation.mutate()
            }}
          >
            <SettingsFieldGroup>
              <FieldShell
                id="current-password"
                required
                label={t("auth.currentPassword")}
                layout="settings"
                controlWidth="medium"
              >
                <PasswordInput
                  id="current-password"
                  fieldLabel={t("auth.currentPassword")}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </FieldShell>
              <FieldShell
                id="profile-new-password"
                required
                label={t("auth.newPassword")}
                hint={t("auth.passwordPolicy")}
                layout="settings"
                controlWidth="medium"
              >
                <PasswordInput
                  id="profile-new-password"
                  fieldLabel={t("auth.newPassword")}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </FieldShell>
              <FieldShell
                id="profile-confirm-password"
                required
                label={t("auth.confirmPassword")}
                layout="settings"
                controlWidth="medium"
              >
                <PasswordInput
                  id="profile-confirm-password"
                  fieldLabel={t("auth.confirmPassword")}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </FieldShell>
            </SettingsFieldGroup>
            <div className="flex justify-end">
              <Button
                type="submit"
                size="default"
                disabled={
                  !currentPassword || !newPassword || passwordMutation.isPending
                }
                aria-busy={passwordMutation.isPending || undefined}
              >
                {passwordMutation.isPending && (
                  <Spinner data-icon="inline-start" />
                )}
                {t("auth.changePassword")}
              </Button>
            </div>
          </form>
        </SettingsCard>
      </div>
    </SettingsPageFrame>
  )
}

function SettingsPageFrame({
  title,
  description,
  className,
  children,
}: {
  title: string
  description: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("settings-page", className)}>
      <header className="settings-page-header">
        <h1 className="text-pretty">{title}</h1>
        <p className="text-pretty">{description}</p>
      </header>
      {children}
    </div>
  )
}

function resolveBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}
