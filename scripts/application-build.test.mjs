import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { test } from "node:test";
import { applicationBuildId, applicationBuildInputs } from "./application-build.mjs";

test("Web and API share a deterministic source identity that changes with either implementation or shared contracts", () => {
  const root = mkdtempSync(join(tmpdir(), "linksense-build-"));
  try {
    for (const input of applicationBuildInputs) {
      const file = extname(input) || input.startsWith("Dockerfile") ? input : `${input}/source.ts`;
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), input);
    }
    const first = applicationBuildId(root);
    assert.match(first, /^[a-f0-9]{64}$/u);
    assert.equal(applicationBuildId(root), first);
    mkdirSync(join(root, "apps/api/src/generated"));
    writeFileSync(join(root, "apps/api/src/generated/prisma.ts"), "platform-specific code");
    assert.equal(applicationBuildId(root), first);
    let previous = first;
    for (const input of ["apps/api/src/source.ts", "apps/web/src/source.ts", "packages/shared/src/source.ts", "pnpm-lock.yaml", "apps/api/tsconfig.json"]) {
      writeFileSync(join(root, input), "changed");
      const next = applicationBuildId(root);
      assert.notEqual(next, previous);
      previous = next;
    }
    assert.equal(applicationBuildId(root, first), first);
    assert.throws(() => applicationBuildId(root, "latest"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production verification checks each API replica and fails on a mismatched replica even inside a shell condition", () => {
  const script = readFileSync(resolve("deploy/production/deploy-production.sh"), "utf8");
  const start = script.indexOf("verify_release() {");
  const end = script.indexOf("\nexisting_release_is_healthy() {", start);
  assert.ok(start > 0 && end > start);
  const verifyFunction = script.slice(start, end);
  for (const outdated of [false, true]) {
    const result = spawnSync("sh", ["-c", `
set -eu
environment_file=unused
compose() {
  if [ "$3" = api ]; then printf '%s\\n' api-one api-two api-three; else printf '%s\\n' migrate; fi
}
docker() {
  case "$1" in
    exec)
      printf '%s\\n' "$2" >&2
      ${outdated ? '[ "$2" != api-two ]' : 'return 0'}
      ;;
    inspect) printf '%s\\n' 'exited 0' ;;
    image) printf '%s\\n' fingerprint ;;
  esac
}
gateway_port() { printf '%s\\n' 18081; }
curl() { return 0; }
read_key() { printf '%s\\n' fingerprint; }
${verifyFunction}
if verify_release; then exit 0; else exit 1; fi
`], { encoding: "utf8" });
    assert.equal(result.status, outdated ? 1 : 0, result.stderr);
    assert.deepEqual(result.stderr.trim().split("\n"), outdated ? ["api-one", "api-two"] : ["api-one", "api-two", "api-three"]);
  }
});

test("both production Docker builds derive their identity from the full source snapshot", () => {
  for (const name of ["Dockerfile.api", "Dockerfile.web"]) {
    const dockerfile = readFileSync(resolve(name), "utf8");
    assert.match(dockerfile, /--mount=type=bind,target=\/source[\s\S]*application-build\.mjs id \/source/u);
    assert.match(dockerfile, /LINKSENSE_BUILD_ID="\$\(cat \/linksense-build-id\)" pnpm --filter @linksense\/(api|web) build/u);
  }
  assert.match(readFileSync(resolve("deploy/production/deploy-production.sh"), "utf8"), /for api_container_id in \$api_container_ids; do[\s\S]*verify-web-build\.js/u);
});

test("the web manifest and unsuccessful asset responses cannot be cached", () => {
  const config = readFileSync(resolve("deploy/nginx/default.conf.template"), "utf8");
  assert.match(config, /\/build-info\.json "no-store";/u);
  assert.match(config, /location = \/build-info\.json \{\s*try_files \$uri =404;/u);
  assert.match(config, /map \$status \$linksense_response_cache_control \{[\s\S]*~\^\[45\] "no-store";/u);
  assert.match(config, /add_header Cache-Control \$linksense_response_cache_control always;/u);
});
