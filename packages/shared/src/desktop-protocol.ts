import { z } from "zod";

export const DESKTOP_PROTOCOL_HEADER = "x-linksense-desktop-protocol";
export const desktopProtocolVersion = 1;
// Pre-desktop API replicas must reject desktop writes before business effects.
export const DESKTOP_LEGACY_BUILD_SENTINEL = "0".repeat(64);
export const desktopProtocolVersionSchema = z.string().regex(/^[1-9]\d{0,3}$/u).transform(Number);
export const conversationExecutionTargetSchema = z.enum(["cloud", "local"]);
export type ConversationExecutionTarget = z.infer<typeof conversationExecutionTargetSchema>;
