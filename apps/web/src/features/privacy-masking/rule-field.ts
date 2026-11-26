export type RuleField = "name" | "prefix" | "digits" | "pattern"

export type RuleFieldError = {
  id: string
  field: RuleField
  message: string
}

export function ruleFieldId(id: string, field: RuleField): string {
  return `privacy-masking-rule-${id}-${field}`
}
