import { z } from "zod";
import { type WorkspaceInput } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import { GoogleWorkspaceAdapter } from "./google-workspace.js";
import { OutlookMailAdapter } from "./outlook-mail.js";

import type { WorkspaceAdapter, WorkspacePage } from "./workspace-response.js";
export type { WorkspaceAdapter, WorkspacePage } from "./workspace-response.js";

export class WorkspaceConnections implements WorkspaceAdapter {
  constructor(
    private readonly google: WorkspaceAdapter = new GoogleWorkspaceAdapter(),
    private readonly outlook: WorkspaceAdapter = new OutlookMailAdapter(),
  ) {}
  async execute(
    token: string,
    input: WorkspaceInput,
    next?: string,
    signal?: AbortSignal,
  ): Promise<WorkspacePage> {
    try {
      return await (
        input.provider === "outlook" ? this.outlook : this.google
      ).execute(token, input, next, signal);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (signal?.aborted) throw error;
      const failure = z
        .object({
          status: z.number().optional(),
          statusCode: z.number().optional(),
          code: z.union([z.number(), z.string()]).optional(),
          response: z.object({ status: z.number() }).optional(),
        })
        .safeParse(error);
      const status = failure.success
        ? (failure.data.status ??
          failure.data.statusCode ??
          failure.data.response?.status ??
          Number(failure.data.code))
        : 0;
      if (status === 401) throw new AppError("CONNECTION_REQUIRED");
      if ([403, 404].includes(status))
        throw new AppError("CONNECTION_ACCESS_DENIED");
      if (
        [409, 412].includes(status) ||
        (status === 400 && input.operation === "edit_document")
      )
        throw new AppError("CONNECTION_FILE_CONFLICT");
      if (status === 413) throw new AppError("CONNECTION_FILE_TOO_LARGE");
      // Never expose provider response bodies, credentials, or message content.
      throw new AppError("CONNECTION_UNAVAILABLE");
    }
  }
}
