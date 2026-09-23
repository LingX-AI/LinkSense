import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { interactiveApplicationManifestSchema } from "@linksense/shared";
import { backendI18n } from "../src/lib/i18n.js";
import { actor, OWNER, TASK, developmentFixture } from "./application-development.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const fixture = await developmentFixture();
  roots.push(fixture.root);
  return fixture;
}

describe("application development task titles", () => {
  it.each([
    ["zh-CN", "开发 调研报告生成器"],
    ["en-US", "Develop 调研报告生成器"],
  ] as const)("prefixes a new development task in %s without renaming the application", async (locale, title) => {
    const f = await setup();
    const project = await f.service.create(actor, { name: "调研报告生成器" }, locale);
    expect(await f.store.conversation()).toMatchObject({ title });
    expect(project.name).toBe("调研报告生成器");
    expect(f.conversations.createDevelopmentPreview).toHaveBeenCalledWith(OWNER,
      expect.objectContaining({ name: "调研报告生成器" }), expect.anything());
    expect(f.conversations.patch).toHaveBeenCalledWith(OWNER, TASK, { title });
  });

  it("names an ordinary task when the development tool opens a project in it", async () => {
    const f = await setup();
    await f.service.tool(actor, TASK, OWNER, { operation: "open", name: "天气助手" }, "zh-CN", f.workspace);
    expect(await f.store.conversation()).toMatchObject({ title: "开发 天气助手" });
    expect(f.conversations.create).not.toHaveBeenCalled();
  });

  it("updates the task when the source application name changes", async () => {
    const f = await setup();
    const project = await f.service.create(actor, { name: "测试应用" }, "zh-CN");
    const path = join(f.workspace, project.directory, "manifest.json");
    const manifest = interactiveApplicationManifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
    await writeFile(path, JSON.stringify({ ...manifest, name: "调研报告生成器" }));
    const changed = await f.service.sync(actor, project.id);
    expect(changed.name).toBe("调研报告生成器");
    expect(await f.store.conversation()).toMatchObject({ title: "开发 调研报告生成器" });
  });

  it("updates an existing unprefixed task on sync without rewriting it on each poll", async () => {
    const f = await setup();
    const project = await f.service.create(actor, { name: "现有应用" }, "zh-CN");
    await f.conversations.patch(OWNER, TASK, { title: "现有应用" });
    f.conversations.patch.mockClear();
    const synchronized = await f.service.sync(actor, project.id);
    expect(await f.store.conversation()).toMatchObject({ title: "开发 现有应用" });
    await f.service.sync(actor, project.id);
    expect(f.conversations.patch).toHaveBeenCalledTimes(1);
    expect(synchronized).toMatchObject({ revision: project.revision, preview_conversation_id: project.preview_conversation_id });
  });

  it("keeps a current English title during unchanged polls and does not duplicate its prefix on reopen", async () => {
    const f = await setup();
    const project = await f.service.create(actor, { name: "Report & Notes" }, "en-US");
    f.conversations.patch.mockClear();
    await f.service.sync(actor, project.id);
    await f.service.open(actor, TASK, { name: "Ignored" }, "en-US");
    expect(await f.store.conversation()).toMatchObject({ title: "Develop Report & Notes" });
    expect(f.conversations.patch).not.toHaveBeenCalled();
  });

  it("uses the current draft name when continuing development of an installed application", async () => {
    const f = await setup();
    const project = await f.service.create(actor, { name: "新版应用" }, "zh-CN");
    f.store.sourceApplication.mockResolvedValue({ application: { id: OWNER, name: "已安装旧版" }, assets: [] });
    await f.conversations.patch(OWNER, TASK, { title: "旧任务标题" });
    expect((await f.service.resume(actor, OWNER, "zh-CN")).id).toBe(project.id);
    expect(await f.store.conversation()).toMatchObject({ title: "开发 新版应用" });
    expect(f.conversations.create).toHaveBeenCalledTimes(1);
  });

  it("does not rename another user's task", async () => {
    const f = await setup();
    const project = await f.service.create(actor, { name: "Report" }, "zh-CN");
    f.conversations.patch.mockClear();
    await expect(f.service.sync({ ...actor, id: TASK }, project.id)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
    expect(f.conversations.patch).not.toHaveBeenCalled();
  });

  it.each([
    ["zh-CN", "开发 Report"], ["en-US", "Develop Report"], ["de-DE", "开发 Report"],
  ])("translates the title in %s with Chinese fallback", (locale, expected) => {
    expect(backendI18n.t("applicationDevelopment.taskTitle", { lng: locale, name: "Report" })).toBe(expected);
  });
});
