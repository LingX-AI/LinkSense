import { describe, expect, it } from "vitest";
import { conversationSourcesSchema } from "../src/conversation-sources.js";

describe("conversation sources contract", () => {
  it("validates a lightweight summary and nullable titles", () => {
    const summary = { items: [{ url: "https://example.test/guide", title: null }] };
    expect(conversationSourcesSchema.parse(summary)).toEqual(summary);
  });
  it.each(["javascript:alert(1)", "file:///tmp/private", "https://user:secret@example.test", "/relative"])("rejects unsafe source %s", (url) => {
    expect(conversationSourcesSchema.safeParse({ items: [{ url, title: null }] }).success).toBe(false);
  });
  it("rejects unexpected message bodies at the response boundary", () => {
    expect(conversationSourcesSchema.safeParse({ items: [{ url: "https://example.test", title: null, content: "private body" }] }).success).toBe(false);
  });
});
