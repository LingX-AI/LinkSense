import { useEffect, useEffectEvent, useRef, type RefObject } from "react"

import { officeAnnotationCursor } from "./office-annotation-cursor"
import {
  installOfficeAnnotationHover,
  type OfficeAnnotationHoverResolver,
} from "./office-annotation-hover-controller"

export function OfficeAnnotationHover({
  scopeRef,
  scopeSelector,
  enabled,
  resolve,
}: Readonly<{
  scopeRef: RefObject<HTMLElement | null>
  scopeSelector?: string
  enabled: boolean
  resolve: OfficeAnnotationHoverResolver
}>) {
  const overlayRef = useRef<SVGSVGElement>(null)
  const resolveCurrent = useEffectEvent(resolve)
  useEffect(() => {
    const root = scopeRef.current
    const scope = scopeSelector
      ? root?.querySelector<HTMLElement>(scopeSelector)
      : root
    const overlay = overlayRef.current
    if (!enabled || !scope || !overlay) return
    return installOfficeAnnotationHover(
      scope,
      overlay,
      (point, target) => resolveCurrent(point, target),
      officeAnnotationCursor
    )
  }, [enabled, scopeRef, scopeSelector])
  return enabled ? (
    <svg
      ref={overlayRef}
      className="office-annotation-hover-overlay"
      data-testid="office-annotation-hover-overlay"
      aria-hidden="true"
      focusable="false"
    >
      <path className="office-annotation-hover-frame" />
    </svg>
  ) : null
}
