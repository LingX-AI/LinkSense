import { describe, expect, it } from "vitest";
import { projectInputSchema, projectSchema, projectIconSchema, projectColorSchema } from "../src/index.js";

describe("project appearance contract", () => {
  it("provides twelve unique built-in colors including the four additional shades", () => {
    expect(new Set(projectColorSchema.options).size).toBe(12);
    expect(projectColorSchema.options).toEqual(expect.arrayContaining(["teal", "cyan", "brown", "gray"]));
  });
  it("accepts every supported icon and color and trims the project name", () => {
    for (const icon of projectIconSchema.options) {
      for (const color of projectColorSchema.options) {
        expect(projectInputSchema.parse({ name: " Project ", icon, color })).toEqual({ name: "Project", icon, color });
      }
    }
  });
  it.each([{ icon: "<svg>" }, { icon: "https://example.test/icon.svg" }, { color: "#ffffff" }, { icon: null }, { color: null }, { owner_id: "another-owner" }])("rejects unsupported appearance or ownership input: %j", fields => {
    expect(projectInputSchema.safeParse({ name: "Project", ...fields }).success).toBe(false);
  });
  it("allows a name-only update without resetting the stored appearance", () => {
    expect(projectInputSchema.parse({ name: "Updated" })).toEqual({ name: "Updated" });
  });
  it("requires the API to return persisted appearance fields", () => {
    const project = { id: "80000000-0000-4000-8000-000000000001", name: "Project", created_at: "2026-09-17T00:00:00.000Z", updated_at: "2026-09-17T00:00:00.000Z" };
    expect(projectSchema.safeParse(project).success).toBe(false);
    expect(projectSchema.parse({ ...project, icon: "folder", color: "default" })).toMatchObject({ icon: "folder", color: "default" });
  });
});
