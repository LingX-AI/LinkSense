import type { PointerEvent } from "react"

import "./card-spotlight.css"

// Adapted from React Bits SpotlightCard (e12c221); see public/licenses/react-bits.txt.
function clearSpotlight(event: PointerEvent<HTMLElement>): void {
  delete event.currentTarget.dataset.spotlightActive
}

function moveSpotlight(event: PointerEvent<HTMLElement>): void {
  const card = event.currentTarget
  if (
    event.pointerType === "touch" ||
    card.matches(":disabled, [aria-disabled=true]") ||
    !window.matchMedia(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)"
    ).matches
  ) {
    clearSpotlight(event)
    return
  }

  const bounds = card.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  const x = Math.max(
    0,
    Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)
  )
  const y = Math.max(
    0,
    Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)
  )
  card.style.setProperty("--card-spotlight-x", `${x}%`)
  card.style.setProperty("--card-spotlight-y", `${y}%`)
  card.dataset.spotlightActive = "true"
}

export const cardSpotlightProps = {
  className: "card-spotlight relative isolate",
  onPointerMove: moveSpotlight,
  onPointerLeave: clearSpotlight,
  onPointerCancel: clearSpotlight,
}
