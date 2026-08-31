import { createHash } from "node:crypto"
import { readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const output = process.argv[2]
const tokenizerDirectory = process.argv[3]
const releaseAssetDirectory = process.argv[4]

if (!output || !tokenizerDirectory || !releaseAssetDirectory) {
  throw new Error(
    "usage: node scripts/generate-release-manifest.mjs <output> <tokenizer-directory> <release-asset-directory>",
  )
}

const releaseVersion = requiredEnvironment("RELEASE_VERSION")
if (!/^v\d+\.\d+\.\d+$/u.test(releaseVersion)) {
  throw new Error("RELEASE_VERSION must be a v-prefixed SemVer tag")
}

const imageKeys = [
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
]

const resourcePaths = {
  LICENSE: "LICENSE",
  COMPOSE_COMMON: "compose.common.yml",
  COMPOSE_CORE: "compose.core.yml",
  COMPOSE_FULL: "compose.full.yml",
  GATEWAY: "gateway.conf.template",
  INSTALLER_ENGINE: "linksense-installer.sh",
  INSTALL_CORE: "install-core.sh",
  INSTALL_FULL: "install-full.sh",
  REPAIR_CORE: "repair-core.sh",
  REPAIR_FULL: "repair-full.sh",
}

const tokenizerLock = JSON.parse(
  await readFile(
    path.join(repositoryRoot, "deploy/release/tokenizer.lock.json"),
    "utf8",
  ),
)

const lines = [
  "MANIFEST_FORMAT=1",
  `RELEASE_VERSION=${releaseVersion}`,
  "RELEASE_EDITION_SUPPORT=core-full",
  "RELEASE_ARCHITECTURE=linux-amd64",
  `RELEASE_GIT_COMMIT=${requiredEnvironment("RELEASE_GIT_COMMIT")}`,
  `RELEASE_BUILD_TIME=${requiredEnvironment("RELEASE_BUILD_TIME")}`,
  `RELEASE_WORKFLOW_ID=${requiredEnvironment("RELEASE_WORKFLOW_ID")}`,
  `RELEASE_ASSET_BASE_URL=https://github.com/LingX-AI/linksense/releases/download/${releaseVersion}`,
  "MIN_DOCKER_API=1.45",
  "MIN_DOCKER_COMPOSE=2.24.4",
  "CORE_MIN_MEMORY_GIB=8",
  "CORE_MIN_DISK_GIB=40",
  "CORE_MIN_FREE_INODES=100000",
  "FULL_MIN_MEMORY_GIB=16",
  "FULL_MIN_DISK_GIB=80",
  "FULL_MIN_FREE_INODES=200000",
]

for (const imageKey of imageKeys) {
  const image = requiredEnvironment(`IMAGE_${imageKey}`)
  if (!/^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u.test(image)) {
    throw new Error(`IMAGE_${imageKey} must be an immutable OCI reference`)
  }
  lines.push(`IMAGE_${imageKey}=${image}`)
  lines.push(`IMAGE_${imageKey}_DIGEST=${image.slice(image.indexOf("sha256:"))}`)
}

for (const [key, relativePath] of Object.entries(resourcePaths)) {
  lines.push(
    `RESOURCE_${key}_SHA256=${await sha256(path.join(releaseAssetDirectory, relativePath))}`,
  )
}

lines.push(`TOKENIZER_SOURCE=${tokenizerLock.source}`)
lines.push(`TOKENIZER_REPOSITORY=${tokenizerLock.repository}`)
lines.push(`TOKENIZER_LICENSE=${tokenizerLock.license}`)
lines.push(`TOKENIZER_REVISION=${tokenizerLock.revision}`)
lines.push(`TOKENIZER_MOUNT_PATH=${tokenizerLock.mountPath}`)
lines.push(`TOKENIZER_FILE_COUNT=${tokenizerLock.files.length}`)

let tokenizerTotalBytes = 0
for (const [offset, filename] of tokenizerLock.files.entries()) {
  if (!/^[A-Za-z0-9._-]+$/u.test(filename)) {
    throw new Error(`unsafe tokenizer filename: ${filename}`)
  }
  const filePath = path.join(tokenizerDirectory, filename)
  const fileStat = await stat(filePath)
  tokenizerTotalBytes += fileStat.size
  const index = offset + 1
  lines.push(`TOKENIZER_FILE_${index}_PATH=${filename}`)
  lines.push(
    `TOKENIZER_FILE_${index}_URL=https://huggingface.co/${tokenizerLock.repository}/resolve/${tokenizerLock.revision}/${filename}?download=true`,
  )
  lines.push(`TOKENIZER_FILE_${index}_SIZE=${fileStat.size}`)
  lines.push(`TOKENIZER_FILE_${index}_SHA256=${await sha256(filePath)}`)
}
lines.push(`TOKENIZER_TOTAL_BYTES=${tokenizerTotalBytes}`)

await writeFile(output, `${lines.join("\n")}\n`, { mode: 0o644 })

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  if (!/^[A-Za-z0-9_./:@?&=+,-]+$/u.test(value)) {
    throw new Error(`${name} contains unsupported manifest characters`)
  }
  return value
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex")
}
