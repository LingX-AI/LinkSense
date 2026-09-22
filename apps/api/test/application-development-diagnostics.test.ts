import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { instrumentApplicationPreview } from "../src/modules/applications/development-diagnostics.js";
import { applicationDevelopmentTemplate } from "../src/modules/applications/development-template.js";

const starterLocales = [
  { locale: "zh-CN", title: "从这里开始创建应用", starting: "已受理，正在启动…", unavailable: "暂时无法读取任务状态，请重新打开应用重试。" },
  { locale: "en-US", title: "Your application starts here", starting: "Accepted, starting…", unavailable: "Unable to read task status. Reopen the application to retry." },
  { locale: "es-ES", title: "Tu aplicación empieza aquí", starting: "Aceptada, iniciando…", unavailable: "No se pudo consultar el estado de la tarea. Vuelve a abrir la aplicación para reintentarlo." },
  { locale: "pt-BR", title: "Seu aplicativo começa aqui", starting: "Aceita, iniciando…", unavailable: "Não foi possível ler o status da tarefa. Reabra o aplicativo para tentar novamente." },
  { locale: "fr-FR", title: "Votre application commence ici", starting: "Acceptée, démarrage…", unavailable: "Impossible de lire l’état de la tâche. Rouvrez l’application pour réessayer." },
  { locale: "ja-JP", title: "ここからアプリを作成", starting: "受け付けました。開始中…", unavailable: "タスクの状態を取得できません。アプリを開き直して再試行してください。" },
] as const;

describe("preview diagnostics and starter", () => {
  it("installs listeners before application scripts and bounds error and rejection reports", () => {
    const html = instrumentApplicationPreview('<script src="app.js"></script><h1>Application</h1>');
    expect(html.indexOf("linksense:development")).toBeLessThan(html.indexOf('src="app.js"'));
    const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];
    if (!script) throw new Error("bootstrap missing");
    const listeners = new Map<string, (event: unknown) => void>(); const postMessage = vi.fn();
    runInNewContext(script, { parent: { postMessage }, addEventListener: (type: string, callback: (event: unknown) => void) => listeners.set(type, callback) });
    listeners.get("error")?.({ message: "broken app", filename: "app.js", lineno: 3 });
    listeners.get("unhandledrejection")?.({ reason: "private value" });
    for (let i = 0; i < 25; i++) listeners.get("error")?.({ target: { src: "missing.js" } });
    expect(postMessage).toHaveBeenCalledTimes(20);
    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({ protocol: "linksense:development", type: "diagnostic", diagnostic: { message: "broken app", file: "app.js", line: 3 } });
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("private value");
  });
  it.each(starterLocales)("creates a localized working SDK starter in $locale and escapes the name", ({ locale, title }) => {
    const files = applicationDevelopmentTemplate('<img src=x onerror="alert(1)">', "test", locale);
    expect(files["index.html"]).toContain(`lang="${locale}"`);
    expect(files["index.html"]).toContain(`<h1>${title}</h1>`);
    expect(files["index.html"]).not.toContain("applicationTemplate.");
    expect(files["index.html"]).not.toContain("<img");
    expect(files["index.html"]).toContain("/api/v1/interactive-app-runtime/sdk/v1.js");
    expect(files["app.js"]).toContain("await window.LinkSense.ready()");
    expect(files["app.js"]).toContain("window.LinkSense.tasks.run");
    expect(JSON.parse(files["manifest.json"]!)).toMatchObject({ sdk_version: 1, permissions: ["tasks:write", "files:write"] });
  });
});

describe("starter task restoration behavior", () => {
  it.each(starterLocales)("restores server state and prevents automatic resubmission in $locale", async ({ locale, starting, unavailable: unavailableMessage }) => {
    const files = applicationDevelopmentTemplate("Example", "example", locale);
    const button = { disabled: true };
    const status = { textContent: "" };
    let submit: ((event: { preventDefault(): void }) => Promise<void>) | undefined;
    let update: ((state: { status: string; can_submit: boolean }) => void) | undefined;
    let unavailable: (() => void) | undefined;
    const form = { querySelector: () => button, addEventListener: (_: string, fn: typeof submit) => { submit = fn; } };
    const run = vi.fn();
    const sdk = { ready: async () => undefined, tasks: {
      run,
      onStateChange: (fn: typeof update, error: typeof unavailable) => { update = fn; unavailable = error; return () => undefined; },
      getState: async () => { update?.({ status: "starting", can_submit: false }); },
    } };
    runInNewContext(files["app.js"]!, { window: { LinkSense: sdk, addEventListener: vi.fn() }, document: { querySelector: (selector: string) => selector === "form" ? form : selector === "#status" ? status : { value: "A request" } } });
    await vi.waitFor(() => expect(status.textContent).toBe(starting));
    expect(button.disabled).toBe(true);
    await submit?.({ preventDefault: vi.fn() });
    expect(run).not.toHaveBeenCalled();
    update?.({ status: "completed", can_submit: true });
    expect(button.disabled).toBe(false);
    unavailable?.();
    expect(button.disabled).toBe(true);
    expect(status.textContent).toBe(unavailableMessage);
    update?.({ status: "interrupted", can_submit: true });
    expect(button.disabled).toBe(false);
  });
});
