import { z } from "zod";

export const conversationFormMaximumFieldCount = 20;
export const conversationFormMaximumOptionCount = 50;
export const conversationFormAutoResolutionMs = 10 * 60 * 1_000;

export const conversationFormFieldIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/u);

const fieldTitleSchema = z.string().trim().min(1).max(160).optional();
const fieldDescriptionSchema = z.string().max(2_000).optional();
const enumValueSchema = z.string().min(1).max(500);
const enumValuesSchema = z
  .array(enumValueSchema)
  .min(1)
  .max(conversationFormMaximumOptionCount)
  .refine((values) => new Set(values).size === values.length, {
    message: "duplicate_enum_value",
  });
const titledEnumOptionSchema = z.strictObject({
  const: enumValueSchema,
  title: z.string().trim().min(1).max(500),
});
const titledEnumOptionsSchema = z
  .array(titledEnumOptionSchema)
  .min(1)
  .max(conversationFormMaximumOptionCount)
  .refine(
    (options) =>
      new Set(options.map((option) => option.const)).size === options.length,
    { message: "duplicate_enum_value" },
  );

const untitledSingleSelectSchema = z.strictObject({
  type: z.literal("string"),
  title: fieldTitleSchema,
  description: fieldDescriptionSchema,
  enum: enumValuesSchema,
  default: enumValueSchema.optional(),
});

const legacyTitledSingleSelectSchema = untitledSingleSelectSchema.extend({
  enumNames: z
    .array(z.string().trim().min(1).max(500))
    .min(1)
    .max(conversationFormMaximumOptionCount),
});

const titledSingleSelectSchema = z.strictObject({
  type: z.literal("string"),
  title: fieldTitleSchema,
  description: fieldDescriptionSchema,
  oneOf: titledEnumOptionsSchema,
  default: enumValueSchema.optional(),
});

const untitledMultiSelectSchema = z.strictObject({
  type: z.literal("array"),
  title: fieldTitleSchema,
  description: fieldDescriptionSchema,
  minItems: z.number().int().min(0).max(conversationFormMaximumOptionCount).optional(),
  maxItems: z.number().int().min(0).max(conversationFormMaximumOptionCount).optional(),
  items: z.strictObject({
    type: z.literal("string"),
    enum: enumValuesSchema,
  }),
  default: z.array(enumValueSchema).max(conversationFormMaximumOptionCount).optional(),
});

const titledMultiSelectSchema = z.strictObject({
  type: z.literal("array"),
  title: fieldTitleSchema,
  description: fieldDescriptionSchema,
  minItems: z.number().int().min(0).max(conversationFormMaximumOptionCount).optional(),
  maxItems: z.number().int().min(0).max(conversationFormMaximumOptionCount).optional(),
  items: z.strictObject({ anyOf: titledEnumOptionsSchema }),
  default: z.array(enumValueSchema).max(conversationFormMaximumOptionCount).optional(),
});

const booleanFieldSchema = z.strictObject({
  type: z.literal("boolean"),
  title: fieldTitleSchema,
  description: fieldDescriptionSchema,
  default: z.boolean().optional(),
});

const stringFieldSchema = z.strictObject({
  type: z.literal("string"),
  title: fieldTitleSchema,
  description: fieldDescriptionSchema,
  minLength: z.number().int().min(0).max(4_000).optional(),
  maxLength: z.number().int().min(0).max(4_000).optional(),
  format: z.enum(["email", "uri", "date", "date-time"]).optional(),
  default: z.string().max(4_000).optional(),
});

const numberFieldSchema = z.strictObject({
  type: z.enum(["number", "integer"]),
  title: fieldTitleSchema,
  description: fieldDescriptionSchema,
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  default: z.number().finite().optional(),
});

export const conversationFormPrimitiveSchema = z.union([
  legacyTitledSingleSelectSchema,
  untitledSingleSelectSchema,
  titledSingleSelectSchema,
  untitledMultiSelectSchema,
  titledMultiSelectSchema,
  booleanFieldSchema,
  stringFieldSchema,
  numberFieldSchema,
]);

export const conversationFormRequestedSchema = z
  .strictObject({
    $schema: z.string().max(500).optional(),
    type: z.literal("object"),
    properties: z.record(
      conversationFormFieldIdSchema,
      conversationFormPrimitiveSchema,
    ),
    required: z
      .array(conversationFormFieldIdSchema)
      .max(conversationFormMaximumFieldCount)
      .optional(),
  })
  .superRefine((schema, context) => {
    const fieldIds = Object.keys(schema.properties);
    if (
      fieldIds.length === 0 ||
      fieldIds.length > conversationFormMaximumFieldCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["properties"],
        message: "invalid_field_count",
      });
    }
    const required = schema.required ?? [];
    if (new Set(required).size !== required.length) {
      context.addIssue({
        code: "custom",
        path: ["required"],
        message: "duplicate_required_field",
      });
    }
    for (const fieldId of required) {
      if (!(fieldId in schema.properties)) {
        context.addIssue({
          code: "custom",
          path: ["required"],
          message: "unknown_required_field",
        });
      }
    }
    for (const [fieldId, field] of Object.entries(schema.properties)) {
      validateFieldBounds(fieldId, field, context);
    }
  });

export const conversationFormUiHintSchema = z.strictObject({
  control: z.enum(["text", "textarea", "number"]),
  placeholder: z.string().max(500).optional(),
});

export const conversationFormUiHintsSchema = z
  .record(conversationFormFieldIdSchema, conversationFormUiHintSchema)
  .refine(
    (hints) => Object.keys(hints).length <= conversationFormMaximumFieldCount,
    "too_many_ui_hints",
  );

export const conversationFormResponseSemanticsSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("input") }),
    z
      .strictObject({
        kind: z.literal("approval"),
        decision_field_id: conversationFormFieldIdSchema,
        approve_value: enumValueSchema,
        reject_value: enumValueSchema,
      })
      .refine((value) => value.approve_value !== value.reject_value, {
        message: "duplicate_decision_value",
      }),
  ],
);

export const conversationFormResponseValueSchema = z.union([
  z.string().max(4_000),
  z.number().finite(),
  z.boolean(),
  z
    .array(z.string().min(1).max(500))
    .max(conversationFormMaximumOptionCount)
    .refine((values) => new Set(values).size === values.length, {
      message: "duplicate_response_value",
    }),
]);

export const conversationFormResponseContentSchema = z
  .record(conversationFormFieldIdSchema, conversationFormResponseValueSchema)
  .refine(
    (content) =>
      Object.keys(content).length <= conversationFormMaximumFieldCount,
    "too_many_response_fields",
  );

export const conversationAsyncUserInputMaximumQuestionCount = 100;
export const conversationAsyncUserInputResponseContentSchema = z
  .record(
    z.string().regex(/^question-[1-9]\d{0,2}$/),
    z.string().min(1).max(4_000),
  )
  .refine(
    (content) =>
      Object.keys(content).length <=
      conversationAsyncUserInputMaximumQuestionCount,
    "too_many_response_fields",
  );

export const conversationUserInputResponseSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("accept"),
      content: z.union([
        conversationFormResponseContentSchema,
        conversationAsyncUserInputResponseContentSchema,
      ]),
    }),
    z.strictObject({ action: z.literal("decline") }),
    z.strictObject({ action: z.literal("cancel") }),
  ],
);

function validateFieldBounds(
  fieldId: string,
  field: z.infer<typeof conversationFormPrimitiveSchema>,
  context: z.RefinementCtx,
): void {
  if ("minLength" in field && "maxLength" in field) {
    if (
      field.minLength !== undefined &&
      field.maxLength !== undefined &&
      field.minLength > field.maxLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["properties", fieldId],
        message: "minimum_exceeds_maximum",
      });
    }
  }
  if ("minimum" in field && "maximum" in field) {
    if (
      field.minimum !== undefined &&
      field.maximum !== undefined &&
      field.minimum > field.maximum
    ) {
      context.addIssue({
        code: "custom",
        path: ["properties", fieldId],
        message: "minimum_exceeds_maximum",
      });
    }
  }
  if (field.type === "array") {
    if (
      field.minItems !== undefined &&
      field.maxItems !== undefined &&
      field.minItems > field.maxItems
    ) {
      context.addIssue({
        code: "custom",
        path: ["properties", fieldId],
        message: "minimum_exceeds_maximum",
      });
    }
    const allowed = new Set(
      "enum" in field.items
        ? field.items.enum
        : field.items.anyOf.map((option) => option.const),
    );
    if (field.default?.some((value) => !allowed.has(value))) {
      context.addIssue({
        code: "custom",
        path: ["properties", fieldId, "default"],
        message: "unsupported_default_value",
      });
    }
  }
  if (field.type === "string" && ("enum" in field || "oneOf" in field)) {
    const allowed = new Set(
      "enum" in field
        ? field.enum
        : field.oneOf.map((option) => option.const),
    );
    if (field.default !== undefined && !allowed.has(field.default)) {
      context.addIssue({
        code: "custom",
        path: ["properties", fieldId, "default"],
        message: "unsupported_default_value",
      });
    }
    if (
      "enumNames" in field &&
      field.enumNames !== undefined &&
      field.enumNames.length !== field.enum.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["properties", fieldId, "enumNames"],
        message: "enum_names_length_mismatch",
      });
    }
  }
  if (
    field.default !== undefined &&
    !conversationFormValueMatchesField(field, field.default)
  ) {
    context.addIssue({
      code: "custom",
      path: ["properties", fieldId, "default"],
      message: "invalid_default_value",
    });
  }
}

export type ConversationFormPrimitive = z.infer<
  typeof conversationFormPrimitiveSchema
>;
export type ConversationFormRequestedSchema = z.infer<
  typeof conversationFormRequestedSchema
>;
export type ConversationFormResponseContent = z.infer<
  typeof conversationFormResponseContentSchema
>;
export type ConversationFormResponseValue = z.infer<
  typeof conversationFormResponseValueSchema
>;
export type ConversationFormUiHint = z.infer<
  typeof conversationFormUiHintSchema
>;
export type ConversationFormResponseSemantics = z.infer<
  typeof conversationFormResponseSemanticsSchema
>;
export type ConversationUserInputResponse = z.infer<
  typeof conversationUserInputResponseSchema
>;

export function conversationFormResponseSemanticsMatchesSchema(
  semantics: ConversationFormResponseSemantics,
  schema: ConversationFormRequestedSchema,
): boolean {
  if (semantics.kind === "input") return true;
  const field = schema.properties[semantics.decision_field_id];
  if (
    !field ||
    field.type !== "string" ||
    !("enum" in field || "oneOf" in field) ||
    !(schema.required ?? []).includes(semantics.decision_field_id)
  ) {
    return false;
  }
  const values =
    "oneOf" in field
      ? field.oneOf.map((option) => option.const)
      : field.enum;
  return (
    values.length === 2 &&
    values.includes(semantics.approve_value) &&
    values.includes(semantics.reject_value)
  );
}

export function conversationFormAcceptedOutcome(
  semantics: ConversationFormResponseSemantics,
  content: ConversationFormResponseContent | null,
): "submitted" | "approved" | "rejected" {
  if (semantics.kind === "input" || content === null) return "submitted";
  const decision = content[semantics.decision_field_id];
  if (decision === semantics.approve_value) return "approved";
  if (decision === semantics.reject_value) return "rejected";
  return "submitted";
}

const conversationFormSensitiveValuePattern =
  /(?:password|passcode|credential|(?:api|client|app)[\s_-]*(?:key|secret)|(?:access|refresh)[\s_-]*token|密码|口令|密钥|访问令牌|刷新令牌|凭据)/iu;

export function conversationFormTextSuggestsSensitiveValue(
  value: string,
): boolean {
  return conversationFormSensitiveValuePattern.test(value);
}

export function conversationFormRequestsSensitiveValue(
  message: string,
  schema: ConversationFormRequestedSchema,
): boolean {
  return [
    message,
    ...Object.entries(schema.properties).flatMap(([fieldId, field]) => [
      fieldId,
      field.title ?? "",
      field.description ?? "",
    ]),
  ].some(conversationFormTextSuggestsSensitiveValue);
}

export function conversationFormResponseMatchesSchema(
  schema: ConversationFormRequestedSchema,
  content: ConversationFormResponseContent,
): boolean {
  const fieldIds = new Set(Object.keys(schema.properties));
  if (Object.keys(content).some((fieldId) => !fieldIds.has(fieldId))) {
    return false;
  }
  if ((schema.required ?? []).some((fieldId) => !(fieldId in content))) {
    return false;
  }
  return Object.entries(content).every(([fieldId, value]) => {
    const field = schema.properties[fieldId];
    return Boolean(field && conversationFormValueMatchesField(field, value));
  });
}

export function conversationFormValueMatchesField(
  field: ConversationFormPrimitive,
  value: ConversationFormResponseValue,
): boolean {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "number" || field.type === "integer") {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (field.type !== "integer" || Number.isInteger(value)) &&
      (field.minimum === undefined || value >= field.minimum) &&
      (field.maximum === undefined || value <= field.maximum)
    );
  }
  if (field.type === "array") {
    if (!Array.isArray(value)) return false;
    const allowed = new Set(
      "enum" in field.items
        ? field.items.enum
        : field.items.anyOf.map((option) => option.const),
    );
    return (
      new Set(value).size === value.length &&
      (field.minItems === undefined || value.length >= field.minItems) &&
      (field.maxItems === undefined || value.length <= field.maxItems) &&
      value.every((item) => allowed.has(item))
    );
  }
  if (typeof value !== "string") return false;
  if ("enum" in field || "oneOf" in field) {
    const allowed = new Set(
      "enum" in field
        ? field.enum
        : field.oneOf.map((option) => option.const),
    );
    return allowed.has(value);
  }
  const minLength = "minLength" in field ? field.minLength : undefined;
  const maxLength = "maxLength" in field ? field.maxLength : undefined;
  const format = "format" in field ? field.format : undefined;
  return (
    (minLength === undefined || value.length >= minLength) &&
    (maxLength === undefined || value.length <= maxLength) &&
    matchesStringFormat(format, value)
  );
}

function matchesStringFormat(
  format: "email" | "uri" | "date" | "date-time" | undefined,
  value: string,
): boolean {
  if (format === undefined) return true;
  if (format === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
  }
  if (format === "uri") {
    try {
      return Boolean(new URL(value).protocol);
    } catch {
      return false;
    }
  }
  if (format === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (!match) return false;
    const date = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    );
    return date.toISOString().slice(0, 10) === value;
  }
  return /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));
}
