import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common.js";
import { desktopApprovalDecisionSchema } from "./conversation-forms.js";

/**
 * The closed set of desktop audit actions that may appear in a user's own
 * recent-activity view. Every entry is emitted by an existing Mac desktop
 * writer; this view never broadens the audit trail.
 */
export const desktopActivityActionSchema = z.enum([
  "desktop_device_paired",
  "desktop_device_registered",
  "desktop_device_renamed",
  "desktop_device_revoked",
  "desktop_approval_responded",
  "computer_session_started",
  "computer_session_stopped",
  "computer_permission_granted",
  "computer_permission_revoked",
  "desktop_tool_requested",
  "conversation_continued",
]);
export type DesktopActivityAction = z.infer<typeof desktopActivityActionSchema>;

/** The bounded latest-N read; the same constant bounds the response schema. */
export const desktopActivityLimit = 20;

export const desktopActivityResultSchema = z.enum([
  "success",
  "rejected",
  "failure",
]);
export type DesktopActivityResult = z.infer<
  typeof desktopActivityResultSchema
>;

/**
 * Stored delivery vocabulary shared by an approval reply and a computer read
 * attempt. Only the approval writer can prove `confirmed`; an attempt's exact
 * stored `unconfirmed` is kept, and a missing or unknown value stays unstated.
 */
export const desktopActivityDeliverySchema = z.enum([
  "unconfirmed",
  "confirmed",
]);
export type DesktopActivityDelivery = z.infer<
  typeof desktopActivityDeliverySchema
>;

/**
 * Bounded audit allowlist for the request kinds the existing computer.execute
 * tool body writes. It stays separate from the protocol's input schema, which
 * also carries observation, ref, and typed-text details that must not enter
 * the audit projection.
 */
export const desktopActivityComputerRequestSchema = z.enum([
  "status",
  "observe",
  "act",
  "wait",
]);
export type DesktopActivityComputerRequest = z.infer<
  typeof desktopActivityComputerRequestSchema
>;

/**
 * The bounded click/type action kinds. Only the action names are copied from
 * the protocol input; its refs, observation ids, and typed text never enter
 * the audit projection.
 */
export const desktopActivityComputerActionSchema = z.enum(["click", "type"]);
export type DesktopActivityComputerAction = z.infer<
  typeof desktopActivityComputerActionSchema
>;

/**
 * One account-scoped desktop audit row projected for display. It carries only
 * the audit row key, time, allowlisted action, outcome, and bounded dimensions;
 * target IDs, actor IDs, raw metadata, commands, typed text, AX content, paths,
 * URLs, and network identifiers never cross this boundary.
 */
export const desktopActivityItemSchema = z.strictObject({
  id: uuidSchema,
  created_at: timestampSchema,
  action: desktopActivityActionSchema,
  result: desktopActivityResultSchema,
  delivery: desktopActivityDeliverySchema.optional(),
  computer_request: desktopActivityComputerRequestSchema.optional(),
  computer_action: desktopActivityComputerActionSchema.optional(),
  approval_decision: desktopApprovalDecisionSchema.optional(),
});
export type DesktopActivityItem = z.infer<typeof desktopActivityItemSchema>;

/** Newest-first, bounded response. */
export const desktopActivityListSchema = z.strictObject({
  items: z.array(desktopActivityItemSchema).max(desktopActivityLimit),
});
export type DesktopActivityList = z.infer<typeof desktopActivityListSchema>;
