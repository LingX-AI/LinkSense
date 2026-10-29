import { createContext, type Dispatch, type SetStateAction } from "react"

export const ShellHeaderActionsContext = createContext<{
  target: HTMLDivElement | null
  setTarget: Dispatch<SetStateAction<HTMLDivElement | null>>
  fallbackTarget: HTMLDivElement | null
  setFallbackTarget: Dispatch<SetStateAction<HTMLDivElement | null>>
} | null>(null)
