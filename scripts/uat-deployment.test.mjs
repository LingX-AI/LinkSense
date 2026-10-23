import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { prepareUat } from "../deploy/uat/prepare.mjs";

const revision = "a".repeat(40);
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "linksense-uat-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, "deploy/baselines"), { recursive: true });
  writeFileSync(resolve(root, "deploy/baselines/images.lock.json"), readFileSync(new URL("../deploy/baselines/images.lock.json", import.meta.url)));
  writeFileSync(resolve(root, "package.json"), JSON.stringify({ version: "0.3.11" }));
  return root;
}
test("UAT updates preserve credentials and data identities while advancing source images", t => {
  const root = fixture(t);
  const first = prepareUat(root, { revision, publicUrl: "http://192.0.2.5:19090" });
  const second = prepareUat(root, { revision: "b".repeat(40), publicUrl: "http://192.0.2.5:19090" });
  for (const key of ["POSTGRES_PASSWORD", "REDIS_PASSWORD", "LINKSENSE_CREDENTIAL_MASTER_KEY", "LINKSENSE_JWT_SECRET", "LINKSENSE_INITIALIZATION_TOKEN", "LINKSENSE_POSTGRES_VOLUME", "LINKSENSE_USER_DATA_VOLUME"]) assert.equal(first[key], second[key], key);
  assert.notEqual(first.LINKSENSE_API_IMAGE, second.LINKSENSE_API_IMAGE);
  assert.equal(second.LINKSENSE_EDITION, "core");
  assert.equal(second.LINKSENSE_USER_DATA_VOLUME, "linksense-uat-user-data");
  assert.equal(second.LINKSENSE_VERSION, "v0.3.11");
  assert.equal(second.LINKSENSE_MAX_CONCURRENT_CONVERSATIONS, "1");
  assert.equal(Buffer.from(second.LINKSENSE_CREDENTIAL_MASTER_KEY, "base64").length, 32);
  for (const file of ["runtime.env", "initialization.txt"]) assert.equal(statSync(resolve(root, ".data/uat", file)).mode & 0o777, 0o600);
  assert(!("ELASTICSEARCH_PASSWORD" in second));
});
test("UAT rejects invalid origins and cross-project credential reuse", t => {
  const root = fixture(t);
  for (const publicUrl of ["file:///tmp/config", "http://user:secret@example.test", "https://example.test/path", "https://example.test/?token=secret"]) assert.throws(() => prepareUat(root, { revision, publicUrl }));
  assert.throws(() => prepareUat(root, { revision, project: "../production", publicUrl: "http://localhost:19090" }));
  assert.throws(() => prepareUat(root, { revision: "main", publicUrl: "http://localhost:19090" }));
  prepareUat(root, { revision, publicUrl: "http://localhost:19090" });
  assert.throws(() => prepareUat(root, { revision, project: "other-uat", publicUrl: "http://localhost:19090" }), /another project/u);
});
test("proxy-loaded baseline aliases keep the frozen image digests in their identity", t => {
  const root = fixture(t);
  const original = prepareUat(root, { revision, publicUrl: "http://localhost:19090" });
  const cached = prepareUat(root, { revision, publicUrl: "http://localhost:19090", cachedBaselines: true });
  for (const role of ["POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY"]) assert.equal(cached[`${role}_IMAGE`], `linksense-uat-cache/${role.toLowerCase()}:${original[`${role}_IMAGE`].split("sha256:")[1]}`);
  assert.equal(cached.POSTGRES_PASSWORD, original.POSTGRES_PASSWORD);
});
