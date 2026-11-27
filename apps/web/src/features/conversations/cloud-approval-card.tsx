import { ShieldCheckIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { DesktopCloudApproval } from "@/adapters/desktop/desktop-device-adapter"
import { Button } from "@/components/ui/button"

/**
 * One native approval for a cloud command or file change. It is local Mac
 * state, not a turn event: the person answers here and the Mac runs or denies
 * the exact request. Nothing is resent to the API.
 */
export function CloudApprovalCard({
  approval,
  answering,
  failed,
  onAnswer,
}: Readonly<{
  approval: DesktopCloudApproval
  answering: boolean
  failed: boolean
  onAnswer: (decision: "allow" | "deny") => void
}>) {
  const { t } = useTranslation()
  const command = approval.kind === "command"
  const titleId = `cloud-approval-title-${approval.id}`
  return (
    <section
      data-testid="cloud-approval-card"
      data-approval-kind={approval.kind}
      aria-labelledby={titleId}
      className="mx-auto w-full max-w-(--app-composer-width) rounded-2xl border-[color:var(--app-border)] bg-[var(--app-composer)] p-4 shadow-[var(--app-shadow)]"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted">
          <ShieldCheckIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-medium">
            {t(
              command
                ? "desktopApproval.titleCommand"
                : "desktopApproval.titleFileChange"
            )}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              command
                ? "desktopApproval.descriptionCommand"
                : "desktopApproval.descriptionFileChange"
            )}
          </p>
          <dl className="mt-3 grid gap-2 text-xs">
            {command && approval.command ? (
              <div className="grid gap-1">
                <dt className="text-muted-foreground">
                  {t("desktopApproval.commandLabel")}
                </dt>
                <dd>
                  <code className="block max-h-40 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">
                    {approval.command}
                  </code>
                </dd>
              </div>
            ) : null}
            {command ? (
              <div className="flex min-w-0 gap-2">
                <dt className="shrink-0 text-muted-foreground">
                  {t("desktopApproval.cwdLabel")}
                </dt>
                <dd className="min-w-0 truncate font-mono">
                  {approval.cwd
                    ? `${approval.rootName}/${approval.cwd}`
                    : approval.rootName}
                </dd>
              </div>
            ) : null}
            {!command && approval.path ? (
              <div className="flex min-w-0 gap-2">
                <dt className="shrink-0 text-muted-foreground">
                  {t("desktopApproval.pathsLabel")}
                </dt>
                <dd className="min-w-0 truncate font-mono">
                  {`${approval.rootName}/${approval.path}`}
                </dd>
              </div>
            ) : null}
          </dl>
          {failed ? (
            <p role="alert" className="mt-3 text-xs text-destructive-text">
              {t("desktopApproval.unconfirmed")} —{" "}
              {t("desktopApproval.unconfirmedDescription")}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              data-approval-decision="allow"
              disabled={answering}
              onClick={() => onAnswer("allow")}
            >
              {t("desktopApproval.allowOnce")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-approval-decision="deny"
              disabled={answering}
              onClick={() => onAnswer("deny")}
            >
              {t("desktopApproval.decline")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
