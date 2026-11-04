import Translate from "@docusaurus/Translate"
import { useLocation } from "@docusaurus/router"
import TOCItems from "@theme/TOCItems"
import type { Props } from "@theme/TOC"
import { useEffect, useRef } from "react"

const activeClass = "table-of-contents__link--active"

export default function TOC({ className, ...props }: Props) {
  const nav = useRef<HTMLElement>(null)
  const { pathname } = useLocation()

  useEffect(() => {
    const list = nav.current?.querySelector<HTMLElement>(".table-of-contents")
    if (!list) return

    let active: HTMLElement | null = null
    const sync = () => {
      const next = list.querySelector<HTMLElement>(`.${activeClass}`)
      if (next !== active) {
        active?.removeAttribute("aria-current")
        active = next
        active?.setAttribute("aria-current", "location")
      }
      if (!next) {
        list.style.removeProperty("--linksense-toc-marker-size")
        list.style.removeProperty("--linksense-toc-marker-arm")
        return
      }
      const row = next.getBoundingClientRect()
      const rail = list.getBoundingClientRect()
      list.style.setProperty(
        "--linksense-toc-marker-offset",
        `${row.top - rail.top + 4}px`,
      )
      list.style.setProperty(
        "--linksense-toc-marker-size",
        `${Math.max(0, row.height - 8)}px`,
      )
      list.style.setProperty(
        "--linksense-toc-marker-arm",
        `${Math.max(6, row.left - rail.left - 2)}px`,
      )
    }

    const changes = new MutationObserver(sync)
    changes.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    })
    const resize = new ResizeObserver(sync)
    resize.observe(list)
    sync()
    return () => {
      changes.disconnect()
      resize.disconnect()
    }
  }, [pathname])

  return (
    <nav
      ref={nav}
      className={`linksense-toc thin-scrollbar ${className ?? ""}`}
      aria-labelledby="linksense-toc-title"
    >
      <p id="linksense-toc-title" className="linksense-toc-title">
        <Translate id="theme.TOCCollapsible.toggleButtonLabel">
          On this page
        </Translate>
      </p>
      <TOCItems
        {...props}
        linkClassName="table-of-contents__link toc-highlight"
        linkActiveClassName={activeClass}
      />
    </nav>
  )
}
