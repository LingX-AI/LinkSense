import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { inspectInteractiveApplicationArchive } from "../src/modules/applications/interactive-package.js";

describe("interactive application package inspection", () => {
  it("accepts a root manifest, entry document, and static assets", async () => {
    const archive = await packageArchive({
      manifest: {
        schema_version: 1,
        id: "research-workbench",
        name: "Research workbench",
        version: "1.0.0",
        sdk_version: 1,
        custom_events: [
          {
            name: "research.section_ready",
            description: "A section is ready.",
            payload_schema: {
              type: "object",
              additionalProperties: false,
              required: ["title"],
              properties: { title: { type: "string" } },
            },
          },
        ],
      },
    });

    const prepared = await inspectInteractiveApplicationArchive(archive);

    expect(prepared.manifest.name).toBe("Research workbench");
    expect(prepared.assets.map((asset) => asset.path)).toEqual([
      "app.js",
      "index.html",
      "manifest.json",
    ]);
    expect(prepared.assets.find((asset) => asset.path === "index.html"))
      .toMatchObject({ contentType: "text/html; charset=utf-8" });
  });

  it("rejects a package without index.html", async () => {
    const archive = await packageArchive({ includeIndex: false });
    await expect(inspectInteractiveApplicationArchive(archive)).rejects.toEqual(
      expect.objectContaining({ code: "APPLICATION_PACKAGE_INVALID" }),
    );
  });

  it("rejects a custom event schema that is not an object", async () => {
    const archive = await packageArchive({
      manifest: {
        schema_version: 1,
        id: "research-workbench",
        name: "Research workbench",
        version: "1.0.0",
        sdk_version: 1,
        custom_events: [
          {
            name: "research.invalid",
            description: "Invalid event.",
            payload_schema: { type: "string" },
          },
        ],
      },
    });
    await expect(inspectInteractiveApplicationArchive(archive)).rejects.toEqual(
      expect.objectContaining({ code: "APPLICATION_PACKAGE_INVALID" }),
    );
  });

  it("accepts the LinkSense-styled research brief example as an importable package", async () => {
    const exampleDirectory = fileURLToPath(
      new URL(
        "../../../examples/interactive-research-brief/",
        import.meta.url,
      ),
    );
    const archive = new JSZip();
    for (const fileName of [
      "manifest.json",
      "index.html",
      "styles.css",
      "app.js",
      "README.txt",
    ]) {
      archive.file(
        fileName,
        await readFile(`${exampleDirectory}/${fileName}`),
      );
    }

    const prepared = await inspectInteractiveApplicationArchive(
      Buffer.from(await archive.generateAsync({ type: "uint8array" })),
    );
    const indexDocument = await readFile(
      `${exampleDirectory}/index.html`,
      "utf8",
    );
    const stylesheet = await readFile(
      `${exampleDirectory}/styles.css`,
      "utf8",
    );

    expect(prepared.manifest).toMatchObject({
      id: "interactive-research-brief",
      version: "1.2.0",
      entry: "index.html",
      sdk_version: 1,
    });
    expect(prepared.manifest.permissions).toContain("files:write");
    expect(prepared.assets.map((asset) => asset.path)).toEqual([
      "app.js",
      "index.html",
      "manifest.json",
      "README.txt",
      "styles.css",
    ]);
    expect(indexDocument).toContain(
      '<script src="/api/v1/interactive-app-runtime/sdk/v1.js?v=1.1.0" defer></script>',
    );
    expect(indexDocument).toContain('class="builder-panel"');
    expect(indexDocument).toContain('class="results-panel"');
    expect(indexDocument).not.toContain('class="brand-mark"');
    expect(stylesheet).toContain("--surface-muted: #f3f3f1;");
    expect(stylesheet).toContain("border: 1px solid var(--border);");
    expect(stylesheet).toContain("@media (max-width: 1120px)");
  });
});

async function packageArchive(options: {
  includeIndex?: boolean;
  manifest?: Record<string, unknown>;
} = {}) {
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify(
      options.manifest ?? {
        schema_version: 1,
        id: "research-workbench",
        name: "Research workbench",
        version: "1.0.0",
        sdk_version: 1,
      },
    ),
  );
  if (options.includeIndex !== false) {
    zip.file(
      "index.html",
      '<!doctype html><script src="/api/v1/interactive-app-runtime/sdk/v1.js"></script><script src="./app.js"></script>',
    );
  }
  zip.file("app.js", "void LinkSense.ready();");
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}
