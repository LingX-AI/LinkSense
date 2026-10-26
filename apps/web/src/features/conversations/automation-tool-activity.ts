import { automationToolNames, coreMcpServerKey } from "@linksense/shared"

import type { NativeCodexItem } from "@/api/contracts"
import type { QueryClient } from "@tanstack/react-query"

export function isAutomationToolItem(item: NativeCodexItem): boolean {
  return (
    item.type === "mcpToolCall" &&
    item.server === coreMcpServerKey &&
    automationToolNames.some((name) => name === item.tool)
  )
}

export function isAutomationMutationItem(item: NativeCodexItem): boolean {
  return (
    isAutomationToolItem(item) &&
    item.type === "mcpToolCall" &&
    item.tool !== "list_automations" &&
    item.tool !== "get_automation"
  )
}

export async function refreshAutomationQueries(
  queryClient: QueryClient,
  conversationId: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["automations"] }),
    queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    queryClient.invalidateQueries({
      queryKey: ["conversation", conversationId],
    }),
  ])
}
