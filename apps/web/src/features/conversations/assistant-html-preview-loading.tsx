import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { AssistantWaitingSnake } from "@/features/conversations/assistant-waiting-snake"
import { cn } from "@/lib/utils"

export function AssistantHtmlPreviewLoading({
  label,
  className,
}: Readonly<{
  label: string
  className?: string
}>) {
  const { t } = useTranslation()
  const [playing, setPlaying] = useState(false)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const exitGame = () => {
    setPlaying(false)
    surfaceRef.current?.focus({ preventScroll: true })
  }

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      onDoubleClick={(event) => {
        event.preventDefault()
        if (playing) exitGame()
        else setPlaying(true)
      }}
      onKeyDown={(event) => {
        if (
          !playing &&
          event.key === "Enter" &&
          !event.repeat &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          event.preventDefault()
          setPlaying(true)
        }
      }}
      className={cn(
        "assistant-html-preview-loading-surface relative min-h-80 w-full touch-manipulation overflow-hidden rounded-2xl outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
        className
      )}
      role={playing ? "group" : "status"}
      aria-label={label}
      aria-description={
        playing ? undefined : t("conversation.waitingGame.enter")
      }
      aria-busy={playing ? undefined : true}
      aria-live={playing ? undefined : "polite"}
    >
      <div className="assistant-html-preview-loading-canvas" aria-hidden="true">
        <span
          className="assistant-html-preview-loading-dots"
          aria-hidden="true"
        />
        {!playing && (
          <span
            className="assistant-html-preview-loading-glow"
            aria-hidden="true"
          />
        )}
      </div>
      {playing && (
        <>
          <span
            className="sr-only"
            role="status"
            aria-label={label}
            aria-busy="true"
          />
          <AssistantWaitingSnake onExit={exitGame} />
        </>
      )}
    </div>
  )
}
