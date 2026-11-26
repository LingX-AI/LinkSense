import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import { computerFailureCodes } from "./computer-use.js";
import { desktopDeviceAppVersionSchema } from "./desktop-device.js";
import {
  localComputerActInputSchema,
  localComputerActResultSchema,
  localComputerActOperation,
  localComputerControlResultSchema,
  localComputerObserveInputSchema,
  localComputerObserveOperation,
  localComputerObserveResultSchema,
  localComputerPauseInputSchema,
  localComputerPauseOperation,
  localComputerResumeInputSchema,
  localComputerResumeOperation,
  localComputerSelectInputSchema,
  localComputerSelectOperation,
  localComputerSelectResultSchema,
  localComputerStatusInputSchema,
  localComputerStatusOperation,
  localComputerStatusResultSchema,
  localComputerStopInputSchema,
  localComputerStopOperation,
  localComputerWaitInputSchema,
  localComputerWaitOperation,
  localComputerWaitResultSchema,
} from "./desktop-cloud-computer.js";
import {
  localFilesCreateInputSchema,
  localFilesCreateResultSchema,
  localFilesDeleteInputSchema,
  localFilesDeleteResultSchema,
  localFilesListInputSchema,
  localFilesListResultSchema,
  localFilesRootsInputSchema,
  localFilesRootsResultSchema,
  localFilesReadInputSchema,
  localFilesReadResultSchema,
  localFilesSearchInputSchema,
  localFilesSearchResultSchema,
  localFilesWriteInputSchema,
  localFilesWriteResultSchema,
} from "./desktop-file-tools.js";

/**
 * Cloud task -> API -> Mac tool lane. It is independent of the retired local
 * execution protocol: the Mac advertises it even when no local runtime exists.
 */
export const DESKTOP_CLOUD_TOOL_PROTOCOL_HEADER = "x-linksense-desktop-cloud-tools";
export const DESKTOP_CLOUD_TOOL_OPERATIONS_HEADER = "x-linksense-desktop-cloud-tool-operations";
export const desktopCloudToolProtocolVersion = 1;
export const desktopCloudToolLifetimeMs = 30_000;
/** A native window picker waits for a person, so select gets a longer frame. */
export const desktopCloudToolSelectLifetimeMs = 120_000;
export function desktopCloudToolLifetimeFor(operation: DesktopCloudToolOperation): number {
  return operation === "local_computer.select"
    ? desktopCloudToolSelectLifetimeMs
    : desktopCloudToolLifetimeMs;
}

export const localToolsPingOperation = "local_tools.ping" as const;
export const localFilesRootsOperation = "local_files.roots" as const;
export const localFilesListOperation = "local_files.list" as const;
export const localFilesReadOperation = "local_files.read" as const;
export const localFilesSearchOperation = "local_files.search" as const;
export const localFilesWriteOperation = "local_files.write" as const;
export const localFilesCreateOperation = "local_files.create" as const;
export const localFilesDeleteOperation = "local_files.delete" as const;

export const desktopCloudToolOperationSchema = z.enum([
  localToolsPingOperation,
  localFilesRootsOperation,
  localFilesListOperation,
  localFilesReadOperation,
  localFilesSearchOperation,
  localFilesWriteOperation,
  localFilesCreateOperation,
  localFilesDeleteOperation,
  localComputerStatusOperation,
  localComputerSelectOperation,
  localComputerObserveOperation,
  localComputerActOperation,
  localComputerWaitOperation,
  localComputerPauseOperation,
  localComputerResumeOperation,
  localComputerStopOperation,
]);
export type DesktopCloudToolOperation = z.infer<typeof desktopCloudToolOperationSchema>;

export const localToolsPingToolName = "local_tools_ping" as const;

export const desktopCloudToolPingInputSchema = z.strictObject({
  message: z.string().trim().min(1).max(200),
});
export type DesktopCloudToolPingInput = z.infer<typeof desktopCloudToolPingInputSchema>;

export const desktopCloudToolPingResultSchema = z.strictObject({
  message: z.string(),
  platform: z.enum(["darwin", "windows"]),
  app_version: desktopDeviceAppVersionSchema,
});
export type DesktopCloudToolPingResult = z.infer<typeof desktopCloudToolPingResultSchema>;

export const desktopCloudToolErrorCodeSchema = z.enum([
  "FORBIDDEN",
  "RUNNER_UNAVAILABLE",
  "DESKTOP_TOOL_UNAVAILABLE",
  "CANCELLED",
  "DESKTOP_FILE_INVALID_PATH",
  "DESKTOP_FILE_NOT_FOUND",
  "DESKTOP_FILE_ACCESS_DENIED",
  "DESKTOP_FILE_CONFLICT",
  "DESKTOP_FILE_TOO_LARGE",
  "DESKTOP_FILE_UNSUPPORTED",
  "DESKTOP_FILE_UNAVAILABLE",
  "COMPUTER_CANCELED",
  ...computerFailureCodes,
]);
export type DesktopCloudToolErrorCode = z.infer<typeof desktopCloudToolErrorCodeSchema>;

export const desktopCloudToolInputSchemaFor = {
  [localToolsPingOperation]: desktopCloudToolPingInputSchema,
  [localFilesRootsOperation]: localFilesRootsInputSchema,
  [localFilesListOperation]: localFilesListInputSchema,
  [localFilesReadOperation]: localFilesReadInputSchema,
  [localFilesSearchOperation]: localFilesSearchInputSchema,
  [localFilesWriteOperation]: localFilesWriteInputSchema,
  [localFilesCreateOperation]: localFilesCreateInputSchema,
  [localFilesDeleteOperation]: localFilesDeleteInputSchema,
  [localComputerStatusOperation]: localComputerStatusInputSchema,
  [localComputerSelectOperation]: localComputerSelectInputSchema,
  [localComputerObserveOperation]: localComputerObserveInputSchema,
  [localComputerActOperation]: localComputerActInputSchema,
  [localComputerWaitOperation]: localComputerWaitInputSchema,
  [localComputerPauseOperation]: localComputerPauseInputSchema,
  [localComputerResumeOperation]: localComputerResumeInputSchema,
  [localComputerStopOperation]: localComputerStopInputSchema,
} satisfies Record<DesktopCloudToolOperation, z.ZodType>;

export const desktopCloudToolDataSchemaFor = {
  [localToolsPingOperation]: desktopCloudToolPingResultSchema,
  [localFilesRootsOperation]: localFilesRootsResultSchema,
  [localFilesListOperation]: localFilesListResultSchema,
  [localFilesReadOperation]: localFilesReadResultSchema,
  [localFilesSearchOperation]: localFilesSearchResultSchema,
  [localFilesWriteOperation]: localFilesWriteResultSchema,
  [localFilesCreateOperation]: localFilesCreateResultSchema,
  [localFilesDeleteOperation]: localFilesDeleteResultSchema,
  [localComputerStatusOperation]: localComputerStatusResultSchema,
  [localComputerSelectOperation]: localComputerSelectResultSchema,
  [localComputerObserveOperation]: localComputerObserveResultSchema,
  [localComputerActOperation]: localComputerActResultSchema,
  [localComputerWaitOperation]: localComputerWaitResultSchema,
  [localComputerPauseOperation]: localComputerControlResultSchema,
  [localComputerResumeOperation]: localComputerControlResultSchema,
  [localComputerStopOperation]: localComputerControlResultSchema,
} satisfies Record<DesktopCloudToolOperation, z.ZodType>;

export type DesktopCloudToolInputFor<O extends DesktopCloudToolOperation> =
  z.infer<(typeof desktopCloudToolInputSchemaFor)[O]>;
export type DesktopCloudToolDataFor<O extends DesktopCloudToolOperation> =
  z.infer<(typeof desktopCloudToolDataSchemaFor)[O]>;
export type DesktopCloudToolData = DesktopCloudToolDataFor<DesktopCloudToolOperation>;

export const desktopCloudToolInvocationSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal(localToolsPingOperation), input: desktopCloudToolPingInputSchema }),
  z.strictObject({ operation: z.literal(localFilesRootsOperation), input: localFilesRootsInputSchema }),
  z.strictObject({ operation: z.literal(localFilesListOperation), input: localFilesListInputSchema }),
  z.strictObject({ operation: z.literal(localFilesReadOperation), input: localFilesReadInputSchema }),
  z.strictObject({ operation: z.literal(localFilesSearchOperation), input: localFilesSearchInputSchema }),
  z.strictObject({ operation: z.literal(localFilesWriteOperation), input: localFilesWriteInputSchema }),
  z.strictObject({ operation: z.literal(localFilesCreateOperation), input: localFilesCreateInputSchema }),
  z.strictObject({ operation: z.literal(localFilesDeleteOperation), input: localFilesDeleteInputSchema }),
  z.strictObject({ operation: z.literal(localComputerStatusOperation), input: localComputerStatusInputSchema }),
  z.strictObject({ operation: z.literal(localComputerSelectOperation), input: localComputerSelectInputSchema }),
  z.strictObject({ operation: z.literal(localComputerObserveOperation), input: localComputerObserveInputSchema }),
  z.strictObject({ operation: z.literal(localComputerActOperation), input: localComputerActInputSchema }),
  z.strictObject({ operation: z.literal(localComputerWaitOperation), input: localComputerWaitInputSchema }),
  z.strictObject({ operation: z.literal(localComputerPauseOperation), input: localComputerPauseInputSchema }),
  z.strictObject({ operation: z.literal(localComputerResumeOperation), input: localComputerResumeInputSchema }),
  z.strictObject({ operation: z.literal(localComputerStopOperation), input: localComputerStopInputSchema }),
]);
export type DesktopCloudToolInvocation = z.infer<typeof desktopCloudToolInvocationSchema>;

const requestFor = <O extends DesktopCloudToolOperation>(operation: O) => z.strictObject({
  type: z.literal("cloud_tool.request"),
  id: uuidSchema,
  operation: z.literal(operation),
  input: desktopCloudToolInputSchemaFor[operation],
  expires_at: timestampSchema,
});

export const desktopCloudToolRequestSchema = z.discriminatedUnion("operation", [
  requestFor(localToolsPingOperation),
  requestFor(localFilesRootsOperation),
  requestFor(localFilesListOperation),
  requestFor(localFilesReadOperation),
  requestFor(localFilesSearchOperation),
  requestFor(localFilesWriteOperation),
  requestFor(localFilesCreateOperation),
  requestFor(localFilesDeleteOperation),
  requestFor(localComputerStatusOperation),
  requestFor(localComputerSelectOperation),
  requestFor(localComputerObserveOperation),
  requestFor(localComputerActOperation),
  requestFor(localComputerWaitOperation),
  requestFor(localComputerPauseOperation),
  requestFor(localComputerResumeOperation),
  requestFor(localComputerStopOperation),
]);
export type DesktopCloudToolRequest = z.infer<typeof desktopCloudToolRequestSchema>;

const successFor = <O extends DesktopCloudToolOperation>(operation: O) => z.strictObject({
  type: z.literal("cloud_tool.result"),
  id: uuidSchema,
  operation: z.literal(operation),
  ok: z.literal(true),
  data: desktopCloudToolDataSchemaFor[operation],
});

export const desktopCloudToolResultSchema = z.union([
  successFor(localToolsPingOperation),
  successFor(localFilesRootsOperation),
  successFor(localFilesListOperation),
  successFor(localFilesReadOperation),
  successFor(localFilesSearchOperation),
  successFor(localFilesWriteOperation),
  successFor(localFilesCreateOperation),
  successFor(localFilesDeleteOperation),
  successFor(localComputerStatusOperation),
  successFor(localComputerSelectOperation),
  successFor(localComputerObserveOperation),
  successFor(localComputerActOperation),
  successFor(localComputerWaitOperation),
  successFor(localComputerPauseOperation),
  successFor(localComputerResumeOperation),
  successFor(localComputerStopOperation),
  z.strictObject({
    type: z.literal("cloud_tool.result"),
    id: uuidSchema,
    operation: desktopCloudToolOperationSchema,
    ok: z.literal(false),
    error_code: desktopCloudToolErrorCodeSchema,
  }),
]);
export type DesktopCloudToolResult = z.infer<typeof desktopCloudToolResultSchema>;
export type DesktopCloudToolSuccessResult<O extends DesktopCloudToolOperation> =
  Extract<DesktopCloudToolResult, { ok: true; operation: O }>;

export const desktopCloudToolCancelSchema = z.strictObject({
  type: z.literal("cloud_tool.cancel"),
  id: uuidSchema,
  operation: desktopCloudToolOperationSchema,
});
export type DesktopCloudToolCancel = z.infer<typeof desktopCloudToolCancelSchema>;
