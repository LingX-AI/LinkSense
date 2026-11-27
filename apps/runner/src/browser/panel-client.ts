import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  browserPanelErrorCodes,
  browserPanelRequestSchema,
  browserPanelStateSchema,
  type BrowserPanelRequest,
  type BrowserPanelState,
} from "@linksense/shared";
import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js";
import { BrowserPanelError } from "./session-control.js";

export async function runBrowserPanel(input: {
  conversationId: string;
  home: string;
  codexHome: string;
  workspace: string;
  readOnly: boolean;
  request: BrowserPanelRequest;
  identity?: ProcessIdentity;
}): Promise<BrowserPanelState> {
  const request = browserPanelRequestSchema.parse(input.request);
  const compiled = fileURLToPath(new URL("./panel-cli.js", import.meta.url));
  const args = existsSync(compiled)
    ? [compiled]
    : [
        "--import",
        "tsx",
        fileURLToPath(new URL("./panel-cli.ts", import.meta.url)),
      ];
  const invocation = isolatedChildInvocation(
    process.execPath,
    args,
    input.identity,
  );
  const source = await new Promise<string>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: input.workspace,
      env: {
        HOME: input.home,
        CODEX_HOME: input.codexHome,
        LINKSENSE_CONVERSATION_ID: input.conversationId,
        LINKSENSE_WORKSPACE_PATH: input.workspace,
        LINKSENSE_BROWSER_READ_ONLY: input.readOnly ? "1" : "0",
        PATH: process.env.PATH,
        LANG: process.env.LANG,
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      if (output.length > 3_000_000) child.kill("SIGKILL");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolve(output);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(request));
  });
  let response: unknown;
  try {
    response = JSON.parse(source);
  } catch {
    throw new BrowserPanelError("BROWSER_PANEL_UNAVAILABLE");
  }
  const failure = z
    .object({ error_code: z.enum(browserPanelErrorCodes) })
    .safeParse(response);
  if (failure.success) throw new BrowserPanelError(failure.data.error_code);
  return browserPanelStateSchema.parse(response);
}
