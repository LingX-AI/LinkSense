import { localComputerGrantSchema, timestampSchema, uuidSchema } from "@linksense/shared";
import { z } from "zod";

import { desktopRunScopeSchema } from "../desktop-credentials/run-leases.js";

/**
 * Internal, encrypted-Redis-only admission for one queued computer command.
 *
 * This is never part of the device command. It carries the exact fields of the
 * `LocalComputerActionAuthorization` permit that authorized the tool request so
 * the receiving gateway can recheck the original grant/session at dispatch
 * time. No run bearer or model-supplied target crosses here.
 */
export const desktopComputerDispatchAdmissionSchema = z.strictObject({
  scope: desktopRunScopeSchema,
  sessionId: uuidSchema,
  grantId: uuidSchema,
  capability: z.enum(["computer.observe", "computer.act"]),
  bundleId: localComputerGrantSchema.shape.target.shape.bundle_id,
  expiresAt: timestampSchema.transform(value => new Date(value)),
  /**
   * Product-lane renewal fence. Absent in the joined fixture; the product
   * admission compares it with the live selection so a renewal cannot revive a
   * command authorized before the new five-minute window.
   */
  controlEpoch: uuidSchema.optional(),
});
export type DesktopComputerDispatchAdmission = z.infer<typeof desktopComputerDispatchAdmissionSchema>;
export type DesktopComputerDispatchAdmissionInput = z.input<typeof desktopComputerDispatchAdmissionSchema>;

/**
 * Request-local continuation for publishing one read-only observe or wait
 * success.
 *
 * The Mac's AX text or `met`/`timed_out` result is produced before the API has
 * a final authoritative view of the run. This carries only the identity
 * captured for that one tool request (canonical scope, original selection
 * epoch/session/bundle/expiry, adopted holder, original observe grant and
 * expiry). `publish` rechecks that exact identity under the existing
 * `verifyDispatch` PostgreSQL conversation lock and invokes `finalize` at most
 * once, synchronously, while the lock is held. It never persists state, starts
 * a timer, re-authorizes a newer selection, or waits for the device.
 */
export type DesktopComputerReadPublication = {
  /**
   * Exact request kind this continuation was issued for. The tool-request lane
   * compares it with the request and the returned read before any send, so an
   * observe proof can never publish a wait result (or the reverse).
   */
  kind: "observe" | "wait";
  /** `finalize` performs only local socket checks and the one send. */
  publish: (finalize: () => boolean) => Promise<boolean>;
  /** Read after `publish` resolves false: the final synchronous deadline elapsed. */
  timedOut?: () => boolean;
};
