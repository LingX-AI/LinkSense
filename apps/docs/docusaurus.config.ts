import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "LinkSense 帮助中心",
  tagline: "LinkSense 用户与管理员使用指南",
  favicon: "img/linksense-appicon.svg",
  url: process.env.LINKSENSE_DOCS_SITE_URL ?? "http://localhost",
  baseUrl: "/help/",
  baseUrlIssueBanner: false,
  trailingSlash: true,
  onBrokenLinks: "throw",
  markdown: {
    format: "md",
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },
  i18n: {
    defaultLocale: "zh-CN",
    locales: ["zh-CN", "en-US"],
    localeConfigs: {
      "zh-CN": {
        label: "简体中文",
        htmlLang: "zh-CN",
      },
      "en-US": {
        label: "English",
        htmlLang: "en-US",
      },
    },
  },
  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          breadcrumbs: true,
        },
        blog: false,
        pages: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],
  themes: [
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: "filename",
        language: ["en", "zh"],
        docsRouteBasePath: "/",
        indexBlog: false,
        indexPages: false,
        searchBarShortcut: true,
        searchBarShortcutHint: true,
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],
  themeConfig: {
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 3,
    },
    colorMode: {
      defaultMode: "light",
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "帮助中心",
      logo: {
        alt: "LinkSense",
        src: "img/linksense-lockup-primary.svg",
        srcDark: "img/linksense-lockup-on-dark.svg",
      },
      hideOnScroll: false,
      items: [
        {
          type: "localeDropdown",
          position: "right",
        },
      ],
    },
    docs: {
      sidebar: {
        hideable: false,
        autoCollapseCategories: true,
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
