export const modelProviderSettingsQueryKeys = {
  settings: ["admin", "model-provider-settings"] as const,
  discoverableModels: (providerId: string, revision: number) =>
    [
      "admin",
      "model-provider-settings",
      "providers",
      providerId,
      "discoverable-models",
      revision,
    ] as const,
}
