import { browserUseRequestSchema, browserUseResultSchema } from "./browser-use.js";

/** Local Chrome/Edge extension actions ride the same cloud local-tool lane. */
export const localBrowserExecuteOperation = "local_browser.execute" as const;
export const localBrowserExecuteInputSchema = browserUseRequestSchema;
export const localBrowserExecuteResultSchema = browserUseResultSchema;
export const localBrowserToolName = "browser_use" as const;
