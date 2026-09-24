import { fileURLToPath } from "node:url";
import {
  microsoftFilesPlugin,
  googleDocsPlugin,
  gmailPlugin,
  outlookPlugin,
  type ConnectionProvider,
} from "@linksense/shared";
import type { ExecutionCapability } from "../conversations/service.js";
import type { PrismaConnectionRepository } from "./repository.js";
import manifest from "./plugins/linksense-microsoft-files/.codex-plugin/plugin.json" with { type: "json" };
import mcp from "./plugins/linksense-microsoft-files/.mcp.json" with { type: "json" };

import googleDocsManifest from "./plugins/linksense-google-docs/.codex-plugin/plugin.json" with { type: "json" };
import googleDocsMcp from "./plugins/linksense-google-docs/.mcp.json" with { type: "json" };
import gmailManifest from "./plugins/linksense-gmail/.codex-plugin/plugin.json" with { type: "json" };
import gmailMcp from "./plugins/linksense-gmail/.mcp.json" with { type: "json" };
import outlookManifest from "./plugins/linksense-outlook/.codex-plugin/plugin.json" with { type: "json" };
import outlookMcp from "./plugins/linksense-outlook/.mcp.json" with { type: "json" };

// Import both manifests so TypeScript emits the complete package in API builds.
// Only the trusted package is published, never a user-provided directory.
const packages = [
  {
    definition: microsoftFilesPlugin,
    manifest,
    mcp,
    sourcePath: fileURLToPath(
      new URL("./plugins/linksense-microsoft-files/", import.meta.url),
    ),
  },
  {
    definition: googleDocsPlugin,
    manifest: googleDocsManifest,
    mcp: googleDocsMcp,
    sourcePath: fileURLToPath(
      new URL("./plugins/linksense-google-docs/", import.meta.url),
    ),
  },
  {
    definition: gmailPlugin,
    manifest: gmailManifest,
    mcp: gmailMcp,
    sourcePath: fileURLToPath(
      new URL("./plugins/linksense-gmail/", import.meta.url),
    ),
  },
  {
    definition: outlookPlugin,
    manifest: outlookManifest,
    mcp: outlookMcp,
    sourcePath: fileURLToPath(
      new URL("./plugins/linksense-outlook/", import.meta.url),
    ),
  },
];

export class ConnectionRuntimePlugins {
  constructor(
    private readonly repository: Pick<
      PrismaConnectionRepository,
      "listAvailableProviders"
    >,
  ) {}

  async resolve(ownerId: string): Promise<ExecutionCapability[]> {
    const providers = new Set<ConnectionProvider>(
      await this.repository.listAvailableProviders(ownerId),
    );
    return packages.flatMap(
      ({ definition, manifest: plugin, mcp: servers, sourcePath }) => {
        if (!definition.providers.some((provider) => providers.has(provider)))
          return [];
        if (
          plugin.name !== definition.name ||
          Object.keys(servers.mcpServers).length === 0
        )
          throw new Error("official connection package is invalid");
        return [
          {
            id: definition.id,
            name: definition.name,
            type: "plugin" as const,
            revision: definition.revision,
            description: plugin.description,
            sourceType: "local",
            sourceOwnerId: ownerId,
            sourcePath,
          },
        ];
      },
    );
  }
}
