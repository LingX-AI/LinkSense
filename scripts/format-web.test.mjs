import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

import { resolveWebFormatTargets } from "./format-web.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("web formatter keeps its default target inside the web package", () => {
  assert.deepEqual(resolveWebFormatTargets([]), ["**/*.{ts,tsx}"]);
});

test("web formatter accepts files inside apps/web", () => {
  const previousCwd = process.cwd();
  process.chdir(repositoryRoot);
  try {
    assert.deepEqual(
      resolveWebFormatTargets(["apps/web/src/app/route-guards.tsx"]),
      ["src/app/route-guards.tsx"],
    );
  } finally {
    process.chdir(previousCwd);
  }
});

test("web formatter resolves repository paths from the package script cwd", () => {
  const previousCwd = process.cwd();
  process.chdir(resolve(repositoryRoot, "apps/web"));
  try {
    assert.deepEqual(
      resolveWebFormatTargets(["apps/web/src/app/route-guards.tsx"]),
      ["src/app/route-guards.tsx"],
    );
    assert.throws(
      () => resolveWebFormatTargets(["apps/api/src/app.ts"]),
      /拒绝格式化 apps\/web 之外的文件/u,
    );
  } finally {
    process.chdir(previousCwd);
  }
});

test("web formatter rejects files from API and shared packages", () => {
  const previousCwd = process.cwd();
  process.chdir(repositoryRoot);
  try {
    assert.throws(
      () => resolveWebFormatTargets(["apps/api/src/app.ts"]),
      /拒绝格式化 apps\/web 之外的文件/u,
    );
    assert.throws(
      () => resolveWebFormatTargets(["packages/shared/src/settings.ts"]),
      /拒绝格式化 apps\/web 之外的文件/u,
    );
  } finally {
    process.chdir(previousCwd);
  }
});
