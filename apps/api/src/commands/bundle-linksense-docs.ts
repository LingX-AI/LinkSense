import path from "node:path"
import { fileURLToPath } from "node:url"

import { bundleLinksenseDocsSources } from "../modules/capabilities/built-in-linksense-docs.js"

async function main(): Promise<void> {
  const commandDirectory = path.dirname(fileURLToPath(import.meta.url))
  const apiRoot = path.resolve(commandDirectory, "../..")
  const docsRoot = path.resolve(apiRoot, "../docs")

  await bundleLinksenseDocsSources({
    sourceRoots: {
      "zh-CN": path.join(docsRoot, "docs"),
      "en-US": path.join(
        docsRoot,
        "i18n",
        "en-US",
        "docusaurus-plugin-content-docs",
        "current",
      ),
    },
    outputRoot: path.join(apiRoot, "dist", "linksense-docs"),
  })
}

main().catch(() => {
  process.stderr.write(
    "Bundling the LinkSense help documentation for the API failed.\n",
  )
  process.exitCode = 1
})
