import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react"

export const OFFICE_PREVIEW_ENTER_CLASS = "office-preview-pane-entering"

function OfficePreviewSuspenseFallback({
  children,
  onPresented,
}: Readonly<{
  children: ReactNode
  onPresented: () => void
}>) {
  useEffect(() => {
    onPresented()
  }, [onPresented])

  return children
}

export function OfficePreviewSuspenseBoundary({
  children,
  fallback,
}: Readonly<{
  children: (paneClassName: string | undefined) => ReactNode
  fallback: (paneClassName: string) => ReactNode
}>) {
  const [fallbackPresented, setFallbackPresented] = useState(false)
  const markFallbackPresented = useCallback(() => {
    setFallbackPresented(true)
  }, [])

  return (
    <Suspense
      fallback={
        <OfficePreviewSuspenseFallback onPresented={markFallbackPresented}>
          {fallback(OFFICE_PREVIEW_ENTER_CLASS)}
        </OfficePreviewSuspenseFallback>
      }
    >
      {children(fallbackPresented ? undefined : OFFICE_PREVIEW_ENTER_CLASS)}
    </Suspense>
  )
}
