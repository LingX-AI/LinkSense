import {
  conversationFormAutoResolutionMs,
  conversationFormRequestedSchema,
  conversationFormResponseSemanticsMatchesSchema,
  conversationFormResponseSemanticsSchema,
  conversationFormTextSuggestsSensitiveValue,
  conversationUserInputResponseSchema,
  emitInteractiveApplicationCustomEventInputSchema,
} from "@linksense/shared"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import {
  failureToolResult,
  successToolResult,
  withRequestTimeout,
  type CoreMcpModuleDefinition,
  type CoreMcpToolModule,
} from "../core-service-module.js"

const fieldIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/u)
const labelSchema = z.string().trim().min(1).max(160)
const descriptionSchema = z.string().max(2_000).optional()
const placeholderSchema = z
  .string()
  .max(500)
  .optional()
  .describe("Optional hint shown inside text, textarea, or number controls.")
const commonFieldShape = {
  id: fieldIdSchema,
  label: labelSchema,
  description: descriptionSchema,
  required: z.boolean().default(false),
}
const textFieldSchema = z.strictObject({
  ...commonFieldShape,
  control: z.enum(["text", "textarea"]),
  placeholder: placeholderSchema,
  default: z.string().max(4_000).optional(),
  min_length: z.number().int().min(0).max(4_000).optional(),
  max_length: z.number().int().min(0).max(4_000).optional(),
})
const dateFieldSchema = z.strictObject({
  ...commonFieldShape,
  control: z.literal("date"),
  default: z.iso.date().optional(),
})
const dateTimeFieldSchema = z.strictObject({
  ...commonFieldShape,
  control: z.literal("date_time"),
  default: z.iso.datetime({ offset: true }).optional(),
})
const numberFieldSchema = z.strictObject({
  ...commonFieldShape,
  control: z.literal("number"),
  placeholder: placeholderSchema,
  integer: z.boolean().default(false),
  default: z.number().finite().optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
})
const selectOptionSchema = z.strictObject({
  value: z.string().min(1).max(500),
  label: z.string().trim().min(1).max(500),
})
const singleSelectFieldSchema = z.strictObject({
  ...commonFieldShape,
  control: z.literal("single_select"),
  options: z.array(selectOptionSchema).min(1).max(50),
  default: z.string().min(1).max(500).optional(),
})
const multiSelectFieldSchema = z.strictObject({
  ...commonFieldShape,
  control: z.literal("multi_select"),
  options: z.array(selectOptionSchema).min(1).max(50),
  default: z
    .array(z.string().min(1).max(500))
    .max(50)
    .optional(),
})
const booleanFieldSchema = z.strictObject({
  ...commonFieldShape,
  control: z.literal("boolean"),
  default: z.boolean().optional(),
})
const interactiveFormFieldSchema = z.discriminatedUnion("control", [
  textFieldSchema,
  dateFieldSchema,
  dateTimeFieldSchema,
  numberFieldSchema,
  singleSelectFieldSchema,
  multiSelectFieldSchema,
  booleanFieldSchema,
])
const approvalSemanticsSchema = z.strictObject({
  decision_field_id: fieldIdSchema.describe(
    "Required single-select field that records the approve or reject decision.",
  ),
  approve_value: z.string().min(1).max(500),
  reject_value: z.string().min(1).max(500),
})
const interactiveFormArgumentsSchema = z
  .strictObject({
    message: z.string().trim().min(1).max(4_000),
    purpose: z
      .enum(["input", "approval"])
      .default("input")
      .describe(
        "Use approval only when this form explicitly approves or rejects a described action.",
      ),
    approval: approvalSemanticsSchema.optional(),
    fields: z.array(interactiveFormFieldSchema).min(1).max(20),
  })
  .superRefine((input, context) => {
    if (new Set(input.fields.map((field) => field.id)).size !== input.fields.length) {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "duplicate_field_id",
      })
    }
    const sensitivePrompt = [
      input.message,
      ...input.fields.flatMap((field) => [
        field.id,
        field.label,
        field.description ?? "",
        "placeholder" in field ? (field.placeholder ?? "") : "",
      ]),
    ].find(conversationFormTextSuggestsSensitiveValue)
    if (sensitivePrompt) {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "sensitive_field_forbidden",
      })
    }
    if (input.purpose === "input" && input.approval !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["approval"],
        message: "approval_semantics_for_input_form",
      })
    }
    if (input.purpose === "approval") {
      if (!input.approval) {
        context.addIssue({
          code: "custom",
          path: ["approval"],
          message: "approval_semantics_required",
        })
      } else {
        const decisionField = input.fields.find(
          (field) => field.id === input.approval?.decision_field_id,
        )
        const decisionValues =
          decisionField?.control === "single_select"
            ? decisionField.options.map((option) => option.value)
            : []
        if (
          decisionField?.control !== "single_select" ||
          !decisionField.required ||
          decisionValues.length !== 2 ||
          input.approval.approve_value === input.approval.reject_value ||
          !decisionValues.includes(input.approval.approve_value) ||
          !decisionValues.includes(input.approval.reject_value)
        ) {
          context.addIssue({
            code: "custom",
            path: ["approval"],
            message: "invalid_approval_decision_field",
          })
        }
      }
    }
    for (const [index, field] of input.fields.entries()) {
      if (
        field.control === "text" ||
        field.control === "textarea"
      ) {
        if (
          field.min_length !== undefined &&
          field.max_length !== undefined &&
          field.min_length > field.max_length
        ) {
          context.addIssue({
            code: "custom",
            path: ["fields", index],
            message: "minimum_exceeds_maximum",
          })
        }
      }
      if (field.control === "number") {
        if (
          field.minimum !== undefined &&
          field.maximum !== undefined &&
          field.minimum > field.maximum
        ) {
          context.addIssue({
            code: "custom",
            path: ["fields", index],
            message: "minimum_exceeds_maximum",
          })
        }
      }
      if (
        field.control === "single_select" ||
        field.control === "multi_select"
      ) {
        const values = field.options.map((option) => option.value)
        if (new Set(values).size !== values.length) {
          context.addIssue({
            code: "custom",
            path: ["fields", index, "options"],
            message: "duplicate_option_value",
          })
        }
      }
    }
  })

export const interactiveFormCoreMcpModule = {
  key: "interactive_form",
  modes: ["default", "plan"],
  toolNames: ["request_user_form", "emit_application_event"],
  create({ environment, fetch }): CoreMcpToolModule {
    const endpoint = z.url().parse(environment.LINKSENSE_FORM_SERVICE_ENDPOINT)
    const token = z
      .string()
      .min(32)
      .parse(environment.LINKSENSE_FORM_SERVICE_TOKEN)
    const request = fetch ?? globalThis.fetch
    return {
      key: "interactive_form",
      tools: [requestUserFormTool, emitApplicationEventTool],
      instructions:
        "Call request_user_form whenever the user explicitly asks for an interactive form, form card, interactive card, confirmation card, or a fillable or selectable UI inside the current conversation. The explicit request alone is sufficient, including for a one-field form and even when the same information could be collected in plain text. Also use request_user_form when the user must provide typed or multiple values before you can continue. Do not substitute Markdown, numbered questions, plain-text questions, or a description of the intended form for an explicitly requested interactive form. Never claim that an interactive form was displayed unless request_user_form was actually called successfully. Set purpose=input for ordinary data collection. Set purpose=approval only when the form explicitly approves or rejects a clearly described external side effect, and declare the required two-option decision field and its exact approve and reject values. Never request passwords, API keys, tokens, credentials, or other secrets. Form submission by itself, cancellation, rejection, or missing input is not approval. The form records user intent only, so every subsequent side-effecting tool must still enforce its own authorization, freshness, validation, and audit requirements. Use emit_application_event only when the current LinkSense application instructions declare the exact custom event name and payload schema. Never use it for message deltas, reasoning, or tool progress.",
      async callTool(input) {
        if (input.toolName === "emit_application_event") {
          try {
            const event = emitInteractiveApplicationCustomEventInputSchema.parse(
              normalizeApplicationEventArguments(input.argumentsValue),
            )
            const response = await request(
              endpoint.replace(/\/request$/u, "/event"),
              {
                method: "POST",
                headers: {
                  authorization: `Bearer ${token}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify(event),
                signal: withRequestTimeout(input.signal, 15_000),
              },
            )
            if (!response.ok) {
              return failureToolResult({
                code: "APPLICATION_CUSTOM_EVENT_INVALID",
                retryable: response.status >= 500,
              })
            }
            return successToolResult(await response.json())
          } catch (error) {
            if (input.signal.aborted) throw error
            return failureToolResult({
              code: "APPLICATION_CUSTOM_EVENT_INVALID",
              retryable: false,
            })
          }
        }
        let arguments_: z.infer<typeof interactiveFormArgumentsSchema>
        let formRequest: ReturnType<typeof buildFormRequest>
        try {
          arguments_ = interactiveFormArgumentsSchema.parse(
            input.argumentsValue,
          )
          formRequest = buildFormRequest(arguments_)
        } catch (error) {
          const details =
            error instanceof z.ZodError
              ? error.issues.map((issue) => ({
                  path: issue.path.join("."),
                  reason: issue.message,
                }))
              : undefined
          return failureToolResult({
            code: "INTERACTIVE_FORM_INVALID",
            retryable: !isSensitiveFormValidationError(error),
            ...(details ? { details } : {}),
          })
        }
        const { requestedSchema, responseSemantics, uiHints } = formRequest
        try {
          const response = await request(endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              message: arguments_.message,
              requestedSchema,
              uiHints,
              responseSemantics,
            }),
            signal: withRequestTimeout(
              input.signal,
              conversationFormAutoResolutionMs + 15_000,
            ),
          })
          if (!response.ok) {
            return failureToolResult({
              code: "INTERACTIVE_FORM_UNAVAILABLE",
              retryable: response.status >= 500,
            })
          }
          const result = conversationUserInputResponseSchema.parse(
            await response.json(),
          )
          return successToolResult({
            action: result.action,
            content: result.action === "accept" ? result.content : null,
          })
        } catch (error) {
          if (input.signal.aborted) throw error
          return failureToolResult({
            code: "INTERACTIVE_FORM_UNAVAILABLE",
            retryable: true,
          })
        }
      },
    }
  },
} satisfies CoreMcpModuleDefinition

function buildFormRequest(
  input: z.infer<typeof interactiveFormArgumentsSchema>,
) {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  const uiHints: Record<
    string,
    { control: "text" | "textarea" | "number"; placeholder?: string }
  > = {}

  for (const field of input.fields) {
    if (field.required) required.push(field.id)
    const common = {
      title: field.label,
      ...(field.description ? { description: field.description } : {}),
    }
    if (field.control === "text" || field.control === "textarea") {
      const defaultValue = validTextDefault(field)
      properties[field.id] = {
        type: "string",
        ...common,
        ...(defaultValue !== undefined ? { default: defaultValue } : {}),
        ...(field.min_length !== undefined
          ? { minLength: field.min_length }
          : {}),
        ...(field.max_length !== undefined
          ? { maxLength: field.max_length }
          : {}),
      }
      uiHints[field.id] = {
        control: field.control,
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      }
      continue
    }
    if (field.control === "date" || field.control === "date_time") {
      properties[field.id] = {
        type: "string",
        ...common,
        format: field.control === "date" ? "date" : "date-time",
        ...(field.default !== undefined ? { default: field.default } : {}),
      }
      continue
    }
    if (field.control === "number") {
      const defaultValue = validNumberDefault(field)
      properties[field.id] = {
        type: field.integer ? "integer" : "number",
        ...common,
        ...(defaultValue !== undefined ? { default: defaultValue } : {}),
        ...(field.minimum !== undefined ? { minimum: field.minimum } : {}),
        ...(field.maximum !== undefined ? { maximum: field.maximum } : {}),
      }
      if (field.placeholder) {
        uiHints[field.id] = {
          control: "number",
          placeholder: field.placeholder,
        }
      }
      continue
    }
    if (
      field.control === "single_select" ||
      field.control === "multi_select"
    ) {
      const options = field.options.map((option) => ({
        const: option.value,
        title: option.label,
      }))
      const allowedValues = new Set(field.options.map((option) => option.value))
      const defaultValue = validSelectDefault(field, allowedValues)
      properties[field.id] =
        field.control === "single_select"
          ? {
              type: "string",
              ...common,
              oneOf: options,
              ...(typeof defaultValue === "string"
                ? { default: defaultValue }
                : {}),
            }
          : {
              type: "array",
              ...common,
              items: { anyOf: options },
              minItems: field.required ? 1 : 0,
              maxItems: options.length,
              ...(Array.isArray(defaultValue)
                ? { default: defaultValue }
                : {}),
            }
      continue
    }
    properties[field.id] = {
      type: "boolean",
      ...common,
      ...(field.default !== undefined ? { default: field.default } : {}),
    }
  }

  const requestedSchema = conversationFormRequestedSchema.parse({
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  })
  const responseSemantics = conversationFormResponseSemanticsSchema.parse(
    input.purpose === "approval" && input.approval
      ? { kind: "approval", ...input.approval }
      : { kind: "input" },
  )
  if (
    !conversationFormResponseSemanticsMatchesSchema(
      responseSemantics,
      requestedSchema,
    )
  ) {
    throw new Error("invalid form response semantics")
  }
  return {
    requestedSchema,
    responseSemantics,
    uiHints,
  }
}

function validTextDefault(
  field: z.infer<typeof textFieldSchema>,
): string | undefined {
  const value = field.default
  if (value === undefined) return undefined
  if (field.min_length !== undefined && value.length < field.min_length) {
    return undefined
  }
  if (field.max_length !== undefined && value.length > field.max_length) {
    return undefined
  }
  return value
}

function validNumberDefault(
  field: z.infer<typeof numberFieldSchema>,
): number | undefined {
  const value = field.default
  if (value === undefined) return undefined
  if (field.integer && !Number.isInteger(value)) return undefined
  if (field.minimum !== undefined && value < field.minimum) return undefined
  if (field.maximum !== undefined && value > field.maximum) return undefined
  return value
}

function validSelectDefault(
  field:
    | z.infer<typeof singleSelectFieldSchema>
    | z.infer<typeof multiSelectFieldSchema>,
  allowedValues: ReadonlySet<string>,
): string | string[] | undefined {
  const value = field.default
  if (value === undefined) return undefined
  if (typeof value === "string") {
    return allowedValues.has(value) ? value : undefined
  }
  if (
    new Set(value).size !== value.length ||
    value.some((item) => !allowedValues.has(item)) ||
    (field.required && value.length === 0)
  ) {
    return undefined
  }
  return value
}

const mcpToolInputSchemaSchema = z.looseObject({
  type: z.literal("object"),
  properties: z
    .record(z.string(), z.looseObject({}))
    .optional(),
  required: z.array(z.string()).optional(),
})

const requestUserFormTool = {
  name: "request_user_form",
  description:
    "Show a blocking interactive form card inside the current conversation and wait for the user's response. Call this tool when the user explicitly asks for an interactive form, form card, interactive card, confirmation card, or a fillable or selectable UI; that explicit request is sufficient even for one field. Do not replace an explicitly requested form with Markdown or plain-text questions, and never claim that a form was displayed unless this tool call succeeded. Supports text, textarea, single/multi select, date, date-time, number, and boolean fields. Declare purpose=input for ordinary forms or purpose=approval with an exact required two-option decision mapping for approve and reject flows. It only records user intent and never performs the side effect itself. Never use it for secrets.",
  inputSchema: mcpToolInputSchemaSchema.parse(
    z.toJSONSchema(interactiveFormArgumentsSchema),
  ),
  annotations: {
    title: "Request user form input",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
} satisfies Tool

const emitApplicationEventTool = {
  name: "emit_application_event",
  description:
    "Send one schema-validated custom business event to the current LinkSense interactive application. Use only event names and payload schemas explicitly declared in the current application instructions. Do not send chat messages, reasoning, or tool progress through this tool.",
  inputSchema: mcpToolInputSchemaSchema.parse(
    z.toJSONSchema(emitInteractiveApplicationCustomEventInputSchema),
  ),
  annotations: {
    title: "Emit interactive application event",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
} satisfies Tool

function normalizeApplicationEventArguments(input: unknown): unknown {
  const candidate = z.record(z.string(), z.unknown()).safeParse(input)
  if (!candidate.success || typeof candidate.data.payload !== "string") {
    return input
  }
  try {
    const payload: unknown = JSON.parse(candidate.data.payload)
    if (z.record(z.string(), z.json()).safeParse(payload).success) {
      return { ...candidate.data, payload }
    }
  } catch {
    // The strict public schema below returns the normal invalid-arguments result.
  }
  return input
}

function isSensitiveFormValidationError(error: unknown): boolean {
  return (
    error instanceof z.ZodError &&
    error.issues.some((issue) => issue.message === "sensitive_field_forbidden")
  )
}
