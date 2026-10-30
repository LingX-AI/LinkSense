import { z } from "zod";

export const browserUseIntentRequestSchema = z.strictObject({ message_id: z.uuid() });
export const browserUseIntentSchema = z.boolean();

export const localBrowserHelpPath = "/settings/general#browser-extension";
export const localBrowserUrlSchema = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  });
const tabId = z.number().int().positive();
const coordinate = z.number().finite().min(0).max(32768);
export const localBrowserKeySchema = z.enum([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "SelectAll",
]);
export const localBrowserRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({ action: z.literal("tabs") }),
  z.strictObject({ action: z.literal("open"), url: localBrowserUrlSchema }),
  z.strictObject({
    action: z.literal("navigate"),
    tab_id: tabId,
    url: localBrowserUrlSchema,
  }),
  z.strictObject({
    action: z.enum(["snapshot", "screenshot", "release"]),
    tab_id: tabId,
  }),
  z.strictObject({
    action: z.literal("click"),
    tab_id: tabId,
    ref: z.string().min(1).max(200),
  }),
  z.strictObject({
    action: z.literal("click_at"),
    tab_id: tabId,
    x: coordinate,
    y: coordinate,
  }),
  z.strictObject({
    action: z.literal("type"),
    tab_id: tabId,
    text: z.string().max(8000),
    clear: z.boolean().default(false),
  }),
  z.strictObject({
    action: z.literal("scroll"),
    tab_id: tabId,
    x: coordinate,
    y: coordinate,
    delta_x: z.number().finite().min(-10000).max(10000).default(0),
    delta_y: z.number().finite().min(-10000).max(10000),
  }),
  z.strictObject({
    action: z.literal("key"),
    tab_id: tabId,
    key: localBrowserKeySchema,
  }),
]);
export type LocalBrowserRequest = z.infer<typeof localBrowserRequestSchema>;
export function localBrowserReadOnly(request: LocalBrowserRequest): boolean {
  return ["status", "tabs", "snapshot", "screenshot"].includes(request.action);
}
export const localBrowserFailureCodes = [
  "LOCAL_BROWSER_NOT_CONNECTED",
  "LOCAL_BROWSER_BUSY",
  "LOCAL_BROWSER_ACCESS_DENIED",
  "LOCAL_BROWSER_TAB_BUSY",
  "LOCAL_BROWSER_STALE_REF",
  "LOCAL_BROWSER_TIMEOUT",
  "LOCAL_BROWSER_CANCELLED",
  "LOCAL_BROWSER_COMMAND_FAILED",
] as const;
const tabSchema = z.strictObject({
  tab_id: tabId,
  url: z.string().max(4096),
  title: z.string().max(500),
});
export const localBrowserDataSchema = z.strictObject({
  connected: z.boolean().optional(),
  connection_id: z.uuid().optional(),
  browser: z.enum(["chrome", "edge"]).optional(),
  tabs: z.array(tabSchema).max(100).optional(),
  tab_id: tabId.optional(),
  url: z.string().max(4096).optional(),
  title: z.string().max(500).optional(),
  elements: z
    .array(
      z.strictObject({
        ref: z.string().max(200),
        role: z.string().max(100),
        name: z.string().max(500),
      }),
    )
    .max(200)
    .optional(),
  image: z
    .string()
    .max(4_000_000)
    .regex(/^[A-Za-z0-9+/=]+$/)
    .optional(),
  mime_type: z.literal("image/jpeg").optional(),
  viewport: z
    .strictObject({
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
});
export const localBrowserResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    browser: z.literal("local"),
    data: localBrowserDataSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(localBrowserFailureCodes),
    retryable: z.literal(false),
    help_path: z.literal(localBrowserHelpPath),
  }),
]);
export type LocalBrowserResult = z.infer<typeof localBrowserResultSchema>;
export function localBrowserFailure(
  code: (typeof localBrowserFailureCodes)[number],
): LocalBrowserResult {
  return { ok: false, code, retryable: false, help_path: localBrowserHelpPath };
}
export const localBrowserCommandSchema = z.strictObject({
  id: z.uuid(),
  connection_id: z.uuid(),
  conversation_id: z.uuid(),
  expires_at: z.number().int(),
  request: localBrowserRequestSchema,
});
export type LocalBrowserCommand = z.infer<typeof localBrowserCommandSchema>;
export const localBrowserReplySchema = z.strictObject({
  id: z.uuid(),
  result: localBrowserResultSchema,
});
export const localBrowserStatusSchema = z.strictObject({
  connected: z.boolean(),
  browser: z.enum(["chrome", "edge"]).optional(),
  connection_id: z.uuid().optional(),
});
export const localBrowserPairingSchema = z.strictObject({
  code: z.string().min(32).max(100),
  endpoint: z.url(),
});
export const localBrowserPairExchangeSchema = z.strictObject({
  code: localBrowserPairingSchema.shape.code,
  approval_id: z.uuid().optional(),
});
export const localBrowserPairResponseSchema = z.object({
  token: z.string().min(32).max(100),
  owner_id: z.uuid().optional(),
  approval_id: z.uuid().optional(),
});
export const localBrowserPreviewSchema = z.strictObject({
  tab_id: tabId,
  title: z.string().max(500),
  url: localBrowserUrlSchema,
  image: z.string().min(1).max(600_000).regex(/^[A-Za-z0-9+/=]+$/),
  captured_at: z.number().int().nonnegative(),
});
