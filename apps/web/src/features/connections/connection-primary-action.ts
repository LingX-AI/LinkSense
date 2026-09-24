import type { Connection } from "@linksense/shared"

export function connectionPrimaryAction(
  connection: Connection
): "connect" | "reconnect" | "upgrade" {
  if (connection.status === "connected" && connection.access_mode === "read") {
    return "upgrade"
  }
  return connection.status === "disconnected" ? "connect" : "reconnect"
}
