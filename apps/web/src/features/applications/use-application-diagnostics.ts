import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  sanitizeApplicationDevelopmentDiagnostic,
  type ApplicationDevelopmentDiagnostic,
} from "@linksense/shared"
import { reportApplicationDiagnostics } from "./application-development-api"

export function useApplicationDiagnostics(
  id: string,
  revision: number,
  current: boolean
) {
  const [local, setLocal] = useState<{
    revision: number
    items: ApplicationDevelopmentDiagnostic[]
  } | null>(null)
  const pending = useRef<{
    revision: number
    items: ApplicationDevelopmentDiagnostic[]
  } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { mutate, error, variables } = useMutation({
    mutationFn: (report: {
      revision: number
      items: ApplicationDevelopmentDiagnostic[]
    }) => reportApplicationDiagnostics(id, report.revision, report.items),
    retry: 1,
  })
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [id, revision]
  )
  const onDiagnostic = useCallback(
    (received: ApplicationDevelopmentDiagnostic) => {
      // An in-flight test retains its original package; never attribute its errors to new code.
      if (!current) return
      const diagnostic = sanitizeApplicationDevelopmentDiagnostic(received)
      const items =
        pending.current?.revision === revision ? pending.current.items : []
      if (
        items.length >= 20 ||
        items.some(
          (item) =>
            item.message === diagnostic.message &&
            item.file === diagnostic.file &&
            item.line === diagnostic.line
        )
      )
        return
      const report = { revision, items: [...items, diagnostic] }
      pending.current = report
      setLocal(report)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => mutate(report), 250)
    },
    [current, revision, mutate]
  )
  return {
    onDiagnostic,
    diagnostics: local?.revision === revision ? local.items : null,
    error: variables?.revision === revision ? error : null,
  }
}
