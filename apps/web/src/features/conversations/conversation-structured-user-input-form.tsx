import { useMemo, useState, type ChangeEvent, type FormEvent } from "react"
import dayjs from "dayjs"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

import {
  conversationFormResponseMatchesSchema,
  conversationFormValueMatchesField,
  type ConversationFormPrimitive,
  type ConversationFormResponseContent,
  type ConversationFormUiHint,
  type ConversationUserInputResponse,
} from "@linksense/shared"

import type { ConversationUserInputRequest } from "@/api/contracts"
import { DatePicker } from "@/components/forms/date-picker"
import { DateTimePicker } from "@/components/forms/date-time-picker"
import { Button } from "@/components/ui/button"
import { CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
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
import { Textarea } from "@/components/ui/textarea"
import { ConversationUserInputRequestFooter } from "@/features/conversations/conversation-user-input-request-footer"
import { cn } from "@/lib/utils"

type StructuredRequest = Extract<ConversationUserInputRequest, { kind: "form" }>
type FormValue = string | boolean | string[]

export function ConversationStructuredUserInputForm({
  request,
  formId,
  disabled,
  submitting,
  terminal,
  onSubmit,
}: {
  request: StructuredRequest
  formId: string
  disabled: boolean
  submitting: boolean
  terminal: boolean
  onSubmit: (response: ConversationUserInputResponse) => void
}) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, FormValue>>(() =>
    initialValues(request)
  )
  const [showErrors, setShowErrors] = useState(false)
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const required = useMemo(
    () => new Set(request.requested_schema.required ?? []),
    [request.requested_schema.required]
  )
  const errors = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(request.requested_schema.properties).flatMap(
          ([fieldId, field]) => {
            const error = validateField(
              field,
              values[fieldId],
              required.has(fieldId),
              t
            )
            return error ? [[fieldId, error]] : []
          }
        )
      ),
    [request.requested_schema.properties, required, t, values]
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setShowErrors(true)
    const content = buildResponseContent(request, values)
    if (
      disabled ||
      Object.keys(errors).length > 0 ||
      !conversationFormResponseMatchesSchema(request.requested_schema, content)
    ) {
      return
    }
    onSubmit({ action: "accept", content })
  }

  return (
    <form
      className={cn(
        "conversation-structured-user-input-form",
        terminal && "conversation-structured-user-input-form-readonly",
        "flex min-h-0 flex-1 flex-col gap-0",
        !terminal && "-mb-(--card-spacing)"
      )}
      onSubmit={handleSubmit}
      noValidate
      aria-readonly={terminal || undefined}
    >
      <CardContent className="pb-(--card-spacing)">
        <FieldGroup className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
          {Object.entries(request.requested_schema.properties).map(
            ([fieldId, field], index) => {
              const inputId = `${formId}-field-${index}`
              const error = errors[fieldId]
              const invalid = Boolean(
                error && (showErrors || touched.has(fieldId))
              )
              return (
                <StructuredField
                  key={fieldId}
                  fieldId={fieldId}
                  inputId={inputId}
                  field={field}
                  value={values[fieldId]}
                  required={required.has(fieldId)}
                  disabled={disabled}
                  invalid={invalid}
                  error={invalid ? error : undefined}
                  uiHint={request.ui_hints[fieldId]}
                  onBlur={() =>
                    setTouched((current) => new Set(current).add(fieldId))
                  }
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [fieldId]: value }))
                  }
                />
              )
            }
          )}
        </FieldGroup>
      </CardContent>
      {!terminal && (
        <ConversationUserInputRequestFooter
          disabled={disabled}
          complete
          submitting={submitting}
          onCancel={() => onSubmit({ action: "cancel" })}
        />
      )}
    </form>
  )
}

function StructuredField({
  fieldId,
  inputId,
  field,
  value,
  required,
  disabled,
  invalid,
  error,
  uiHint,
  onBlur,
  onChange,
}: {
  fieldId: string
  inputId: string
  field: ConversationFormPrimitive
  value: FormValue | undefined
  required: boolean
  disabled: boolean
  invalid: boolean
  error?: string
  uiHint?: ConversationFormUiHint
  onBlur: () => void
  onChange: (value: FormValue) => void
}) {
  const { t } = useTranslation()
  const errorId = `${inputId}-error`
  const descriptionId = `${inputId}-description`
  const describedBy = [
    field.description ? descriptionId : null,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ")
  const label = field.title ?? fieldId

  return (
    <Field
      className={cn("min-w-0 gap-1.5", structuredFieldColumnClass(field))}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
    >
      <FieldLabel htmlFor={inputId} className="text-sm font-medium">
        {label}
        {required && (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </FieldLabel>
      {field.description && (
        <FieldDescription id={descriptionId} size="sm" className="leading-4">
          {field.description}
        </FieldDescription>
      )}
      {renderControl({
        field,
        inputId,
        label,
        value,
        disabled,
        invalid,
        describedBy: describedBy || undefined,
        placeholder: uiHint?.placeholder,
        multiline:
          uiHint?.control === "textarea" ||
          (field.type === "string" &&
            !("enum" in field) &&
            !("oneOf" in field) &&
            (field.maxLength ?? 0) > 500),
        onBlur,
        onChange,
        t,
      })}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  )
}

function renderControl(input: {
  field: ConversationFormPrimitive
  inputId: string
  label: string
  value: FormValue | undefined
  disabled: boolean
  invalid: boolean
  describedBy?: string
  placeholder?: string
  multiline: boolean
  onBlur: () => void
  onChange: (value: FormValue) => void
  t: TFunction
}) {
  const { field } = input
  if (field.type === "boolean") {
    return (
      <Checkbox
        id={input.inputId}
        checked={input.value === true}
        disabled={input.disabled}
        aria-label={input.label}
        aria-invalid={input.invalid || undefined}
        aria-describedby={input.describedBy}
        nativeButton
        render={(checkboxProps) => (
          <Label className="flex cursor-pointer items-center gap-2 rounded-lg bg-background/30 px-2.5 py-1.5 transition-colors has-data-[checked]:bg-muted/50">
            <Button
              {...checkboxProps}
              type="button"
              variant="ghost"
              size="icon-xs"
            />
            <span className="text-sm">
              {input.value === true
                ? input.t("conversation.userInput.booleanYes")
                : input.t("conversation.userInput.booleanNo")}
            </span>
          </Label>
        )}
        onCheckedChange={(checked) => input.onChange(checked === true)}
        onBlur={input.onBlur}
      />
    )
  }
  if (field.type === "number" || field.type === "integer") {
    return (
      <Input
        id={input.inputId}
        type="number"
        step={field.type === "integer" ? 1 : "any"}
        min={field.minimum}
        max={field.maximum}
        placeholder={input.placeholder}
        value={typeof input.value === "string" ? input.value : ""}
        disabled={input.disabled}
        aria-invalid={input.invalid || undefined}
        aria-describedby={input.describedBy}
        onBlur={input.onBlur}
        onChange={(event) => input.onChange(event.target.value)}
      />
    )
  }
  if (field.type === "array") {
    const selected = Array.isArray(input.value) ? input.value : []
    return (
      <div
        role="group"
        aria-label={input.label}
        aria-invalid={input.invalid || undefined}
        aria-describedby={input.describedBy}
        className="grid gap-1.5 sm:grid-cols-2"
        onBlur={input.onBlur}
      >
        {enumOptions(field).map((option, index) => {
          const optionId = `${input.inputId}-option-${index}`
          return (
            <Checkbox
              key={option.value}
              id={optionId}
              checked={selected.includes(option.value)}
              disabled={input.disabled}
              nativeButton
              render={(checkboxProps) => (
                <Label className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-background/30 px-2.5 py-2 transition-colors has-data-[checked]:bg-muted/50">
                  <Button
                    {...checkboxProps}
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                  />
                  <span className="text-sm font-medium">{option.label}</span>
                </Label>
              )}
              onCheckedChange={(checked) =>
                input.onChange(
                  checked === true
                    ? [...selected, option.value]
                    : selected.filter((value) => value !== option.value)
                )
              }
            />
          )
        })}
      </div>
    )
  }
  if ("enum" in field || "oneOf" in field) {
    const options = enumOptions(field)
    const selected = typeof input.value === "string" ? input.value : ""
    return (
      <Select
        modal={false}
        value={selected || null}
        disabled={input.disabled}
        onValueChange={(value) => input.onChange(value ?? "")}
      >
        <SelectTrigger
          id={input.inputId}
          className="w-full"
          aria-invalid={input.invalid || undefined}
          aria-describedby={input.describedBy}
          onBlur={input.onBlur}
        >
          <SelectValue>
            {options.find((option) => option.value === selected)?.label ??
              input.t("conversation.userInput.selectPlaceholder")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    )
  }
  if ("format" in field && field.format === "date") {
    return (
      <DatePicker
        id={input.inputId}
        value={typeof input.value === "string" ? input.value : ""}
        disabled={input.disabled}
        placeholder={input.t("conversation.userInput.datePlaceholder")}
        clearLabel={input.t("conversation.userInput.clearDate")}
        size="sm"
        onValueChange={input.onChange}
      />
    )
  }
  if ("format" in field && field.format === "date-time") {
    return (
      <DateTimePicker
        id={input.inputId}
        value={typeof input.value === "string" ? input.value : ""}
        disabled={input.disabled}
        label={input.label}
        datePlaceholder={input.t("conversation.userInput.datePlaceholder")}
        clearDateLabel={input.t("conversation.userInput.clearDate")}
        hourLabel={input.t("conversation.userInput.hour")}
        minuteLabel={input.t("conversation.userInput.minute")}
        size="sm"
        className="gap-1.5 sm:grid-cols-[minmax(0,1.55fr)_minmax(6.5rem,0.8fr)]"
        onValueChange={input.onChange}
      />
    )
  }
  const shared = {
    id: input.inputId,
    value: typeof input.value === "string" ? input.value : "",
    disabled: input.disabled,
    maxLength: "maxLength" in field ? field.maxLength : undefined,
    placeholder:
      input.placeholder ?? input.t("conversation.userInput.answerPlaceholder"),
    "aria-invalid": input.invalid || undefined,
    "aria-describedby": input.describedBy,
    onBlur: input.onBlur,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      input.onChange(event.target.value),
  }
  return input.multiline ? (
    <Textarea {...shared} rows={3} />
  ) : (
    <Input
      {...shared}
      type={
        "format" in field && field.format === "email"
          ? "email"
          : "format" in field && field.format === "uri"
            ? "url"
            : "text"
      }
    />
  )
}

function structuredFieldColumnClass(field: ConversationFormPrimitive): string {
  if ("format" in field && field.format === "date-time") {
    return "sm:col-span-2"
  }
  if (
    field.type === "boolean" ||
    field.type === "number" ||
    field.type === "integer" ||
    ("format" in field && field.format === "date") ||
    "enum" in field ||
    "oneOf" in field
  ) {
    return "sm:col-span-1"
  }
  return "sm:col-span-2"
}

function initialValues(request: StructuredRequest): Record<string, FormValue> {
  const persisted = request.response_content
  const useSchemaDefaults =
    persisted === null &&
    (request.status === "pending" || request.status === "answering")
  return Object.fromEntries(
    Object.entries(request.requested_schema.properties).map(
      ([fieldId, field]) => {
        const hasPersistedValue =
          persisted !== null &&
          Object.prototype.hasOwnProperty.call(persisted, fieldId)
        const persistedValue = hasPersistedValue
          ? persisted?.[fieldId]
          : undefined
        if (field.type === "array") {
          return [
            fieldId,
            Array.isArray(persistedValue)
              ? persistedValue
              : useSchemaDefaults
                ? (field.default ?? [])
                : [],
          ]
        }
        if (field.type === "boolean") {
          return [
            fieldId,
            typeof persistedValue === "boolean"
              ? persistedValue
              : useSchemaDefaults
                ? (field.default ?? false)
                : false,
          ]
        }
        if (field.type === "number" || field.type === "integer") {
          return [
            fieldId,
            typeof persistedValue === "number"
              ? String(persistedValue)
              : !useSchemaDefaults || field.default === undefined
                ? ""
                : String(field.default),
          ]
        }
        const stringValue =
          typeof persistedValue === "string"
            ? persistedValue
            : useSchemaDefaults
              ? (field.default ?? "")
              : ""
        if ("format" in field && field.format === "date-time" && stringValue) {
          const parsed = dayjs(stringValue)
          return [
            fieldId,
            parsed.isValid() ? parsed.format("YYYY-MM-DDTHH:mm") : "",
          ]
        }
        return [fieldId, stringValue]
      }
    )
  )
}

function buildResponseContent(
  request: StructuredRequest,
  values: Record<string, FormValue>
): ConversationFormResponseContent {
  const required = new Set(request.requested_schema.required ?? [])
  const content: ConversationFormResponseContent = {}
  for (const [fieldId, field] of Object.entries(
    request.requested_schema.properties
  )) {
    const value = values[fieldId]
    if (field.type === "boolean") {
      content[fieldId] = value === true
      continue
    }
    if (field.type === "number" || field.type === "integer") {
      if (typeof value === "string" && value.trim() !== "") {
        content[fieldId] = Number(value)
      }
      continue
    }
    if (field.type === "array") {
      const selected = Array.isArray(value) ? value : []
      if (selected.length > 0 || required.has(fieldId)) {
        content[fieldId] = selected
      }
      continue
    }
    if (typeof value !== "string" || (!value && !required.has(fieldId))) {
      continue
    }
    if ("format" in field && field.format === "date-time") {
      const parsed = dayjs(value)
      if (parsed.isValid()) content[fieldId] = parsed.toISOString()
      continue
    }
    content[fieldId] = value
  }
  return content
}

function validateField(
  field: ConversationFormPrimitive,
  value: FormValue | undefined,
  required: boolean,
  t: TFunction
): string | null {
  const empty =
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  if (empty) {
    return required ? t("conversation.userInput.validation.required") : null
  }
  if (field.type === "boolean") {
    return typeof value === "boolean"
      ? null
      : t("conversation.userInput.validation.invalid")
  }
  if (field.type === "number" || field.type === "integer") {
    const number = typeof value === "string" ? Number(value) : Number.NaN
    if (!Number.isFinite(number)) {
      return t("conversation.userInput.validation.invalidNumber")
    }
    if (field.type === "integer" && !Number.isInteger(number)) {
      return t("conversation.userInput.validation.integer")
    }
    if (field.minimum !== undefined && number < field.minimum) {
      return t("conversation.userInput.validation.minimum", {
        value: field.minimum,
      })
    }
    if (field.maximum !== undefined && number > field.maximum) {
      return t("conversation.userInput.validation.maximum", {
        value: field.maximum,
      })
    }
    return null
  }
  if (field.type === "array") {
    if (!Array.isArray(value)) {
      return t("conversation.userInput.validation.invalid")
    }
    if (field.minItems !== undefined && value.length < field.minItems) {
      return t("conversation.userInput.validation.minimumSelections", {
        count: field.minItems,
      })
    }
    if (field.maxItems !== undefined && value.length > field.maxItems) {
      return t("conversation.userInput.validation.maximumSelections", {
        count: field.maxItems,
      })
    }
    return conversationFormValueMatchesField(field, value)
      ? null
      : t("conversation.userInput.validation.invalid")
  }
  if (typeof value !== "string") {
    return t("conversation.userInput.validation.invalid")
  }
  const minLength = "minLength" in field ? field.minLength : undefined
  const maxLength = "maxLength" in field ? field.maxLength : undefined
  if (minLength !== undefined && value.length < minLength) {
    return t("conversation.userInput.validation.minimumLength", {
      count: minLength,
    })
  }
  if (maxLength !== undefined && value.length > maxLength) {
    return t("conversation.userInput.validation.maximumLength", {
      count: maxLength,
    })
  }
  if (!conversationFormValueMatchesField(field, value)) {
    if ("format" in field) {
      if (field.format === "email") {
        return t("conversation.userInput.validation.invalidEmail")
      }
      if (field.format === "uri") {
        return t("conversation.userInput.validation.invalidUri")
      }
      if (field.format === "date") {
        return t("conversation.userInput.validation.invalidDate")
      }
      if (field.format === "date-time") {
        return t("conversation.userInput.validation.invalidDateTime")
      }
    }
    return t("conversation.userInput.validation.invalid")
  }
  return null
}

function enumOptions(
  field: Extract<ConversationFormPrimitive, { type: "string" | "array" }>
): Array<{ value: string; label: string }> {
  if (field.type === "array") {
    return "enum" in field.items
      ? field.items.enum.map((value) => ({ value, label: value }))
      : field.items.anyOf.map((option) => ({
          value: option.const,
          label: option.title,
        }))
  }
  if ("oneOf" in field) {
    return field.oneOf.map((option) => ({
      value: option.const,
      label: option.title,
    }))
  }
  if ("enum" in field) {
    return field.enum.map((value, index) => ({
      value,
      label: "enumNames" in field ? (field.enumNames?.[index] ?? value) : value,
    }))
  }
  return []
}
