import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

export async function preparePublicDocs(root) {
  const output = path.join(root, ".public-docs")
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  await cp(path.join(root, "docs"), path.join(output, "docs"), {
    recursive: true,
  })
  await cp(path.join(root, "i18n"), path.join(output, "i18n"), {
    recursive: true,
  })
  await cp(path.join(root, "deployment"), path.join(output, "docs/deploy"), {
    recursive: true,
  })
  await cp(
    path.join(
      root,
      "i18n/en-US/docusaurus-plugin-content-docs-deployment/current",
    ),
    path.join(
      output,
      "i18n/en-US/docusaurus-plugin-content-docs/current/deploy",
    ),
    { recursive: true },
  )
}

if (
  process.env.LINKSENSE_PUBLIC_DOCS === "1" &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  await preparePublicDocs(path.resolve(import.meta.dirname, ".."))
}
