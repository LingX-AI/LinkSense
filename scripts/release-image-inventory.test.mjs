import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finalUpstreamImages, managedImages } from "./release-image-inventory.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "linksense-final-images-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = "registry.example/base@sha256:" + "a".repeat(64);
  const inventory = join(directory, "upstream.env");
  writeFileSync(inventory, ["POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY", "ELASTICSEARCH", "DOCLING"].map(role => `IMAGE_${role}=${original}`).join("\n") + "\n");
  return { directory, inventory, original };
}

test("application releases reuse every frozen service baseline and promote only application images", t => {
  const f = fixture(t);
  const images = finalUpstreamImages(f.inventory);
  for (const reference of Object.values(images)) assert.equal(reference, f.original);
  assert.equal(images.MINIO, f.original);
  assert.equal(images.BUSYBOX, f.original);
  assert.deepEqual(managedImages, ["api", "web", "migrate", "runner", "worker"]);
});

test("a missing service baseline cannot fall back to resolving a mutable vendor tag", t => {
  const f = fixture(t);
  writeFileSync(f.inventory, `IMAGE_MINIO=${f.original}\n`);
  assert.throws(() => finalUpstreamImages(f.inventory));
});

test("mutable candidate tags and duplicate frozen roles fail closed", t => {
  const f = fixture(t);
  writeFileSync(f.inventory, ["POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY", "ELASTICSEARCH", "DOCLING"].map(role => `IMAGE_${role}=registry.example/patched:latest`).join("\n"));
  assert.throws(() => finalUpstreamImages(f.inventory));
  writeFileSync(f.inventory, Array(8).fill(`IMAGE_MINIO=${f.original}`).join("\n"));
  assert.throws(() => finalUpstreamImages(f.inventory));
});
