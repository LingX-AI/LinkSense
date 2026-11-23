import { PlusIcon, ShieldIcon, TagsIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  MAX_PRIVACY_MASKING_CUSTOM_RULES,
  MAX_PRIVACY_MASKING_PREFIX_LENGTH,
  MAX_PRIVACY_MASKING_REGEX_LENGTH,
  MAX_PRIVACY_MASKING_RULE_NAME_LENGTH,
  MAX_PRIVACY_MASKING_TEMPLATE_DIGITS,
  privacyMaskingPersonalKindValues,
  privacyMaskingPhoneRegionValues,
  privacyMaskingRuleActionValues,
  type PrivacyMaskingCustomRule,
  type PrivacyMaskingSettings,
} from "@linksense/shared"

import {
  FieldShell,
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createRandomUuid } from "@/lib/random-uuid"
import { privacyMaskingKindLabelKeys } from "./kinds"

import { ruleFieldId, type RuleField, type RuleFieldError } from "./rule-field"

function ModeSelect<Value extends string>({
  id,
  value,
  items,
  disabled,
  onChange,
  hint,
}: {
  id: string
  value: Value
  items: readonly { value: Value; label: string }[]
  disabled: boolean
  onChange: (value: Value) => void
  hint?: boolean
}) {
  return (
    <Select
      name={id}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onChange(next)
      }}
    >
      <SelectTrigger
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="w-full"
      >
        <SelectValue>
          {items.find((item) => item.value === value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function PrivacyMaskingRules({
  settings,
  disabled,
  onChange,
  fieldError,
}: {
  settings: PrivacyMaskingSettings
  disabled: boolean
  onChange: (patch: Partial<PrivacyMaskingSettings>) => void
  fieldError: RuleFieldError | null
}) {
  const { t, i18n } = useTranslation()
  const rules = settings.custom_rules ?? []
  const actionItems = privacyMaskingRuleActionValues.map((value) => ({
    value,
    label: t(`privacyMaskingRules.${value}`),
  }))
  const regions = new Intl.DisplayNames(i18n.resolvedLanguage ?? "zh-CN", {
    type: "region",
  })
  const regionItems = [
    {
      value: "international" as const,
      label: t("privacyMaskingRules.internationalPhone"),
    },
    ...privacyMaskingPhoneRegionValues.map((value) => ({
      value,
      label: regions.of(value) ?? value,
    })),
  ]
  const updateRule = (rule: PrivacyMaskingCustomRule) => {
    onChange({
      custom_rules: rules.map((current) =>
        current.id === rule.id ? rule : current
      ),
    })
  }
  const addRule = (type: PrivacyMaskingCustomRule["type"]) => {
    if (rules.length >= MAX_PRIVACY_MASKING_CUSTOM_RULES) return
    const id = createRandomUuid()
    const base = { id, name: "", action: "mask" as const }
    const rule: PrivacyMaskingCustomRule =
      type === "prefix_digits"
        ? { ...base, type, prefix: "", digits: 6 }
        : { ...base, type, pattern: "" }
    onChange({ custom_rules: [...rules, rule] })
    requestAnimationFrame(() =>
      document.getElementById(ruleFieldId(id, "name"))?.focus()
    )
  }

  return (
    <>
      <SettingsCard
        aria-labelledby="privacy-masking-personal-heading"
        layout="split"
        icon={<ShieldIcon />}
        header={
          <SettingsSectionHeader
            id="privacy-masking-personal-heading"
            title={t("privacyMaskingRules.personalTitle")}
            description={t("privacyMaskingRules.personalDescription")}
          />
        }
      >
        <SettingsFieldGroup>
          {privacyMaskingPersonalKindValues.map((kind) => {
            const id = `privacy-masking-personal-${kind}`
            const hint =
              kind === "ID_CARD"
                ? t("privacyMaskingRules.idCardHint")
                : kind === "BANK_CARD"
                  ? t("privacyMaskingRules.bankCardHint")
                  : undefined
            return (
              <SettingsFieldRow
                key={kind}
                id={id}
                label={t(privacyMaskingKindLabelKeys[kind])}
                hint={hint}
              >
                <ModeSelect
                  id={id}
                  value={settings.personal_rules?.[kind] ?? "off"}
                  items={[
                    { value: "off", label: t("privacyMaskingRules.off") },
                    ...actionItems,
                  ]}
                  disabled={disabled}
                  hint={hint !== undefined}
                  onChange={(value) => {
                    const personalRules = { ...settings.personal_rules }
                    if (value === "off") delete personalRules[kind]
                    else personalRules[kind] = value
                    onChange({ personal_rules: personalRules })
                  }}
                />
              </SettingsFieldRow>
            )
          })}
          {settings.personal_rules?.PHONE && (
            <SettingsFieldRow
              id="privacy-masking-phone-region"
              label={t("privacyMaskingRules.phoneRegion")}
              hint={t("privacyMaskingRules.phoneRegionHint")}
            >
              <ModeSelect
                id="privacy-masking-phone-region"
                value={settings.phone_region ?? "international"}
                items={regionItems}
                disabled={disabled}
                hint
                onChange={(value) =>
                  onChange({
                    phone_region: value === "international" ? null : value,
                  })
                }
              />
            </SettingsFieldRow>
          )}
        </SettingsFieldGroup>
      </SettingsCard>
      <SettingsCard
        aria-labelledby="privacy-masking-custom-heading"
        layout="split"
        icon={<TagsIcon />}
        header={
          <SettingsSectionHeader
            id="privacy-masking-custom-heading"
            title={t("privacyMaskingRules.customTitle")}
            description={t("privacyMaskingRules.customDescription", {
              max: MAX_PRIVACY_MASKING_CUSTOM_RULES,
            })}
          />
        }
      >
        <div className="grid min-w-0 gap-4">
          {rules.map((rule) => (
            <fieldset
              key={rule.id}
              className="grid min-w-0 gap-3 rounded-lg border border-border p-3"
            >
              <legend className="px-1 text-sm font-medium">
                {t(
                  rule.type === "prefix_digits"
                    ? "privacyMaskingRules.template"
                    : "privacyMaskingRules.regex"
                )}
              </legend>
              <RuleInput
                rule={rule}
                field="name"
                value={rule.name}
                maxLength={MAX_PRIVACY_MASKING_RULE_NAME_LENGTH}
                disabled={disabled}
                error={fieldError}
                onChange={(name) => updateRule({ ...rule, name })}
              />
              {rule.type === "prefix_digits" ? (
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <RuleInput
                    rule={rule}
                    field="prefix"
                    value={rule.prefix}
                    maxLength={MAX_PRIVACY_MASKING_PREFIX_LENGTH}
                    disabled={disabled}
                    error={fieldError}
                    onChange={(prefix) => updateRule({ ...rule, prefix })}
                  />
                  <RuleInput
                    rule={rule}
                    field="digits"
                    value={rule.digits || ""}
                    disabled={disabled}
                    error={fieldError}
                    onChange={(digits) =>
                      updateRule({ ...rule, digits: Number(digits) })
                    }
                  />
                </div>
              ) : (
                <RuleInput
                  rule={rule}
                  field="pattern"
                  value={rule.pattern}
                  maxLength={MAX_PRIVACY_MASKING_REGEX_LENGTH}
                  disabled={disabled}
                  error={fieldError}
                  onChange={(pattern) => updateRule({ ...rule, pattern })}
                />
              )}
              <FieldShell
                id={`privacy-masking-action-${rule.id}`}
                label={t("privacyMaskingRules.action")}
              >
                <ModeSelect
                  id={`privacy-masking-action-${rule.id}`}
                  value={rule.action}
                  items={actionItems}
                  disabled={disabled}
                  onChange={(action) => updateRule({ ...rule, action })}
                />
              </FieldShell>
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                disabled={disabled}
                onClick={() => {
                  onChange({
                    custom_rules: rules.filter(({ id }) => id !== rule.id),
                  })
                  requestAnimationFrame(() =>
                    document
                      .getElementById("privacy-masking-add-template")
                      ?.focus()
                  )
                }}
              >
                <Trash2Icon data-icon="inline-start" />
                {t("privacyMaskingRules.remove")}
              </Button>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              id="privacy-masking-add-template"
              type="button"
              variant="outline"
              disabled={
                disabled || rules.length >= MAX_PRIVACY_MASKING_CUSTOM_RULES
              }
              onClick={() => addRule("prefix_digits")}
            >
              <PlusIcon data-icon="inline-start" />
              {t("privacyMaskingRules.addTemplate")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={
                disabled || rules.length >= MAX_PRIVACY_MASKING_CUSTOM_RULES
              }
              onClick={() => addRule("regex")}
            >
              <PlusIcon data-icon="inline-start" />
              {t("privacyMaskingRules.addRegex")}
            </Button>
          </div>
        </div>
      </SettingsCard>
    </>
  )
}

function RuleInput({
  rule,
  field,
  value,
  maxLength,
  disabled,
  error,
  onChange,
}: {
  rule: PrivacyMaskingCustomRule
  field: RuleField
  value: string | number
  maxLength?: number
  disabled: boolean
  error: RuleFieldError | null
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const id = ruleFieldId(rule.id, field)
  const message =
    error?.id === rule.id && error.field === field ? error.message : null
  const pattern = field === "pattern"
  const numeric = field === "digits"
  return (
    <Field
      data-invalid={Boolean(message) || undefined}
      className="min-w-0 gap-1.5"
    >
      <FieldLabel htmlFor={id} required>
        {t(`privacyMaskingRules.${field}`)}
      </FieldLabel>
      {pattern && (
        <FieldDescription id={`${id}-hint`}>
          {t("privacyMaskingRules.patternHint")}
        </FieldDescription>
      )}
      <Input
        id={id}
        name={id}
        type={numeric ? "number" : "text"}
        inputMode={numeric ? "numeric" : undefined}
        min={numeric ? 1 : undefined}
        max={numeric ? MAX_PRIVACY_MASKING_TEMPLATE_DIGITS : undefined}
        maxLength={maxLength}
        autoComplete="off"
        autoCorrect={field === "name" ? undefined : "off"}
        autoCapitalize={field === "name" ? undefined : "none"}
        spellCheck={field === "name" ? undefined : false}
        className={pattern ? "font-mono text-base" : "text-base"}
        value={value}
        disabled={disabled}
        required
        aria-invalid={Boolean(message) || undefined}
        aria-describedby={
          [pattern && `${id}-hint`, message && `${id}-error`]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onChange={(event) => onChange(event.target.value)}
      />
      {message && <FieldError id={`${id}-error`}>{message}</FieldError>}
    </Field>
  )
}
