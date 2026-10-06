import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve("deploy/runtime/fonts");
const requiredPackages = [
  "fontconfig",
  "fonts-arphic-ukai",
  "fonts-crosextra-carlito",
  "fonts-liberation",
  "fonts-noto-cjk",
];

test("both worker targets install and verify the open-source font packages", async () => {
  const dockerfile = await readFile("Dockerfile.runner", "utf8");
  const workers = dockerfile
    .split(/FROM worker-browser-(?:build|cache)-input AS worker(?:-cached-browser)?\n/u)
    .slice(1);

  assert.equal(workers.length, 2);
  for (const worker of workers) {
    assert.match(worker, /corepack enable pnpm/u);
    for (const packageName of requiredPackages) {
      assert.match(worker, new RegExp(`^    ${packageName} \\\\`, "mu"));
    }
    assert.match(worker, /COPY deploy\/runtime\/fonts \/opt\/linksense\/runtime\/fonts/u);
    assert.match(worker, /COPY --chmod=0644 deploy\/runtime\/fonts\/replacements\.conf \/etc\/fonts\/conf\.d\/99-linksense-replacements\.conf/u);
    assert.match(worker, /fc-cache -f[\s\S]*setpriv --reuid=1001 --regid=1000 --clear-groups sh \/opt\/linksense\/runtime\/fonts\/verify.sh/u);
  }
  assert.doesNotMatch(dockerfile, /font-runtime-build|linksense-microsoft|downloads\.sha256|install\.sh/u);

  const production = await readFile("deploy/production/deploy-production.sh", "utf8");
  for (const name of ["worker_source_fingerprint", "worker_runtime_changed_paths", "worker_rebuild_changed_paths"]) {
    const body = production.split(`${name}() {`)[1].split("\n}")[0];
    assert.ok(body.includes("deploy/runtime/fonts"));
  }
  const development = await readFile("scripts/dev.mjs", "utf8");
  assert.ok(development.split("export function workerImageFingerprint(")[1].split("\n}")[0].includes('"deploy/runtime/fonts"'));
});

test("font manifest covers the expected open-source families and real Ubuntu font paths", async () => {
  const entries = (await readFile(path.join(root, "families.tsv"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
  assert.equal(entries.length, 17);
  assert.ok(entries.every((entry) => entry.length === 3));
  assert.equal(new Set(entries.map(([file]) => file)).size, entries.length);
  assert.deepEqual(
    [...new Set(entries.map(([, family]) => family))].sort(),
    ["AR PL UKai CN", "Carlito", "Liberation Sans", "Liberation Serif", "Noto Sans CJK SC", "Noto Serif CJK SC"].sort(),
  );
  for (const [file, family, style] of entries) {
    assert.match(file, /^\/usr\/share\/fonts\/(?:truetype|opentype)\/[\w/-]+\.(?:ttf|ttc)$/u);
    assert.ok(family.length > 0 && style.length > 0);
    if (family.startsWith("Liberation ")) {
      assert.match(file, /^\/usr\/share\/fonts\/truetype\/liberation\/Liberation/u);
    }
  }
  for (const family of ["Liberation Sans", "Liberation Serif", "Carlito"]) {
    const styles = entries.filter(([, name]) => name === family).map(([, , style]) => style);
    assert.deepEqual(styles, ["Regular", "Bold", "Italic", "Bold Italic"]);
  }
  const replacements = (await readFile(path.join(root, "replacements.tsv"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
  assert.deepEqual(replacements, [
    ["Arial", "Liberation Sans"],
    ["Times New Roman", "Liberation Serif"],
    ["Calibri", "Carlito"],
    ["Microsoft YaHei", "Noto Sans CJK SC"],
    ["SimHei", "Noto Sans CJK SC"],
    ["SimSun", "Noto Serif CJK SC"],
    ["KaiTi", "AR PL UKai CN"],
  ]);
  const configuration = await readFile(path.join(root, "replacements.conf"), "utf8");
  for (const [source, replacement] of replacements.slice(3)) {
    assert.ok(configuration.includes(`<family>${source}</family>`));
    assert.ok(configuration.includes(`<prefer><family>${replacement}</family></prefer>`));
  }
  await assert.rejects(stat(path.join(root, "downloads.sha256")), { code: "ENOENT" });
  await assert.rejects(stat(path.join(root, "install.sh")), { code: "ENOENT" });
});

test("font verification rejects fallback families, wrong styles, and wrong files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-font-verify-"));
  try {
    await writeFile(path.join(directory, "fc-match"), '#!/bin/sh\nprintf "%s" "$FONT_TEST_MATCH"\n', { mode: 0o755 });
    const manifest = path.join(directory, "families.tsv");
    const replacements = path.join(directory, "replacements.tsv");
    await writeFile(manifest, "/fonts/Carlito-Bold.ttf\tCarlito\tBold\n");
    await writeFile(replacements, "");
    for (const match of [
      "Carlito\tBold\t/fonts/Carlito-Bold.ttf",
      "Liberation Sans\tBold\t/fonts/Carlito-Bold.ttf",
      "Carlito\tRegular\t/fonts/Carlito-Bold.ttf",
      "Carlito\tBold\t/other/Carlito-Bold.ttf",
    ]) {
      const result = run("sh", [path.join(root, "verify.sh"), manifest, replacements], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FONT_TEST_MATCH: match },
      });
      if (match === "Carlito\tBold\t/fonts/Carlito-Bold.ttf") await result;
      else await assert.rejects(result, /Font mismatch/u);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("font verification rejects a fallback that does not match the replacement policy", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-font-alias-"));
  try {
    await writeFile(path.join(directory, "fc-match"), '#!/bin/sh\nprintf "%s" "$FONT_TEST_MATCH"\n', { mode: 0o755 });
    const manifest = path.join(directory, "families.tsv");
    const replacements = path.join(directory, "replacements.tsv");
    await writeFile(manifest, "");
    await writeFile(replacements, "SimSun\tNoto Serif CJK SC\n");
    for (const match of ["Noto Serif CJK SC", "AR PL UKai CN"]) {
      const result = run("sh", [path.join(root, "verify.sh"), manifest, replacements], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FONT_TEST_MATCH: match },
      });
      if (match === "Noto Serif CJK SC") await result;
      else await assert.rejects(result, /Font replacement mismatch/u);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
