import { describe, expect, it } from "vitest";
import { capabilitySnapshotSchema } from "../src/capability-snapshot.js";

const generation = "a".repeat(64);
const snapshot = {
  version: 1, id: `${generation}-11111111-1111-4111-8111-111111111111`,
  generation, contentDigest: "b".repeat(64), sourceDigest: "c".repeat(64), pluginNames: ["calendar", "documents"],
};
describe("immutable capability snapshot metadata", () => {
  it("accepts versioned content metadata without task state or credentials", () => {
    expect(capabilitySnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
  it.each([
    { id: "../../outside" }, { generation: "f".repeat(64) }, { version: 2 },
    { pluginNames: ["calendar", "calendar"] }, { pluginNames: ["../outside"] },
    { pluginNames: ["documents", "calendar"] }, { credentials: "must-not-be-published" },
  ])("rejects malformed metadata %j", (override) => {
    expect(capabilitySnapshotSchema.safeParse({ ...snapshot, ...override }).success).toBe(false);
  });
});
