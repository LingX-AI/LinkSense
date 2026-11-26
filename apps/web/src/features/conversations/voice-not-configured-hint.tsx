import { Trans } from "react-i18next"
import { Link } from "react-router-dom"

export function VoiceNotConfiguredHint() {
  return (
    <Trans
      i18nKey="conversation.voiceNotConfiguredHint"
      components={{
        configure: (
          <Link
            to="/admin/models?tab=voiceTranscription"
            className="text-link-foreground underline-offset-4 hover:underline"
          />
        ),
      }}
    />
  )
}