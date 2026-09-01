import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const releaseDirectory = path.join(root, "deploy/release")

test("the four release entry scripts download only their matching release entry", async () => {
  const entries = [
    "install-core.sh",
    "install-full.sh",
    "repair-core.sh",
    "repair-full.sh",
  ]

  for (const filename of entries) {
    const source = await readFile(path.join(root, filename), "utf8")
    assert.match(source, new RegExp(`\\$base/${filename.replace(".", "\\.")}`))
    assert.doesNotMatch(source, /linksense-installer\.sh/u)
    assert.doesNotMatch(source, /LINKSENSE_INSTALL_(?:ACTION|EDITION)/u)
    assert.doesNotMatch(source, /--edition|select.*edition/iu)
    execFileSync("sh", ["-n", path.join(root, filename)])
  }
  execFileSync("sh", [
    "-n",
    path.join(releaseDirectory, "linksense-installer.sh"),
  ])
})

test("release entry scripts are self-contained and pinned to one mode and version", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-installers-"))
  try {
    execFileSync(
      process.execPath,
      [path.join(root, "scripts/bundle-release-installers.mjs"), directory],
      { env: { ...process.env, RELEASE_VERSION: "v0.1.0" } },
    )
    for (const [filename, [action, edition]] of Object.entries({
      "install-core.sh": ["install", "core"],
      "install-full.sh": ["install", "full"],
      "repair-core.sh": ["repair", "core"],
      "repair-full.sh": ["repair", "full"],
    })) {
      const output = path.join(directory, filename)
      const source = await readFile(output, "utf8")
      assert.match(source, new RegExp(`^ACTION=${action}$`, "mu"))
      assert.match(source, new RegExp(`^EDITION=${edition}$`, "mu"))
      assert.match(
        source,
        /^RELEASE_SELECTOR=\$\{LINKSENSE_VERSION:-v0\.1\.0\}$/mu,
      )
      assert.doesNotMatch(source, /LINKSENSE_INSTALL_(?:ACTION|EDITION)/u)
      execFileSync("sh", ["-n", output])
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the installer checks the host before creating persistent state", async () => {
  const source = await readFile(
    path.join(releaseDirectory, "linksense-installer.sh"),
    "utf8",
  )
  assert.match(
    source,
    /log_stage "Stage 1\/7: run the read-only host preflight\."\nvalidate_install_dir\npreflight\nTMP_ROOT=\$\(mktemp -d\)/u,
  )
  assert.match(source, /REQUIRED_DOCKER_API=1\.45/u)
  assert.match(source, /REQUIRED_COMPOSE_VERSION=2\.24\.4/u)
  assert.match(source, /HTTP_PORT=10080/u)
  assert.match(source, /verify_existing_volumes/u)
  assert.match(source, /dist\/release\/full-installation-probe\.js/u)
  assert.match(
    source,
    /local_health_url="http:\/\/127\.0\.0\.1:\$HTTP_PORT\/api\/v1\/system\/health\/ready"/u,
  )
  assert.match(source, /Repair stopped to avoid creating empty replacements/u)
  assert.match(source, /load_strict_env "\$INSTALL_DIR\/\.env" runtime/u)
  assert.match(
    source,
    /fetch_release_resources\n  write_runtime_env\n  load_runtime_env\n  install_resources/u,
  )
  assert.match(source, /Required Full secret \$required_secret is missing/u)
  assert.match(
    source,
    /if \[ -n "\$\{LINKSENSE_RELEASE_BASE_URL:-\}" \]; then\n    base=\$\{LINKSENSE_RELEASE_BASE_URL%\/\}\n  else\n    base=\$RELEASE_ASSET_BASE_URL/u,
  )
  assert.match(
    source,
    /for resource in LICENSE compose\.common\.yml "compose\.\$EDITION\.yml" gateway\.conf\.template/u,
  )
  assert.match(source, /RESOURCE_LICENSE_SHA256/u)
  assert.doesNotMatch(source, /^\s*\. "\$INSTALL_DIR\/\.env"/mu)
  assert.doesNotMatch(source, /docker\s+(?:system\s+)?prune|compose\s+down\s+-v|volume\s+rm|reset --hard/iu)
})

test(
  "Linux preflight failures never create LinkSense state or run Docker mutations",
  { skip: process.platform !== "linux" },
  async () => {
    for (const scenario of [
      { name: "docker-missing", docker: null, message: /Docker CLI is not installed/u },
      { name: "daemon-stopped", docker: "daemon-stopped", message: /daemon is stopped/u },
      { name: "engine-old", docker: "engine-old", message: /API 1\.44 is too old/u },
      { name: "compose-missing", docker: "compose-missing", message: /Compose V2 is not installed/u },
      { name: "compose-old", docker: "compose-old", message: /Compose 2\.23\.0 is too old/u },
    ]) {
      const directory = await mkdtemp(path.join(tmpdir(), "linksense-preflight-"))
      try {
        const bin = path.join(directory, "bin")
        const installDirectory = path.join(directory, "install")
        const trace = path.join(directory, "trace")
        await mkdir(bin)
        await writeExecutable(
          path.join(bin, "id"),
          "#!/bin/sh\nprintf '%s\\n' 0\n",
        )
        await writeExecutable(
          path.join(bin, "uname"),
          "#!/bin/sh\ncase \"$1\" in -s) printf '%s\\n' Linux ;; -m) printf '%s\\n' x86_64 ;; *) exit 1 ;; esac\n",
        )
        await writeExecutable(
          path.join(bin, "curl"),
          "#!/bin/sh\nprintf 'curl %s\\n' \"$*\" >> \"$LINKSENSE_TEST_TRACE\"\nexit 99\n",
        )
        for (const command of ["grep", "head", "sed", "sort", "tr"]) {
          await linkSystemCommand(command, bin)
        }
        if (scenario.docker !== null) {
          await writeExecutable(
            path.join(bin, "docker"),
            dockerPreflightStub(scenario.docker),
          )
        }

        const bundled = path.join(directory, "install-core.sh")
        execFileSync(
          process.execPath,
          [path.join(root, "scripts/bundle-release-installers.mjs"), directory],
          { env: { ...process.env, RELEASE_VERSION: "v0.1.0" } },
        )
        const result = spawnSync("/bin/sh", [bundled], {
          encoding: "utf8",
          env: {
            LINKSENSE_INSTALL_DIR: installDirectory,
            LINKSENSE_TEST_TRACE: trace,
            PATH: bin,
          },
        })
        assert.notEqual(result.status, 0, scenario.name)
        assert.match(`${result.stdout}${result.stderr}`, scenario.message)
        await assert.rejects(access(installDirectory))
        const recorded = await readFile(trace, "utf8").catch(() => "")
        assert.doesNotMatch(
          recorded,
          /\b(?:pull|up|run|create|rm|prune|stop|restart)\b/iu,
        )
        assert.doesNotMatch(recorded, /^curl /mu)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  },
)

test("Core and Full compose models expose only the gateway on port 10080", () => {
  const docker = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  })
  if (docker.status !== 0) return

  const core = renderCompose("core")
  const full = renderCompose("full")
  const coreServices = composeServices("core")
  const fullServices = composeServices("full")

  assert.deepEqual(
    coreServices.filter((service) =>
      ["elasticsearch", "elasticsearch-init", "docling-api", "docling-worker"].includes(
        service,
      ),
    ),
    [],
  )
  for (const service of [
    "elasticsearch",
    "elasticsearch-init",
    "docling-api",
    "docling-worker",
  ]) {
    assert.ok(fullServices.includes(service), `Full is missing ${service}`)
  }
  assert.match(core, /published: "10080"/u)
  assert.match(full, /published: "10080"/u)
  assert.equal((core.match(/published:/gu) ?? []).length, 1)
  assert.equal((full.match(/published:/gu) ?? []).length, 1)
  assert.doesNotMatch(core, /DOCLING_SERVE_URL|LINKSENSE_KB_ELASTICSEARCH_URL/u)
  assert.doesNotMatch(core, /linksense-knowledge-internal/u)
  assert.match(full, /DOCLING_SERVE_URL/u)
  assert.match(full, /LINKSENSE_KB_ELASTICSEARCH_URL/u)
  assert.match(full, /name: linksense-knowledge-internal/u)
  assert.match(full, /internal: true/u)
})

test("Full runs the official Docling image offline as a constrained non-root user", async () => {
  const compose = await readFile(
    path.join(releaseDirectory, "compose.full.yml"),
    "utf8",
  )
  assert.equal((compose.match(/user: "1001:0"/gu) ?? []).length, 2)
  assert.equal((compose.match(/no-new-privileges:true/gu) ?? []).length, 2)
  assert.equal((compose.match(/cap_drop:/gu) ?? []).length, 2)
  assert.match(compose, /HF_HUB_OFFLINE: "1"/u)
  assert.match(compose, /TRANSFORMERS_OFFLINE: "1"/u)
  assert.match(compose, /tokenizer-data:\$\{LINKSENSE_TOKENIZER_MOUNT_PATH\}:ro/u)
  assert.match(compose, /mem_limit: 8g/u)
  assert.match(compose, /pids_limit: 512/u)
})

test("every LinkSense release image contains the CPAL license", async () => {
  const [api, web, runner] = await Promise.all(
    ["Dockerfile.api", "Dockerfile.web", "Dockerfile.runner"].map((filename) =>
      readFile(path.join(root, filename), "utf8"),
    ),
  )
  const licenseCopy =
    /COPY --chmod=0444 LICENSE \/usr\/share\/licenses\/linksense\/LICENSE/gu
  assert.equal((api.match(licenseCopy) ?? []).length, 2)
  assert.equal((web.match(licenseCopy) ?? []).length, 1)
  assert.equal((runner.match(licenseCopy) ?? []).length, 2)
})

test("the private-source release workflow validates candidates before promotion", async () => {
  const workflow = await readFile(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  )
  for (const image of ["api", "web", "migrate", "runner"]) {
    assert.match(workflow, new RegExp(`name: ${image}`))
    assert.match(workflow, new RegExp(`linksense-\\$\\{\\{ matrix\\.name \\}\\}`))
  }
  assert.match(workflow, /name: Publish private-source release/u)
  assert.match(workflow, /workflow_dispatch:/u)
  assert.doesNotMatch(workflow, /push:\n\s+tags:/u)
  assert.match(workflow, /LINKSENSE_RELEASE_ACTOR/u)
  assert.match(workflow, /test "\$visibility" = private/u)
  assert.match(workflow, /candidate-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/u)
  assert.match(workflow, /worker-image:/u)
  assert.match(workflow, /linksense-worker:\$\{\{ needs\.prepare\.outputs\.candidate_tag \}\}/u)
  assert.match(workflow, /packages: write/u)
  assert.match(workflow, /GITHUB_TOKEN/u)
  assert.match(workflow, /pnpm db:generate/u)
  assert.match(
    workflow,
    /sudo apt-get install --yes --no-install-recommends redis-server/u,
  )
  assert.match(
    workflow,
    /DATABASE_URL: postgresql:\/\/build:build@127\.0\.0\.1:5432\/build/u,
  )
  assert.match(workflow, /sbom: true/u)
  assert.match(workflow, /provenance: mode=min/u)
  assert.match(workflow, /org\.opencontainers\.image\.source/u)
  assert.match(workflow, /Verify anonymous access to every LinkSense image/u)
  assert.match(workflow, /docker logout ghcr\.io/u)
  assert.match(
    workflow,
    /worker-image:\n[\s\S]*?runs-on: ubuntu-24\.04[\s\S]*?target: worker/u,
  )
  assert.doesNotMatch(workflow, /full-installation-smoke:/u)
  assert.doesNotMatch(workflow, /self-hosted|linksense-full-release/u)
  assert.match(workflow, /docker buildx imagetools create/u)
  assert.match(workflow, /gh release create "\$RELEASE_VERSION" release-assets\/\*/u)
  assert.match(workflow, /gh release upload "\$RELEASE_VERSION" "\$asset"/u)
  assert.match(workflow, /gh release download "\$RELEASE_VERSION" --dir verified-release-assets/u)
  assert.match(workflow, /sha256sum -c "\$GITHUB_WORKSPACE\/release-assets\/SHA256SUMS"/u)
  assert.match(workflow, /install -m 0644 \\\n\s+LICENSE/u)
  assert.doesNotMatch(workflow, /environment: public-release/u)
  assert.doesNotMatch(workflow, /attestations: write/u)
  assert.doesNotMatch(workflow, /actions\/attest-build-provenance/u)
  assert.doesNotMatch(workflow, /cache-to: type=gha,mode=max/u)
  assert.doesNotMatch(workflow, /uses: [^\n]+@(v|main|master)\b/u)
})

test("private CI scans secrets and enables GitHub security gates only when public", async () => {
  const workflows = await Promise.all(
    ["ci.yml", "release.yml", "security.yml"].map((filename) =>
      readFile(path.join(root, ".github/workflows", filename), "utf8"),
    ),
  )
  const combined = workflows.join("\n")
  assert.match(
    combined,
    /pnpm audit --registry=https:\/\/registry\.npmjs\.org --prod --audit-level high/u,
  )
  assert.match(combined, /github\/codeql-action\/analyze@[0-9a-f]{40}/u)
  assert.match(
    combined,
    /actions\/dependency-review-action@[0-9a-f]{40}/u,
  )
  assert.match(combined, /scripts\/run-gitleaks\.sh/u)
  assert.match(
    combined,
    /dependency-review:\n\s+if: github\.event_name == 'pull_request' && github\.event\.repository\.visibility == 'public'/u,
  )
  assert.match(
    combined,
    /codeql:\n\s+if: github\.event\.repository\.visibility == 'public'/u,
  )
  assert.doesNotMatch(combined, /uses: [^\n]+@(v|main|master)\b/u)
})

test("the secret scanner pins and verifies the downloaded Gitleaks binary", async () => {
  const source = await readFile(path.join(root, "scripts/run-gitleaks.sh"), "utf8")
  assert.match(source, /^GITLEAKS_VERSION=8\.30\.1$/mu)
  assert.match(source, /expected_sha256=[0-9a-f]{64}/u)
  assert.match(source, /github\.com\/gitleaks\/gitleaks\/releases\/download/u)
  assert.match(source, /--retry-all-errors/u)
  assert.match(source, /\[ "\$actual_sha256" = "\$expected_sha256" \]/u)
  assert.match(source, /gitleaks" git \\\n\s+--redact \\\n\s+--verbose/u)
  execFileSync("sh", ["-n", path.join(root, "scripts/run-gitleaks.sh")])
})

test("the release manifest generator records immutable images and artifact hashes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-manifest-"))
  try {
    const assetDirectory = path.join(directory, "assets")
    await cp(releaseDirectory, assetDirectory, { recursive: true })
    await cp(path.join(root, "LICENSE"), path.join(assetDirectory, "LICENSE"))
    execFileSync(
      process.execPath,
      [path.join(root, "scripts/bundle-release-installers.mjs"), assetDirectory],
      { env: { ...process.env, RELEASE_VERSION: "v0.1.0" } },
    )
    await chmod(path.join(assetDirectory, "linksense-installer.sh"), 0o755)
    const tokenizerLock = JSON.parse(
      await readFile(path.join(releaseDirectory, "tokenizer.lock.json"), "utf8"),
    )
    for (const filename of tokenizerLock.files) {
      await writeFile(path.join(directory, filename), `fixture:${filename}\n`)
    }
    const output = path.join(directory, "release-manifest.env")
    const digest = "a".repeat(64)
    const imageEnvironment = Object.fromEntries(
      [
        "LINKSENSE_API",
        "LINKSENSE_WEB",
        "LINKSENSE_MIGRATE",
        "LINKSENSE_RUNNER",
        "LINKSENSE_WORKER",
        "POSTGRES",
        "REDIS",
        "MINIO",
        "MINIO_CLIENT",
        "BUSYBOX",
        "GATEWAY",
        "ELASTICSEARCH",
        "DOCLING",
      ].map((key) => [
        `IMAGE_${key}`,
        `ghcr.io/example/${key.toLowerCase().replaceAll("_", "-")}@sha256:${digest}`,
      ]),
    )
    execFileSync(
      process.execPath,
      [
        path.join(root, "scripts/generate-release-manifest.mjs"),
        output,
        directory,
        assetDirectory,
      ],
      {
        env: {
          ...process.env,
          ...imageEnvironment,
          RELEASE_VERSION: "v0.1.0",
          RELEASE_GIT_COMMIT: "b".repeat(40),
          RELEASE_BUILD_TIME: "2026-08-27T00:00:00Z",
          RELEASE_WORKFLOW_ID: "https://github.com/LingX-AI/linksense/actions/runs/1",
        },
      },
    )
    const manifest = await readFile(output, "utf8")
    assert.match(manifest, /RELEASE_VERSION=v0\.1\.0/u)
    assert.match(manifest, new RegExp(`IMAGE_LINKSENSE_API=ghcr\\.io/example/linksense-api@sha256:${digest}`))
    assert.match(manifest, /TOKENIZER_REVISION=5cf2132abc99cad020ac570b19d031efec650f2b/u)
    assert.match(manifest, /TOKENIZER_FILE_5_SHA256=[0-9a-f]{64}/u)
    const license = await readFile(path.join(assetDirectory, "LICENSE"))
    assert.match(
      manifest,
      new RegExp(
        `RESOURCE_LICENSE_SHA256=${createHash("sha256").update(license).digest("hex")}`,
      ),
    )
    const commonCompose = await readFile(
      path.join(assetDirectory, "compose.common.yml"),
    )
    assert.match(
      manifest,
      new RegExp(
        `RESOURCE_COMPOSE_COMMON_SHA256=${createHash("sha256").update(commonCompose).digest("hex")}`,
      ),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the public snapshot keeps AGENTS.md and excludes private planning material", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-snapshot-"))
  try {
    const source = path.join(directory, "private-source")
    const target = path.join(directory, "public-source")
    await mkdir(path.join(source, "requirements"), { recursive: true })
    await mkdir(path.join(source, "training"), { recursive: true })
    await mkdir(path.join(source, "output"), { recursive: true })
    await mkdir(path.join(source, "src"), { recursive: true })
    await writeFile(path.join(source, "AGENTS.md"), "public agent guidance\n")
    await writeFile(path.join(source, "LICENSE"), "CPAL-1.0\n")
    await writeFile(path.join(source, "README.md"), "# LinkSense\n")
    await writeFile(path.join(source, "src/index.ts"), "export {}\n")
    await writeFile(path.join(source, "requirements/private.md"), "private\n")
    await writeFile(path.join(source, "training/private.md"), "private\n")
    await writeFile(path.join(source, "output/private.txt"), "private\n")
    await writeFile(path.join(source, "design-qa.md"), "private\n")
    execFileSync("git", ["init", "--quiet"], { cwd: source })
    execFileSync("git", ["add", "."], { cwd: source })

    execFileSync(
      "sh",
      [path.join(root, "scripts/create-public-snapshot.sh"), target],
      { cwd: source },
    )

    await access(path.join(target, "AGENTS.md"))
    await access(path.join(target, "LICENSE"))
    await access(path.join(target, "README.md"))
    await access(path.join(target, "src/index.ts"))
    for (const forbidden of [
      "requirements",
      "training",
      "output",
      "design-qa.md",
      ".git",
    ]) {
      await assert.rejects(access(path.join(target, forbidden)))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the public snapshot applies exclusions before the tar file list", async () => {
  const source = await readFile(
    path.join(root, "scripts/create-public-snapshot.sh"),
    "utf8",
  )
  const fileListPosition = source.indexOf("-T -")
  assert.ok(fileListPosition > 0)
  for (const exclusion of [
    "--exclude='requirements'",
    "--exclude='training'",
    "--exclude='design-qa.md'",
  ]) {
    const exclusionPosition = source.indexOf(exclusion)
    assert.ok(exclusionPosition >= 0)
    assert.ok(exclusionPosition < fileListPosition)
  }
})

test("all workflows use the resolvable pinned pnpm setup action", async () => {
  const expectedReference =
    "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1"
  for (const workflow of ["ci.yml", "release.yml", "security.yml"]) {
    const source = await readFile(
      path.join(root, ".github/workflows", workflow),
      "utf8",
    )
    assert.match(source, new RegExp(expectedReference))
    assert.doesNotMatch(
      source,
      /pnpm\/action-setup@a7487c7e89a18df4991f222e4898a00d66ddda/u,
    )
  }
})

test("hosted workflows install the Redis runtime required by API tests", async () => {
  for (const workflow of ["ci.yml", "release.yml"]) {
    const source = await readFile(
      path.join(root, ".github/workflows", workflow),
      "utf8",
    )
    const installPosition = source.indexOf(
      "sudo apt-get install --yes --no-install-recommends redis-server",
    )
    const testPosition = source.indexOf("pnpm --filter @linksense/api test")
    assert.ok(installPosition >= 0)
    assert.ok(testPosition > installPosition)
  }
})

test("hosted workflows execute the privileged runner filesystem test as root", async () => {
  for (const workflow of ["ci.yml", "release.yml"]) {
    const source = await readFile(
      path.join(root, ".github/workflows", workflow),
      "utf8",
    )
    assert.match(
      source,
      /sudo env "PATH=\$PATH" pnpm --filter @linksense\/runner exec vitest run test\/workspace-manager\.test\.ts/u,
    )
  }
})

function composeEnvironment(edition) {
  const digest = "a".repeat(64)
  const image = (name) => `ghcr.io/example/${name}@sha256:${digest}`
  return {
    ...process.env,
    COMPOSE_PROJECT_NAME: "linksense",
    LINKSENSE_EDITION: edition,
    LINKSENSE_VERSION: "v0.1.0",
    LINKSENSE_PUBLIC_BASE_URL: "http://127.0.0.1:10080",
    LINKSENSE_PUBLIC_SCHEME: "http",
    POSTGRES_DB: "linksense",
    POSTGRES_USER: "linksense",
    POSTGRES_PASSWORD: "postgres-secret",
    DATABASE_URL: "postgresql://linksense:postgres-secret@postgres:5432/linksense",
    REDIS_PASSWORD: "redis-secret",
    REDIS_URL: "redis://:redis-secret@redis:6379/0",
    DOCLING_REDIS_URL: "redis://:redis-secret@redis:6379/2",
    LINKSENSE_JWT_SECRET: "1".repeat(64),
    LINKSENSE_INITIALIZATION_TOKEN: "0".repeat(64),
    LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET: "2".repeat(64),
    LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET: "3".repeat(64),
    LINKSENSE_CREDENTIAL_MASTER_KEY: "4".repeat(64),
    LINKSENSE_CREDENTIAL_KEY_ID: "v1",
    LINKSENSE_RUNNER_SHARED_SECRET: "5".repeat(64),
    MINIO_ROOT_USER: "linksense-root",
    MINIO_ROOT_PASSWORD: "minio-root-secret",
    MINIO_ACCESS_KEY: "linksense-app",
    MINIO_SECRET_KEY: "minio-app-secret",
    MINIO_BUCKET: "linksense-files",
    MINIO_KNOWLEDGE_BUCKET: "linksense-knowledge",
    MINIO_ENDPOINT: "minio",
    MINIO_PORT: "9000",
    MINIO_USE_SSL: "false",
    MINIO_PUBLIC_URL: "http://127.0.0.1:10080",
    MINIO_REGION: "us-east-1",
    ELASTICSEARCH_ROOT_PASSWORD: "elastic-root-secret",
    ELASTICSEARCH_USERNAME: "linksense",
    ELASTICSEARCH_PASSWORD: "elastic-app-secret",
    DOCLING_SERVE_API_KEY: "docling-secret",
    LINKSENSE_KB_HYBRID_TOKENIZER:
      "/models/tokenizers/Qwen3-Embedding-4B/current",
    LINKSENSE_TOKENIZER_MOUNT_PATH: "/models/tokenizers/Qwen3-Embedding-4B",
    LINKSENSE_API_IMAGE: image("api"),
    LINKSENSE_WEB_IMAGE: image("web"),
    LINKSENSE_MIGRATE_IMAGE: image("migrate"),
    LINKSENSE_RUNNER_IMAGE: image("runner"),
    LINKSENSE_WORKER_IMAGE: image("worker"),
    LINKSENSE_WORKER_IMAGE_REVISION: `sha256:${digest}`,
    POSTGRES_IMAGE: image("postgres"),
    REDIS_IMAGE: image("redis"),
    MINIO_IMAGE: image("minio"),
    MINIO_CLIENT_IMAGE: image("minio-client"),
    BUSYBOX_IMAGE: image("busybox"),
    GATEWAY_IMAGE: image("gateway"),
    ELASTICSEARCH_IMAGE: image("elasticsearch"),
    DOCLING_IMAGE: image("docling"),
    LINKSENSE_POSTGRES_VOLUME: "linksense-postgres",
    LINKSENSE_REDIS_VOLUME: "linksense-redis",
    LINKSENSE_MINIO_VOLUME: "linksense-minio",
    LINKSENSE_USER_DATA_VOLUME: "linksense-user-data",
    LINKSENSE_BACKUP_VOLUME: "linksense-backups",
    LINKSENSE_ELASTICSEARCH_VOLUME: "linksense-elasticsearch",
    LINKSENSE_TOKENIZER_VOLUME: "linksense-tokenizer",
    LINKSENSE_KNOWLEDGE_NETWORK: "linksense-knowledge-internal",
    LINKSENSE_INTERNAL_NETWORK: "linksense-internal",
    LINKSENSE_WORKER_CONTROL_NETWORK: "linksense-worker-control",
    LINKSENSE_WORKER_EGRESS_NETWORK: "linksense-worker-egress",
  }
}

async function writeExecutable(file, source) {
  await writeFile(file, source, { mode: 0o755 })
  await chmod(file, 0o755)
}

async function linkSystemCommand(command, targetDirectory) {
  for (const prefix of ["/usr/bin", "/bin"]) {
    const source = path.join(prefix, command)
    try {
      await access(source)
      await symlink(source, path.join(targetDirectory, command))
      return
    } catch {
      // Try the next standard system path.
    }
  }
  throw new Error(`missing system command: ${command}`)
}

function dockerPreflightStub(scenario) {
  return `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$LINKSENSE_TEST_TRACE"
case "${scenario}:$1:$2" in
  daemon-stopped:info:*) exit 1 ;;
  *:info:*) exit 0 ;;
  engine-old:version:*) printf '%s\\n' 1.44 ;;
  *:version:*) printf '%s\\n' 1.45 ;;
  compose-missing:compose:version) exit 1 ;;
  compose-old:compose:version) printf '%s\\n' 2.23.0 ;;
  *:compose:version) printf '%s\\n' 2.24.4 ;;
  *) exit 1 ;;
esac
`
}

function composeArguments(edition, extra = []) {
  return [
    "compose",
    "-f",
    path.join(releaseDirectory, "compose.common.yml"),
    "-f",
    path.join(releaseDirectory, `compose.${edition}.yml`),
    ...extra,
  ]
}

function renderCompose(edition) {
  return execFileSync("docker", composeArguments(edition, ["config"]), {
    encoding: "utf8",
    env: composeEnvironment(edition),
  })
}

function composeServices(edition) {
  return execFileSync(
    "docker",
    composeArguments(edition, ["config", "--services"]),
    { encoding: "utf8", env: composeEnvironment(edition) },
  )
    .trim()
    .split("\n")
}
