import agent01Icon from "@/assets/subagent-icons/agent-01.svg"
import agent02Icon from "@/assets/subagent-icons/agent-02.svg"
import agent03Icon from "@/assets/subagent-icons/agent-03.svg"
import agent04Icon from "@/assets/subagent-icons/agent-04.svg"
import agent05Icon from "@/assets/subagent-icons/agent-05.svg"
import agent06Icon from "@/assets/subagent-icons/agent-06.svg"
import agent07Icon from "@/assets/subagent-icons/agent-07.svg"
import agent08Icon from "@/assets/subagent-icons/agent-08.svg"
import agent09Icon from "@/assets/subagent-icons/agent-09.svg"
import agent10Icon from "@/assets/subagent-icons/agent-10.svg"

import { cn } from "@/lib/utils"

const subAgentIconSources = [
  agent01Icon,
  agent02Icon,
  agent03Icon,
  agent04Icon,
  agent05Icon,
  agent06Icon,
  agent07Icon,
  agent08Icon,
  agent09Icon,
  agent10Icon,
] as const

function getSubAgentIconSource(ordinal: number) {
  const normalizedOrdinal = Number.isFinite(ordinal)
    ? Math.max(1, Math.abs(Math.trunc(ordinal)))
    : 1

  return (
    subAgentIconSources[(normalizedOrdinal - 1) % subAgentIconSources.length] ??
    subAgentIconSources[0]
  )
}

export function SubAgentIcon({
  ordinal,
  className,
}: {
  ordinal: number
  className?: string
}) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      data-slot="subagent-icon"
      decoding="async"
      draggable={false}
      height={32}
      src={getSubAgentIconSource(ordinal)}
      width={32}
    />
  )
}
