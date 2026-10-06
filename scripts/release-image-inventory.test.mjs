import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finalUpstreamImages, hardenedImages, managedImages } from "./release-image-inventory.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "linksense-final-images-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = "registry.example/base@sha256:" + "a".repeat(64);
  const final = "registry.example/patched@sha256:" + "b".repeat(64);
  const inventory = join(directory, "upstream.env");
  writeFileSync(inventory, ["POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY", "ELASTICSEARCH", "DOCLING"].map(role => `IMAGE_${role}=${original}`).join("\n") + "\n");
  for (const name of Object.values(hardenedImages)) writeFileSync(join(directory, name), final + "\n");
  return { directory, inventory, original, final };
}

test("published upstream roles select the scanned hardened image, retaining only the unmodified server and BusyBox", t => {
  const f = fixture(t);
  const images = finalUpstreamImages(f.directory, f.inventory);
  for (const role of Object.keys(hardenedImages)) assert.equal(images[role], f.final);
  assert.equal(images.MINIO, f.original);
  assert.equal(images.BUSYBOX, f.original);
  assert.equal(managedImages.length, 11);
});

test("a missing final image cannot fall back to the original vulnerable image", t => {
  const f = fixture(t);
  rmSync(join(f.directory, "docling"));
  assert.throws(() => finalUpstreamImages(f.directory, f.inventory));
});

test("mutable candidate tags and duplicate frozen roles fail closed", t => {
  const f = fixture(t);
  writeFileSync(join(f.directory, "postgres"), "registry.example/patched:latest\n");
  assert.throws(() => finalUpstreamImages(f.directory, f.inventory));
  writeFileSync(f.inventory, Array(8).fill(`IMAGE_MINIO=${f.original}`).join("\n"));
  assert.throws(() => finalUpstreamImages(f.directory, f.inventory));
});
