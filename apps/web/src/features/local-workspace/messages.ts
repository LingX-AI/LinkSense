import type { Locale } from "@linksense/shared"

type LocalWorkspaceMessages = {
  title: string
  description: string
  size: string
  files: string
  workspaces: string
  policy: string
  cleanup: string
  loading: string
  unavailable: string
  busy: string
  nothingEligible: string
  completed: string
  failed: string
  retry: string
  clearedTitle: string
  clearedDescription: string
}

export const localWorkspaceMessages: Record<
  Locale,
  LocalWorkspaceMessages
> = {
  "zh-CN": {
    title: "本地工作区",
    description:
      "仅显示这台 Mac 上当前账号的本地任务文件；此清理只作用于当前账号，不涉及服务器存储。旧版本创建、未记录服务器来源的工作区会保留，不会在此显示或清理。",
    size: "占用",
    files: "文件",
    workspaces: "工作区",
    policy:
      "清理沿用现有策略：超过 {{days}} 天的工作区，或当前账号总量超过 {{budget}} 时最旧的工作区可被清理。进行中的任务、Codex 历史、已上传工件、受管文件和待处理附件会保留。",
    cleanup: "立即清理",
    loading: "正在读取本地工作区占用…",
    unavailable:
      "无法读取本地工作区占用。本地运行时可能未启动，请重试。",
    busy: "这台 Mac 上正在运行本地任务。请等任务结束后再试。",
    nothingEligible: "当前策略下没有符合条件的工作区。",
    completed: "清理完成，已释放 {{size}}。",
    failed: "无法清理本地工作区，请稍后重试。",
    retry: "重试",
    clearedTitle: "本地任务文件已清理",
    clearedDescription:
      "此会话在这台 Mac 上的任务文件已按保留策略清理。下次运行会重新创建空工作区；已上传的工件不受影响。",
  },
  "en-US": {
    title: "Local workspaces",
    description:
      "Shows local task files for your account on this Mac. This cleanup applies only to this account; server storage is not included. Workspaces created by earlier versions without a recorded server origin are kept and are not shown or cleaned here.",
    size: "Size",
    files: "Files",
    workspaces: "Workspaces",
    policy:
      "Cleanup follows the existing policy: workspaces older than {{days}} days, or the oldest workspaces when this account exceeds {{budget}}, are eligible. Active tasks, Codex history, uploaded artifacts, managed files, and pending attachments are kept.",
    cleanup: "Clean up now",
    loading: "Reading local workspace usage…",
    unavailable:
      "Local workspace usage is unavailable. The local runtime may be stopped; try again.",
    busy: "A local task is running on this Mac. Try again after it finishes.",
    nothingEligible:
      "No workspace is eligible for cleanup under the current policy.",
    completed: "Cleanup finished. {{size}} was freed.",
    failed: "Could not clean up local workspaces. Try again later.",
    retry: "Try again",
    clearedTitle: "Local task files were cleared",
    clearedDescription:
      "This conversation's task files on this Mac were cleared by storage cleanup. The next run starts with an empty workspace; uploaded artifacts are unaffected.",
  },
  "es-ES": {
    title: "Espacios de trabajo locales",
    description:
      "Solo se muestran los archivos de tareas locales de tu cuenta en este Mac. Esta limpieza afecta únicamente a esta cuenta; el almacenamiento del servidor no se incluye. Los espacios de trabajo creados por versiones anteriores sin un origen de servidor registrado se conservan y no se muestran ni se limpian aquí.",
    size: "Tamaño",
    files: "Archivos",
    workspaces: "Espacios de trabajo",
    policy:
      "La limpieza aplica la política actual: pueden eliminarse los espacios de trabajo de más de {{days}} días o los más antiguos cuando esta cuenta supera {{budget}}. Se conservan las tareas activas, el historial de Codex, los artefactos subidos, los archivos gestionados y los adjuntos pendientes.",
    cleanup: "Limpiar ahora",
    loading: "Leyendo el uso de los espacios de trabajo locales…",
    unavailable:
      "El uso de los espacios de trabajo locales no está disponible. Puede que el entorno local esté detenido; inténtalo de nuevo.",
    busy: "Hay una tarea local en ejecución en este Mac. Inténtalo cuando termine.",
    nothingEligible:
      "Ningún espacio de trabajo cumple la política actual.",
    completed: "Limpieza completada. Se liberaron {{size}}.",
    failed:
      "No se pudieron limpiar los espacios de trabajo locales. Inténtalo más tarde.",
    retry: "Reintentar",
    clearedTitle: "Se borraron los archivos locales de la tarea",
    clearedDescription:
      "Los archivos de esta conversación en este Mac se borraron con la limpieza de almacenamiento. La próxima ejecución comienza con un espacio de trabajo vacío; los artefactos subidos no se ven afectados.",
  },
  "pt-BR": {
    title: "Espaços de trabalho locais",
    description:
      "Mostra apenas os arquivos de tarefas locais da sua conta neste Mac. Esta limpeza afeta somente esta conta; o armazenamento do servidor não é incluído. Espaços de trabalho criados por versões anteriores sem uma origem de servidor registrada são preservados e não são exibidos nem limpos aqui.",
    size: "Tamanho",
    files: "Arquivos",
    workspaces: "Espaços de trabalho",
    policy:
      "A limpeza segue a política atual: espaços de trabalho com mais de {{days}} dias ou os mais antigos quando esta conta ultrapassa {{budget}} podem ser removidos. Tarefas ativas, histórico do Codex, artefatos enviados, arquivos gerenciados e anexos pendentes são preservados.",
    cleanup: "Limpar agora",
    loading: "Lendo o uso dos espaços de trabalho locais…",
    unavailable:
      "O uso dos espaços de trabalho locais não está disponível. O ambiente local pode estar parado; tente novamente.",
    busy: "Há uma tarefa local em execução neste Mac. Tente novamente quando ela terminar.",
    nothingEligible:
      "Nenhum espaço de trabalho atende à política atual.",
    completed: "Limpeza concluída. {{size}} foram liberados.",
    failed:
      "Não foi possível limpar os espaços de trabalho locais. Tente novamente mais tarde.",
    retry: "Tentar novamente",
    clearedTitle: "Os arquivos locais da tarefa foram removidos",
    clearedDescription:
      "Os arquivos desta conversa neste Mac foram removidos pela limpeza de armazenamento. A próxima execução começa com um espaço de trabalho vazio; os artefatos enviados não são afetados.",
  },
  "fr-FR": {
    title: "Espaces de travail locaux",
    description:
      "Affiche uniquement les fichiers de tâches locaux de votre compte sur ce Mac. Ce nettoyage ne concerne que ce compte ; le stockage serveur n’est pas inclus. Les espaces de travail créés par des versions antérieures sans origine de serveur enregistrée sont conservés et ne sont ni affichés ni nettoyés ici.",
    size: "Taille",
    files: "Fichiers",
    workspaces: "Espaces de travail",
    policy:
      "Le nettoyage applique la politique existante : les espaces de travail de plus de {{days}} jours, ou les plus anciens lorsque ce compte dépasse {{budget}}, peuvent être supprimés. Les tâches actives, l’historique Codex, les artefacts envoyés, les fichiers gérés et les pièces jointes en attente sont conservés.",
    cleanup: "Nettoyer maintenant",
    loading: "Lecture de l’utilisation des espaces de travail locaux…",
    unavailable:
      "L’utilisation des espaces de travail locaux est indisponible. Le runtime local est peut-être arrêté ; réessayez.",
    busy: "Une tâche locale est en cours sur ce Mac. Réessayez lorsqu’elle sera terminée.",
    nothingEligible:
      "Aucun espace de travail ne relève de la politique actuelle.",
    completed: "Nettoyage terminé. {{size}} ont été libérés.",
    failed:
      "Impossible de nettoyer les espaces de travail locaux. Réessayez plus tard.",
    retry: "Réessayer",
    clearedTitle: "Les fichiers locaux de la tâche ont été supprimés",
    clearedDescription:
      "Les fichiers de cette conversation sur ce Mac ont été supprimés par le nettoyage du stockage. La prochaine exécution repart d’un espace de travail vide ; les artefacts envoyés ne sont pas concernés.",
  },
  "ja-JP": {
    title: "ローカルワークスペース",
    description:
      "この Mac 上の現在のアカウントのローカルタスクファイルのみを表示します。このクリーンアップは現在のアカウントだけを対象とし、サーバーストレージは含まれません。以前のバージョンで作成され、サーバーオリジンが記録されていないワークスペースは保持され、ここには表示されずクリーンアップもされません。",
    size: "使用量",
    files: "ファイル",
    workspaces: "ワークスペース",
    policy:
      "クリーンアップは既存のポリシーに従います。{{days}} 日を超えたワークスペース、またはこのアカウントの合計が {{budget}} を超えた場合は最も古いワークスペースが対象になります。実行中のタスク、Codex の履歴、アップロード済みの成果物、管理ファイル、保留中の添付ファイルは保持されます。",
    cleanup: "今すぐクリーンアップ",
    loading: "ローカルワークスペースの使用量を読み込み中…",
    unavailable:
      "ローカルワークスペースの使用量を取得できません。ローカルランタイムが停止している可能性があります。再試行してください。",
    busy: "この Mac でローカルタスクが実行中です。終了後にもう一度お試しください。",
    nothingEligible:
      "現在のポリシーに該当するワークスペースはありません。",
    completed: "クリーンアップが完了しました。{{size}} を解放しました。",
    failed:
      "ローカルワークスペースをクリーンアップできませんでした。後でもう一度お試しください。",
    retry: "再試行",
    clearedTitle: "ローカルタスクファイルを削除しました",
    clearedDescription:
      "この Mac 上のこの会話のタスクファイルは、ストレージのクリーンアップにより削除されました。次回の実行では空のワークスペースが再作成されます。アップロード済みの成果物には影響しません。",
  },
}
