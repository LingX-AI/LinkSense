import { SettingsCard } from "@/components/settings/settings-card"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import dayjs from "dayjs"
import { useCallback, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { apiRequest } from "@/api/client"
import {
  maintenanceStatusSchema,
  type BootstrapStatus,
  type MaintenanceStatus,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { NotificationToast } from "@/components/feedback/notification-toast"
import { StatusBanner } from "@/components/feedback/status-banner"
import { DateTimePicker } from "@/components/forms/date-time-picker"
import { FieldShell } from "@/components/forms/form-field"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const updateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"),
  settings: maintenanceStatusSchema,
})

type MaintenanceUpdatePayload = {
  enabled: boolean
  reason: string | null
  start_at: string | null
  end_at: string | null
}

type DurationUnit = "minute" | "hour"

const maintenanceDurationPresets = [
  { minutes: 10, labelKey: "admin.maintenance.durationPresets.10m" },
  { minutes: 30, labelKey: "admin.maintenance.durationPresets.30m" },
  { minutes: 60, labelKey: "admin.maintenance.durationPresets.1h" },
  { minutes: 120, labelKey: "admin.maintenance.durationPresets.2h" },
  { minutes: 240, labelKey: "admin.maintenance.durationPresets.4h" },
] as const

export function MaintenanceSettingsForm() {
  const { t } = useTranslation()
  const [message, setMessage] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ["admin", "maintenance-settings"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/maintenance-settings", {
        schema: maintenanceStatusSchema,
        signal,
      }),
  })
  const clearMessage = useCallback(() => setMessage(null), [])
  const handleUpdateSuccess = useCallback(
    (enabled: boolean) =>
      setMessage(
        t(enabled ? "admin.maintenance.saved" : "admin.maintenance.closed")
      ),
    [t]
  )

  if (query.isLoading) return <LoadingState />
  if (query.error || !query.data) {
    return (
      <ErrorState
        message={getErrorMessage(query.error, t)}
        onRetry={() => void query.refetch()}
      />
    )
  }

  return (
    <>
      <NotificationToast
        id="maintenance-settings-feedback"
        message={message}
        onDismiss={clearMessage}
      />
      <MaintenanceSettingsEditor
        key={`${query.data.enabled}:${query.data.start_at}:${query.data.end_at}`}
        settings={query.data}
        onUpdateStart={clearMessage}
        onUpdateSuccess={handleUpdateSuccess}
      />
    </>
  )
}

function MaintenanceSettingsEditor({
  settings,
  onUpdateStart,
  onUpdateSuccess,
}: {
  settings: MaintenanceStatus
  onUpdateStart: () => void
  onUpdateSuccess: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(settings.enabled)
  const [reason, setReason] = useState(settings.reason ?? "")
  const [startAt, setStartAt] = useState(toLocalDateTime(settings.start_at))
  const [endAt, setEndAt] = useState(toLocalDateTime(settings.end_at))
  const initialDuration = formatDurationFields(
    inferDurationMinutes(
      toLocalDateTime(settings.start_at),
      toLocalDateTime(settings.end_at)
    )
  )
  const [durationAmount, setDurationAmount] = useState(initialDuration.amount)
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(
    initialDuration.unit
  )
  const [persistedEnabled, setPersistedEnabled] = useState(settings.enabled)
  const [error, setError] = useState<string | null>(null)

  const createPayload = (nextEnabled = enabled): MaintenanceUpdatePayload => ({
    enabled: nextEnabled,
    reason: reason.trim() || null,
    start_at: toIsoTimestamp(startAt),
    end_at: toIsoTimestamp(endAt),
  })

  const disabledPayload = (): MaintenanceUpdatePayload => ({
    enabled: false,
    reason: null,
    start_at: null,
    end_at: null,
  })

  const mutation = useMutation({
    mutationFn: (payload: MaintenanceUpdatePayload) =>
      apiRequest("/admin/maintenance-settings", {
        method: "PUT",
        body: payload,
        schema: updateResultSchema,
      }),
    onSuccess: async ({ settings: updatedSettings }) => {
      setPersistedEnabled(updatedSettings.enabled)
      onUpdateSuccess(updatedSettings.enabled)
      setError(null)
      queryClient.setQueryData(
        ["admin", "maintenance-settings"],
        updatedSettings
      )
      queryClient.setQueryData<BootstrapStatus>(
        ["system", "bootstrap"],
        (current) =>
          current ? { ...current, maintenance: updatedSettings } : current
      )
      await queryClient.invalidateQueries({ queryKey: ["system", "bootstrap"] })
    },
    onError: (nextError, payload) => {
      if (!payload.enabled && persistedEnabled) setEnabled(true)
      setError(getErrorMessage(nextError, t))
    },
  })

  const validate = () => {
    if (!enabled) return null
    if (!startAt) return t("admin.maintenance.errors.startRequired")
    if (!endAt) return t("admin.maintenance.errors.endRequired")
    if (!dayjs(endAt).isAfter(dayjs(startAt))) {
      return t("admin.maintenance.errors.endAfterStart")
    }
    return null
  }

  const applyDuration = (minutes: number, baseStartAt = startAt) => {
    const nextStartAt = normalizeLocalDateTime(baseStartAt) || localNow()
    setStartAt(nextStartAt)
    setEndAt(addMinutes(nextStartAt, minutes))
  }

  const handleDurationInputChange = (value: string) => {
    setDurationAmount(value)
    const minutes = parseDurationMinutes(value, durationUnit)
    if (minutes) applyDuration(minutes)
  }

  const handleDurationUnitChange = (value: string | null) => {
    if (value !== "minute" && value !== "hour") return
    setDurationUnit(value)
    const minutes = parseDurationMinutes(durationAmount, value)
    if (minutes) applyDuration(minutes)
  }

  const handleStartAtChange = (value: string) => {
    setStartAt(value)
    const minutes = parseDurationMinutes(durationAmount, durationUnit)
    if (value && minutes) setEndAt(addMinutes(value, minutes))
  }

  const handleEndAtChange = (value: string) => {
    setEndAt(value)
    const nextDuration = formatDurationFields(
      inferDurationMinutes(startAt, value)
    )
    setDurationAmount(nextDuration.amount)
    setDurationUnit(nextDuration.unit)
  }

  const durationMinutes = parseDurationMinutes(durationAmount, durationUnit)
  const selectedDurationPreset = maintenanceDurationPresets.find(
    (preset) => preset.minutes === durationMinutes
  )
  const status =
    enabled && settings.active ? "active" : enabled ? "scheduled" : "disabled"

  return (
    <SettingsCard
      className="settings-section"
      aria-labelledby="maintenance-settings-title"
    >
      <SettingsSectionHeader
        id="maintenance-settings-title"
        title={t("admin.maintenance.title")}
        description={t("admin.maintenance.description")}
        status={
          <Badge variant={settings.active ? "destructive" : "secondary"}>
            {t(`admin.maintenance.status.${status}`)}
          </Badge>
        }
      />
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <form
        className="form-stack"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          onUpdateStart()
          const validationError = validate()
          setError(validationError)
          if (!validationError) mutation.mutate(createPayload())
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="maintenance-enabled" className="font-medium">
              {t("admin.maintenance.enabled")}
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("admin.maintenance.enabledDescription")}
            </p>
          </div>
          <Switch
            id="maintenance-enabled"
            checked={enabled}
            disabled={mutation.isPending}
            onCheckedChange={(nextEnabled) => {
              onUpdateStart()
              setError(null)
              setEnabled(nextEnabled)
              if (!nextEnabled && persistedEnabled) {
                mutation.mutate(disabledPayload())
              }
            }}
          />
        </div>
        {enabled && (
          <>
            <FieldShell
              id="maintenance-reason"
              label={t("admin.maintenance.reason")}
            >
              <Textarea
                id="maintenance-reason"
                value={reason}
                maxLength={1_000}
                rows={4}
                placeholder={t("admin.maintenance.reasonPlaceholder")}
                onChange={(event) => setReason(event.target.value)}
              />
            </FieldShell>
            <div
              data-testid="maintenance-time-fields"
              className="flex flex-col gap-4"
            >
              <FieldShell
                id="maintenance-duration-minutes"
                label={t("admin.maintenance.duration")}
                hint={t("admin.maintenance.durationHint")}
              >
                <div className="flex flex-col gap-3">
                  <ToggleGroup
                    value={
                      selectedDurationPreset
                        ? [String(selectedDurationPreset.minutes)]
                        : []
                    }
                    variant="outline"
                    spacing={2}
                    className="flex-wrap"
                    aria-label={t("admin.maintenance.durationPresetsLabel")}
                    onValueChange={(values) => {
                      const value = values[0]
                      const preset = maintenanceDurationPresets.find(
                        (candidate) => String(candidate.minutes) === value
                      )
                      if (!preset) {
                        setDurationAmount("")
                        return
                      }
                      const nextDuration = formatDurationFields(preset.minutes)
                      setDurationAmount(nextDuration.amount)
                      setDurationUnit(nextDuration.unit)
                      applyDuration(preset.minutes)
                    }}
                  >
                    {maintenanceDurationPresets.map((preset) => (
                      <ToggleGroupItem
                        key={preset.minutes}
                        value={String(preset.minutes)}
                      >
                        {t(preset.labelKey)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <div className="flex max-w-md items-center gap-2">
                    <Input
                      id="maintenance-duration-minutes"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={durationUnit === "hour" ? 0.25 : 1}
                      value={durationAmount}
                      placeholder={t(
                        "admin.maintenance.durationCustomPlaceholder"
                      )}
                      aria-label={t("admin.maintenance.duration")}
                      onChange={(event) =>
                        handleDurationInputChange(event.target.value)
                      }
                    />
                    <Select
                      value={durationUnit}
                      onValueChange={handleDurationUnitChange}
                    >
                      <SelectTrigger
                        id="maintenance-duration-unit"
                        aria-label={t("admin.maintenance.durationUnit")}
                        className="h-9! w-28"
                      >
                        <SelectValue>
                          {t(`admin.maintenance.durationUnits.${durationUnit}`)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(["minute", "hour"] as const).map((unit) => (
                            <SelectItem key={unit} value={unit}>
                              {t(`admin.maintenance.durationUnits.${unit}`)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </FieldShell>
              <FieldShell
                id="maintenance-start-at"
                label={t("admin.maintenance.startAt")}
              >
                <DateTimePicker
                  id="maintenance-start-at"
                  value={startAt}
                  onValueChange={handleStartAtChange}
                  label={t("admin.maintenance.startAt")}
                  datePlaceholder={t("admin.maintenance.datePlaceholder")}
                  clearDateLabel={t("admin.maintenance.clearStartDate")}
                  hourLabel={t("admin.maintenance.startHour")}
                  minuteLabel={t("admin.maintenance.startMinute")}
                />
              </FieldShell>
              <FieldShell
                id="maintenance-end-at"
                label={t("admin.maintenance.endAt")}
              >
                <DateTimePicker
                  id="maintenance-end-at"
                  value={endAt}
                  onValueChange={handleEndAtChange}
                  min={startAt || undefined}
                  minExclusive
                  label={t("admin.maintenance.endAt")}
                  datePlaceholder={t("admin.maintenance.datePlaceholder")}
                  clearDateLabel={t("admin.maintenance.clearEndDate")}
                  hourLabel={t("admin.maintenance.endHour")}
                  minuteLabel={t("admin.maintenance.endMinute")}
                />
              </FieldShell>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("admin.maintenance.timezoneHint")}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="submit"
                size="lg"
                disabled={mutation.isPending}
                aria-busy={mutation.isPending || undefined}
              >
                {mutation.isPending && <Spinner data-icon="inline-start" />}
                {t("admin.maintenance.save")}
              </Button>
            </div>
          </>
        )}
      </form>
    </SettingsCard>
  )
}

function toLocalDateTime(value: string | null) {
  if (!value) return ""
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("YYYY-MM-DDTHH:mm") : ""
}

function toIsoTimestamp(value: string) {
  if (!value) return null
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.toISOString() : null
}

function parseDurationMinutes(value: string, unit: DurationUnit) {
  const trimmed = value.trim()
  if (!/^\d+(?:\.\d+)?$/u.test(trimmed)) return null
  const amount = Number(trimmed)
  const minutes = unit === "hour" ? amount * 60 : amount
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  if (unit === "minute" && !Number.isInteger(minutes)) return null
  return Math.round(minutes)
}

function normalizeLocalDateTime(value: string) {
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("YYYY-MM-DDTHH:mm") : ""
}

function localNow() {
  return dayjs().second(0).millisecond(0).format("YYYY-MM-DDTHH:mm")
}

function addMinutes(value: string, minutes: number) {
  const parsed = dayjs(value)
  return parsed.isValid()
    ? parsed.add(minutes, "minute").format("YYYY-MM-DDTHH:mm")
    : ""
}

function inferDurationMinutes(startAt: string, endAt: string) {
  if (!startAt || !endAt) return null
  const start = dayjs(startAt)
  const end = dayjs(endAt)
  if (!start.isValid() || !end.isValid()) return null
  const minutes = end.diff(start, "minute")
  return minutes > 0 ? minutes : null
}

function formatDurationFields(minutes: number | null): {
  amount: string
  unit: DurationUnit
} {
  if (!minutes) return { amount: "", unit: "minute" }
  if (minutes >= 60 && minutes % 60 === 0) {
    return { amount: String(minutes / 60), unit: "hour" }
  }
  return { amount: String(minutes), unit: "minute" }
}
