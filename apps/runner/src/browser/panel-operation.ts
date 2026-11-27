import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  browserPanelFrameSchema,
  browserPanelRequestSchema,
  browserPanelStateSchema,
  type BrowserPanelInput,
  type BrowserPanelRequest,
  type BrowserPanelState,
} from "@linksense/shared";
import {
  browserControlLeaseMs,
  BrowserPanelError,
  readBrowserControl,
  writeBrowserControl,
} from "./session-control.js";

const execFileAsync = promisify(execFile);

export function browserPanelScript(input?: BrowserPanelInput): string {
  let action = "";
  if (input?.type === "click")
    action = `await page.mouse.click(size.width * ${input.x}, size.height * ${input.y});`;
  if (input?.type === "wheel")
    action = `await page.mouse.wheel(${input.delta_x}, ${input.delta_y});`;
  if (input?.type === "text")
    action = `await page.keyboard.insertText(${JSON.stringify(input.text)});`;
  if (input?.type === "key")
    action = `await page.keyboard.press(${JSON.stringify(input.key)});`;
  return `async page => { const size = page.viewportSize(); if (!size) throw new Error('viewport unavailable'); ${action} const image = await page.screenshot({type:'jpeg',quality:50,timeout:5000}); if (image.length > 2000000) throw new Error('frame too large'); return {image:image.toString('base64'),url:page.url().slice(0,4096),title:(await page.title()).slice(0,500),width:size.width,height:size.height}; }`;
}

export function parseBrowserPanelOutput(
  output: string,
): BrowserPanelState["frame"] {
  const result = /^### Result\r?\n([\s\S]*?)(?=\r?\n### |$)/mu.exec(
    output,
  )?.[1];
  if (!result) throw new BrowserPanelError("BROWSER_PANEL_UNAVAILABLE");
  const frame = browserPanelFrameSchema.parse(JSON.parse(result));
  const url = new URL(frame.url);
  url.username = "";
  url.password = "";
  return {
    ...frame,
    url: url.protocol === "data:" ? "about:blank" : url.href.slice(0, 4_096),
  };
}

export async function executeBrowserPanelOperation(
  context: {
    directory: string;
    cliEntry: string;
    sessionName: string;
    environment: NodeJS.ProcessEnv;
    cwd: string;
    run?: (script: string) => Promise<BrowserPanelState["frame"]>;
    now?: () => number;
  },
  request: BrowserPanelRequest,
): Promise<BrowserPanelState> {
  const input = browserPanelRequestSchema.parse(request);
  const now = context.now?.() ?? Date.now();
  let lease = await readBrowserControl(context.directory);
  const active = lease !== null && lease.expiresAt > now;
  if (input.action === "claim") {
    if (active && lease?.token !== input.token)
      throw new BrowserPanelError("BROWSER_CONTROL_REQUIRED");
    lease = { token: input.token, expiresAt: now + browserControlLeaseMs };
  } else if (input.action === "release") {
    if (lease?.token !== input.token)
      throw new BrowserPanelError("BROWSER_CONTROL_REQUIRED");
    lease = { token: input.token, expiresAt: 0, retainUntil: now + 60_000 };
    await writeBrowserControl(context.directory, lease);
  } else if (input.action === "input") {
    if (!active || lease?.token !== input.token)
      throw new BrowserPanelError("BROWSER_CONTROL_REQUIRED");
    lease = { token: input.token, expiresAt: now + browserControlLeaseMs };
  }
  const script = browserPanelScript(
    input.action === "input" ? input.input : undefined,
  );
  const frame = context.run
    ? await context.run(script)
    : parseBrowserPanelOutput(
        (
          await execFileAsync(
            process.execPath,
            [context.cliEntry, `-s=${context.sessionName}`, "run-code", script],
            {
              cwd: context.cwd,
              env: context.environment,
              timeout: 10_000,
              maxBuffer: 3_000_000,
            },
          )
        ).stdout,
      );
  if (lease && input.action !== "frame")
    await writeBrowserControl(context.directory, lease);
  return browserPanelStateSchema.parse({
    mode: lease && lease.expiresAt > now ? "human" : "agent",
    has_control: Boolean(
      lease && lease.expiresAt > now && lease.token === input.token,
    ),
    lease_expires_at:
      lease && lease.expiresAt > now
        ? new Date(lease.expiresAt).toISOString()
        : null,
    frame,
  });
}
