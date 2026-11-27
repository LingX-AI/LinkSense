import { z } from "zod"

import { isMacDesktopHost } from "./desktop-adapter"
import { Desktop } from "./mygo"

const desktopDeviceStateSchema = z.enum([
  "unpaired",
  "connecting",
  "online",
  "offline",
  "revoked",
])

// The native bridge may add fields before the generated binding is refreshed.
// Read the optional execution and computer-use capabilities without editing
// the binding.
const nativeDeviceStatusSchema = z
  .object({
    state: desktopDeviceStateSchema,
    deviceId: z.uuid().optional(),
    errorCode: z.string().optional(),
    localToolsDisabled: z.boolean().optional(),
    executionReady: z.boolean().optional(),
    computerReady: z.boolean().optional(),
    conversationReferenceReadReady: z.boolean().optional(),
  })
  .passthrough()

export type DesktopDeviceState = z.infer<typeof desktopDeviceStateSchema>

export type DesktopDeviceStatus = {
  deviceId?: string
  state: DesktopDeviceState
  errorCode?: string
  /** True when the user disabled local tools on this installation. */
  localToolsDisabled?: boolean
  /**
   * True only when the native host reports a ready execution link. Older hosts
   * omit the field, which means false.
   */
  executionReady?: boolean
  /**
   * The negotiated Computer Use capability. Only a host that advertised the
   * computer-control operation reports true; a missing field means false and
   * the Web UI omits every control without probing TCC.
   */
  computerReady?: boolean
  /**
   * True only when this exact negotiated connection can read a conversation
   * reference. A missing field comes from an older host and means false.
   */
  conversationReferenceReadReady?: boolean
}

export function parseDesktopDeviceStatus(value: unknown): DesktopDeviceStatus {
  const parsed = nativeDeviceStatusSchema.parse(value)
  return {
    deviceId: parsed.deviceId,
    state: parsed.state,
    ...(parsed.errorCode ? { errorCode: parsed.errorCode } : {}),
    ...(parsed.localToolsDisabled ? { localToolsDisabled: true } : {}),
    executionReady: parsed.executionReady === true,
    computerReady: parsed.computerReady === true,
    conversationReferenceReadReady:
      parsed.conversationReferenceReadReady === true,
  }
}

export async function readDesktopDeviceStatus(
  signal?: AbortSignal
): Promise<DesktopDeviceStatus> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  const value: unknown = await (signal
    ? Desktop.deviceStatus.with({ signal })()
    : Desktop.deviceStatus())
  return parseDesktopDeviceStatus(value)
}

/**
 * Ensures the verified Web user's Mac is registered and connected. The native
 * host proves the account again, rotates the device credential, and connects.
 * There is no pairing code and no user action; outside a macOS host this is a
 * no-op.
 */
export async function ensureDesktopDeviceForAuthRestore(
  ownerId: string
): Promise<DesktopDeviceStatus | null> {
  if (!isMacDesktopHost()) return null
  const parsedOwner = z.uuid().safeParse(ownerId)
  if (!parsedOwner.success) return null
  const value: unknown = await Desktop.ensureDevice(parsedOwner.data, false)
  return parseDesktopDeviceStatus(value)
}

/**
 * Applies the explicit local-tools toggle. Enabling re-registers with the
 * server so an earlier revocation is cleared by the user's decision only.
 */
export async function setDesktopLocalToolsEnabled(
  enabled: boolean
): Promise<DesktopDeviceStatus> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  const value: unknown = await Desktop.setLocalToolsEnabled(enabled)
  return parseDesktopDeviceStatus(value)
}

/**
 * Opens the native folder picker and grants that folder to one conversation.
 * The absolute path stays on this Mac.
 */
export async function addDesktopFileRoot(
  conversationId: string,
  mode: "read" | "write"
): Promise<{ id: string; name: string; mode: "read" | "write" }> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  if (!z.uuid().safeParse(conversationId).success) throw new Error("VALIDATION_ERROR")
  const value = await Desktop.addFileRoot(conversationId, mode)
  return parseLocalFileRoot(value)
}

/** Changes the current folder's access mode without reopening the picker. */
export async function setDesktopFileRootMode(
  conversationId: string,
  mode: "read" | "write"
): Promise<{ id: string; name: string; mode: "read" | "write" }> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  if (!z.uuid().safeParse(conversationId).success) throw new Error("VALIDATION_ERROR")
  return parseLocalFileRoot(await Desktop.setFileRootMode(conversationId, mode))
}

/** Reads the conversation's folder grant, creating the default Home grant. */
export async function getDesktopFileRoot(
  conversationId: string
): Promise<{ id: string; name: string; mode: "read" | "write" }> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  if (!z.uuid().safeParse(conversationId).success) throw new Error("VALIDATION_ERROR")
  return parseLocalFileRoot(await Desktop.fileRoot(conversationId))
}

export type DesktopFileRootListing = {
  rootName: string
  mode: "read" | "write"
  path: string
  entries: { name: string; path: string; kind: "file" | "directory" }[]
  truncated: boolean
}

/** Lists one directory of the conversation's folder for the composer @ menu. */
export async function listDesktopFileRoot(
  conversationId: string,
  path: string
): Promise<DesktopFileRootListing> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  if (!z.uuid().safeParse(conversationId).success) throw new Error("VALIDATION_ERROR")
  const value = await Desktop.listFileRoot(conversationId, path)
  return {
    rootName: z.string().trim().min(1).max(120).parse(value.root_name),
    mode: z.enum(["read", "write"]).parse(value.mode),
    path: z.string().max(4_096).parse(value.path),
    entries: z
      .array(
        z.object({
          name: z.string().min(1).max(255),
          path: z.string().min(1).max(4_096),
          kind: z.enum(["file", "directory"]),
        })
      )
      .max(200)
      .parse(
        value.entries.filter(
          (entry) => entry.kind === "file" || entry.kind === "directory"
        )
      ),
    truncated: value.truncated === true,
  }
}

function parseLocalFileRoot(value: {
  id: string
  name: string
  mode: string
}): { id: string; name: string; mode: "read" | "write" } {
  return {
    id: z.uuid().parse(value.id),
    name: z.string().trim().min(1).max(120).parse(value.name),
    mode: z.enum(["read", "write"]).parse(value.mode),
  }
}
