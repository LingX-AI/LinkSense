// Isolated Docker verification: creates only tiny, uniquely labelled images
// and one stopped test container. Never touches project services or data.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildDevelopmentImageGroups, cleanupDevelopmentImages, developmentImageGroups, developmentOwnerLabel, developmentResourceOwner, developmentRoleLabel, planDevelopmentImageBuilds } from "./dev-images.mjs";

const execute = promisify(execFile);
const docker = async (args) => (await execute("docker", args, { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
const root = await mkdtemp(join(tmpdir(), "linksense-image-retention-"));
const key = `retention-${randomUUID()}`;
const environment = {
  LINKSENSE_DEV_RESOURCE_OWNER: developmentResourceOwner(root, join(root, ".env")),
  LINKSENSE_DEV_IMAGE_TAG: key,
  LINKSENSE_IMAGE_TAG: key,
  LINKSENSE_WORKER_IMAGE: `linksense-retention-worker:${key}`,
};
const refs = developmentImageGroups(environment).flatMap((group) => group.images);
const ids = [];
const docsRef = developmentImageGroups(environment).find((group) => group.role === "docs").images[0];
let container;
try {
  await writeFile(join(root, "Dockerfile"), "FROM busybox:latest\nCOPY revision /revision\nCMD [\"true\"]\n");
  let labels = {};
  for (let revision = 1; revision <= 4; revision++) {
    await writeFile(join(root, "revision"), String(revision));
    environment.LINKSENSE_DOCS_IMAGE_FINGERPRINT = `revision-${revision}`;
    const groups = planDevelopmentImageBuilds(environment, ["docs"], (_image, label) => labels[label]);
    assert.equal(groups[0].needsBuild, true);
    await buildDevelopmentImageGroups(groups, async () => docker(["build", "--label", `${developmentOwnerLabel}=${environment.LINKSENSE_DEV_RESOURCE_OWNER}`, "--label", `${developmentRoleLabel}=docs`, "--label", `com.linksense.docs.fingerprint=${environment.LINKSENSE_DOCS_IMAGE_FINGERPRINT}`, "-t", docsRef, root]));
    ids.push(await docker(["image", "inspect", "--format", "{{.Id}}", docsRef]));
    labels = JSON.parse(await docker(["image", "inspect", "--format", "{{json .Config.Labels}}", docsRef]));
    await buildDevelopmentImageGroups(planDevelopmentImageBuilds(environment, ["docs"], (_image, label) => labels[label]), async () => assert.fail("next startup must reuse the freshly built image"));
  }
  for (const ref of refs.filter((ref) => ref !== docsRef)) await docker(["tag", ids[3], ref]);
  container = await docker(["create", "--name", `linksense-${key}`, "--label", "com.linksense.test.disposable=true", ids[1]]);
  assert.deepEqual((await cleanupDevelopmentImages(environment, { dryRun: true })).candidates, [ids[0]]);
  const result = await cleanupDevelopmentImages(environment);
  assert.deepEqual(result.removed, [ids[0]]);
  assert.deepEqual(result.failed, []);
  for (const id of ids.slice(1)) await docker(["image", "inspect", "--format", "{{.Id}}", id]);
  await assert.rejects(docker(["image", "inspect", ids[0]]));
  assert.deepEqual((await cleanupDevelopmentImages(environment)).removed, []);
  console.log("PASS: 4 changed fingerprints each built once and reused on subsequent startup; old unused image removed; current, stopped-container reference and previous image retained; cleanup is idempotent");
} finally {
  if (container) await docker(["rm", "--force", "--volumes", container]);
  for (const ref of refs) await docker(["image", "rm", ref]).catch(() => undefined);
  for (const id of ids) await docker(["image", "rm", id]).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
