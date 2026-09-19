import assert from "node:assert/strict";
import test from "node:test";
import { developmentImageBuildEnvironment } from "./dev.mjs";
import { developmentOwnerLabel, developmentRoleLabel, developmentImageGroups, developmentResourceOwner, planDevelopmentImageBuilds, buildDevelopmentImageGroups, planDevelopmentImageCleanup, cleanupDevelopmentImages } from "./dev-images.mjs";

const owner = "a".repeat(64);
const otherOwner = "b".repeat(64);
const id = (n) => `sha256:${n.toString(16).padStart(64, "0")}`;
const environment = {
  LINKSENSE_DEV_RESOURCE_OWNER: owner,
  LINKSENSE_DEV_IMAGE_FINGERPRINT: "dependencies-v2", LINKSENSE_DOCS_IMAGE_FINGERPRINT: "docs-v2",
  LINKSENSE_MIGRATION_IMAGE_FINGERPRINT: "migration-v2", LINKSENSE_WORKER_IMAGE_FINGERPRINT: "worker-v2",
};
const image = (n, overrides = {}) => ({ Id: id(n), Created: `2026-09-${String(n).padStart(2, "0")}T00:00:00Z`, RepoTags: null, Config: { Labels: { [developmentOwnerLabel]: owner, [developmentRoleLabel]: "docs" } }, ...overrides });

test("Watch replaces all stale fingerprints and the next startup reuses the built images", async () => {
  const next = developmentImageBuildEnvironment("/checkout/.env", environment, {
    api: "dependencies-v3", docs: "docs-v3", migrate: "migration-v3", "runner-worker-image": "worker-v3",
  });
  const labels = new Map();
  const read = (image, label) => labels.get(image)?.[label];
  const built = [];
  const groups = planDevelopmentImageBuilds(next, ["api", "web", "runner", "docs"], read);
  await buildDevelopmentImageGroups(groups, async (services) => {
    built.push(services);
    const group = groups.find((entry) => entry.services === services);
    for (const name of group.images) labels.set(name, { [group.label]: group.fingerprint, [developmentOwnerLabel]: next.LINKSENSE_DEV_RESOURCE_OWNER, [developmentRoleLabel]: group.role });
  });
  assert.deepEqual(built, [["api", "runner", "web"], ["docs"]]);
  assert.equal(next.LINKSENSE_MIGRATION_IMAGE_FINGERPRINT, "migration-v3");
  assert.equal(next.LINKSENSE_WORKER_IMAGE_FINGERPRINT, "worker-v3");
  const startup = planDevelopmentImageBuilds(next, ["api", "runner", "web", "docs"], read);
  assert.ok(startup.every((group) => !group.needsBuild));
  await buildDevelopmentImageGroups(startup, async () => assert.fail("unchanged startup must not build"));
});

test("a docs-only edit never builds or replaces the shared application image group", async () => {
  const groups = planDevelopmentImageBuilds(environment, ["docs"], () => undefined);
  assert.deepEqual(await buildDevelopmentImageGroups(groups, async (services) => assert.deepEqual(services, ["docs"])), ["docs"]);
});

test("ownership, role, missing tags and explicit rebuilds invalidate an otherwise matching fingerprint", () => {
  const group = developmentImageGroups(environment)[0];
  const correct = { [group.label]: group.fingerprint, [developmentOwnerLabel]: owner, [developmentRoleLabel]: group.role };
  assert.equal(planDevelopmentImageBuilds(environment, ["api"], (_image, label) => correct[label])[0].needsBuild, false);
  for (const missing of [group.label, developmentOwnerLabel, developmentRoleLabel]) {
    assert.equal(planDevelopmentImageBuilds(environment, ["api"], (_image, label) => label === missing ? undefined : correct[label])[0].needsBuild, true);
  }
  assert.equal(planDevelopmentImageBuilds(environment, ["api"], (_image, label) => correct[label], true)[0].needsBuild, true);
  assert.throws(() => planDevelopmentImageBuilds(environment, ["postgres"], () => undefined), /Unknown/);
});

test("a failed image group stops subsequent builds", async () => {
  let builds = 0;
  await assert.rejects(buildDevelopmentImageGroups(planDevelopmentImageBuilds(environment, ["api", "docs"], () => undefined), async () => { builds++; throw new Error("build failed"); }), /build failed/);
  assert.equal(builds, 1);
});

test("resource ownership separates worktrees and environment files without embedding their paths", () => {
  assert.notEqual(developmentResourceOwner("/a", "/a/.env"), developmentResourceOwner("/b", "/a/.env"));
  assert.notEqual(developmentResourceOwner("/a", "/a/.env"), developmentResourceOwner("/a", "/a/.env.other"));
  assert.match(developmentResourceOwner("/a", "/a/.env"), /^[a-f0-9]{64}$/u);
});

test("retention keeps the current version, all container references and the newest unused image per role", () => {
  const images = [image(1), image(2), image(3), image(4), image(5), image(6, { Config: { Labels: { [developmentOwnerLabel]: owner, [developmentRoleLabel]: "worker" } } })];
  assert.deepEqual(planDevelopmentImageCleanup({ owner, images, usedImageIds: [id(3)], currentImageIds: [id(5)] }), [id(2), id(1)]);
});

test("retention never selects explicitly tagged, foreign, unmanaged or unknown-role images", () => {
  const images = [image(1, { RepoTags: ["saved:keep"] }), image(2, { Config: { Labels: { [developmentOwnerLabel]: otherOwner, [developmentRoleLabel]: "docs" } } }), image(3, { Config: { Labels: null } }), image(4, { Config: { Labels: { [developmentOwnerLabel]: owner, [developmentRoleLabel]: "database" } } }), image(5)];
  assert.deepEqual(planDevelopmentImageCleanup({ owner, images, usedImageIds: [], currentImageIds: [] }), []);
  assert.throws(() => planDevelopmentImageCleanup({ owner: "unmanaged", images, usedImageIds: [], currentImageIds: [] }));
});

function dockerFixture({ failInventory = false, failRemoval = false, newlyTagged = false } = {}) {
  const calls = [];
  const execute = async (args) => {
    calls.push(args);
    if (args[0] === "image" && args[1] === "ls") return [id(1), id(2), id(3)].join("\n");
    if (args[0] === "image" && args[1] === "inspect" && args[2] !== "--format") return JSON.stringify(args.length === 3 ? [image(1, { RepoTags: newlyTagged ? ["saved:keep"] : null })] : [image(1), image(2), image(3)]);
    if (args[0] === "container" && args[1] === "ls") { if (failInventory) throw new Error("daemon failed"); return "c".repeat(64); }
    if (args[0] === "container" && args[1] === "inspect") return id(3);
    if (args[0] === "image" && args[1] === "inspect") return id(3);
    if (args[0] === "image" && args[1] === "rm") { if (failRemoval) throw new Error("new container now references image"); return ""; }
    assert.fail(`Unexpected Docker command ${args}`);
  };
  return { execute, calls };
}

test("cleanup enumerates stopped containers too and removes only explicit image IDs without force", async () => {
  const f = dockerFixture();
  assert.deepEqual(await cleanupDevelopmentImages(environment, f), { candidates: [id(1)], removed: [id(1)], failed: [] });
  assert.ok(f.calls.some((args) => args[0] === "container" && args.includes("--all")));
  assert.ok(f.calls.some((args) => args[0] === "image" && args[1] === "ls" && args.includes("--all")), "Docker's default image listing hides older build images");
  assert.deepEqual(f.calls.filter((args) => args[1] === "rm"), [["image", "rm", id(1)]]);
});

test("cleanup dry-run performs no mutations", async () => {
  const f = dockerFixture();
  assert.deepEqual((await cleanupDevelopmentImages(environment, { ...f, dryRun: true })).candidates, [id(1)]);
  assert.ok(!f.calls.some((args) => args[1] === "rm"));
});

test("cleanup rechecks ownership and tags before deleting an image selected from an earlier snapshot", async () => {
  const f = dockerFixture({ newlyTagged: true });
  assert.deepEqual(await cleanupDevelopmentImages(environment, f), { candidates: [id(1)], removed: [], failed: [id(1)] });
  assert.ok(!f.calls.some((args) => args[1] === "rm"));
});

test("cleanup fails closed on inventory errors and preserves images claimed after the snapshot", async () => {
  const f = dockerFixture({ failInventory: true });
  await assert.rejects(cleanupDevelopmentImages(environment, f), /daemon failed/);
  assert.ok(!f.calls.some((args) => args[1] === "rm"));
  assert.deepEqual(await cleanupDevelopmentImages(environment, dockerFixture({ failRemoval: true })), { candidates: [id(1)], removed: [], failed: [id(1)] });
});
