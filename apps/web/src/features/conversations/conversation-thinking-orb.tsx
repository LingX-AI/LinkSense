import { useId } from "react"

import thinkingOrbAnimation from "@/assets/figma/thinking-orb.gif"
import thinkingOrbStatic from "@/assets/figma/thinking-orb.svg"

export function ConversationThinkingOrb() {
  const paletteId = useId()

  return (
    <>
      <svg width={0} height={0} className="absolute" aria-hidden="true">
        <defs>
          <filter id={paletteId} colorInterpolationFilters="sRGB">
            {/* Lift red in violet points while retaining the blue/cyan channels. */}
            <feColorMatrix
              type="matrix"
              values="1.8 -.4 .12 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"
            />
          </filter>
        </defs>
      </svg>
      <picture
        data-slot="thinking-orb"
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center"
        style={{ filter: `url("#${paletteId}")` }}
      >
        <source
          media="(prefers-reduced-motion: reduce)"
          srcSet={thinkingOrbStatic}
        />
        <img
          src={thinkingOrbAnimation}
          alt=""
          width={24}
          height={24}
          className="size-6 brightness-95 contrast-125 saturate-[1.35] dark:brightness-110 dark:contrast-100 dark:saturate-[1.2]"
          decoding="async"
        />
      </picture>
    </>
  )
}
