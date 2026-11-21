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
});
export type DesktopComputerDispatchAdmission = z.infer<typeof desktopComputerDispatchAdmissionSchema>;
export type DesktopComputerDispatchAdmissionInput = z.input<typeof desktopComputerDispatchAdmissionSchema>;
