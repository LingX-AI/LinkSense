import type { Locale } from "@linksense/shared"

type DesktopApprovalMessages = {
  titleCommand: string
  titleFileChange: string
  descriptionCommand: string
  descriptionFileChange: string
  commandLabel: string
  cwdLabel: string
  pathsLabel: string
  fileOperations: Record<"add" | "delete" | "update" | "move", string>
  moveTo: string
  allowOnce: string
  decline: string
  cancel: string
  unconfirmed: string
  unconfirmedDescription: string
}

export const desktopApprovalMessages = {
  "zh-CN": {
    titleCommand: "允许运行此命令吗？",
    titleFileChange: "允许修改这些文件吗？",
    descriptionCommand: "此命令将在你的电脑上运行。请先核对命令和工作目录。",
    descriptionFileChange: "这些更改会写入你的电脑。请先核对文件路径。",
    commandLabel: "命令",
    cwdLabel: "工作目录",
    pathsLabel: "文件",
    fileOperations: { add: "新建或覆盖", delete: "删除", update: "修改", move: "修改并移动" },
    moveTo: "目标路径（可能覆盖现有文件）",
    allowOnce: "允许一次",
    decline: "拒绝",
    cancel: "取消审批",
    unconfirmed: "答复未确认",
    unconfirmedDescription: "无法确认 Mac 是否收到答复。请先在 Mac 上核对任务结果。",
  },
  "en-US": {
    titleCommand: "Allow this command to run?",
    titleFileChange: "Allow these file changes?",
    descriptionCommand:
      "This command runs on your computer. Review the command and working directory first.",
    descriptionFileChange:
      "These changes are written to your computer. Review the file paths first.",
    commandLabel: "Command",
    cwdLabel: "Working directory",
    pathsLabel: "Files",
    fileOperations: { add: "Create or replace", delete: "Delete", update: "Edit", move: "Edit and move" },
    moveTo: "Destination (may replace an existing file)",
    allowOnce: "Allow once",
    decline: "Decline",
    cancel: "Cancel approval",
    unconfirmed: "Reply unconfirmed",
    unconfirmedDescription: "We couldn't confirm that your Mac received the reply. Check the task on your Mac before trying again.",
  },
  "es-ES": {
    titleCommand: "¿Permitir que se ejecute este comando?",
    titleFileChange: "¿Permitir estos cambios en archivos?",
    descriptionCommand:
      "Este comando se ejecuta en tu equipo. Revisa el comando y el directorio de trabajo antes de continuar.",
    descriptionFileChange:
      "Estos cambios se escribirán en tu equipo. Revisa las rutas de los archivos antes de continuar.",
    commandLabel: "Comando",
    cwdLabel: "Directorio de trabajo",
    pathsLabel: "Archivos",
    fileOperations: { add: "Crear o sobrescribir", delete: "Eliminar", update: "Editar", move: "Editar y mover" },
    moveTo: "Destino (puede sobrescribir un archivo existente)",
    allowOnce: "Permitir una vez",
    decline: "Rechazar",
    cancel: "Cancelar la aprobación",
    unconfirmed: "Respuesta sin confirmar",
    unconfirmedDescription: "No se pudo confirmar si tu Mac recibió la respuesta. Revisa la tarea en tu Mac antes de volver a intentarlo.",
  },
  "pt-BR": {
    titleCommand: "Permitir que este comando seja executado?",
    titleFileChange: "Permitir estas alterações de arquivos?",
    descriptionCommand:
      "Este comando é executado no seu computador. Revise o comando e o diretório de trabalho antes de continuar.",
    descriptionFileChange:
      "Estas alterações serão gravadas no seu computador. Revise os caminhos dos arquivos antes de continuar.",
    commandLabel: "Comando",
    cwdLabel: "Diretório de trabalho",
    pathsLabel: "Arquivos",
    fileOperations: { add: "Criar ou sobrescrever", delete: "Excluir", update: "Editar", move: "Editar e mover" },
    moveTo: "Destino (pode sobrescrever um arquivo existente)",
    allowOnce: "Permitir uma vez",
    decline: "Recusar",
    cancel: "Cancelar aprovação",
    unconfirmed: "Resposta não confirmada",
    unconfirmedDescription: "Não foi possível confirmar se o Mac recebeu a resposta. Confira a tarefa no Mac antes de tentar novamente.",
  },
  "fr-FR": {
    titleCommand: "Autoriser l’exécution de cette commande ?",
    titleFileChange: "Autoriser ces modifications de fichiers ?",
    descriptionCommand:
      "Cette commande s’exécute sur votre ordinateur. Vérifiez la commande et le répertoire de travail avant de continuer.",
    descriptionFileChange:
      "Ces modifications seront écrites sur votre ordinateur. Vérifiez les chemins des fichiers avant de continuer.",
    commandLabel: "Commande",
    cwdLabel: "Répertoire de travail",
    pathsLabel: "Fichiers",
    fileOperations: { add: "Créer ou écraser", delete: "Supprimer", update: "Modifier", move: "Modifier et déplacer" },
    moveTo: "Destination (peut écraser un fichier existant)",
    allowOnce: "Autoriser une fois",
    decline: "Refuser",
    cancel: "Annuler l’autorisation",
    unconfirmed: "Réponse non confirmée",
    unconfirmedDescription: "Impossible de confirmer que votre Mac a reçu la réponse. Vérifiez la tâche sur votre Mac avant de réessayer.",
  },
  "ja-JP": {
    titleCommand: "このコマンドの実行を許可しますか？",
    titleFileChange: "これらのファイル変更を許可しますか？",
    descriptionCommand:
      "このコマンドはお使いのコンピューターで実行されます。実行前にコマンドと作業ディレクトリを確認してください。",
    descriptionFileChange:
      "これらの変更はお使いのコンピューターに書き込まれます。実行前にファイルのパスを確認してください。",
    commandLabel: "コマンド",
    cwdLabel: "作業ディレクトリ",
    pathsLabel: "ファイル",
    fileOperations: { add: "作成または上書き", delete: "削除", update: "編集", move: "編集して移動" },
    moveTo: "移動先（既存のファイルを上書きする場合があります）",
    allowOnce: "1 回だけ許可",
    decline: "拒否",
    cancel: "承認を取り消す",
    unconfirmed: "応答の受信を確認できません",
    unconfirmedDescription: "Mac が応答を受信したか確認できませんでした。再試行する前に、Mac でタスクの結果を確認してください。",
  },
} satisfies Record<Locale, DesktopApprovalMessages>
