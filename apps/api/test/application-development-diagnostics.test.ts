import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { instrumentApplicationPreview } from "../src/modules/applications/development-diagnostics.js";
import { applicationDevelopmentTemplate } from "../src/modules/applications/development-template.js";

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
  it.each(["zh-CN", "en-US"] as const)("creates a localized working SDK starter in %s and escapes the name", locale => {
    const files = applicationDevelopmentTemplate('<img src=x onerror="alert(1)">', "test", locale);
    expect(files["index.html"]).toContain(`lang="${locale}"`);
    expect(files["index.html"]).not.toContain("<img");
    expect(files["index.html"]).toContain("/api/v1/interactive-app-runtime/sdk/v1.js");
    expect(files["app.js"]).toContain("await window.LinkSense.ready()");
    expect(files["app.js"]).toContain("window.LinkSense.tasks.run");
    expect(JSON.parse(files["manifest.json"]!)).toMatchObject({ sdk_version: 1, permissions: ["tasks:write", "files:write"] });
  });
});
