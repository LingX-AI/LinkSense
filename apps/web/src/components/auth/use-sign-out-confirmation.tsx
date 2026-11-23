import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import {
  isMacDesktopHost,
  supportsMacDesktopSignOut,
} from "@/adapters/desktop/desktop-adapter"
import { readDesktopDeviceStatus } from "@/adapters/desktop/desktop-device-adapter"
import type { RevokedMacDevice } from "@/adapters/desktop/mygo"
import { getErrorMessage } from "@/api/error-message"
import {
  getLoginSessionBoundary,
  isLoginSessionCurrent,
  subscribeToLoginSession,
  type LoginSessionBoundary,
} from "@/api/session"
import { useAuth } from "@/app/auth-state"
import { useProductName } from "@/app/product-branding"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { notify } from "@/components/feedback/notification"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { revokeDesktopDevice } from "@/features/desktop-devices/desktop-device-api"

type SignOutConfirmation = {
  loginSessionBoundary: LoginSessionBoundary
  deviceId?: string
  revoke?: boolean
  unconfirmedDeviceId?: string
  error?: "signOutRevokeFailed" | "signOutDeviceChanged"
}

async function readPairedMacId(retryDeviceId?: string) {
  const { deviceId, state } = await readDesktopDeviceStatus(
    AbortSignal.timeout(10_000)
  )
  if (
    state === "online" ||
    state === "offline" ||
    state === "connecting" ||
    (state === "revoked" && deviceId === retryDeviceId)
  ) {
    return deviceId
  }
}

export function useSignOutConfirmation() {
  const { t } = useTranslation()
  const productName = useProductName()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const macDesktopHost = isMacDesktopHost()
  const macSignOutSupported = supportsMacDesktopSignOut()
  const [signOutConfirmation, setSignOutConfirmation] =
    useState<SignOutConfirmation | null>(null)
  const [signOutPending, setSignOutPending] = useState(false)
  const signOutPendingRef = useRef(false)
  useEffect(() => {
    if (!macDesktopHost) return
    return subscribeToLoginSession(() => setSignOutConfirmation(null))
  }, [macDesktopHost])

  const openSignOutConfirmation = () => {
    if (signOutPendingRef.current) return
    const confirmation = { loginSessionBoundary: getLoginSessionBoundary() }
    setSignOutConfirmation(confirmation)
    if (!macSignOutSupported || !user) return
    void readPairedMacId().then(
      (deviceId) => {
        if (
          !deviceId ||
          !isLoginSessionCurrent(confirmation.loginSessionBoundary)
        )
          return
        setSignOutConfirmation((current) =>
          current === confirmation ? { ...confirmation, deviceId } : current
        )
      },
      () => {
        // An unavailable bridge must not stop ordinary sign-out.
      }
    )
  }

  const handleSignOut = async () => {
    if (
      !signOutConfirmation ||
      signOutPendingRef.current ||
      (macDesktopHost &&
        !isLoginSessionCurrent(signOutConfirmation.loginSessionBoundary))
    ) {
      return
    }
    const { loginSessionBoundary, deviceId, revoke, unconfirmedDeviceId } =
      signOutConfirmation
    signOutPendingRef.current = true
    setSignOutPending(true)
    try {
      let revokedDevice: RevokedMacDevice | undefined
      if (macSignOutSupported && revoke && deviceId && user) {
        let attempted = false
        try {
          const currentDeviceId = await readPairedMacId(
            unconfirmedDeviceId === deviceId ? deviceId : undefined
          )
          if (!isLoginSessionCurrent(loginSessionBoundary)) return
          if (currentDeviceId !== deviceId) {
            setSignOutConfirmation({
              loginSessionBoundary,
              deviceId: currentDeviceId,
              unconfirmedDeviceId,
              error: "signOutDeviceChanged",
            })
            return
          }
          await revokeDesktopDevice(deviceId, {
            loginSessionBoundary,
            signal: AbortSignal.timeout(30_000),
            beforeAttempt: () => {
              // Refresh can keep the login alive, but a new DELETE needs a
              // fresh native status read and another explicit confirmation.
              if (attempted) throw new Error("DESKTOP_REVOKE_CONFIRM_AGAIN")
              attempted = true
            },
          })
          revokedDevice = { deviceId, ownerId: user.id }
        } catch {
          if (isLoginSessionCurrent(loginSessionBoundary)) {
            setSignOutConfirmation({
              ...signOutConfirmation,
              unconfirmedDeviceId: attempted ? deviceId : unconfirmedDeviceId,
              error: "signOutRevokeFailed",
            })
          }
          return
        }
        if (!isLoginSessionCurrent(loginSessionBoundary)) return
      }
      const outgoingSignOut = signOut(
        revokedDevice ? { revokedDevice } : undefined
      )
      const endingLoginSession = getLoginSessionBoundary()
      try {
        await outgoingSignOut
      } catch (error) {
        if (!macSignOutSupported) throw error
        if (isLoginSessionCurrent(endingLoginSession)) {
          notify.error(getErrorMessage(error, t))
        }
      }
      if (!macDesktopHost || isLoginSessionCurrent(endingLoginSession)) {
        if (
          unconfirmedDeviceId &&
          unconfirmedDeviceId !== revokedDevice?.deviceId
        ) {
          notify.warning(t("desktopDevices.signOutRevokeUnconfirmed"))
        }
        navigate("/login", { replace: true })
      }
    } finally {
      signOutPendingRef.current = false
      setSignOutPending(false)
    }
  }

  const signOutDialog = (
    <ConfirmDialog
      open={signOutConfirmation !== null}
      onOpenChange={(open) => {
        if (!open && !signOutPendingRef.current) setSignOutConfirmation(null)
      }}
      title={t("auth.signOutTitle")}
      description={t("auth.signOutDescription", { productName })}
      confirmLabel={t("common.signOut")}
      destructive
      destructiveNotice={
        signOutConfirmation?.unconfirmedDeviceId &&
        !signOutConfirmation.revoke
          ? t("desktopDevices.signOutRevokeUnconfirmed")
          : signOutConfirmation?.error
            ? t(`desktopDevices.${signOutConfirmation.error}`)
            : undefined
      }
      pending={signOutPending}
      onConfirm={() => void handleSignOut()}
    >
      {signOutConfirmation?.deviceId && (
        <Label className="min-h-8 gap-3 leading-5">
          <Checkbox
            checked={signOutConfirmation.revoke === true}
            disabled={signOutPending}
            onCheckedChange={(revoke) => {
              if (
                signOutPendingRef.current ||
                !isLoginSessionCurrent(signOutConfirmation.loginSessionBoundary)
              ) {
                return
              }
              setSignOutConfirmation({
                ...signOutConfirmation,
                revoke,
                error: undefined,
              })
            }}
          />
          {t("desktopDevices.signOutRevoke")}
        </Label>
      )}
    </ConfirmDialog>
  )

  return { openSignOutConfirmation, signOutDialog }
}
