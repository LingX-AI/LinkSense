import thinkingOrbAnimation from "@/assets/figma/thinking-orb.gif"
import thinkingOrbStatic from "@/assets/figma/thinking-orb.svg"

export function ConversationThinkingOrb() {
  return (
    <picture
      data-slot="thinking-orb"
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center"
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
        className="size-6"
        decoding="async"
      />
    </picture>
  )
}
