import type { Locale } from "@linksense/shared"

type AccountAccessMessages = {
  brandHeadline: string
  brandDescription: string
  brandProducts: string
  emailPlaceholder: string
  passwordPlaceholder: string
}

export const accountAccessMessages: Record<Locale, AccountAccessMessages> = {
  "zh-CN": {
    brandHeadline: "你的 AI 伙伴。\n随时为你准备就绪。",
    brandDescription: "助你处理知识、分析与日常工作。",
    brandProducts: "应用 · 插件 · 技能 · 知识",
    emailPlaceholder: "请输入邮箱地址",
    passwordPlaceholder: "请输入密码",
  },
  "en-US": {
    brandHeadline: "Your AI partner.\nReady when you are.",
    brandDescription: "For knowledge, analysis, and everyday work.",
    brandProducts: "Applications · Plugins · Skills · Knowledge",
    emailPlaceholder: "Enter your email address",
    passwordPlaceholder: "Enter your password",
  },
  "es-ES": {
    brandHeadline: "Tu compañero de IA.\nSiempre a tu disposición.",
    brandDescription: "Para el conocimiento, el análisis y el trabajo diario.",
    brandProducts: "Aplicaciones · Plugins · Habilidades · Conocimiento",
    emailPlaceholder: "Introduce tu correo electrónico",
    passwordPlaceholder: "Introduce tu contraseña",
  },
  "pt-BR": {
    brandHeadline: "Seu parceiro de IA.\nPronto quando você precisar.",
    brandDescription: "Para conhecimento, análise e trabalho diário.",
    brandProducts: "Aplicativos · Plugins · Habilidades · Conhecimento",
    emailPlaceholder: "Digite seu e-mail",
    passwordPlaceholder: "Digite sua senha",
  },
  "fr-FR": {
    brandHeadline: "Votre partenaire IA.\nÀ vos côtés, à tout moment.",
    brandDescription:
      "Pour vos connaissances, vos analyses et votre quotidien.",
    brandProducts: "Applications · Plugins · Compétences · Connaissances",
    emailPlaceholder: "Saisissez votre adresse e-mail",
    passwordPlaceholder: "Saisissez votre mot de passe",
  },
  "ja-JP": {
    brandHeadline: "あなたの AI パートナー。\nいつでも、あなたとともに。",
    brandDescription: "知識の活用、分析、日々の仕事をサポート。",
    brandProducts: "アプリ · プラグイン · スキル · ナレッジ",
    emailPlaceholder: "メールアドレスを入力",
    passwordPlaceholder: "パスワードを入力",
  },
}
