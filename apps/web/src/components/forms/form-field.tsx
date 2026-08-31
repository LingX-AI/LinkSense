import type { ReactNode } from "react"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"

type FieldShellProps = {
  id: string
  label: string
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
}

export function FieldShell({
  id,
  label,
  hint,
  error,
  children,
  className,
}: FieldShellProps) {
  return (
    <Field
      className={cn("form-field gap-1.5", className)}
      data-invalid={error ? true : undefined}
    >
      <FieldLabel htmlFor={id} className="form-label">
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
