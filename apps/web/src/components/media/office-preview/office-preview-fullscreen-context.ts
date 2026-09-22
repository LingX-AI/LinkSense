import { createContext, useContext } from "react"

type OfficePreviewFullscreenContextValue = Readonly<{
  expanded: boolean
  portalContainer: HTMLElement | null
}>

export const OfficePreviewFullscreenContext =
  createContext<OfficePreviewFullscreenContextValue>({
    expanded: false,
    portalContainer: null,
  })

export function useOfficePreviewFullscreen() {
  return useContext(OfficePreviewFullscreenContext).expanded
}

export function useOfficePreviewPortalContainer() {
  return useContext(OfficePreviewFullscreenContext).portalContainer
}
