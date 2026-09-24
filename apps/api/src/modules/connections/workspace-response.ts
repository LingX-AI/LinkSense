import { z } from "zod";
import type { WorkspaceInput, WorkspaceResult } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";

export type WorkspacePage = {
  result: WorkspaceResult;
  nextLink: string | null;
};
export interface WorkspaceAdapter {
  execute(
    token: string,
    input: WorkspaceInput,
    next?: string,
    signal?: AbortSignal,
  ): Promise<WorkspacePage>;
}
export function workspaceData(
  data: unknown,
  nextLink: string | null = null,
): WorkspacePage {
  const parsed = z.json().parse(data);
  if (Buffer.byteLength(JSON.stringify(parsed)) > 4 * 1024 * 1024)
    throw new AppError("CONNECTION_FILE_TOO_LARGE");
  return {
    result: { kind: "workspace_data", data: parsed, next_cursor: null },
    nextLink,
  };
}
export function workspaceFile(
  name: string,
  contentType: string,
  bytes: Buffer,
): WorkspacePage {
  if (bytes.length > 20 * 1024 * 1024)
    throw new AppError("CONNECTION_FILE_TOO_LARGE");
  return {
    result: {
      kind: "workspace_file",
      name,
      content_type: contentType,
      content_base64: bytes.toString("base64"),
    },
    nextLink: null,
  };
}
