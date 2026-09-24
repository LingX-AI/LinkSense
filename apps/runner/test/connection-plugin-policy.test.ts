import { describe, expect, it } from "vitest";
import { microsoftFilesPlugin } from "@linksense/shared";
import { activePluginNames, connectionPluginConfigOverrides } from "../src/codex/connection-plugin-policy.js";

const official = { ...microsoftFilesPlugin, type: "plugin" };
const personal = { id: "personal", name: "personal", type: "plugin" };
describe("connection plugin activation", () => {
  it("keeps all enabled plugins in default mode and only trusted read-filtering packages in Plan", () => {
    expect(activePluginNames([official, personal], "default")).toEqual([official.name, personal.name]);
    expect(activePluginNames([official, personal], "plan")).toEqual([official.name]);
    expect(connectionPluginConfigOverrides([official, personal], "plan")).toEqual([
      "features.plugins=true",
      'plugins.linksense-microsoft-files@linksense-personal.enabled=true',
      'plugins.personal@linksense-personal.enabled=false',
    ]);
    expect(connectionPluginConfigOverrides([personal], "plan")).toEqual(["features.plugins=false"]);
  });
  it("does not admit user plugins with only an official name or id to Plan", () => {
    expect(activePluginNames([{ ...personal, name: official.name }, { ...personal, id: official.id }], "plan")).toEqual([]);
  });
});
