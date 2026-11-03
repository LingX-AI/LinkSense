export type ComputerUsePlatform = "macos" | "windows" | "other"

export function computerUsePlatform(
  browser: Pick<Navigator, "platform" | "userAgent"> = navigator
): ComputerUsePlatform {
  const identity = `${browser.platform} ${browser.userAgent}`
  if (/Macintosh|Mac OS X|MacIntel/iu.test(identity)) return "macos"
  if (/Windows|Win32|Win64|WOW64/iu.test(identity)) return "windows"
  return "other"
}
