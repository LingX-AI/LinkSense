import type { SidebarsConfig } from "@docusaurus/plugin-content-docs"
import help from "./sidebars"

const sidebars = {
  helpSidebar: [
    { type: "doc", id: "introduction", key: "overview", label: "概览" },
    {
      type: "category",
      label: "自主部署",
      link: { type: "doc", id: "deploy/overview" },
      items: [
        "deploy/core",
        "deploy/full",
        "deploy/first-setup",
        "deploy/operations",
      ],
    },
    ...help.helpSidebar.slice(1).map((category) =>
      typeof category === "string"
        ? category
        : {
            ...category,
            items:
              category.label === "开发者指南"
                ? [
                    "deploy/development",
                    "deploy/architecture",
                    ...category.items,
                  ]
                : category.items,
          },
    ),
  ],
} satisfies SidebarsConfig

export default sidebars
