import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("disposable database integration containers remove their anonymous volumes and declare ownership", async () => {
  const directory = resolve("apps/api/test/integration");
  let checked = 0;
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".ts")) continue;
    const source = await readFile(resolve(directory, name), "utf8");
    const starts = [...source.matchAll(/docker\(\s*["']run["']([^;]+?)\);/gu)];
    if (!starts.some(([call]) => /(?:postgres|redis):/u.test(call))) continue;
    for (const [call] of starts) {
      assert.match(call, /["']--rm["']/u, `${name}: temporary containers must auto-remove on exit`);
      assert.match(call, /com\.linksense\.test\.disposable=true/u, `${name}: test resources must be identifiable`);
    }
    const removals = [...source.matchAll(/docker\(\s*["']rm["']([^;]+?)\)/gu)];
    assert.ok(removals.length, `${name}: must clean up after failure`);
    for (const [call] of removals) assert.match(call, /["'](?:--volumes|-v)["']/u, `${name}: container cleanup must include anonymous volumes`);
    for (const [call] of source.matchAll(/docker\([^)]+["']pg_isready["'][^)]+\)/gu)) {
      assert.match(call, /["']-h["'],\s*["']127\.0\.0\.1["']/u, `${name}: wait for the final TCP server, not PostgreSQL's temporary initialization socket`);
    }
    checked++;
  }
  assert.ok(checked >= 8, "must audit all disposable PostgreSQL integration suites");
});
