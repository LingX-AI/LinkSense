import { Component, lazy, Suspense, useMemo, type ReactNode } from "react"
import { parseRichOutput, richOutputText } from "@linksense/shared"
import { useTranslation } from "react-i18next"

const Renderer = lazy(() => import("./assistant-rich-output-renderer"))

class RichOutputBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export default function AssistantRichOutput({
  source,
  streaming = false,
  textOnly = false,
  renderCitation,
}: {
  source: string
  streaming?: boolean
  textOnly?: boolean
  renderCitation?: (number: number) => ReactNode
}) {
  const { t } = useTranslation()
  const output = useMemo(
    () => (streaming ? null : parseRichOutput(source)),
    [source, streaming]
  )
  const pending = (
    <p
      role="status"
      className="my-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground"
    >
      {t("richOutput.loading")}
    </p>
  )
  if (streaming) return pending

  const unavailable = (
    <p
      role="status"
      className="my-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground"
    >
      {t("richOutput.invalid")}
    </p>
  )
  if (!output) return unavailable

  const text = (
    <div className="text-sm wrap-anywhere whitespace-pre-wrap">
      {richOutputText(output)}
    </div>
  )
  if (textOnly) return text

  return (
    <RichOutputBoundary
      key={source}
      fallback={
        <>
          {unavailable}
          {text}
        </>
      }
    >
      <Suspense fallback={pending}>
        <Renderer output={output} renderCitation={renderCitation} />
      </Suspense>
    </RichOutputBoundary>
  )
}
