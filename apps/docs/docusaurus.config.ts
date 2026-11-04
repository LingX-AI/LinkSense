import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const publicDocs = process.env.LINKSENSE_PUBLIC_DOCS === "1";
const websiteTheme = process.env.LINKSENSE_WEBSITE_THEME;
if (publicDocs && !websiteTheme) {
  throw new Error(
    "Build public documentation from linksense-site using pnpm docs:build.",
  );
}

const config: Config = {
  title: "LinkSense 帮助中心",
  tagline: "LinkSense 用户与管理员使用指南",
  favicon: "img/linksense-appicon.svg",
  url: process.env.LINKSENSE_DOCS_SITE_URL ?? "http://localhost",
  baseUrl: "/help/",
  customFields: { publicDocs },
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
    path: publicDocs ? ".public-docs/i18n" : "i18n",
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
          path: publicDocs ? ".public-docs/docs" : "docs",
          routeBasePath: "/",
          sidebarPath: publicDocs ? "./sidebars.public.ts" : "./sidebars.ts",
          breadcrumbs: true,
        },
        blog: false,
        pages: false,
        theme: {
          customCss: [
            "./src/css/custom.css",
            ...(publicDocs && websiteTheme
              ? [websiteTheme, "./src/css/website.css"]
              : []),
          ],
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
        docsDir: publicDocs
          ? [
              ".public-docs/docs",
              ".public-docs/i18n/en-US/docusaurus-plugin-content-docs/current",
            ]
          : "docs",
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
      respectPrefersColorScheme: !publicDocs,
      disableSwitch: publicDocs,
    },
    navbar: {
      title: publicDocs ? "" : "帮助中心",
      logo: {
        alt: "LinkSense",
        src: "img/linksense-lockup-primary.svg",
        srcDark: publicDocs
          ? "img/linksense-lockup-primary.svg"
          : "img/linksense-lockup-on-dark.svg",
      },
      hideOnScroll: false,
      items: [
        ...(publicDocs
          ? [
              {
                to: "/",
                label: "文档",
                position: "left" as const,
                exact: true,
                className: "website-nav-link",
              },
              {
                href: "https://github.com/LingX-AI/linksense/discussions",
                label: "社区",
                position: "left" as const,
                className: "website-nav-link",
                target: "_self",
              },
            ]
          : []),
        {
          type: "localeDropdown",
          position: "right",
        },
        ...(publicDocs
          ? [
              {
                href: "https://github.com/LingX-AI/linksense",
                label: "GitHub",
                position: "right" as const,
                className: "website-repo",
                target: "_self",
              },
              {
                href: "https://explore.linksense.org/",
                label: "在线体验",
                position: "right" as const,
                className: "website-cta",
                target: "_self",
              },
            ]
          : []),
      ],
    },
    docs: {
      sidebar: {
        hideable: false,
        autoCollapseCategories: !publicDocs,
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
