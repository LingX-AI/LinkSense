// Compatibility entrypoint for installed consumers; new code uses browser-use.
import {
  browserUseHelpPath,
  browserUseLegacyResult,
  browserUseReplySchema,
  browserUseResultSchema,
  legacyLocalBrowserFailureCodes,
} from "./browser-use.js";
import type { z } from "zod";

export {
  browserUseToolName,
  legacyLocalBrowserToolName,
  browserUseIntentRequestSchema,
  browserUseIntentSchema,
  browserUseHelpPath as localBrowserHelpPath,
  browserUseUrlSchema as localBrowserUrlSchema,
  browserUseKeySchema as localBrowserKeySchema,
  browserUseRequestSchema as localBrowserRequestSchema,
  browserUseReadOnly as localBrowserReadOnly,
  browserUseDataSchema as localBrowserDataSchema,
  browserUseCommandSchema as localBrowserCommandSchema,
  browserUseStatusSchema as localBrowserStatusSchema,
  browserUsePairingSchema as localBrowserPairingSchema,
  browserUsePairExchangeSchema as localBrowserPairExchangeSchema,
  browserUsePairResponseSchema as localBrowserPairResponseSchema,
  browserUsePreviewSchema as localBrowserPreviewSchema,
} from "./browser-use.js";
export type {
  BrowserUseRequest as LocalBrowserRequest,
  BrowserUseCommand as LocalBrowserCommand,
} from "./browser-use.js";

export const localBrowserFailureCodes = legacyLocalBrowserFailureCodes;
export const localBrowserResultSchema = browserUseResultSchema.transform(browserUseLegacyResult);
export type LocalBrowserResult = z.infer<typeof localBrowserResultSchema>;
export const localBrowserReplySchema = browserUseReplySchema.extend({ result: localBrowserResultSchema });
export function localBrowserFailure(code: (typeof localBrowserFailureCodes)[number]): LocalBrowserResult {
  return localBrowserResultSchema.parse({
    ok: false, code, retryable: false, help_path: browserUseHelpPath,
  });
}
