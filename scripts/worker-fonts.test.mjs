import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve("deploy/runtime/fonts");

test("both worker targets install fonts and deployment fingerprints track font changes", async () => {
  const dockerfile = await readFile("Dockerfile.runner", "utf8");
  const workers = dockerfile.split(/FROM worker-browser-(?:build|cache)-input AS worker(?:-cached-browser)?\n/u).slice(1);
  assert.equal(workers.length, 2);
  const fonts = dockerfile.split(" AS font-runtime-build\n")[1]?.split("\nFROM ")[0];
  assert.ok(fonts, "font downloads need a source-independent build stage");
  assert.match(fonts, /--mount=type=cache,id=linksense-microsoft-fonts,target=\/var\/cache\/linksense-fonts,sharing=locked/u);
  assert.doesNotMatch(fonts, /COPY.*(?:apps\/|packages\/)|COPY --from=build/u);
  for (const worker of workers) {
    assert.match(worker, /COPY deploy\/runtime\/fonts \/opt\/linksense\/runtime\/fonts/u);
    assert.match(worker, /COPY --from=font-runtime-build \/usr\/local\/share\/fonts\/linksense-microsoft \/usr\/local\/share\/fonts\/linksense-microsoft/u);
    assert.doesNotMatch(worker, /sh \/opt\/linksense\/runtime\/fonts\/install.sh/u);
    assert.match(worker, /fc-cache -f[\s\S]*setpriv --reuid=1001 --regid=1000 --clear-groups sh \/opt\/linksense\/runtime\/fonts\/verify.sh/u);
  }
  const production = await readFile("deploy/production/deploy-production.sh", "utf8");
  for (const name of ["worker_source_fingerprint", "worker_runtime_changed_paths", "worker_rebuild_changed_paths"]) {
    const body = production.split(`${name}() {`)[1].split("\n}")[0];
    assert.ok(body.includes("deploy/runtime/fonts"));
  }
  const development = await readFile("scripts/dev.mjs", "utf8");
  assert.ok(development.split("export function workerImageFingerprint(")[1].split("\n}")[0].includes('"deploy/runtime/fonts"'));
});

test("font downloads pin all seven families and their styles to immutable URLs and SHA-256", async () => {
  const downloads = (await readFile(path.join(root, "downloads.sha256"), "utf8")).trim().split("\n");
  const filenames = downloads.map((line) => {
    assert.match(line, /^[a-f0-9]{64}  [a-z0-9]+\.(?:ttf|ttc)  https:\/\/raw\.githubusercontent\.com\/[\w-]+\/[\w-]+\/[a-f0-9]{40}\/(?:fonts\/)?[a-z0-9]+\.(?:ttf|ttc)$/u);
    return line.split(/ +/u)[1];
  });
  const entries = (await readFile(path.join(root, "families.tsv"), "utf8")).trim().split("\n").map((line) => line.split("\t"));
  assert.equal(new Set(filenames).size, 20);
  assert.deepEqual(entries.map(([filename]) => filename).sort(), filenames.sort());
  assert.deepEqual([...new Set(entries.map(([, family]) => family))].sort(), ["Arial", "Calibri", "KaiTi", "Microsoft YaHei", "SimHei", "SimSun", "Times New Roman"]);
  for (const family of ["Arial", "Calibri", "Times New Roman"]) {
    const styles = entries.filter((entry) => entry[1] === family).map((entry) => entry[2]);
    for (const style of ["Regular", "Bold", "Italic", "Bold Italic"]) assert.ok(styles.includes(style));
  }
});

test("installer verifies all downloads before publishing readable fonts and rejects corrupt downloads", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-font-install-"));
  try {
    const bin = path.join(directory, "bin");
    await mkdir(bin);
    const payload = "download fixture";
    const checksum = createHash("sha256").update(payload).digest("hex");
    await writeFile(path.join(directory, "payload"), payload);
    // Mock only the network boundary; use the real checksum and file installer.
    await writeFile(path.join(bin, "curl"), '#!/bin/sh\nwhile [ "$1" != "--output" ]; do shift; done\ncp "$FONT_TEST_PAYLOAD" "$2"\n', { mode: 0o755 });
    const manifest = path.join(directory, "manifest");
    const destination = path.join(directory, "installed");
    const cache = path.join(directory, "cache");
    const options = { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FONT_TEST_PAYLOAD: path.join(directory, "payload") } };
    await writeFile(manifest, `${checksum}  valid.ttf  https://example.com/font\n`);
    await run("sh", [path.join(root, "install.sh"), manifest, destination, cache], options);
    assert.equal(await readFile(path.join(destination, "valid.ttf"), "utf8"), payload);
    assert.equal((await stat(path.join(destination, "valid.ttf"))).mode & 0o777, 0o644);
    await writeFile(manifest, `${checksum}  next.ttf  https://example.com/font\n${"0".repeat(64)}  broken.ttf  https://example.com/font\n`);
    await assert.rejects(run("sh", [path.join(root, "install.sh"), manifest, destination, cache], options));
    assert.deepEqual(await readdir(destination), ["valid.ttf"]);
    await writeFile(manifest, `${checksum}  ../escape.ttf  https://example.com/font\n`);
    await assert.rejects(run("sh", [path.join(root, "install.sh"), manifest, destination, cache], options), /Invalid font filename/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("installer falls back through pinned mirrors when GitHub raw is too slow", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-font-fallback-"));
  try {
    const payload = "fallback font bytes";
    const checksum = createHash("sha256").update(payload).digest("hex");
    const revision = "1".repeat(40);
    const manifest = path.join(directory, "manifest");
    const destination = path.join(directory, "installed");
    const cache = path.join(directory, "cache");
    const calls = path.join(directory, "calls");
    await writeFile(path.join(directory, "payload"), payload);
    await writeFile(
      manifest,
      `${checksum}  font.ttf  https://raw.githubusercontent.com/example/fonts/${revision}/fonts/font.ttf\n`,
    );
    await writeFile(path.join(directory, "curl"), `#!/bin/sh
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\n' "$url" >> "$FONT_TEST_CALLS"
case "$url" in
  https://raw.githubusercontent.com/*) printf 'partial' > "$output"; exit 28 ;;
  https://cdn.jsdelivr.net/gh/example/fonts@${revision}/fonts/font.ttf) exit 22 ;;
  https://gh-proxy.com/https://raw.githubusercontent.com/example/fonts/${revision}/fonts/font.ttf) cp "$FONT_TEST_PAYLOAD" "$output" ;;
  *) exit 7 ;;
esac
`, { mode: 0o755 });

    await run("sh", [path.join(root, "install.sh"), manifest, destination, cache], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        FONT_TEST_CALLS: calls,
        FONT_TEST_PAYLOAD: path.join(directory, "payload"),
      },
    });

    assert.equal(await readFile(path.join(destination, "font.ttf"), "utf8"), payload);
    assert.equal(
      await readFile(calls, "utf8"),
      `https://raw.githubusercontent.com/example/fonts/${revision}/fonts/font.ttf\nhttps://cdn.jsdelivr.net/gh/example/fonts@${revision}/fonts/font.ttf\nhttps://gh-proxy.com/https://raw.githubusercontent.com/example/fonts/${revision}/fonts/font.ttf\n`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("font cache survives interrupted builds, resumes partial files and installs offline on rebuild", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-font-cache-"));
  try {
    const payload = "complete font bytes";
    const checksum = createHash("sha256").update(payload).digest("hex");
    const cache = path.join(directory, "cache");
    const cachedFile = path.join(cache, `${checksum}-font.ttf`);
    const manifest = path.join(directory, "manifest");
    const destination = path.join(directory, "installed");
    const calls = path.join(directory, "calls");
    await writeFile(manifest, `${checksum}  font.ttf  https://example.com/font\n`);
    await writeFile(path.join(directory, "payload"), payload);
    await writeFile(path.join(directory, "curl"), `#!/bin/sh
printf 'call\\n' >> "$FONT_TEST_CALLS"
resume=no
while [ "$1" != "--output" ]; do
  if [ "$1" = "--continue-at" ] && [ "$2" = "-" ]; then resume=yes; fi
  shift
done
if [ "$FONT_TEST_MODE" = fail ]; then printf 'complete' > "$2"; exit 28; fi
if [ "$FONT_TEST_MODE" = offline ]; then exit 7; fi
if [ "$FONT_TEST_MODE" = resume ]; then
  test "$resume" = yes && test "$(cat "$2")" = complete || exit 1
fi
cp "$FONT_TEST_PAYLOAD" "$2"
`, { mode: 0o755 });
    const invoke = (mode, target = destination) => run("sh", [path.join(root, "install.sh"), manifest, target, cache], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FONT_TEST_PAYLOAD: path.join(directory, "payload"), FONT_TEST_CALLS: calls, FONT_TEST_MODE: mode },
    });
    await assert.rejects(invoke("fail"));
    assert.equal(await readFile(`${cachedFile}.part`, "utf8"), "complete");
    await assert.rejects(stat(destination), { code: "ENOENT" });
    await invoke("resume");
    assert.equal(await readFile(cachedFile, "utf8"), payload);
    assert.equal(await readFile(path.join(destination, "font.ttf"), "utf8"), payload);
    assert.equal(await readFile(calls, "utf8"), "call\ncall\n");
    const freshDestination = path.join(directory, "rebuilt");
    await invoke("offline", freshDestination);
    assert.equal(await readFile(path.join(freshDestination, "font.ttf"), "utf8"), payload);
    assert.equal(await readFile(calls, "utf8"), "call\ncall\n");
    await writeFile(cachedFile, "corrupt cache");
    await assert.rejects(invoke("offline"));
    await invoke("fresh");
    assert.equal(await readFile(cachedFile, "utf8"), payload);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("font verification fails when fontconfig substitutes a different family or style", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-font-verify-"));
  try {
    await writeFile(path.join(directory, "fc-match"), '#!/bin/sh\nprintf "%s" "$FONT_TEST_MATCH"\n', { mode: 0o755 });
    const manifest = path.join(directory, "families.tsv");
    await writeFile(manifest, "arialbd.ttf\tArial\tBold\n");
    for (const match of ["Arial\tBold\t/fonts/arialbd.ttf", "Liberation Sans\tBold\t/fonts/arialbd.ttf", "Arial\tRegular\t/fonts/arialbd.ttf", "Arial\tBold\t/other/arialbd.ttf"]) {
      const result = run("sh", [path.join(root, "verify.sh"), manifest, "/fonts"], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FONT_TEST_MATCH: match },
      });
      if (match === "Arial\tBold\t/fonts/arialbd.ttf") await result;
      else await assert.rejects(result, /Font mismatch/u);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
