import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultDocsRoot = path.join(packageRoot, "docs");
const englishDocsRoot = path.join(
  packageRoot,
  "i18n",
  "en-US",
  "docusaurus-plugin-content-docs",
  "current",
);
const expectedMarkdownPaths = [
  "admin-guide/audit.md",
  "admin-guide/authentication-settings.md",
  "admin-guide/feedback.md",
  "admin-guide/groups.md",
  "admin-guide/health.md",
  "admin-guide/knowledge-governance.md",
  "admin-guide/knowledge-sources.md",
  "admin-guide/model-settings.md",
  "admin-guide/overview.md",
  "admin-guide/plugin-governance.md",
  "admin-guide/roles.md",
  "admin-guide/system-settings.md",
  "admin-guide/system-update.md",
  "admin-guide/usage.md",
  "admin-guide/users.md",
  "developer-guide/embed-application.md",
  "developer-guide/interactive-application.md",
  "introduction.md",
  "user-guide/automations/create-and-manage.md",
  "user-guide/feedback.md",
  "user-guide/getting-started/first-task.md",
  "user-guide/getting-started/password-and-sso.md",
  "user-guide/getting-started/registration.md",
  "user-guide/getting-started/sign-in.md",
  "user-guide/knowledge-bases/create-and-manage.md",
  "user-guide/knowledge-bases/documents.md",
  "user-guide/knowledge-bases/sharing.md",
  "user-guide/knowledge-bases/use-and-citations.md",
  "user-guide/mcp/connect-and-manage.md",
  "user-guide/message-channels/dingtalk.md",
  "user-guide/message-channels/feishu.md",
  "user-guide/message-channels/teams.md",
  "user-guide/message-channels/wecom.md",
  "user-guide/message-channels/weixin.md",
  "user-guide/overview.md",
  "user-guide/plugin-center/application-access.md",
  "user-guide/plugin-center/application-usage.md",
  "user-guide/plugin-center/clawhub.md",
  "user-guide/plugin-center/create-applications.md",
  "user-guide/plugin-center/credentials.md",
  "user-guide/plugin-center/discover-and-install.md",
  "user-guide/plugin-center/organization-apps.md",
  "user-guide/plugin-center/personal-content.md",
  "user-guide/settings/appearance.md",
  "user-guide/settings/archived-tasks.md",
  "user-guide/settings/general.md",
  "user-guide/settings/personalization.md",
  "user-guide/settings/profile.md",
  "user-guide/settings/security.md",
  "user-guide/tasks/branch-and-organize.md",
  "user-guide/tasks/create-and-run.md",
  "user-guide/tasks/file-annotations.md",
  "user-guide/tasks/files-and-results.md",
  "user-guide/tasks/goal-tasks.md",
  "user-guide/tasks/manage-history.md",
  "user-guide/tasks/plan-mode.md",
  "user-guide/tasks/running-requests.md",
  "user-guide/tasks/voice-input.md",
  "user-guide/troubleshooting/common-problems.md",
];

async function markdownPaths(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) return markdownPaths(root, entryPath);
      if (entry.isFile() && entry.name.endsWith(".md")) {
        return [path.relative(root, entryPath)];
      }
      return [];
    }),
  );
  return nested.flat().sort();
}

function stripFrontMatter(source) {
  if (!source.startsWith("---\n")) return source;
  const end = source.indexOf("\n---\n", 4);
  return end === -1 ? source : source.slice(end + 5);
}

function markdownLinks(source) {
  return [...stripFrontMatter(source).matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1]?.trim())
    .filter((target) => {
      if (!target) return false;
      return !/^(?:[a-z]+:|#|\/)/iu.test(target);
    });
}

async function assertContentTree(root, paths) {
  for (const relativePath of paths) {
    const absolutePath = path.join(root, relativePath);
    const source = await readFile(absolutePath, "utf8");
    const frontMatterEnd = source.indexOf("\n---\n", 4);
    assert.ok(source.startsWith("---\n") && frontMatterEnd > 4);
    const frontMatter = source.slice(4, frontMatterEnd);
    assert.match(frontMatter, /^title:\s*.+$/mu);
    assert.match(frontMatter, /^description:\s*.+$/mu);
    assert.match(stripFrontMatter(source), /^#\s+.+/mu);

    for (const target of markdownLinks(source)) {
      const withoutHash = target.split("#", 1)[0];
      if (!withoutHash) continue;
      const resolved = path.resolve(path.dirname(absolutePath), withoutHash);
      assert.ok(
        resolved.startsWith(`${root}${path.sep}`),
        `${relativePath} links outside its locale tree: ${target}`,
      );
      const targetSource = await readFile(resolved, "utf8");
      assert.ok(
        targetSource.length > 0,
        `${relativePath} has a broken link: ${target}`,
      );
    }
  }
}

test("Chinese and English guides have one-to-one Markdown files", async () => {
  const [defaultPaths, englishPaths] = await Promise.all([
    markdownPaths(defaultDocsRoot),
    markdownPaths(englishDocsRoot),
  ]);

  assert.deepEqual(defaultPaths, expectedMarkdownPaths);
  assert.deepEqual(englishPaths, defaultPaths);
});

test("every guide has required metadata, a heading, and valid local links", async () => {
  const paths = await markdownPaths(defaultDocsRoot);
  await Promise.all([
    assertContentTree(defaultDocsRoot, paths),
    assertContentTree(englishDocsRoot, paths),
  ]);
});

test("administrator guides remain public documentation, not hidden content", async () => {
  const config = await readFile(
    path.join(packageRoot, "docusaurus.config.ts"),
    "utf8",
  );
  const sidebars = await readFile(
    path.join(packageRoot, "sidebars.ts"),
    "utf8",
  );

  assert.match(sidebars, /label: "管理员指南"/u);
  assert.doesNotMatch(config, /authGuard|requireRole|permissionGuard/u);
  assert.doesNotMatch(sidebars, /user\.role|requireRole|permissionGuard/u);
});

test("the explicit sidebar includes every guide", async () => {
  const sidebars = await readFile(
    path.join(packageRoot, "sidebars.ts"),
    "utf8",
  );

  for (const relativePath of expectedMarkdownPaths) {
    const documentId = relativePath.replace(/\.md$/u, "");
    assert.match(
      sidebars,
      new RegExp(
        `["']${documentId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["']`,
        "u",
      ),
      `sidebar is missing ${documentId}`,
    );
  }
});

test("local search indexes both languages and uses accessible custom clear controls", async () => {
  const [config, searchPatch, englishMessages] = await Promise.all([
    readFile(path.join(packageRoot, "docusaurus.config.ts"), "utf8"),
    readFile(
      path.resolve(
        packageRoot,
        "../..",
        "patches",
        "@easyops-cn__docusaurus-search-local@0.55.3.patch",
      ),
      "utf8",
    ),
    readFile(path.join(packageRoot, "i18n", "en-US", "code.json"), "utf8"),
  ]);

  assert.match(config, /@easyops-cn\/docusaurus-search-local/u);
  assert.match(config, /language:\s*\["en", "zh"\]/u);
  assert.match(searchPatch, /aria-label=\{translate\(\{/u);
  assert.match(searchPatch, /id: "theme\.SearchBar\.clearButtonLabel"/u);
  assert.match(
    searchPatch,
    /"theme\.SearchBar\.clearButtonLabel": "清除搜索"/u,
  );
  assert.match(
    englishMessages,
    /"theme\.SearchBar\.clearButtonLabel":\s*\{\s*"message": "Clear search"/u,
  );
  assert.match(searchPatch, /className=\{styles\.searchQueryClearButton\}/u);
  assert.match(searchPatch, /searchInputRef\.current\?\.focus\(\)/u);
  assert.match(
    searchPatch,
    /\.searchQueryInput::-webkit-search-cancel-button/u,
  );
  assert.match(
    searchPatch,
    /<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">/u,
  );
  assert.doesNotMatch(searchPatch, /<span aria-hidden="true">✕<\/span>/u);
  assert.doesNotMatch(searchPatch, /\+.*aria-label="Search"/u);
});

test("site chrome uses the full LinkSense lockup and preserves the app icon favicon", async () => {
  const [config, titleFormatter, appIcon, primaryLockup, darkLockup, navbarTranslations] = await Promise.all([
    readFile(path.join(packageRoot, "docusaurus.config.ts"), "utf8"),
    readFile(
      path.join(
        packageRoot,
        "src",
        "theme",
        "ThemeProvider",
        "TitleFormatter",
        "index.tsx",
      ),
      "utf8",
    ),
    readFile(
      path.join(packageRoot, "static", "img", "linksense-appicon.svg"),
      "utf8",
    ),
    readFile(
      path.join(packageRoot, "static", "img", "linksense-lockup-primary.svg"),
      "utf8",
    ),
    readFile(
      path.join(packageRoot, "static", "img", "linksense-lockup-on-dark.svg"),
      "utf8",
    ),
    readFile(
      path.join(
        packageRoot,
        "i18n",
        "en-US",
        "docusaurus-theme-classic",
        "navbar.json",
      ),
      "utf8",
    ),
  ]);

  assert.match(config, /baseUrlIssueBanner:\s*false/u);
  assert.match(config, /favicon:\s*"img\/linksense-appicon\.svg"/u);
  assert.match(
    config,
    /navbar:\s*\{\s*title:\s*"帮助中心",\s*logo:\s*\{\s*alt:\s*"LinkSense",\s*src:\s*"img\/linksense-lockup-primary\.svg",\s*srcDark:\s*"img\/linksense-lockup-on-dark\.svg",\s*\}/u,
  );
  assert.match(appIcon, /<title>LinkSense app icon/u);
  assert.match(appIcon, /fill="#1866E1"/u);
  assert.match(primaryLockup, /<title>LinkSense horizontal lockup — primary<\/title>/u);
  assert.match(primaryLockup, /fill="#1B1D20"/u);
  assert.match(darkLockup, /<title>LinkSense horizontal lockup — on dark<\/title>/u);
  assert.match(darkLockup, /fill="#FFFFFF"/u);
  assert.match(navbarTranslations, /"message": "Help Center"/u);
  assert.match(titleFormatter, /"zh-CN": "LinkSense 帮助中心"/u);
  assert.match(titleFormatter, /"en-US": "LinkSense Help Center"/u);
  assert.match(titleFormatter, /currentLocale/u);
});

test("the minimal theme uses neutral surfaces and removes visual clutter", async () => {
  const [config, theme] = await Promise.all([
    readFile(path.join(packageRoot, "docusaurus.config.ts"), "utf8"),
    readFile(path.join(packageRoot, "src", "css", "custom.css"), "utf8"),
  ]);

  assert.match(config, /hideable:\s*false/u);
  assert.match(config, /autoCollapseCategories:\s*true/u);
  assert.match(theme, /--doc-sidebar-width:\s*276px/u);
  assert.match(theme, /--linksense-sidebar:\s*#fafbfb/u);
  assert.match(theme, /--linksense-code-block-background:\s*#f8f9fb/u);
  assert.match(theme, /--linksense-code-block-border:\s*rgb\(32 32 32 \/ 8%\);/u);
  assert.match(theme, /--linksense-code-block-text:\s*#202936/u);
  assert.match(theme, /--linksense-code-token-key:\s*#344356/u);
  assert.match(theme, /--linksense-code-token-string:\s*#2f6b2f/u);
  assert.match(theme, /--linksense-code-token-punctuation:\s*#44505f/u);
  assert.match(theme, /--linksense-code-button-surface:\s*rgb\(255 255 255 \/ 82%\);/u);
  assert.match(theme, /--linksense-code-button-active:\s*#202020/u);
  assert.match(theme, /\.navbar__brand\s*\{[\s\S]*font-size:\s*16px;/u);
  assert.match(theme, /\.navbar__brand\s*\{[\s\S]*gap:\s*8px;/u);
  assert.match(
    theme,
    /\.navbar__logo\s*\{[\s\S]*height:\s*28px;[\s\S]*margin-right:\s*0;/u,
  );
  assert.match(
    theme,
    /\.navbar__logo img\s*\{[\s\S]*width:\s*auto;[\s\S]*height:\s*28px;/u,
  );
  assert.match(theme, /\.menu__link\s*\{[\s\S]*font-size:\s*14px;/u);
  assert.match(
    theme,
    /\.theme-doc-sidebar-item-category-level-1[\s\S]*font-size:\s*13\.5px;/u,
  );
  assert.match(theme, /\.theme-doc-breadcrumbs\s*\{\s*display:\s*none;/u);
  assert.match(theme, /\.theme-doc-markdown h2\s*\{[\s\S]*border:\s*0;/u);
  assert.match(
    theme,
    /\.theme-doc-markdown pre\s*\{[\s\S]*border:\s*1px solid var\(--linksense-code-block-border\);[\s\S]*background:\s*var\(--linksense-code-block-background\) !important;[\s\S]*color:\s*var\(--linksense-code-block-text\);/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown \.prism-code,\s*\.theme-doc-markdown pre code\s*\{[\s\S]*background:\s*var\(--linksense-code-block-background\) !important;[\s\S]*color:\s*var\(--linksense-code-block-text\) !important;/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown \.language-text \.token-line,\s*\.theme-doc-markdown \.language-text \.token-line span,[\s\S]*color:\s*var\(--linksense-code-block-text\) !important;[\s\S]*opacity:\s*1 !important;/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown \.prism-code \.token\.property,[\s\S]*color:\s*var\(--linksense-code-token-key\) !important;/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown \.prism-code \.token\.string,[\s\S]*color:\s*var\(--linksense-code-token-string\) !important;/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown \.prism-code \.token\.punctuation,[\s\S]*color:\s*var\(--linksense-code-token-punctuation\) !important;/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown \.theme-code-block \[class\*="buttonGroup"\]\s*\{[\s\S]*top:\s*12px;[\s\S]*column-gap:\s*6px;/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown \.theme-code-block \[class\*="buttonGroup"\] button\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*width:\s*34px;[\s\S]*background:\s*var\(--linksense-code-button-surface\);[\s\S]*line-height:\s*0;[\s\S]*opacity:\s*1;/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown \.theme-code-block \[class\*="buttonGroup"\] button > svg,[\s\S]*display:\s*block;[\s\S]*flex:\s*0 0 auto;/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown \.theme-code-block button\[class\*="wordWrapButtonEnabled"\]\s*\{[\s\S]*background:\s*var\(--linksense-code-button-active\);[\s\S]*color:\s*var\(--linksense-code-button-active-color\);/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown \.theme-code-block \[class\*="copyButtonCopied"\]\s*\{[\s\S]*color:\s*var\(--linksense-link\);/u,
  );
  assert.doesNotMatch(theme, /#ddeaf2/iu);
});

test("desktop pages expose a responsive native table of contents", async () => {
  const [config, theme] = await Promise.all([
    readFile(path.join(packageRoot, "docusaurus.config.ts"), "utf8"),
    readFile(path.join(packageRoot, "src", "css", "custom.css"), "utf8"),
  ]);

  assert.match(
    config,
    /tableOfContents:\s*\{\s*minHeadingLevel:\s*2,\s*maxHeadingLevel:\s*3,/u,
  );
  assert.match(theme, /--linksense-toc-width:\s*clamp\(184px, 15vw, 216px\);/u);
  assert.match(
    theme,
    /@media \(min-width: 1200px\)[\s\S]*\.theme-doc-toc-desktop\s*\{[\s\S]*display:\s*block;/u,
  );
  assert.match(
    theme,
    /main \.row > \[class\*="docItemCol"\] \+ \.col\.col--3[\s\S]*flex:\s*0 0 var\(--linksense-toc-width\);/u,
  );
  assert.match(
    theme,
    /\.theme-doc-toc-desktop \.table-of-contents\s*\{[\s\S]*border-left:\s*1px solid var\(--linksense-divider\);/u,
  );
  assert.match(
    theme,
    /\.theme-doc-toc-desktop \.table-of-contents__link--active\s*\{[\s\S]*color:\s*var\(--linksense-text\);[\s\S]*font-weight:\s*600;/u,
  );
  assert.match(
    theme,
    /\.theme-doc-toc-desktop \.table-of-contents__link--active::before\s*\{[\s\S]*width:\s*2px;[\s\S]*background:\s*var\(--linksense-text\);/u,
  );
  assert.match(
    theme,
    /\.theme-doc-markdown :is\(h2, h3\)\[id\]\s*\{[\s\S]*scroll-margin-top:\s*calc\(var\(--ifm-navbar-height\) \+ 24px\);/u,
  );
});

test("help center controls use softened interaction states and consistent popovers", async () => {
  const theme = await readFile(
    path.join(packageRoot, "src", "css", "custom.css"),
    "utf8",
  );

  assert.match(theme, /--linksense-text:\s*#202020;/u);
  assert.match(theme, /--linksense-muted:\s*#626262;/u);
  assert.match(theme, /--linksense-link:\s*#174a7e;/u);
  assert.match(theme, /--linksense-input:\s*#eeeeee;/u);
  assert.match(theme, /--linksense-popover:\s*#ffffff;/u);
  assert.match(theme, /--linksense-radius:\s*0\.7rem;/u);
  assert.match(
    theme,
    /--linksense-popover-radius:\s*calc\(var\(--linksense-radius\) \* 1\.4\);/u,
  );
  assert.match(
    theme,
    /--linksense-hover:\s*color-mix\(\s*in srgb,\s*var\(--linksense-hover-source\) 64%,\s*var\(--linksense-canvas\)\s*\);/u,
  );
  assert.match(
    theme,
    /--linksense-active:\s*color-mix\(\s*in srgb,\s*var\(--linksense-active-source\) 52%,\s*var\(--linksense-canvas\)\s*\);/u,
  );
  assert.match(
    theme,
    /--linksense-surface-muted:\s*color-mix\(\s*in srgb,\s*var\(--linksense-hover-source\) 58%,\s*var\(--linksense-canvas\)\s*\);/u,
  );
  assert.equal(theme.match(/--linksense-hover:\s*color-mix\(/gu)?.length, 2);
  assert.equal(theme.match(/--linksense-active:\s*color-mix\(/gu)?.length, 2);
  assert.equal(
    theme.match(/--linksense-input-hover-surface:\s*color-mix\(/gu)?.length,
    2,
  );
  assert.equal(
    theme.match(/--linksense-surface-muted:\s*color-mix\(/gu)?.length,
    2,
  );
  assert.equal(
    theme.match(/--ifm-hover-overlay:\s*var\(--linksense-hover\);/gu)?.length,
    2,
  );
  assert.match(
    theme,
    /--ifm-menu-color-background-active:\s*var\(--linksense-active\);/u,
  );
  assert.match(
    theme,
    /--ifm-menu-color-background-hover:\s*var\(--linksense-hover\);/u,
  );
  assert.match(theme, /--linksense-border:\s*rgb\(32 32 32 \/ 10%\);/u);
  assert.match(
    theme,
    /--linksense-shadow:\s*0 12px 34px rgb\(0 0 0 \/ 9%\), 0 1px 5px rgb\(0 0 0 \/ 5%\);/u,
  );
  assert.match(
    theme,
    /\.navbar__search-input\s*\{[\s\S]*height:\s*32px;[\s\S]*font-size:\s*14px;/u,
  );
  assert.match(
    theme,
    /\.navbar__search > span\[class\*="searchBar"\]\s*\{[\s\S]*display:\s*block !important;[\s\S]*width:\s*100% !important;[\s\S]*max-width:\s*100%;/u,
  );
  assert.match(
    theme,
    /@media \(min-width: 577px\)[\s\S]*\.navbar__search \.navbar__search-input\s*\{[\s\S]*width:\s*100% !important;/u,
  );
  assert.match(
    theme,
    /\.navbar__search \[class\*="searchIcon"\]\s*\{[\s\S]*width:\s*14px;[\s\S]*height:\s*14px;/u,
  );
  assert.match(
    theme,
    /\.navbar__search-input:focus-visible\s*\{[\s\S]*border-color:\s*var\(--linksense-input-focus-border\);[\s\S]*outline:\s*none !important;[\s\S]*box-shadow:\s*none !important;/u,
  );
  assert.match(
    theme,
    /\.navbar__search \[class\*="dropdownMenu"\]\s*\{[\s\S]*border:\s*1px solid var\(--linksense-border\);[\s\S]*border-radius:\s*var\(--linksense-popover-radius\) !important;[\s\S]*box-shadow:\s*var\(--linksense-shadow\) !important;/u,
  );
  assert.match(
    theme,
    /\.dropdown__menu\s*\{[\s\S]*border-radius:\s*var\(--linksense-popover-radius\);/u,
  );
  assert.match(
    theme,
    /\.navbar__search \[class\*="suggestion"\]\s*\{[\s\S]*background:\s*transparent !important;[\s\S]*box-shadow:\s*none !important;/u,
  );
  assert.match(
    theme,
    /\.navbar__search \[class\*="hitIcon"\]\s*\{[\s\S]*flex:\s*0 0 16px;[\s\S]*width:\s*16px;[\s\S]*height:\s*16px;/u,
  );
  assert.match(
    theme,
    /\.navbar__search \[class\*="hitIcon"\] > svg\s*\{[\s\S]*width:\s*16px;[\s\S]*height:\s*16px;/u,
  );
  assert.match(
    theme,
    /\.navbar__search \[class\*="hitAction"\]\s*\{[\s\S]*flex:\s*0 0 16px;[\s\S]*width:\s*16px;[\s\S]*height:\s*16px;/u,
  );
  assert.match(
    theme,
    /\.navbar__search \[class\*="hitAction"\] > svg\s*\{[\s\S]*width:\s*16px;[\s\S]*height:\s*16px;/u,
  );
  assert.match(
    theme,
    /\[class\*="suggestion"\]\[class\*="cursor"\][\s\S]*background:\s*var\(--linksense-active\) !important;/u,
  );
  assert.match(
    theme,
    /\.dropdown__link--active,\s*\.dropdown__link--active:hover\s*\{\s*background:\s*var\(--linksense-active\);/u,
  );
  assert.match(
    theme,
    /\.menu__list-item-collapsible--active,\s*\.menu__list-item-collapsible--active:hover\s*\{\s*background:\s*var\(--linksense-active\);/u,
  );
  assert.match(
    theme,
    /\.pagination__item:not\(\.pagination__item--active\):hover \.pagination__link,\s*\.pills__item:not\(\.pills__item--active\):hover\s*\{\s*background:\s*var\(--linksense-hover\);/u,
  );
  assert.match(
    theme,
    /:where\(a, button, input, select, textarea, \[tabindex\]\):focus-visible/u,
  );
  assert.match(
    theme,
    /main \.row > \[class\*="docItemCol"\][\s\S]*max-width:\s*100% !important;/u,
  );
  assert.match(
    theme,
    /\[class\*="docMainContainer"\] \.container[\s\S]*padding:\s*50px clamp\(32px, 7vw, 112px\) 84px;/u,
  );
  assert.match(
    theme,
    /\[class\*="docItemContainer"\][\s\S]*max-width:\s*780px;/u,
  );
  assert.match(theme, /html\[data-theme="dark"\][\s\S]*#252525/u);
  assert.doesNotMatch(theme, /--linksense-hover:\s*#(?:e9e9e9|2c2c2c);/iu);
  assert.doesNotMatch(theme, /--linksense-active:\s*#(?:e3e3e3|343434);/iu);
  assert.doesNotMatch(theme, /#24617d/iu);
});

test("shared navigation and admonition icons use compact size tiers", async () => {
  const theme = await readFile(
    path.join(packageRoot, "src", "css", "custom.css"),
    "utf8",
  );

  assert.match(
    theme,
    /\.navbar \[class\*="iconLanguage"\]\s*\{[\s\S]*width:\s*16px;[\s\S]*height:\s*16px;[\s\S]*margin-inline-end:\s*4px;/u,
  );
  assert.match(
    theme,
    /\.theme-admonition \[class\*="admonitionIcon"\]\s*\{[\s\S]*margin-inline-end:\s*6px;/u,
  );
  assert.match(
    theme,
    /\.theme-admonition \[class\*="admonitionIcon"\] svg\s*\{[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;/u,
  );
});

test("document pagination replaces text guillemets with compact directional icons", async () => {
  const theme = await readFile(
    path.join(packageRoot, "src", "css", "custom.css"),
    "utf8",
  );

  assert.match(
    theme,
    /\.pagination-nav \.pagination-nav__link--prev \.pagination-nav__label::before,\s*\.pagination-nav \.pagination-nav__link--next \.pagination-nav__label::after\s*\{[\s\S]*width:\s*14px;[\s\S]*height:\s*14px;[\s\S]*background:\s*currentColor;[\s\S]*content:\s*"";[\s\S]*mask:[\s\S]*data:image\/svg\+xml/u,
  );
  assert.match(
    theme,
    /\.pagination-nav \.pagination-nav__link--prev \.pagination-nav__label::before\s*\{[\s\S]*margin-inline-end:\s*5px;[\s\S]*transform:\s*rotate\(180deg\);/u,
  );
  assert.match(
    theme,
    /\.pagination-nav \.pagination-nav__link--next \.pagination-nav__label::after\s*\{[\s\S]*margin-inline-start:\s*5px;/u,
  );
  assert.match(
    theme,
    /\[dir="rtl"\][\s\S]*\.pagination-nav__link--prev[\s\S]*transform:\s*none;[\s\S]*\[dir="rtl"\][\s\S]*\.pagination-nav__link--next[\s\S]*transform:\s*rotate\(180deg\);/u,
  );
});
