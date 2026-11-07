import { expect, it } from "vitest";
import * as browserUse from "@linksense/shared/browser-use";
import {
  browserUseRequestSchema,
  browserUseReadOnly,
  browserUsePairExchangeSchema,
  browserUsePairResponseSchema,
  browserUsePreviewSchema,
  browserUseIntentSchema,
  browserUseIntentRequestSchema,
} from "../src/browser-use.js";
it("exports browser contracts through the canonical browser-use module", () => {
  expect(browserUse.browserUseRequestSchema).toBe(browserUseRequestSchema);
  expect(browserUse.browserUseToolName).toBe("browser_use");
});
it("accepts only a boolean intent result and a persisted message identifier", () => {
  expect(browserUseIntentSchema.parse(true)).toBe(true);
  expect(browserUseIntentSchema.parse(false)).toBe(false);
  expect(browserUseIntentSchema.safeParse("true").success).toBe(false);
  expect(browserUseIntentRequestSchema.safeParse({ message_id: "invalid" }).success).toBe(false);
});
it("accepts bounded browser actions and rejects arbitrary execution, credentials and local files", () => {
  for (const url of [
    "file:///tmp/private",
    "javascript:alert(1)",
    "https://user:secret@example.test",
  ])
    expect(
      browserUseRequestSchema.safeParse({ action: "open", url }).success,
    ).toBe(false);
  expect(
    browserUseRequestSchema.safeParse({
      action: "evaluate",
      code: "document.cookie",
    }).success,
  ).toBe(false);
  expect(
    browserUseRequestSchema.safeParse({
      action: "click_at",
      tab_id: 1,
      x: -1,
      y: 2,
    }).success,
  ).toBe(false);
  expect(
    browserUseRequestSchema.safeParse({
      action: "type",
      tab_id: 1,
      text: "x".repeat(8001),
    }).success,
  ).toBe(false);
  expect(
    browserUseReadOnly({ action: "open", url: "https://example.test" }),
  ).toBe(false);
  expect(browserUseReadOnly({ action: "snapshot", tab_id: 1 })).toBe(true);
});
it("keeps existing pairing messages usable and validates optional automatic-renewal metadata", () => {
  const code = "p".repeat(43);
  const token = "t".repeat(43);
  expect(browserUsePairExchangeSchema.parse({ code })).toEqual({ code });
  expect(browserUsePairResponseSchema.parse({ token })).toEqual({ token });
  expect(browserUsePairExchangeSchema.safeParse({ code, approval_id: "invalid" }).success).toBe(false);
  expect(browserUsePairResponseSchema.safeParse({ token, owner_id: "invalid" }).success).toBe(false);
});
it("bounds thumbnail data and rejects private-file URLs before displaying a browser preview", () => {
  const preview = { tab_id: 7, title: "Page", url: "https://example.test/", image: "AQID", captured_at: 1 };
  expect(browserUsePreviewSchema.parse(preview)).toEqual(preview);
  expect(browserUsePreviewSchema.safeParse({ ...preview, url: "file:///private" }).success).toBe(false);
  expect(browserUsePreviewSchema.safeParse({ ...preview, image: "x".repeat(600001) }).success).toBe(false);
});
