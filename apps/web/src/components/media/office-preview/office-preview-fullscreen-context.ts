import { createContext, useContext } from "react"

export const OfficePreviewFullscreenContext = createContext(false)

export function useOfficePreviewFullscreen() {
  return useContext(OfficePreviewFullscreenContext)
}
