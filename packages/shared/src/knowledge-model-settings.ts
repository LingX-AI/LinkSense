import { z } from "zod"

import { modelIdentifierSchema } from "./model-provider.js"

export const knowledgeEmbeddingModelSettingsSchema = z.strictObject({
  configured: z.boolean(),
  model: modelIdentifierSchema.nullable(),
  dimensions: z.number().int().positive(),
  maximum_input_tokens: z.number().int().positive(),
})

export const knowledgeRerankModelSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  model: modelIdentifierSchema.nullable(),
  maximum_input_tokens: z.number().int().positive(),
  timeout_ms: z.number().int().positive(),
})

export const knowledgeModelSettingsSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  embedding: knowledgeEmbeddingModelSettingsSchema,
  rerank: knowledgeRerankModelSettingsSchema,
})

export const updateKnowledgeModelSettingsSchema = z
  .strictObject({
    expected_revision: z.number().int().nonnegative(),
    embedding: z.strictObject({
      model: modelIdentifierSchema,
    }),
    rerank: z.strictObject({
      enabled: z.boolean(),
      model: modelIdentifierSchema.nullable(),
    }),
  })
  .superRefine((settings, context) => {
    if (settings.rerank.enabled && settings.rerank.model === null) {
      context.addIssue({
        code: "custom",
        path: ["rerank", "model"],
        message: "rerank_model_is_required_when_enabled",
      })
    }
  })

export type KnowledgeModelSettings = z.infer<
  typeof knowledgeModelSettingsSchema
>
export type UpdateKnowledgeModelSettings = z.input<
  typeof updateKnowledgeModelSettingsSchema
>
