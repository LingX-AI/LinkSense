import { officialConnectionPluginFor } from "@linksense/shared";
import { NATIVE_PLUGIN_MARKETPLACE_NAME } from "./native-plugin-manager.js";

type Capability = { id: string; name: string; type: string };

export function activePluginNames(capabilities: readonly Capability[], mode: "default" | "plan"): string[] {
  return capabilities.filter((capability) => capability.type === "plugin" &&
    (mode === "default" || officialConnectionPluginFor(capability)?.supportsPlanMode === true))
    .map((capability) => capability.name);
}

export function connectionPluginConfigOverrides(capabilities: readonly Capability[], mode: "default" | "plan"): string[] {
  if (mode === "default") return [];
  const allowed = new Set(activePluginNames(capabilities, mode));
  if (allowed.size === 0) return ["features.plugins=false"];
  // Codex -c splits dotted paths literally; TOML quotes would become part of
  // the plugin key. Capability names are validated slug identifiers upstream.
  return [
    "features.plugins=true",
    ...capabilities.filter((capability) => capability.type === "plugin").map((capability) =>
      `plugins.${capability.name}@${NATIVE_PLUGIN_MARKETPLACE_NAME}.enabled=${allowed.has(capability.name)}`),
  ];
}
