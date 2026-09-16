import { describe, expect, it } from "vitest";
import { installedApplicationBaselineSchema, mergeInstalledApplication } from "../src/modules/applications/installation-merge.js";

const baseline = { name: "Reports", instructions: "Summarize reports.", model: null, reasoningEffort: null };

describe("manual application updates", () => {
  it("adopts upstream changes for untouched fields", () => {
    const incoming = { ...baseline, instructions: "Summarize with citations." };
    expect(mergeInstalledApplication(baseline, baseline, incoming)).toEqual({ values: incoming, preserved: [] });
  });

  it("preserves local names and instructions while applying other upstream changes", () => {
    const current = { ...baseline, name: "My reports", instructions: "Use our report format." };
    const incoming = { ...baseline, instructions: "Summarize with citations.", model: "gpt-5.6-terra", reasoningEffort: "medium" as const };
    expect(mergeInstalledApplication(current, baseline, incoming)).toEqual({
      values: { ...incoming, name: current.name, instructions: current.instructions }, preserved: ["name", "instructions"],
    });
  });

  it("preserves the user's entire model selection when upstream chooses a different one", () => {
    const current = { ...baseline, model: "gpt-5.6-terra", reasoningEffort: "high" as const };
    const incoming = { ...baseline, model: "gpt-5.5", reasoningEffort: "low" as const };
    expect(mergeInstalledApplication(current, baseline, incoming)).toEqual({ values: current, preserved: ["model", "reasoning_effort"] });
  });

  it("does not report a conflict when the user already made the upstream change", () => {
    const current = { ...baseline, instructions: "Updated instructions" };
    expect(mergeInstalledApplication(current, baseline, current).preserved).toEqual([]);
  });

  it("validates persisted installation state and rejects credentials or malformed capability identities", () => {
    const valid = { ...baseline, interactivePackageId: null, capabilities: [], requiredKnowledgeBases: 0, requiredMcpServers: 0 };
    expect(installedApplicationBaselineSchema.safeParse(valid).success).toBe(true);
    expect(installedApplicationBaselineSchema.safeParse({ ...valid, token: "secret" }).success).toBe(false);
    expect(installedApplicationBaselineSchema.safeParse({ ...valid, capabilities: [{ sourceId: "invalid" }] }).success).toBe(false);
  });
});
