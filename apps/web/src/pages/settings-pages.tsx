import { useCallback, useMemo, useRef, useState, type FormEvent } from "react"
import { SocialAccounts } from "@/features/social-auth/social-accounts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useBeforeUnload, useBlocker, useNavigate } from "react-router-dom"
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
import { Card } from "@/components/ui/card"
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
import { normalizeLanguage, supportedLanguages } from "@/i18n"
import { useLanguageSelection } from "@/features/onboarding/use-language-selection"
import { passwordSchema } from "@/lib/password"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"
import { cn } from "@/lib/utils"
import { languageLabelKey } from "@/features/onboarding/language-labels"

const personalizationQueryKey = ["me", "personalization"] as const
const resetMemoriesNotificationId = "personalization-memories-reset"
export function SettingsGeneralPage() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
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
      <Card className="gap-0 px-4 py-0 sm:px-5">
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
                  className="w-44 rounded-md"
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
                  className="w-44 max-w-[45vw] sm:w-56"
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
        <Separator className="bg-[var(--app-divider)]" />
        <BrowserNotificationSettings userId={user?.id} />
      </Card>
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
            <FieldShell id="profile-name" label={t("common.name")}>
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
  const personalizationQuery = useQuery({
    queryKey: personalizationQueryKey,
    queryFn: () =>
      apiRequest("/me/personalization", {
        schema: personalizationSettingsSchema,
      }),
    staleTime: Number.POSITIVE_INFINITY,
  })
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
      <div className="grid min-w-0 gap-8">
        <FieldSet className="min-w-0 gap-3">
          <FieldLegend className="mb-0 text-sm font-semibold">
            {t("settings.theme")}
          </FieldLegend>
          <RadioGroup
            className="grid grid-cols-3 gap-3 sm:gap-4"
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
                className="group/theme-option flex w-full min-w-0 flex-col items-stretch gap-2 rounded-none border-0 bg-transparent p-0 has-[[aria-checked=true]]:bg-transparent"
              >
                <RadioGroupItem
                  id={`appearance-theme-${preference}`}
                  value={preference}
                  className="sr-only"
                />
                <ThemePreview
                  preference={preference}
                  selected={theme === preference}
                />
                <span
                  className={cn(
                    "text-center text-sm font-medium",
                    theme === preference
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {t(themeLabelKeys[preference])}
                </span>
              </RadioGroupOption>
            ))}
          </RadioGroup>
        </FieldSet>
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
  const system = preference === "system"
  return (
    <span
      className={cn(
        "appearance-theme-preview relative block aspect-[10/7] w-full overflow-hidden rounded-card border-2 transition-colors group-has-[:focus-visible]/theme-option:ring-2 group-has-[:focus-visible]/theme-option:ring-ring group-has-[:focus-visible]/theme-option:ring-offset-2",
        selected ? "border-foreground" : "border-[color:var(--app-border)]",
        system
          ? "bg-[linear-gradient(90deg,#a0a0a0_50%,#5c5c5c_50%)]"
          : preference === "dark"
            ? "bg-[#5c5c5c]"
            : "bg-[#f4f4f4]"
      )}
      data-preview-theme={preference}
      aria-hidden="true"
    >
      {system && (
        <span className="absolute inset-x-[4%] top-[28%] bottom-0 rounded-t-xl bg-[linear-gradient(90deg,#f4f4f4_50%,#383838_50%)]" />
      )}
      <span
        className={cn(
          "absolute left-1/2 block h-[5%] w-[45%] -translate-x-1/2 rounded-full",
          system
            ? "top-[49%] w-[16%] bg-[linear-gradient(90deg,#cecece_50%,#787878_50%)]"
            : preference === "dark"
              ? "top-[22%] bg-[#a0a0a0]"
              : "top-[22%] bg-[#cecece]"
        )}
      />
      <span
        className={cn(
          "absolute left-1/2 block h-[3%] -translate-x-1/2 rounded-full",
          system
            ? "top-[57%] w-[38%] bg-[linear-gradient(90deg,#dedede_50%,#888888_50%)]"
            : preference === "dark"
              ? "top-[30%] w-[68%] bg-[#929292]"
              : "top-[30%] w-[68%] bg-[#dedede]"
        )}
      />
      <span
        className={cn(
          "absolute bottom-[-10%] flex flex-col overflow-hidden rounded-t-xl",
          system
            ? "inset-x-[15%] top-[64%] bg-[linear-gradient(90deg,#ffffff_50%,#505050_50%)]"
            : "inset-x-[9%] top-[37%] bg-white"
        )}
      >
        {["first", "second", "third"].map((row) => (
          <span
            key={row}
            className="flex h-1/3 shrink-0 flex-col justify-center gap-[15%] border-b border-[#f2f2f2] px-[5%]"
          >
            <span className="block h-[24%] w-[36%] rounded-full bg-[#dedede]" />
            <span className="block h-[8%] w-[52%] bg-[#f4f4f4]" />
          </span>
        ))}
      </span>
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
