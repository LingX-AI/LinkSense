import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const locales = [
  {
    name: "zh-CN",
    root: new URL("../docs/", import.meta.url),
    rules: [
      ["admin-guide/overview.md", /用户与用户组[\s\S]*角色与权限/u],
      ["admin-guide/users.md", /开放注册[\s\S]*系统设置/u],
      ["admin-guide/usage.md", /导出 Excel[\s\S]*月度账单[\s\S]*导出 PDF/u],
      ["user-guide/automations/create-and-manage.md", /每日简报[\s\S]*每周回顾[\s\S]*跟进监控/u],
      ["user-guide/tasks/files-and-results.md", /Mermaid[\s\S]*导出 PNG/u],
      ["user-guide/tasks/publish-websites.md", /访问者不需要登录[\s\S]*取消发布[\s\S]*隔离区域/u],
      ["user-guide/plugin-center/organization-apps.md", /应用安装包[\s\S]*应用服务[\s\S]*手动安装更新/u],
      ["admin-guide/plugin-governance.md", /审核应用中心版本[\s\S]*交互式应用[\s\S]*应用服务/u],
    ],
    obsolete: [/用户组与用户/u, /导出 CSV/u, /应用不需要安装/u, /已有组织共享会同步更新/u],
  },
  {
    name: "en-US",
    root: new URL(
      "../i18n/en-US/docusaurus-plugin-content-docs/current/",
      import.meta.url,
    ),
    rules: [
      ["admin-guide/overview.md", /Users & groups[\s\S]*Roles & permissions/u],
      ["admin-guide/users.md", /enable open registration[\s\S]*System settings/u],
      ["admin-guide/usage.md", /Export Excel[\s\S]*Monthly statements[\s\S]*export a PDF/u],
      ["user-guide/automations/create-and-manage.md", /Daily brief[\s\S]*Weekly review[\s\S]*Follow-up monitor/u],
      ["user-guide/tasks/files-and-results.md", /Mermaid[\s\S]*export a PNG/u],
      ["user-guide/tasks/publish-websites.md", /do not need to sign in[\s\S]*Unpublish[\s\S]*isolated surface/u],
      ["user-guide/plugin-center/organization-apps.md", /Application package[\s\S]*Application service[\s\S]*install the update manually/u],
      ["admin-guide/plugin-governance.md", /Review Application Center releases[\s\S]*Application service[\s\S]*Interactive applications/u],
    ],
    obsolete: [/Groups & users/u, /Export CSV/u, /Applications do not require installation/u, /automatically updates organization sharing/u],
  },
];

for (const locale of locales) {
  test(`help documents current product features (${locale.name})`, async () => {
    const sources = await Promise.all(
      locale.rules.map(async ([relativePath, rule]) => {
        const source = await readFile(new URL(relativePath, locale.root), "utf8");
        assert.match(source, rule, `${relativePath} is missing ${rule}`);
        return source;
      }),
    );

    const combined = sources.join("\n");
    for (const obsolete of locale.obsolete) {
      assert.doesNotMatch(combined, obsolete);
    }
  });
}
