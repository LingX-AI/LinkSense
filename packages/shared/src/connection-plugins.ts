import type { ConnectionProvider } from "./connections.js";

// Stable runtime identities; these are product packages, not rows in the user's
// installed-capability table. Account authorization stays in user_connections.
export const microsoftFilesPlugin = {
  id: "c21d72e9-c8bc-4bc6-9e18-974aa19e7451",
  name: "linksense-microsoft-files",
  revision: "2026-09-23T00:00:00.000Z",
  providers: ["onedrive", "sharepoint"],
  supportsPlanMode: true,
} as const satisfies {
  id: string;
  name: string;
  revision: string;
  providers: readonly ConnectionProvider[];
  supportsPlanMode: boolean;
};

export const googleDocsPlugin = {
  id: "4dd47c82-2bf1-4a53-8c44-a3d902cc4f91",
  name: "linksense-google-docs",
  revision: "2026-09-24T00:00:00.000Z",
  providers: ["google_docs"],
  supportsPlanMode: true,
} as const;
export const gmailPlugin = {
  id: "c6bfe9d2-0999-40a8-9e82-b76c6f5a13e9",
  name: "linksense-gmail",
  revision: "2026-09-24T00:00:00.000Z",
  providers: ["gmail"],
  supportsPlanMode: true,
} as const;
export const outlookPlugin = {
  id: "7e692bbf-1fd5-4857-bc64-27576e379e64",
  name: "linksense-outlook",
  revision: "2026-09-24T00:00:00.000Z",
  providers: ["outlook"],
  supportsPlanMode: true,
} as const;
export const officialConnectionPlugins = [
  microsoftFilesPlugin,
  googleDocsPlugin,
  gmailPlugin,
  outlookPlugin,
] as const;

export function officialConnectionPluginFor(input: {
  id: string;
  name: string;
  type: string;
}): (typeof officialConnectionPlugins)[number] | undefined {
  return officialConnectionPlugins.find(
    (plugin) =>
      input.type === "plugin" &&
      plugin.id === input.id &&
      plugin.name === input.name,
  );
}
