import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { preparationStatePath, recordStoragePreparation, storageNeedsInitialization } from "./dev-preparation.mjs";

test("storage preparation reuses only the same existing directory with unchanged permissions", () => {
  const root = mkdtempSync(resolve(tmpdir(), "linksense-preparation-"));
  const directory = resolve(root, "users");
  const statePath = preparationStatePath(root, resolve(root, ".env"), {});
  try {
    assert.equal(storageNeedsInitialization(statePath, directory, "configuration"), true);
    mkdirSync(directory, { mode: 0o770 });
    recordStoragePreparation(statePath, directory, "configuration");
    assert.equal(storageNeedsInitialization(statePath, directory, "configuration"), false);
    assert.equal(storageNeedsInitialization(statePath, directory, "changed configuration"), true);
    writeFileSync(resolve(directory, "user-file"), "content");
    assert.equal(storageNeedsInitialization(statePath, directory, "configuration"), false);
    chmodSync(directory, 0o700);
    assert.equal(storageNeedsInitialization(statePath, directory, "configuration"), true);
    recordStoragePreparation(statePath, directory, "configuration");
    renameSync(directory, resolve(root, "previous-users"));
    mkdirSync(directory, { mode: 0o700 });
    assert.equal(storageNeedsInitialization(statePath, directory, "configuration"), true);
    writeFileSync(statePath, "malformed");
    assert.equal(storageNeedsInitialization(statePath, directory, "configuration"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("storage preparation is isolated by environment, Compose project and Docker target", () => {
  const base = preparationStatePath("/checkout", "/checkout/.env", {});
  for (const environment of [{ COMPOSE_PROJECT_NAME: "second" }, { DOCKER_CONTEXT: "other" }, { DOCKER_HOST: "ssh://other" }]) {
    assert.notEqual(preparationStatePath("/checkout", "/checkout/.env", environment), base);
  }
  assert.notEqual(preparationStatePath("/checkout", "/checkout/.env.second", {}), base);
});
