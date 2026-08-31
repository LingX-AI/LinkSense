import { useCallback, useMemo, useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
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
  type SupportedLanguage,
} from "@/api/contracts"
import { MAX_CUSTOM_INSTRUCTIONS_LENGTH } from "@linksense/shared"
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
import { FieldShell } from "@/components/forms/form-field"
import { PasswordInput } from "@/components/forms/password-input"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
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
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ProfileOverview } from "@/features/profile/profile-overview"
import { BrowserNotificationSettings } from "@/features/browser-notifications/browser-notification-settings"
import { normalizeLanguage, setAppLanguage } from "@/i18n"
import { passwordSchema } from "@/lib/password"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"
import { cn } from "@/lib/utils"

export function SettingsGeneralPage() {
  const { t, i18n } = useTranslation()
  const { user, refreshUser } = useAuth()
  const initialLanguage =
    user?.language ?? normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [language, setLanguage] = useState<SupportedLanguage>(initialLanguage)
  const [savedLanguage, setSavedLanguage] =
    useState<SupportedLanguage>(initialLanguage)
  const currentRunningMessageAction = user?.running_message_action ?? "queue"
  const [runningMessageAction, setRunningMessageAction] =
    useState<RunningMessageAction>(currentRunningMessageAction)
  const [savedRunningMessageAction, setSavedRunningMessageAction] =
    useState<RunningMessageAction>(currentRunningMessageAction)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: (nextLanguage: SupportedLanguage) =>
      apiRequest("/me", {
        method: "PATCH",
        body: { preferred_locale: nextLanguage },
        schema: userSchema,
      }),
    onSuccess: async (_nextUser, nextLanguage) => {
      await setAppLanguage(nextLanguage)
      setSavedLanguage(nextLanguage)
      await refreshUser()
      setError(null)
    },
    onError: async (nextError) => {
      setLanguage(savedLanguage)
      await setAppLanguage(savedLanguage, { persist: false })
      setError(getErrorMessage(nextError, i18n.getFixedT(savedLanguage)))
    },
  })

  const changeLanguage = async (value: string | null) => {
    if (value !== "zh-CN" && value !== "en-US") return
    const nextLanguage = value
    setLanguage(nextLanguage)
    setError(null)
    try {
      await setAppLanguage(nextLanguage, { persist: false })
      mutation.mutate(nextLanguage)
    } catch {
      setLanguage(savedLanguage)
      await setAppLanguage(savedLanguage, { persist: false })
      setError(i18n.getFixedT(savedLanguage)("errors.unknown"))
    }
  }

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
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <section
        className="settings-panel settings-language-panel"
        aria-labelledby="interface-language-heading"
      >
        <SettingsSectionHeader
          id="interface-language-heading"
          title={t("settings.interfaceLanguage")}
          description={t("settings.interfaceLanguageDescription")}
        />
        <FieldShell
          id="settings-language"
          label={t("common.language")}
          className="settings-language-field"
        >
          <Select
            value={language}
            onValueChange={changeLanguage}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="settings-language" className="h-9! w-full">
              <SelectValue>
                {t(language === "zh-CN" ? "common.chinese" : "common.english")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">{t("common.chinese")}</SelectItem>
              <SelectItem value="en-US">{t("common.english")}</SelectItem>
            </SelectContent>
          </Select>
        </FieldShell>
      </section>
      <section
        className="settings-panel mt-4"
        aria-labelledby="running-message-action-heading"
      >
        <SettingsSectionHeader
          id="running-message-action-heading"
          title={t("settings.runningMessageAction")}
          description={t("settings.runningMessageActionDescription")}
          descriptionId="running-message-action-description"
        />
        <RadioGroup
          value={runningMessageAction}
          onValueChange={(value) => {
            if (value !== "steer" && value !== "queue") return
            setRunningMessageAction(value)
            setError(null)
            runningMessageActionMutation.mutate(value)
          }}
          disabled={runningMessageActionMutation.isPending}
          aria-describedby="running-message-action-description"
          className="mt-4 grid gap-2 sm:grid-cols-2"
        >
          <Label
            htmlFor="running-message-action-steer"
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-[color:var(--app-border)] px-3 py-2.5 has-data-[checked]:border-[color:var(--app-text)] has-data-[checked]:bg-[color-mix(in_srgb,var(--app-text)_4%,transparent)]"
          >
            <RadioGroupItem
              id="running-message-action-steer"
              value="steer"
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--app-text)]">
                {t("settings.runningMessageActionSteer")}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">
                {t("settings.runningMessageActionSteerDescription")}
              </span>
            </span>
          </Label>
          <Label
            htmlFor="running-message-action-queue"
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-[color:var(--app-border)] px-3 py-2.5 has-data-[checked]:border-[color:var(--app-text)] has-data-[checked]:bg-[color-mix(in_srgb,var(--app-text)_4%,transparent)]"
          >
            <RadioGroupItem
              id="running-message-action-queue"
              value="queue"
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--app-text)]">
                {t("settings.runningMessageActionQueue")}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">
                {t("settings.runningMessageActionQueueDescription")}
              </span>
            </span>
          </Label>
        </RadioGroup>
      </section>
      <BrowserNotificationSettings userId={user?.id} />
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
    queryKey: ["me", "personalization"],
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
    true

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
    onSuccess: () => {
      setResetDialogOpen(false)
      setError(null)
      notify.success(t("settings.memoriesReset"), {
        id: "personalization-memories-reset",
      })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const hasUnsavedInstructions = customInstructions !== savedCustomInstructions
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
        <>
          <section
            className="personalization-section"
            aria-labelledby="custom-instructions-heading"
          >
            <SettingsSectionHeader
              id="custom-instructions-heading"
              title={t("settings.customInstructions")}
              description={t("settings.customInstructionsDescription")}
              action={
                <Button
                  type="submit"
                  form="custom-instructions-form"
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
              }
            />
            <form
              id="custom-instructions-form"
              className="personalization-instructions-form"
              onSubmit={(event) => {
                event.preventDefault()
                setError(null)
                customInstructionsMutation.mutate(customInstructions)
              }}
            >
              <Textarea
                id="custom-instructions"
                value={customInstructions}
                maxLength={MAX_CUSTOM_INSTRUCTIONS_LENGTH}
                disabled={customInstructionsMutation.isPending}
                aria-labelledby="custom-instructions-heading"
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
              </div>
            </form>
          </section>

          <section
            className="personalization-section personalization-memory-section"
            aria-labelledby="memory-heading"
          >
            <SettingsSectionHeader
              id="memory-heading"
              title={t("settings.memory")}
              description={t("settings.memoryDescription")}
            />
            <div className="personalization-memory-card">
              <div className="personalization-memory-row">
                <div>
                  <h3 id="enable-memories-label">
                    {t("settings.enableMemories")}
                  </h3>
                  <p id="enable-memories-description">
                    {t("settings.enableMemoriesDescription")}
                  </p>
                </div>
                <Switch
                  checked={memoriesEnabled}
                  disabled={
                    personalizationQuery.isFetching ||
                    memoriesMutation.isPending
                  }
                  aria-labelledby="enable-memories-label"
                  aria-describedby="enable-memories-description"
                  onCheckedChange={(checked) => {
                    setError(null)
                    setMemoriesEnabled(checked)
                    memoriesMutation.mutate(checked)
                  }}
                />
              </div>
              <div className="personalization-memory-row">
                <div>
                  <h3>{t("settings.resetMemories")}</h3>
                  <p>{t("settings.resetMemoriesDescription")}</p>
                </div>
                <Button
                  type="button"
                  variant="destructive-ghost"
                  disabled={resetMemoriesMutation.isPending}
                  onClick={() => setResetDialogOpen(true)}
                >
                  {t("settings.reset")}
                </Button>
              </div>
            </div>
          </section>
        </>
      )}

      <AlertDialog
        open={resetDialogOpen}
        onOpenChange={(open) => {
          if (!resetMemoriesMutation.isPending) setResetDialogOpen(open)
        }}
      >
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
              onClick={() => resetMemoriesMutation.mutate()}
            >
              {resetMemoriesMutation.isPending && (
                <Spinner data-icon="inline-start" />
              )}
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
      <FieldSet className="appearance-theme-fieldset">
        <FieldLegend
          variant="label"
          className="mb-0 text-sm leading-5 font-semibold"
        >
          {t("settings.theme")}
        </FieldLegend>
        <RadioGroup
          value={theme}
          onValueChange={(value) => {
            if (value === "system" || value === "light" || value === "dark") {
              setTheme(value)
            }
          }}
          className="appearance-theme-grid"
        >
          {themePreferences.map((preference) => (
            <Label
              key={preference}
              htmlFor={`appearance-theme-${preference}`}
              className="appearance-theme-option"
            >
              <RadioGroupItem
                id={`appearance-theme-${preference}`}
                value={preference}
                className="appearance-theme-radio sr-only"
              />
              <ThemePreview preference={preference} />
              <span className="appearance-theme-label">
                {t(themeLabelKeys[preference])}
              </span>
            </Label>
          ))}
        </RadioGroup>
      </FieldSet>
      <section
        className="appearance-font-size-setting"
        aria-labelledby="appearance-font-size-heading"
        aria-describedby="appearance-font-size-description"
      >
        <SettingsSectionHeader
          id="appearance-font-size-heading"
          title={t("settings.uiFontSize")}
          description={t("settings.uiFontSizeDescription", {
            productName,
            min: MIN_UI_FONT_SIZE,
            max: MAX_UI_FONT_SIZE,
          })}
          descriptionId="appearance-font-size-description"
        />
        <div className="appearance-font-size-control">
          <Input
            id="appearance-font-size"
            type="number"
            inputMode="numeric"
            min={MIN_UI_FONT_SIZE}
            max={MAX_UI_FONT_SIZE}
            step={1}
            value={uiFontSizeInput}
            aria-labelledby="appearance-font-size-heading"
            aria-describedby="appearance-font-size-description"
            className="h-9 w-18 text-center max-[420px]:w-16"
            onChange={(event) => updateUiFontSizeInput(event.target.value)}
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
      </section>
    </SettingsPageFrame>
  )
}

function ThemePreview({ preference }: { preference: ThemePreference }) {
  return (
    <span
      className="appearance-theme-preview"
      data-preview-theme={preference}
      aria-hidden="true"
    >
      <span className="appearance-theme-preview-toolbar">
        <span />
      </span>
      <span className="appearance-theme-preview-window">
        <span className="appearance-theme-preview-line appearance-theme-preview-line-short" />
        <span className="appearance-theme-preview-line" />
        <span className="appearance-theme-preview-line" />
        <span className="appearance-theme-preview-line appearance-theme-preview-line-short" />
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
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <section
        className="settings-panel"
        aria-labelledby="change-password-heading"
      >
        <SettingsSectionHeader
          id="change-password-heading"
          title={t("auth.changePassword")}
          description={t("profile.passwordDescription")}
        />
        <form
          className="form-stack settings-form"
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
          <FieldShell id="current-password" label={t("auth.currentPassword")}>
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
          <div>
            <Button
              type="submit"
              size="lg"
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
      </section>
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
