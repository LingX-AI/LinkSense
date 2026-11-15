import { useCallback, useState, type ReactNode } from "react"

import {
  RichOutputResourceContext,
  type RichOutputResources,
} from "./rich-output-resource-context"

export function RichOutputResourceProvider({
  children,
  ...resources
}: RichOutputResources & { children: ReactNode }) {
  const [registrations, setRegistrations] = useState(
    () => new Map<symbol, string[]>()
  )
  const register = useCallback((ids: string[]) => {
    const key = Symbol()
    setRegistrations((current) => new Map(current).set(key, ids))
    return () =>
      setRegistrations((current) => {
        const next = new Map(current)
        next.delete(key)
        return next
      })
  }, [])
  const renderedFileIds = new Set([...registrations.values()].flat())
  return (
    <RichOutputResourceContext.Provider
      value={{ ...resources, register, renderedFileIds }}
    >
      {children}
    </RichOutputResourceContext.Provider>
  )
}
