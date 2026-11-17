import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  checkDesktopUpdate,
  isDesktopHost,
} from "@/adapters/desktop/desktop-adapter"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function DesktopUpdateControl() {
  const { t } = useTranslation()
  const active = useRef(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] =
    useState<Awaited<ReturnType<typeof checkDesktopUpdate>>>()

  if (!isDesktopHost()) return null
  async function check() {
    if (active.current) return
    active.current = true
    setPending(true)
    setResult(undefined)
    try {
      setResult(await checkDesktopUpdate())
    } catch {
      setResult({ state: "failed" })
    } finally {
      active.current = false
      setPending(false)
    }
  }

  return (
    <div className="grid min-w-0 justify-items-start gap-2">
      <Button
        type="button"
        variant="secondary"
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        onClick={() => void check()}
      >
        {pending && <Spinner data-icon="inline-start" />}
        {t("desktopUpdate.check")}
      </Button>
      <p
        className="text-sm text-muted-foreground"
        role="status"
        aria-atomic="true"
      >
        {result?.state === "available"
          ? t("desktopUpdate.available", { version: result.version })
          : result
            ? t(`desktopUpdate.${result.state}`)
            : null}
      </p>
    </div>
  )
}
