import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const locales = [
  {
    name: "zh-CN",
    root: new URL("../docs/", import.meta.url),
    sharingRules: [
      /“发布更新”或“更新应用包”成功后[^\n]*只对创建者生效/u,
      /“组织内共享”[\s\S]*“保存共享”/u,
      /默认选中原来的共享用户和用户组/u,
      /接收者[^\n]*需要手动安装/u,
      /新建任务[^\n]*当前已安装版本/u,
      /下一次执行[^\n]*当前已安装版本/u,
      /已经开始执行[^\n]*不在执行中途切换/u,
      /只打开或刷新历史任务[^\n]*不会触发执行或自动安装更新/u,
      /应用中心[^\n]*已审核上架的版本/u,
    ],
    externalRules: [/启动前自动更新/u, /全部任务均已结束/u, /原版本、对话和工作文件保留/u, /恢复会话不会触发更新/u, /组织内共享及应用中心仍采用手动安装/u],
    nextExecution: /下一次执行/u,
    obsolete: /创建时固定的(?:应用)?包|历史任务固定使用创建时|在创建任务时固定对应的包版本/u,
    eventVersions: /历史事件[^\n]*schema_version/u,
    permissionBoundary: /只刷新页面不会更新权限/u,
  },
  {
    name: "en-US",
    root: new URL(
      "../i18n/en-US/docusaurus-plugin-content-docs/current/",
      import.meta.url,
    ),
    sharingRules: [
      /Publish update[^\n]*Update application package[^\n]*updates only the creator's installation/u,
      /Share within organization[\s\S]*Save sharing/u,
      /preselects existing users and user groups/u,
      /Recipients must manually install/u,
      /New task[^\n]*currently installed version/u,
      /Next execution[^\n]*currently installed version/u,
      /Already running[^\n]*does not switch mid-execution/u,
      /Only open or refresh a historical task[^\n]*Neither executes a task nor automatically installs/u,
      /Application Center[^\n]*approved and listed version/u,
    ],
    externalRules: [/installation updates automatically/u, /all of that user's tasks for this application have finished/u, /previous version, conversations, and work files are retained/u, /restoring a session does not trigger an update/u, /Organization sharing and Application Center continue to require manual installation/u],
    nextExecution: /next execution/iu,
    obsolete: /fixed at creation|fixed when the task was created|historical tasks remain pinned|fixes the corresponding package version when a task is created|Existing tasks retain their pinned package/iu,
    eventVersions: /Historical events[^\n]*schema_version/u,
    permissionBoundary: /Refreshing alone does not update permissions/u,
  },
];

for (const locale of locales) {
  const readGuide = (relativePath) =>
    readFile(new URL(relativePath, locale.root), "utf8");

  test(`shared application guide explains publication and execution boundaries (${locale.name})`, async () => {
    const source = await readGuide("user-guide/plugin-center/application-access.md");
    for (const rule of locale.sharingRules) {
      assert.ok(rule.test(source), `Missing sharing rule: ${rule}`);
    }
  });

  test(`external access updates only at an idle task start and retains data on failure (${locale.name})`, async () => {
    const source = await readGuide("user-guide/plugin-center/application-access.md");
    for (const rule of locale.externalRules) assert.ok(rule.test(source), `Missing external update rule: ${rule}`);
  });

  test(`interactive guides do not permanently pin tasks to their creation version (${locale.name})`, async () => {
    for (const relativePath of [
      "user-guide/plugin-center/create-applications.md",
      "user-guide/plugin-center/organization-apps.md",
      "developer-guide/interactive-application.md",
    ]) {
      const source = await readGuide(relativePath);
      assert.ok(locale.nextExecution.test(source), `${relativePath}: missing next-execution behavior`);
      assert.ok(!locale.obsolete.test(source), `${relativePath}: obsolete creation-version pin`);
    }
  });

  test(`interactive development guide preserves event and permission boundaries (${locale.name})`, async () => {
    const source = await readGuide("developer-guide/interactive-application.md");
    assert.ok(locale.eventVersions.test(source), "Historical event schema versions must be documented");
    assert.ok(locale.permissionBoundary.test(source), "Reloading must not be described as a permission upgrade");
  });
}
