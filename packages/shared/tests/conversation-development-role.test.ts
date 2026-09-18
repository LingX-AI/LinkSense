import { describe, expect, it } from "vitest";
import { conversationSchema } from "../src/conversations.js";

describe("conversation application development metadata", () => {
  const metadata = conversationSchema.pick({ application_development_role: true });
  it.each(["development", "preview", null])("accepts a %s task role without changing task lifecycle fields", (role) => {
    expect(metadata.parse({ application_development_role: role })).toEqual({ application_development_role: role });
  });
  it("rejects unknown role values", () => {
    expect(metadata.safeParse({ application_development_role: "installed" }).success).toBe(false);
  });
});
