import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import { localComputerGrantSchema } from "./local-computer.js";

/**
 * M1b product control path, additive to the existing execution protocol.
 *
 * Only the authenticated Mac device socket may send this frame, and only after
 * it negotiated `computer.execute`. The native host derives the conversation
 * turn and its deliberate picker selection; the model and renderer never reach
 * this contract. Owner, connection, runtime generation, internal tokens,
 * window identity, process ids, resolved titles, and paths are deliberately
 * not part of the request body.
 */
const controlId = uuidSchema.transform(value => value.toLowerCase());
const controlScope = z.strictObject({
  conversation_id: controlId,
  turn_id: controlId,
  selection_id: controlId,
});
const selectBody = controlScope.extend({
  action: z.literal("select"),
  bundle_id: localComputerGrantSchema.shape.target.shape.bundle_id,
});
const pauseBody = controlScope.extend({ action: z.literal("pause") });
const resumeBody = controlScope.extend({
  action: z.literal("resume"),
  new_selection_id: controlId,
}).refine(body => body.new_selection_id !== body.selection_id, {
  path: ["new_selection_id"], error: "desktop_computer_selection_unchanged",
});
const stopBody = controlScope.extend({ action: z.literal("stop") });
export const desktopComputerControlSchema = z.strictObject({
  type: z.literal("computer.control"),
  // Preserve the native correlation id byte-for-byte; only scoped server ids
  // are normalized for database and Redis comparisons.
  id: uuidSchema,
  body: z.discriminatedUnion("action", [selectBody, pauseBody, resumeBody, stopBody]),
});
export type DesktopComputerControl = z.infer<typeof desktopComputerControlSchema>;
export type DesktopComputerControlBody = DesktopComputerControl["body"];

export const desktopComputerControlStateSchema = z.enum(["active", "paused", "stopped"]);
export type DesktopComputerControlState = z.infer<typeof desktopComputerControlStateSchema>;
/** A control transition never reports pausing; success means native terminal or refs cleared. */
export const desktopComputerControlSuccessSchema = z.strictObject({
  type: z.literal("computer.control.result"),
  id: uuidSchema,
  ok: z.literal(true),
  data: z.strictObject({
    state: desktopComputerControlStateSchema,
    session_id: uuidSchema,
    selection_id: uuidSchema,
    runtime_generation: uuidSchema,
    expires_at: timestampSchema,
  }),
});
/** Every failure is one of the existing bounded computer failure codes. */
export const desktopComputerControlFailureSchema = z.strictObject({
  type: z.literal("computer.control.result"),
  id: uuidSchema,
  ok: z.literal(false),
  error_code: z.enum([
    "COMPUTER_UNAVAILABLE",
    "COMPUTER_STALE_OBSERVATION",
    "COMPUTER_ACCESS_DENIED",
    "COMPUTER_TIMEOUT",
    "COMPUTER_INVALID",
    "COMPUTER_ACTION_FAILED",
    "DEVICE_BUSY",
    "COMPUTER_TARGET_CHANGED",
    "RUNNER_OPERATION_UNCERTAIN",
  ]),
});
export const desktopComputerControlResultSchema = z.union([
  desktopComputerControlSuccessSchema,
  desktopComputerControlFailureSchema,
]);
export type DesktopComputerControlResult = z.infer<typeof desktopComputerControlResultSchema>;
export type DesktopComputerControlFailureCode = z.infer<typeof desktopComputerControlFailureSchema>["error_code"];
