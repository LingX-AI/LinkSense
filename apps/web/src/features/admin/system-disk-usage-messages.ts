import type { Locale } from "@linksense/shared"

type DiskMessages = { title: string; checkedAt: string }

export const diskUsageMessages = {
  "zh-CN": {
    title: "磁盘占用",
    checkedAt: "统计时间：{{time}}",
  },
  "en-US": {
    title: "Disk usage",
    checkedAt: "Measured at: {{time}}",
  },
  "es-ES": {
    title: "Uso de disco",
    checkedAt: "Medido: {{time}}",
  },
  "pt-BR": {
    title: "Uso de disco",
    checkedAt: "Medido em: {{time}}",
  },
  "fr-FR": {
    title: "Utilisation du disque",
    checkedAt: "Mesuré le : {{time}}",
  },
  "ja-JP": {
    title: "ディスク使用量",
    checkedAt: "集計日時：{{time}}",
  },
} satisfies Record<Locale, DiskMessages>
