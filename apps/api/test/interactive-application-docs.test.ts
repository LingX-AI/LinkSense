import { readFile } from "node:fs/promises";

import {
  interactiveApplicationCustomEventDefinitionSchema,
  interactiveApplicationManifestSchema,
  interactiveApplicationPermissionSchema,
} from "@linksense/shared";
import { Ajv2020 } from "ajv/dist/2020.js";
import JSZip from "jszip";
import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";

import { inspectInteractiveApplicationArchive } from "../src/modules/applications/interactive-package.js";

const guides = [
  ["zh-CN", "../docs/docs/developer-guide/interactive-application.md"],
  [
    "en-US",
    "../docs/i18n/en-US/docusaurus-plugin-content-docs/current/developer-guide/interactive-application.md",
  ],
] as const;

describe.each(guides)("interactive application guide (%s)", (_locale, path) => {
  async function readGuide(): Promise<string> {
    return readFile(new URL(`../${path}`, import.meta.url), "utf8");
  }

  it("documents every manifest field, custom event field, and supported permission", async () => {
    const source = await readGuide();
    const documentedFields = new Set(
      [...source.matchAll(/^\| `([^`]+)` \|/gmu)].map((match) => match[1]),
    );
    const fields = [
      ...Object.keys(interactiveApplicationManifestSchema.shape),
      ...Object.keys(interactiveApplicationCustomEventDefinitionSchema.shape).map(
        (field) => `custom_events[].${field}`,
      ),
      ...interactiveApplicationPermissionSchema.options,
    ];

    for (const field of fields) {
      expect(documentedFields, `Missing field reference: ${field}`).toContain(field);
    }
  });

  it("provides importable minimal and full manifests with a valid business event example", async () => {
    const blocks = fromMarkdown(await readGuide())
      .children.filter((node) => node.type === "code")
      .filter((node) => node.lang === "json");
    const manifests = blocks.filter(
      (node) => node.meta === 'title="manifest.json"',
    );
    expect(manifests).toHaveLength(2);

    const prepared = [];
    for (const block of manifests) {
      const archive = new JSZip();
      archive.file("manifest.json", block.value);
      archive.file("index.html", "<!doctype html><title>Manifest example</title>");
      prepared.push(
        await inspectInteractiveApplicationArchive(
          await archive.generateAsync({ type: "nodebuffer" }),
        ),
      );
    }

    expect(prepared[0]?.manifest).toMatchObject({
      entry: "index.html",
      description: null,
      instructions: null,
      icon: null,
      permissions: ["tasks:write"],
      custom_events: [],
    });
    const fullManifest = prepared[1]?.manifest;
    expect(fullManifest?.custom_events).toHaveLength(1);
    expect(fullManifest?.permissions).toEqual(["tasks:write"]);

    const ajv = new Ajv2020({ allErrors: true, strict: false });
    for (const event of fullManifest?.custom_events ?? []) {
      const payloadBlock = blocks.find(
        (node) => node.meta === `title="${event.name}.payload.json"`,
      );
      expect(payloadBlock, `Missing payload example: ${event.name}`).toBeDefined();
      const payload: unknown = JSON.parse(payloadBlock?.value ?? "null");
      const validate = ajv.compile(event.payload_schema);
      expect(validate(payload), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({})).toBe(false);
      expect(validate(JSON.stringify(payload))).toBe(false);
    }
  });
});
