import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("a failed Elasticsearch startup retains its crash logs until owned cleanup", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "linksense-es-smoke-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = path.join(directory, "calls.jsonl");
  writeFileSync(path.join(directory, "docker"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SMOKE_TEST_CALLS, JSON.stringify(args) + "\\n");
const state = process.env.SMOKE_TEST_CALLS + ".state";
if (args[0] === "run") {
  fs.writeFileSync(state, args.includes("--rm") ? "removed" : "retained");
  process.stdout.write("a".repeat(64));
} else if (fs.readFileSync(state, "utf8") === "removed") {
  process.stderr.write("No such container"); process.exit(1);
} else if (args[0] === "port") {
  process.stderr.write("Container exited during startup"); process.exit(1);
} else if (args[0] === "logs") {
  process.stdout.write("Elasticsearch startup diagnostic: invalid module");
} else if (args[0] === "inspect") {
  process.stdout.write("elasticsearch");
} else if (args[0] !== "rm") process.exit(1);
`, { mode: 0o755 });
  const result = spawnSync(process.execPath, ["scripts/elasticsearch-image-smoke.mjs", `ghcr.io/example/elasticsearch@sha256:${"b".repeat(64)}`], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, SMOKE_TEST_CALLS: calls },
    encoding: "utf8", timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Elasticsearch startup diagnostic: invalid module/u);
  const commands = readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(!commands[0].includes("--rm"));
  assert.deepEqual(commands.at(-1), ["rm", "--force", "--volumes", "a".repeat(64)]);
  assert.equal(commands.at(-2)[0], "inspect");
});
