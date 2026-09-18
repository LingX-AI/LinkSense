import type { ApplicationIconFormState } from "./application-icon-form"
import { useRef, useState } from "react"
import { UploadIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  DEFAULT_APPLICATION_ICON_PRESET,
  APPLICATION_ICON_MAX_BYTES,
  APPLICATION_ICON_MAX_DIMENSION,
  applicationIconMimeTypeSchema,
  applicationIconPresetSchema,
  type ApplicationIcon,
} from "@linksense/shared"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ApplicationIconDisplay,
  ApplicationPresetIcon,
} from "./application-icon"
import { applicationIconPresetOptions } from "./application-icon-presets"

export function ApplicationIconField({
  value,
  onChange,
  onReadingChange,
  disabled = false,
}: {
  value: ApplicationIconFormState
  onChange: (value: ApplicationIconFormState) => void
  onReadingChange: (reading: boolean) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const busy = (value: boolean) => {
    setReading(value)
    onReadingChange(value)
  }
  const displayed: ApplicationIcon =
    value.mode === "preset"
      ? { type: "preset", preset: value.preset }
      : value.mode === "existing-custom"
        ? value.icon
        : {
            type: "custom",
            url: value.previewUrl,
            fallback_preset: DEFAULT_APPLICATION_ICON_PRESET,
          }
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel>{t("applications.icon")}</FieldLabel>
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        <ApplicationIconDisplay
          icon={displayed}
          className="size-16 [&_svg]:size-11"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <ToggleGroup
            variant="outline"
            disabled={disabled}
            value={value.mode === "preset" ? [value.preset] : []}
            onValueChange={(values) => {
              const preset = applicationIconPresetSchema.safeParse(values[0])
              if (!preset.success) return
              generation.current += 1
              busy(false)
              setError(null)
              onChange({ mode: "preset", preset: preset.data })
            }}
            aria-label={t("applications.iconPresetLabel")}
            spacing={1}
            className="grid w-full grid-cols-5 sm:grid-cols-10"
          >
            {applicationIconPresetOptions.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                aria-label={t(`applications.iconPresets.${option.value}`)}
                className="aspect-square h-auto min-h-7 w-full min-w-0 p-0"
              >
                <ApplicationPresetIcon preset={option.value} />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || reading}
              onClick={() => input.current?.click()}
            >
              <UploadIcon data-icon="inline-start" />
              {t(
                value.mode === "preset"
                  ? "applications.uploadIcon"
                  : "applications.replaceIcon"
              )}
            </Button>
            <Input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label={t("applications.uploadIcon")}
              disabled={disabled || reading}
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (!file) return
                setError(null)
                const mime = applicationIconMimeTypeSchema.safeParse(file.type)
                if (
                  !mime.success ||
                  !file.size ||
                  file.size > APPLICATION_ICON_MAX_BYTES ||
                  file.name.length > 160
                ) {
                  setError(t("applications.iconFileInvalid"))
                  return
                }
                const current = ++generation.current
                busy(true)
                try {
                  const previewUrl = await readFileAsDataUrl(file)
                  const prefix = `data:${mime.data};base64,`
                  if (!previewUrl.startsWith(prefix))
                    throw new Error("Invalid icon")
                  if (current === generation.current)
                    onChange({
                      mode: "upload",
                      filename: file.name,
                      mimeType: mime.data,
                      dataBase64: previewUrl.slice(prefix.length),
                      previewUrl,
                    })
                } catch {
                  if (current === generation.current)
                    setError(t("applications.iconFileInvalid"))
                } finally {
                  if (current === generation.current) busy(false)
                }
              }}
            />
          </div>
        </div>
      </div>
      <FieldDescription className="w-full max-w-none text-xs leading-5 whitespace-normal">
        {t("applications.iconHint", {
          size: "512 KiB",
          dimension: APPLICATION_ICON_MAX_DIMENSION,
        })}
      </FieldDescription>
      {error && (
        <FieldDescription role="alert" className="text-destructive">
          {error}
        </FieldDescription>
      )}
    </Field>
  )
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Invalid icon"))
    reader.readAsDataURL(file)
  })
}
