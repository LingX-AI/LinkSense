import { z } from "zod";

import { uuidSchema } from "./common.js";
import { desktopRelativePathSchema } from "./desktop-file-tools.js";

/**
 * Local shell runs only through the per-conversation permission mode on the
 * Mac. The command starts in a granted folder; output and runtime are bounded.
 * The command text never becomes server audit metadata.
 */
export const localShellCommandMaxBytes = 16_384;
export const localShellOutputMaxBytes = 65_536;
export const localShellDefaultTimeoutMs = 30_000;
export const localShellMaxTimeoutMs = 120_000;
/** A person must answer the native approval before this deadline. */
export const localShellApprovalTimeoutMs = 45_000;

export const localShellExecInputSchema = z.strictObject({
  root_id: uuidSchema,
  cwd: desktopRelativePathSchema.optional(),
  command: z.string().min(1).max(localShellCommandMaxBytes),
  timeout_ms: z
    .number()
    .int()
    .min(1_000)
    .max(localShellMaxTimeoutMs)
    .default(localShellDefaultTimeoutMs),
});
export type LocalShellExecInput = z.infer<typeof localShellExecInputSchema>;

export const localShellExecResultSchema = z.strictObject({
  /** Relative to the grant; empty means the granted folder itself. */
  cwd: z.string().max(4_096),
  exit_code: z.number().int().min(-1).max(255).nullable(),
  timed_out: z.boolean(),
  stdout: z.string().max(localShellOutputMaxBytes),
  stdout_truncated: z.boolean(),
  stderr: z.string().max(localShellOutputMaxBytes),
  stderr_truncated: z.boolean(),
  duration_ms: z.number().int().nonnegative(),
});
export type LocalShellExecResult = z.infer<typeof localShellExecResultSchema>;
