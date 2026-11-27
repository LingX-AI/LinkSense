import type { Locale } from "@linksense/shared"

type DesktopDevicesMessages = {
  signOutRevoke: string
  signOutRevokeFailed: string
  signOutRevokeUnconfirmed: string
  signOutDeviceChanged: string
}

export const desktopDevicesMessages = {
  "zh-CN": {
    signOutRevoke: "同时撤销这台 Mac 的授权",
    signOutRevokeFailed:
      "无法确认已撤销这台 Mac 的授权。请重试，或取消勾选后只退出登录。",
    signOutRevokeUnconfirmed:
      "之前的撤销结果尚未确认。退出登录不会再次尝试撤销。",
    signOutDeviceChanged:
      "这台 Mac 的本机工具状态已变更。请重新选择，或只退出登录。",
  },
  "en-US": {
    signOutRevoke: "Also revoke access for this Mac",
    signOutRevokeFailed:
      "Could not confirm that access was revoked for this Mac. Try again, or uncheck the option to just sign out.",
    signOutRevokeUnconfirmed:
      "The previous revocation was not confirmed. Signing out will not retry it.",
    signOutDeviceChanged:
      "This Mac’s local-tools status has changed. Make a new selection, or just sign out.",
  },
  "es-ES": {
    signOutRevoke: "Revocar también el acceso de este Mac",
    signOutRevokeFailed:
      "No se pudo confirmar la revocación del acceso de este Mac. Inténtalo de nuevo o desmarca la opción para cerrar sesión sin repetir la revocación.",
    signOutRevokeUnconfirmed:
      "La revocación anterior no se ha confirmado. Al cerrar sesión no se volverá a intentar.",
    signOutDeviceChanged:
      "Cambió el estado de las herramientas locales de este Mac. Vuelve a elegir o cierra sesión sin revocar el acceso.",
  },
  "pt-BR": {
    signOutRevoke: "Revogar também o acesso deste Mac",
    signOutRevokeFailed:
      "Não foi possível confirmar a revogação do acesso deste Mac. Tente novamente ou desmarque a opção para apenas sair.",
    signOutRevokeUnconfirmed:
      "A revogação anterior não foi confirmada. Sair da conta não fará outra tentativa.",
    signOutDeviceChanged:
      "O estado das ferramentas locais deste Mac mudou. Faça uma nova seleção ou apenas saia.",
  },
  "fr-FR": {
    signOutRevoke: "Révoquer aussi l’accès de ce Mac",
    signOutRevokeFailed:
      "Impossible de confirmer la révocation de l’accès de ce Mac. Réessayez ou décochez l’option pour simplement vous déconnecter.",
    signOutRevokeUnconfirmed:
      "La révocation précédente n’a pas été confirmée. Vous déconnecter ne relancera pas la révocation.",
    signOutDeviceChanged:
      "L’état des outils locaux de ce Mac a changé. Faites un nouveau choix ou déconnectez-vous simplement.",
  },
  "ja-JP": {
    signOutRevoke: "この Mac のアクセス権も取り消す",
    signOutRevokeFailed:
      "この Mac のアクセス権が取り消されたことを確認できませんでした。もう一度お試しいただくか、チェックを外してログアウトのみ行ってください。",
    signOutRevokeUnconfirmed:
      "前回の取り消しは確認できていません。ログアウトしても取り消しは再試行されません。",
    signOutDeviceChanged:
      "この Mac のローカルツールの状態が変わりました。選び直すか、ログアウトのみ行ってください。",
  },
} satisfies Record<Locale, DesktopDevicesMessages>
