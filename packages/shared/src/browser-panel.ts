import { z } from "zod";

export const browserPanelInputSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("click"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  z.strictObject({
    type: z.literal("wheel"),
    delta_x: z.number().min(-2_000).max(2_000),
    delta_y: z.number().min(-2_000).max(2_000),
  }),
  z.strictObject({
    type: z.literal("text"),
    text: z.string().min(1).max(4_096),
  }),
  z.strictObject({
    type: z.literal("key"),
    key: z.enum([
      "Enter",
      "Tab",
      "Shift+Tab",
      "Backspace",
      "Delete",
      "Escape",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "ControlOrMeta+A",
    ]),
  }),
]);
const token = z.uuid();
export const browserPanelRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("frame"), token: token.optional() }),
  z.strictObject({ action: z.literal("claim"), token }),
  z.strictObject({ action: z.literal("release"), token }),
  z.strictObject({
    action: z.literal("input"),
    token,
    input: browserPanelInputSchema,
  }),
]);
export const browserPanelFrameSchema = z.strictObject({
  image: z
    .string()
    .max(2_800_000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/u),
  url: z.string().max(4_096),
  title: z.string().max(500),
  width: z.number().int().min(1).max(16_384),
  height: z.number().int().min(1).max(16_384),
});
export const browserPanelStateSchema = z.strictObject({
  mode: z.enum(["agent", "human"]),
  has_control: z.boolean(),
  lease_expires_at: z.string().datetime().nullable(),
  frame: browserPanelFrameSchema,
});
export type BrowserPanelInput = z.infer<typeof browserPanelInputSchema>;
export type BrowserPanelRequest = z.infer<typeof browserPanelRequestSchema>;
export type BrowserPanelState = z.infer<typeof browserPanelStateSchema>;

export const browserPanelErrorCodes = [
  "BROWSER_PANEL_UNAVAILABLE",
  "BROWSER_CONTROL_BUSY",
  "BROWSER_CONTROL_REQUIRED",
] as const;
