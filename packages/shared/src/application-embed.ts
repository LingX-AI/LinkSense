import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const APPLICATION_EMBED_TICKET_TTL_SECONDS = 60;
export const APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS = 2 * 60 * 60;
export const APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS = 8 * 60 * 60;
export const APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS = 7 * 24 * 60 * 60;

export const applicationExternalAuthModeSchema = z.enum([
  "required",
  "public",
]);

export const applicationExternalOriginSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .transform((value, context) => {
    try {
      const parsed = new URL(value);
      if (
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error("invalid origin");
      }
      return parsed.origin;
    } catch {
      context.addIssue({ code: "custom", message: "invalid_origin" });
      return z.NEVER;
    }
  });

export const applicationExternalStarterQuestionSchema = z
  .string()
  .trim()
  .min(1)
  .max(500);

export const applicationExternalStarterQuestionSetSchema = z.strictObject({
  origin: applicationExternalOriginSchema,
  questions: z
    .array(applicationExternalStarterQuestionSchema)
    .max(4)
    .refine((questions) => new Set(questions).size === questions.length),
});

const applicationExternalStarterQuestionSetsSchema = z
  .array(applicationExternalStarterQuestionSetSchema)
  .max(50)
  .refine(
    (sets) => new Set(sets.map((set) => set.origin)).size === sets.length,
  );

export const applicationExternalAccessSchema = z.strictObject({
  application_id: uuidSchema,
  enabled: z.boolean(),
  auth_mode: applicationExternalAuthModeSchema,
  app_id: z.string().min(16).max(80),
  app_secret: z.string().min(32).max(256).nullable(),
  allowed_origins: z.array(applicationExternalOriginSchema).max(50),
  starter_questions_by_origin: applicationExternalStarterQuestionSetsSchema,
  iframe_url: z.string().url().max(4_096),
  access_token_ttl_seconds: z.literal(
    APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
  ),
  renewal_token_ttl_seconds: z.literal(
    APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS,
  ),
  absolute_session_ttl_seconds: z.literal(
    APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS,
  ),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const updateApplicationExternalAccessInputSchema = z
  .strictObject({
    enabled: z.boolean(),
    auth_mode: applicationExternalAuthModeSchema,
    allowed_origins: z
      .array(applicationExternalOriginSchema)
      .min(1)
      .max(50)
      .refine((origins) => new Set(origins).size === origins.length),
    starter_questions_by_origin: applicationExternalStarterQuestionSetsSchema,
  })
  .superRefine((input, context) => {
    const allowedOrigins = new Set(input.allowed_origins);
    input.starter_questions_by_origin.forEach((set, index) => {
      if (allowedOrigins.has(set.origin)) return;
      context.addIssue({
        code: "custom",
        path: ["starter_questions_by_origin", index, "origin"],
        message: "starter_question_origin_not_allowed",
      });
    });
  });

export const applicationExternalSecretSchema = z.strictObject({
  access: applicationExternalAccessSchema,
  app_secret: z.string().min(32).max(256),
});

export const applicationExternalAccessUpdateResultSchema = z.strictObject({
  access: applicationExternalAccessSchema,
  app_secret: z.string().min(32).max(256).nullable(),
});

export const createApplicationEmbedTicketInputSchema = z.strictObject({
  app_id: z.string().trim().min(16).max(80),
  app_secret: z.string().min(32).max(256),
  origin: applicationExternalOriginSchema,
  external_subject: z.string().trim().min(1).max(320).optional(),
  external_tenant: z.string().trim().min(1).max(240).optional(),
  display_name: z.string().trim().min(1).max(120).optional(),
});

export const createPublicApplicationEmbedSessionInputSchema = z.strictObject({
  app_id: z.string().trim().min(16).max(80),
  origin: applicationExternalOriginSchema,
});

export const exchangeApplicationEmbedTicketInputSchema = z.strictObject({
  ticket: z.string().min(32).max(512),
  origin: applicationExternalOriginSchema,
});

export const renewApplicationEmbedSessionInputSchema = z.strictObject({
  renewal_token: z.string().min(32).max(512),
  renewal_request_id: uuidSchema,
  origin: applicationExternalOriginSchema,
});

export const updateApplicationEmbedExternalApplicationSessionInputSchema =
  z.strictObject({
    external_application_session_id: z
      .string()
      .min(1)
      .max(16_384)
      .refine((value) => value.trim().length > 0 && !/[\r\n]/u.test(value))
      .nullable(),
  });

export const applicationEmbedTicketSchema = z.strictObject({
  ticket: z.string().min(32).max(512),
  iframe_url: z.string().url().max(4_096),
  expires_at: timestampSchema,
});

export const applicationEmbedTokenPairSchema = z.strictObject({
  access_token: z.string().min(32).max(16_384),
  renewal_token: z.string().min(32).max(512),
  access_token_expires_at: timestampSchema,
  renewal_token_expires_at: timestampSchema,
  session_expires_at: timestampSchema,
  session_id: uuidSchema,
});

export const applicationEmbedPublicSessionSchema = z.strictObject({
  session_id: uuidSchema,
  session_expires_at: timestampSchema,
});

export const applicationEmbedConversationSummarySchema = z.strictObject({
  id: uuidSchema,
  title: z.string().min(1).max(240),
  updated_at: timestampSchema,
  created_at: timestampSchema,
  execution_status: z.enum([
    "idle",
    "running",
    "pending",
    "completed",
    "failed",
    "interrupted",
  ]),
  current: z.boolean(),
});

export const applicationEmbedConversationListSchema = z.strictObject({
  items: z.array(applicationEmbedConversationSummarySchema).max(50),
});

export const applicationEmbedConversationSessionUpdateSchema = z.strictObject({
  session_id: uuidSchema,
  session_expires_at: timestampSchema,
  conversation_id: uuidSchema,
  access_token: z.string().min(32).max(16_384).nullable(),
  renewal_token: z.string().min(32).max(512).nullable(),
  access_token_expires_at: timestampSchema.nullable(),
  renewal_token_expires_at: timestampSchema.nullable(),
});

export const applicationEmbedAccessTokenClaimsSchema = z.strictObject({
  token_use: z.literal("application_embed"),
  sub: uuidSchema,
  session_id: uuidSchema,
  application_id: uuidSchema,
  conversation_id: uuidSchema,
  external_access_id: uuidSchema,
  origin: applicationExternalOriginSchema,
  credential_version: z.number().int().positive(),
  jti: uuidSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export type ApplicationExternalAccess = z.infer<
  typeof applicationExternalAccessSchema
>;
export type ApplicationEmbedAccessTokenClaims = z.infer<
  typeof applicationEmbedAccessTokenClaimsSchema
>;
export type ApplicationEmbedConversationSummary = z.infer<
  typeof applicationEmbedConversationSummarySchema
>;
export type UpdateApplicationExternalAccessInput = z.infer<
  typeof updateApplicationExternalAccessInputSchema
>;
