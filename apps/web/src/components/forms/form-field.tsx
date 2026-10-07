import type { ComponentProps, ReactNode } from "react"

import {
  Field,
  FieldContent,
  FieldGroup,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"

type FieldShellProps = {
  id: string
  label: string
  required?: boolean
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
  layout?: "default" | "settings"
  controlWidth?: "compact" | "medium" | "wide" | "full"
  multiline?: boolean
}

const settingsControlWidths = {
  compact: "md:max-w-48",
  medium: "md:max-w-sm",
  wide: "md:max-w-xl",
  full: "md:max-w-none",
} as const

export function FieldShell({
  id,
  label,
  required,
  hint,
  error,
  children,
  className,
  layout = "default",
  controlWidth = "full",
  multiline = false,
}: FieldShellProps) {
  if (layout === "settings") {
    return (
      <Field
        orientation="vertical"
        className={cn(
          "settings-field-row min-w-0 gap-3 py-4 first:pt-0 last:pb-0",
          !multiline &&
            "md:grid md:grid-cols-[minmax(0,1fr)_minmax(18rem,42%)] md:items-center md:gap-8",
          className
        )}
        data-invalid={error ? true : undefined}
        data-layout="settings"
        data-multiline={multiline || undefined}
      >
        <FieldContent className="min-w-0 gap-1">
          <FieldLabel htmlFor={id} className="form-label" required={required}>
            {label}
          </FieldLabel>
          {hint && (
            <FieldDescription id={`${id}-hint`} className="form-hint">
              {hint}
            </FieldDescription>
          )}
        </FieldContent>
        <FieldContent
          className={cn(
            "min-w-0 gap-1.5 md:w-full md:items-stretch md:justify-self-end",
            !multiline && settingsControlWidths[controlWidth]
          )}
        >
          {children}
          {error && (
            <FieldError id={`${id}-error`} className="form-error">
              {error}
            </FieldError>
          )}
        </FieldContent>
      </Field>
    )
  }

  return (
    <Field
      className={cn("form-field gap-1.5", className)}
      data-invalid={error ? true : undefined}
    >
      <FieldLabel htmlFor={id} className="form-label" required={required}>
        {label}
      </FieldLabel>
      {children}
      {hint && !error && (
        <FieldDescription className="form-hint">{hint}</FieldDescription>
      )}
      {error && (
        <FieldError id={`${id}-error`} className="form-error">
          {error}
        </FieldError>
      )}
    </Field>
  )
}

export function SettingsFieldGroup({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <FieldGroup
      data-slot="settings-field-group"
      className={cn(
        "min-w-0 gap-0 divide-y divide-[color:var(--app-divider)]",
        className
      )}
      {...props}
    />
  )
}

export function SettingsFieldRow({
  id,
  label,
  required,
  hint,
  children,
  className,
  controlWidth = "full",
}: Omit<FieldShellProps, "error" | "layout">) {
  return (
    <Field
      orientation="vertical"
      className={cn(
        "settings-field-row min-w-0 gap-3 py-4 first:pt-0 last:pb-0 md:grid md:grid-cols-[minmax(0,1fr)_minmax(18rem,42%)] md:items-center md:gap-8",
        className
      )}
      data-layout="settings"
    >
      <FieldContent className="min-w-0 gap-1">
        <FieldLabel htmlFor={id} className="form-label" required={required}>
          {label}
        </FieldLabel>
        {hint && (
          <FieldDescription className="form-hint">{hint}</FieldDescription>
        )}
      </FieldContent>
      <FieldContent
        className={cn(
          "min-w-0 md:w-full md:items-end md:justify-self-end",
          settingsControlWidths[controlWidth]
        )}
      >
        {children}
      </FieldContent>
    </Field>
  )
}
