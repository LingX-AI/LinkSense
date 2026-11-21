import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  isMacDesktopHost,
  readDesktopWorkspaceNotice,
} from "@/adapters/desktop/desktop-adapter"
import { useAuth } from "@/app/auth-state"

/**
 * Shows one inline notice when this Mac explicitly evicted this conversation's
 * task files. The native host answers from its own account and origin-bound
 * marker; legacy, foreign, corrupt, or missing evidence never shows a notice.
 */
export function LocalWorkspaceClearedNotice({
  conversationId,
}: Readonly<{ conversationId?: string }>) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const enabled =
    isMacDesktopHost() &&
    Boolean(user?.id && conversationId && conversationId !== "new")
  const notice = useQuery({
    // Sign-out removes account-scoped queries, so a same-id sign-in cannot
    // reuse a previous session's answer.
    queryKey: ["local-workspace-notice", user?.id, conversationId],
    queryFn: () => readDesktopWorkspaceNotice(conversationId as string),
    enabled,
    retry: false,
    staleTime: 0,
  })
  if (!enabled || !notice.data?.cleared) return null
  return (
    <div className="px-3 pt-3" data-slot="local-workspace-notice">
      <Alert appearance="soft" className="mx-auto max-w-2xl">
        <AlertTitle>{t("localWorkspace.clearedTitle")}</AlertTitle>
        <AlertDescription>{t("localWorkspace.clearedDescription")}</AlertDescription>
      </Alert>
    </div>
  )
}
