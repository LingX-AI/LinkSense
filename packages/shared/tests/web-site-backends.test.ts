import { describe, expect, it } from "vitest";
import { generatedWebSiteBackendHostLabel, webSiteBackendConfigureSchema, webSiteBackendHostSchema, webSiteBackendPrepareSchema, webSiteBackendSchema } from "../src/web-site-backends.js";
import { webSiteCreateSchema, webSiteToolRequestSchema } from "../src/web-sites.js";

const id = "40000000-0000-4000-8000-000000000001";
describe("public application backend contracts", () => {
  it("recognizes existing UUID hosts without accepting them as new chosen addresses", () => {
    expect(webSiteBackendHostSchema.parse(id)).toBe(id);
    expect(generatedWebSiteBackendHostLabel(id)).toBe("400000000000");
    expect(webSiteBackendHostSchema.parse(generatedWebSiteBackendHostLabel(id))).toBe("400000000000");
    expect(webSiteBackendPrepareSchema.safeParse({ name: "App", address: id }).success).toBe(false);
  });
  it("keeps pre-backend website creation valid and supports explicit dynamic publication", () => {
    const original = { conversation_id: id, file_id: id, name: "Existing website" };
    expect(webSiteCreateSchema.parse(original)).not.toHaveProperty("backend_id");
    expect(webSiteCreateSchema.parse({ ...original, backend_id: id }).backend_id).toBe(id);
    expect(webSiteToolRequestSchema.parse({ operation: "prepare_backend", name: "Appointments" }).operation).toBe("prepare_backend");
  });
  it("defaults new resources to private and prevents privileged scopes and destructive schema changes", () => {
    const table = webSiteBackendConfigureSchema.parse({ backend_id: id, change: { action: "create_table", id: "appointments", name: "Appointments" } });
    expect(table.change).toMatchObject({ public_read: false, columns: [], indexes: [] });
    for (const change of [
      { action: "delete_table", id: "appointments" },
      { action: "add_column", table_id: "appointments", column: { key: "new", type: "boolean", required: true } },
      { action: "create_function", id: "approval", name: "Approval", entrypoint: "../outside.js" },
      { action: "create_function", id: "approval", name: "Approval", entrypoint: "main.js", scopes: ["keys.write"] },
      { action: "inspect", path: "/project/keys" },
      { action: "inspect", path: "/functions/../project" },
    ]) expect(webSiteBackendConfigureSchema.safeParse({ backend_id: id, change }).success).toBe(false);
  });
  it("does not expose credentials through the public backend projection", () => {
    const backend = webSiteBackendSchema.parse({
      id, project_id: "ls-app", name: "App", status: "ready", origin: "https://app.example.test",
      endpoint: "https://app.example.test/appwrite/v1", database_id: "app", secret: "must-not-escape",
    });
    expect(backend).not.toHaveProperty("secret");
    expect(backend.runtime_mode).toBe("origin");
  });
  it("describes sandbox applications without replacing the existing origin contract", () => {
    const value = webSiteBackendSchema.parse({
      id, project_id: "ls-app", name: "App", status: "ready", origin: "https://console.example.test",
      endpoint: "https://console.example.test/app/demo/_rpc", database_id: "app", runtime_mode: "sandbox",
      url: "https://console.example.test/app/demo", sdk_url: "https://console.example.test/app/_sdk/v1.js",
    });
    expect(value.runtime_mode).toBe("sandbox");
    expect(value.url).toBe("https://console.example.test/app/demo");
    expect(webSiteBackendSchema.safeParse({ ...value, runtime_mode: "untrusted-origin" }).success).toBe(false);
  });
});
