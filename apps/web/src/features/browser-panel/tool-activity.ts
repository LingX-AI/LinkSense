import type { NativeCodexItem } from "@/api/contracts"

// The cloud browser session the panel mirrors is opened by the managed
// `linksense-browser` shell command; the command text is the only browser
// activity the conversation events carry.
const managedBrowserInvocation = /(^|[\s;&|])linksense-browser\s+(?!-)\S/u

export function isManagedBrowserCommandItem(item: NativeCodexItem): boolean {
  if (item.type !== "commandExecution") return false
  const commands = [
    item.command ?? "",
    ...(item.commandActions ?? []).map((action) => action.command ?? ""),
  ]
  return commands.some((command) => managedBrowserInvocation.test(command))
}
