import type { ConversationActivity, ConversationEvent } from "@/api/contracts"

const activityTypeByAction: Record<string, string> = {
  analyzing: "analysis",
  working_in_workspace: "working_in_workspace",
  updating_file: "file_write",
  using_external_service: "external_access",
  registering_artifact: "registering_artifact",
  using_platform_tool: "using_platform_tool",
  working: "working",
}

export function mapLegacyConversationActivity(
  event: ConversationEvent,
  fallbackId: string
): ConversationActivity {
  const payload = event.payload as Record<string, unknown>
  const action =
    typeof payload.action === "string"
      ? payload.action
      : event.type.includes("capability")
        ? "capability_use"
        : event.type.includes("tool")
          ? event.type.endsWith("completed")
            ? "tool_completed"
            : "tool_started"
          : event.type.endsWith("completed")
            ? "step_completed"
            : "step_started"

  return {
    id: event.id ?? fallbackId,
    turn_id: event.turn_id,
    item_id: typeof payload.item_id === "string" ? payload.item_id : undefined,
    type:
      action === "capability_use"
        ? payload.capability_type === "skill" || payload.type === "skill"
          ? "skill_use"
          : "plugin_use"
        : (activityTypeByAction[action] ?? action),
    capability_name:
      typeof payload.capability_name === "string"
        ? payload.capability_name
        : typeof payload.name === "string"
          ? payload.name
          : undefined,
    status:
      event.type === "conversation.capability.used" ||
      event.type === "conversation.system_capability.used" ||
      event.type.endsWith("completed")
        ? "completed"
        : "running",
    created_at: event.created_at,
  }
}
