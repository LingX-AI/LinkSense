import { chmod, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const outputDirectory = process.argv[2]
const releaseVersion = process.env.RELEASE_VERSION
if (!outputDirectory || !releaseVersion) {
  throw new Error(
    "usage: RELEASE_VERSION=v1.2.3 node scripts/bundle-release-installers.mjs <output-directory>",
  )
}
if (!/^v\d+\.\d+\.\d+$/u.test(releaseVersion)) {
  throw new Error("RELEASE_VERSION must be a v-prefixed SemVer tag")
}

const root = path.resolve(import.meta.dirname, "..")
const engine = await readFile(
  path.join(root, "deploy/release/linksense-installer.sh"),
  "utf8",
)

for (const entry of [
  { filename: "install-core.sh", action: "install", edition: "core" },
  { filename: "install-full.sh", action: "install", edition: "full" },
  { filename: "repair-core.sh", action: "repair", edition: "core" },
  { filename: "repair-full.sh", action: "repair", edition: "full" },
  { filename: "upgrade.sh", action: "upgrade", edition: "" },
]) {
  const bundled = engine
    .replace(
      "EDITION=${LINKSENSE_INSTALL_EDITION:-}",
      `EDITION=${entry.edition}`,
    )
    .replace("ACTION=${LINKSENSE_INSTALL_ACTION:-}", `ACTION=${entry.action}`)
    .replace(
      "RELEASE_SELECTOR=${LINKSENSE_VERSION:-latest}",
      entry.action === "upgrade"
        ? "RELEASE_SELECTOR=${LINKSENSE_VERSION:-latest}"
        : `RELEASE_SELECTOR=\${LINKSENSE_VERSION:-${releaseVersion}}`,
    )
  if (
    bundled.includes("EDITION=${LINKSENSE_INSTALL_EDITION:-}") ||
    bundled.includes("ACTION=${LINKSENSE_INSTALL_ACTION:-}")
  ) {
    throw new Error(`failed to bind ${entry.filename}`)
  }
  const output = path.join(outputDirectory, entry.filename)
  await writeFile(output, bundled, { mode: 0o755 })
  await chmod(output, 0o755)
}
