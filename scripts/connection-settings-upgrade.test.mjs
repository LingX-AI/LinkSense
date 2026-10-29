import assert from "node:assert/strict";
import test from "node:test";
import { register as registerCjs } from "tsx/cjs/api";
import { register } from "tsx/esm/api";

registerCjs();
register();
const { upgradeConnectionSettings } = await import("../prisma/connection-settings-upgrade.ts");
const { encryptJson, decryptJson } = await import("../apps/api/src/lib/crypto.ts");
const { connectionSettingsStorage } = await import("../packages/shared/src/connection-settings.ts");
const encryption = { masterKey: "test-only-connector-upgrade-master-key", keyId: "test" };
const previousContext = "linksense:social-authentication:v1";

function fixture(previous) {
  let json = previous;
  let writes = 0;
  const tx = {
    $executeRaw: async () => 1,
    systemSetting: {
      findUnique: async () => json === undefined ? null : { settingsJson: json },
      upsert: async ({ create, update }) => { json = json === undefined ? create.settingsJson : update.settingsJson; writes++; },
    },
  };
  return {
    prisma: { $transaction: async (run) => run(tx) },
    json: () => json,
    setJson: (value) => { json = value; },
    writes: () => writes,
    envelope: () => decryptJson(json[connectionSettingsStorage.key], encryption.masterKey, encryption.keyId, connectionSettingsStorage.context),
  };
}

test("the fresh deployment keeps seed defaults and initializes an independent empty connector envelope", async () => {
  const f = fixture();
  assert.deepEqual(await upgradeConnectionSettings(f.prisma, encryption), { initialized: true, configuredProviders: 0 });
  assert.deepEqual(f.envelope(), {});
  assert.equal(f.json().system_initialized, false);
  assert.equal(f.json().default_locale, "zh-CN");
  assert.deepEqual(f.json().self_registration, { enabled: false });
});

test("upgrading real pre-split encrypted settings copies both provider apps without changing login or user grants", async () => {
  const previous = {
    google: { revision: 6, enabled: false, client_id: "old-google-app", client_secret: "old-google-private" },
    microsoft: { revision: 9, enabled: false, client_id: "old-microsoft-app", client_secret: "old-microsoft-private" },
    github: { revision: 1, enabled: true, client_id: "github", client_secret: "github-private" },
  };
  const original = encryptJson(previous, encryption.masterKey, encryption.keyId, previousContext);
  const f = fixture({ system_initialized: true, organization_display_name: "Existing organization", social_authentication_encrypted: original, existing_setting: { keep: true } });
  assert.deepEqual(await upgradeConnectionSettings(f.prisma, encryption), { initialized: true, configuredProviders: 5 });
  assert.equal(f.json().social_authentication_encrypted, original);
  assert.equal(f.json().system_initialized, true);
  assert.equal(f.json().organization_display_name, "Existing organization");
  assert.deepEqual(f.json().existing_setting, { keep: true });
  for (const provider of ["onedrive", "sharepoint", "outlook", "google_docs", "gmail"]) {
    const old = previous[provider === "google_docs" || provider === "gmail" ? "google" : "microsoft"];
    assert.deepEqual(f.envelope()[provider], { revision: 1, client_id: old.client_id, client_secret: old.client_secret });
  }
  assert.ok(!JSON.stringify(f.json()).includes("-private"));
  assert.throws(() => decryptJson(f.json()[connectionSettingsStorage.key], encryption.masterKey, encryption.keyId, previousContext));
});

test("repeated deployment never reimports login credentials or overwrites independently saved connector settings", async () => {
  const f = fixture({ social_authentication_encrypted: encryptJson({ microsoft: { client_id: "old-app", client_secret: "old-private" } }, encryption.masterKey, encryption.keyId, previousContext) });
  await upgradeConnectionSettings(f.prisma, encryption);
  const modified = { ...f.envelope(), onedrive: { revision: 3, client_id: "new-connector-app", client_secret: "connector-private" } };
  f.setJson({ ...f.json(), [connectionSettingsStorage.key]: encryptJson(modified, encryption.masterKey, encryption.keyId, connectionSettingsStorage.context) });
  const before = structuredClone(f.json());
  await upgradeConnectionSettings(f.prisma, encryption);
  assert.deepEqual(f.json(), before);
  assert.equal(f.envelope().onedrive.client_id, "new-connector-app");
  assert.equal(f.writes(), 1);
});

test("an empty or incomplete old configuration does not inherit a login app created after upgrade", async () => {
  const f = fixture({});
  await upgradeConnectionSettings(f.prisma, encryption);
  f.setJson({ ...f.json(), social_authentication_encrypted: encryptJson({ google: { client_id: "later-login", client_secret: "later-private" } }, encryption.masterKey, encryption.keyId, previousContext) });
  await upgradeConnectionSettings(f.prisma, encryption);
  assert.deepEqual(f.envelope(), {});
});

test("invalid previous or new envelopes and missing encryption keys fail without overwriting data", async () => {
  for (const json of [null, [], "invalid-settings", { social_authentication_encrypted: "corrupt-private" }, { [connectionSettingsStorage.key]: "corrupt-private" }]) {
    const f = fixture(json);
    await assert.rejects(upgradeConnectionSettings(f.prisma, encryption));
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.json(), json);
  }
  const f = fixture({});
  await assert.rejects(upgradeConnectionSettings(f.prisma, { masterKey: "", keyId: "test" }));
  assert.equal(f.writes(), 0);
});
