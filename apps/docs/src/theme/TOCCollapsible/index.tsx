import { useEffect, useId, useRef } from "react"
import { useLocation } from "@docusaurus/router"
import Translate from "@docusaurus/Translate"
import useDocusaurusContext from "@docusaurus/useDocusaurusContext"
import OriginalTOCCollapsible from "@theme-original/TOCCollapsible"
import TOCItems from "@theme/TOCItems"
import type { Props } from "@theme/TOCCollapsible"

function WebsiteMobileTOC({ className, ...props }: Props) {
  const { pathname } = useLocation()
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
  const labelId = useId()

  useEffect(() => {
    function dismissOutside(event: PointerEvent) {
      const details = detailsRef.current
      if (
        details?.open &&
        event.target instanceof Node &&
        !details.contains(event.target)
      ) {
        details.open = false
      }
    }

    document.addEventListener("pointerdown", dismissOutside)
    return () => document.removeEventListener("pointerdown", dismissOutside)
  }, [])

  return (
    <details
      key={pathname}
      ref={detailsRef}
      className={`${className ?? ""} website-mobile-toc`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.currentTarget.open) {
          event.stopPropagation()
          event.currentTarget.open = false
          summaryRef.current?.focus({ preventScroll: true })
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          event.currentTarget.open = false
        }
      }}
    >
      <summary id={labelId} ref={summaryRef}>
        <Translate id="theme.TOCCollapsible.toggleButtonLabel">
          On this page
        </Translate>
      </summary>
      <nav
        aria-labelledby={labelId}
        className="website-mobile-toc-panel"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("a") &&
            detailsRef.current
          ) {
            summaryRef.current?.focus({ preventScroll: true })
            detailsRef.current.open = false
          }
        }}
      >
        <TOCItems {...props} />
      </nav>
    </details>
  )
}

export default function TOCCollapsible(props: Props) {
  const { siteConfig } = useDocusaurusContext()
  return siteConfig.customFields?.publicDocs ? (
    <WebsiteMobileTOC {...props} />
  ) : (
    <OriginalTOCCollapsible {...props} />
  )
}
