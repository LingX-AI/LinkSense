import { browserPanelRequestSchema } from "@linksense/shared";
import { browserCliMain } from "./cli-wrapper.js";
import { BrowserPanelError } from "./session-control.js";

async function main(): Promise<void> {
  let source = "";
  for await (const chunk of process.stdin) {
    source += String(chunk);
    if (source.length > 24_000) throw new Error("input too large");
  }
  const request = browserPanelRequestSchema.parse(JSON.parse(source));
  await browserCliMain(["snapshot"], process.env, process.cwd(), {
    panelOperation: request,
  });
}
void main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      error_code:
        error instanceof BrowserPanelError
          ? error.code
          : "BROWSER_PANEL_UNAVAILABLE",
    }),
  );
  process.exitCode = 1;
});
