import { useState } from "react"
import type { ModelProviderSettings } from "@/api/contracts"
import { ModelProviderSettingsForm } from "./model-provider-settings-form"

export function ModelProviderSettingsFormHarness({
  settings,
}: {
  settings: ModelProviderSettings
}) {
  const [selectedChannelId, setSelectedChannelId] = useState("")
  return (
    <ModelProviderSettingsForm
      settings={settings}
      selectedChannelId={selectedChannelId}
      onSelectedChannelChange={setSelectedChannelId}
    />
  )
}
