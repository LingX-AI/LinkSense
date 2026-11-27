import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { useAuth } from "@/app/auth-state"
import { useProductName } from "@/app/product-branding"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"

export function useSignOutConfirmation() {
  const { t } = useTranslation()
  const productName = useProductName()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const [signOutConfirmationOpen, setSignOutConfirmationOpen] = useState(false)
  const [signOutPending, setSignOutPending] = useState(false)
  const signOutPendingRef = useRef(false)

  const openSignOutConfirmation = () => {
    if (signOutPendingRef.current) return
    setSignOutConfirmationOpen(true)
  }

  const handleSignOut = async () => {
    if (signOutPendingRef.current) return
    signOutPendingRef.current = true
    setSignOutPending(true)
    try {
      await signOut()
      navigate("/login", { replace: true })
    } finally {
      signOutPendingRef.current = false
      setSignOutPending(false)
    }
  }

  const signOutDialog = (
    <ConfirmDialog
      open={signOutConfirmationOpen}
      onOpenChange={(open) => {
        if (!open && !signOutPendingRef.current)
          setSignOutConfirmationOpen(false)
      }}
      title={t("auth.signOutTitle")}
      description={t("auth.signOutDescription", { productName })}
      confirmLabel={t("common.signOut")}
      destructive
      pending={signOutPending}
      onConfirm={() => void handleSignOut()}
    />
  )

  return { openSignOutConfirmation, signOutDialog }
}
