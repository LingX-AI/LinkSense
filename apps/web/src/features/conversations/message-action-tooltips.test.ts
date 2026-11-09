import { describe, expect, it } from "vitest"

import i18n from "@/i18n"

describe("compact message action labels", () => {
  it.each([
    ["zh-CN", "复制", "旁聊", "分支", "编辑", "引用"],
    ["en-US", "Copy", "Side chat", "Branch", "Edit", "Quote"],
    ["es-ES", "Copiar", "Chat lateral", "Crear rama", "Editar", "Citar"],
    ["pt-BR", "Copiar", "Conversa lateral", "Ramificar", "Editar", "Citar"],
    [
      "fr-FR",
      "Copier",
      "Discussion parallèle",
      "Créer une branche",
      "Modifier",
      "Citer",
    ],
    ["ja-JP", "コピー", "サイドチャット", "分岐", "編集", "引用"],
    ["de-DE", "复制", "旁聊", "分支", "编辑", "引用"],
  ])("provides compact message action labels in %s", (language, ...labels) => {
    const t = i18n.getFixedT(language)
    expect([
      t("common.copy"),
      t("sideChat.title"),
      t("conversation.forkMessageTooltip"),
      t("common.edit"),
      t("sideChat.carryTooltip"),
    ]).toEqual(labels)
  })
})
