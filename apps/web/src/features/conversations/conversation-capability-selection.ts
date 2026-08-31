import type { CapabilitySummary } from "@/api/contracts"

export function canSelectConversationCapability(
  capability: Pick<CapabilitySummary, "can_select" | "is_builtin">
): boolean {
  return capability.is_builtin || capability.can_select
}

const conversationSkillNameCollator = new Intl.Collator(["zh-CN", "en-US"], {
  numeric: true,
  sensitivity: "base",
})

export function orderConversationSkills<
  T extends Pick<CapabilitySummary, "is_builtin" | "name">,
>(capabilities: readonly T[]): T[] {
  const nonBuiltInCapabilities: T[] = []
  const builtInCapabilities: T[] = []

  capabilities.forEach((capability) => {
    if (capability.is_builtin) {
      builtInCapabilities.push(capability)
    } else {
      nonBuiltInCapabilities.push(capability)
    }
  })

  nonBuiltInCapabilities.sort((left, right) =>
    conversationSkillNameCollator.compare(left.name, right.name)
  )

  return [...nonBuiltInCapabilities, ...builtInCapabilities]
}
