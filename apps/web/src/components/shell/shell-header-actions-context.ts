import { createContext, type Dispatch, type SetStateAction } from "react"

export const ShellHeaderActionsContext = createContext<{
  sidebarTarget: HTMLDivElement | null
  setSidebarTarget: Dispatch<SetStateAction<HTMLDivElement | null>>
  mobileSidebarTarget: HTMLDivElement | null
  setMobileSidebarTarget: Dispatch<SetStateAction<HTMLDivElement | null>>
} | null>(null)
