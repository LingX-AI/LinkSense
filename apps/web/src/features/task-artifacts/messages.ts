import type { Locale } from "@linksense/shared"

type TaskArtifactDownloadMessages = {
  saved: string
  showInFinder: string
  revealFailed: string
}

/** The explicit Finder offer appears only for a successful Mac desktop save. */
export const taskArtifactDownloadMessages: Record<
  Locale,
  TaskArtifactDownloadMessages
> = {
  "zh-CN": {
    saved: "已保存 {{name}}",
    showInFinder: "在 Finder 中显示",
    revealFailed: "无法在 Finder 中显示该文件。请重试。",
  },
  "en-US": {
    saved: "Saved {{name}}",
    showInFinder: "Show in Finder",
    revealFailed: "Could not show the file in Finder. Try again.",
  },
  "es-ES": {
    saved: "Se guardó {{name}}",
    showInFinder: "Mostrar en Finder",
    revealFailed:
      "No se pudo mostrar el archivo en Finder. Inténtalo de nuevo.",
  },
  "pt-BR": {
    saved: "{{name}} salvo",
    showInFinder: "Mostrar no Finder",
    revealFailed:
      "Não foi possível mostrar o arquivo no Finder. Tente novamente.",
  },
  "fr-FR": {
    saved: "{{name}} enregistré",
    showInFinder: "Afficher dans le Finder",
    revealFailed: "Impossible d’afficher le fichier dans le Finder. Réessayez.",
  },
  "ja-JP": {
    saved: "{{name}} を保存しました",
    showInFinder: "Finder に表示",
    revealFailed:
      "Finder にファイルを表示できませんでした。再試行してください。",
  },
}
