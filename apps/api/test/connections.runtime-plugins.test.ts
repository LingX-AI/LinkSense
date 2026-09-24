import { describe, expect, it, vi } from "vitest";
import {
  microsoftFilesPlugin,
  type ConnectionProvider,
} from "@linksense/shared";
import { ConnectionRuntimePlugins } from "../src/modules/connections/runtime-plugins.js";

const owner = "00000000-0000-4000-8000-000000000001";

describe("official connection packages", () => {
  it.each<ConnectionProvider[]>([
    [],
    ["onedrive"],
    ["sharepoint"],
    ["onedrive", "sharepoint"],
  ])(
    "publishes a single trusted package for providers %j without exposing account credentials",
    async (...providers) => {
      const repository = {
        listAvailableProviders: vi.fn(async () => providers),
      };
      const runtime = new ConnectionRuntimePlugins(repository);
      const result = await runtime.resolve(owner);
      expect(repository.listAvailableProviders).toHaveBeenCalledWith(owner);
      expect(result).toHaveLength(providers.length ? 1 : 0);
      if (providers.length) {
        expect(result[0]).toMatchObject({
          id: microsoftFilesPlugin.id,
          name: microsoftFilesPlugin.name,
          type: "plugin",
          revision: microsoftFilesPlugin.revision,
          sourceType: "local",
          sourceOwnerId: owner,
        });
        expect(result[0]).not.toHaveProperty("credentialEnvironment");
      }
    },
  );
});

it("publishes separate trusted packages only for connected workspace providers", async () => {
  const repository = {
    listAvailableProviders: vi.fn(async (): Promise<ConnectionProvider[]> => [
      "gmail",
      "google_docs",
      "outlook",
    ]),
  };
  const result = await new ConnectionRuntimePlugins(repository).resolve(owner);
  expect(result.map((plugin) => plugin.name)).toEqual([
    "linksense-google-docs",
    "linksense-gmail",
    "linksense-outlook",
  ]);
  for (const plugin of result) {
    expect(plugin).toMatchObject({
      sourceOwnerId: owner,
      type: "plugin",
      sourceType: "local",
    });
    expect(plugin).not.toHaveProperty("credentialEnvironment");
  }
});
