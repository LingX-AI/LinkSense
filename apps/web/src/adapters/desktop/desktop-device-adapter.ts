import {
  desktopDeviceRenameInputSchema,
  desktopPairingCodeSchema,
} from "@linksense/shared"
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
// Read the optional executionReady capability without editing the binding.
const nativeDeviceStatusSchema = z
  .object({
    state: desktopDeviceStateSchema,
    deviceId: z.uuid().optional(),
    executionReady: z.boolean().optional(),
  })
  .passthrough()

export type DesktopDeviceState = z.infer<typeof desktopDeviceStateSchema>

export type DesktopDeviceStatus = {
  deviceId?: string
  state: DesktopDeviceState
  /**
   * True only when the native host reports a ready execution link. Older hosts
   * omit the field, which means false.
   */
  executionReady?: boolean
}

export function parseDesktopDeviceStatus(value: unknown): DesktopDeviceStatus {
  const parsed = nativeDeviceStatusSchema.parse(value)
  return {
    deviceId: parsed.deviceId,
    state: parsed.state,
    executionReady: parsed.executionReady === true,
  }
}

export async function readDesktopDeviceStatus(): Promise<DesktopDeviceStatus> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  const value: unknown = await Desktop.deviceStatus()
  return parseDesktopDeviceStatus(value)
}

export async function pairDesktopDevice(
  code: string,
  name: string
): Promise<DesktopDeviceStatus> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  const parsedCode = desktopPairingCodeSchema.parse(code)
  const parsedName = desktopDeviceRenameInputSchema.parse({ name }).name
  const value: unknown = await Desktop.pairDevice(parsedCode, parsedName)
  return parseDesktopDeviceStatus(value)
}

/**
 * Resumes the Mac's stored device credential for the verified Web user. The
 * native host verifies the owner, session, and credential again; this call
 * never pairs a device and is a no-op outside a macOS host.
 */
export async function resumeDesktopDeviceForAuthRestore(
  ownerId: string
): Promise<DesktopDeviceStatus | null> {
  if (!isMacDesktopHost()) return null
  const parsedOwner = z.uuid().safeParse(ownerId)
  if (!parsedOwner.success) return null
  const value: unknown = await Desktop.resumeDevice(parsedOwner.data)
  return parseDesktopDeviceStatus(value)
}
