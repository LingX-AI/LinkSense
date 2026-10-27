import { expect, it } from "vitest";
import {
  localBrowserRequestSchema,
  localBrowserReadOnly,
  localBrowserPairExchangeSchema,
  localBrowserPairResponseSchema,
  localBrowserPreviewSchema,
  browserUseIntentSchema,
  browserUseIntentRequestSchema,
} from "../src/local-browser.js";
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
      localBrowserRequestSchema.safeParse({ action: "open", url }).success,
    ).toBe(false);
  expect(
    localBrowserRequestSchema.safeParse({
      action: "evaluate",
      code: "document.cookie",
    }).success,
  ).toBe(false);
  expect(
    localBrowserRequestSchema.safeParse({
      action: "click_at",
      tab_id: 1,
      x: -1,
      y: 2,
    }).success,
  ).toBe(false);
  expect(
    localBrowserRequestSchema.safeParse({
      action: "type",
      tab_id: 1,
      text: "x".repeat(8001),
    }).success,
  ).toBe(false);
  expect(
    localBrowserReadOnly({ action: "open", url: "https://example.test" }),
  ).toBe(false);
  expect(localBrowserReadOnly({ action: "snapshot", tab_id: 1 })).toBe(true);
});
it("keeps existing pairing messages usable and validates optional automatic-renewal metadata", () => {
  const code = "p".repeat(43);
  const token = "t".repeat(43);
  expect(localBrowserPairExchangeSchema.parse({ code })).toEqual({ code });
  expect(localBrowserPairResponseSchema.parse({ token })).toEqual({ token });
  expect(localBrowserPairExchangeSchema.safeParse({ code, approval_id: "invalid" }).success).toBe(false);
  expect(localBrowserPairResponseSchema.safeParse({ token, owner_id: "invalid" }).success).toBe(false);
});
it("bounds thumbnail data and rejects private-file URLs before displaying a browser preview", () => {
  const preview = { tab_id: 7, title: "Page", url: "https://example.test/", image: "AQID", captured_at: 1 };
  expect(localBrowserPreviewSchema.parse(preview)).toEqual(preview);
  expect(localBrowserPreviewSchema.safeParse({ ...preview, url: "file:///private" }).success).toBe(false);
  expect(localBrowserPreviewSchema.safeParse({ ...preview, image: "x".repeat(600001) }).success).toBe(false);
});
