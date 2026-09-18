import { describe, expect, it } from "vitest";
import { installedApplicationBaselineSchema } from "../src/modules/applications/installation-merge.js";
import { mapCopyResourceBindings } from "../src/modules/applications/installation-service.js";

const baseline = { name: "Reports", instructions: "Summarize reports.", model: null, reasoningEffort: null };

describe("manual application updates", () => {
  it("keeps the user's resource identities when the source reorders them", () => {
    expect(mapCopyResourceBindings(["source-a", "source-b"], ["own-a", "own-b"], ["source-b", "source-a"])).toEqual(["own-b", "own-a"]);
  });

  it("removes obsolete app bindings and uses newly configured user resources", () => {
    expect(mapCopyResourceBindings(["source-a", "source-b"], ["own-a", "own-b", "own-c"], ["source-a", "source-c"])).toEqual(["own-a", "own-c"]);
  });

  it("rejects missing new resources before modifying the existing installation", () => {
    const current = ["own-a"];
    expect(() => mapCopyResourceBindings(["source-a"], current, ["source-a", "source-b"])).toThrow("APPLICATION_DEPENDENCY_UNAVAILABLE");
    expect(current).toEqual(["own-a"]);
  });

  it("removes the application's selection without deleting the user's resource", () => {
    const current = ["own-a"];
    expect(mapCopyResourceBindings(["source-a"], current, [])).toEqual([]);
    expect(current).toEqual(["own-a"]);
  });

  it("validates persisted installation state and rejects credentials or malformed capability identities", () => {
    const valid = { ...baseline, interactivePackageId: null, capabilities: [], requiredKnowledgeBases: 0, requiredMcpServers: 0 };
    expect(installedApplicationBaselineSchema.safeParse(valid).success).toBe(true);
    expect(installedApplicationBaselineSchema.safeParse({ ...valid, token: "secret" }).success).toBe(false);
    expect(installedApplicationBaselineSchema.safeParse({ ...valid, capabilities: [{ sourceId: "invalid" }] }).success).toBe(false);
  });
});
