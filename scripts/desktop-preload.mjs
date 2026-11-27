import { chmod } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

// Generated into the Mac platform resources; apps/desktop/.gitignore excludes
// the resources directory. Other targets never ship this file.
const desktopAnnotationPreloadRelativePath =
  "apps/desktop/resources/darwin/application-annotation-preload.js"

export function desktopAnnotationPreloadOutput(rootDir) {
  return path.join(rootDir, desktopAnnotationPreloadRelativePath)
}

/**
 * Bundle the fixed first-party annotation controller as a classic script for
 * MyGo's PageOptions.PreloadScript. The page never supplies controller text.
 */
export async function buildDesktopAnnotationPreload(
  rootDir = path.resolve(import.meta.dirname, ".."),
) {
  const web = path.join(rootDir, "apps/web")
  const output = desktopAnnotationPreloadOutput(rootDir)
  // Vite is a Web workspace dependency, not a root dependency.
  const webRequire = createRequire(path.join(web, "package.json"))
  const { build } = await import(
    pathToFileURL(webRequire.resolve("vite")).href
  )
  await build({
    configFile: false,
    root: web,
    publicDir: false,
    logLevel: "warn",
    resolve: { alias: [{ find: "@", replacement: path.join(web, "src") }] },
    build: {
      outDir: path.dirname(output),
      emptyOutDir: false,
      copyPublicDir: false,
      target: "safari17",
      modulePreload: false,
      sourcemap: false,
      rolldownOptions: {
        input: path.join(
          web,
          "src/features/applications/application-annotation-preload.ts",
        ),
        output: {
          format: "iife",
          entryFileNames: path.basename(output),
        },
      },
    },
  })
  // Vite creates the bundle with the build account's umask and keeps the mode
  // of a bundle it overwrites. MyGo copies resources with their permissions
  // into the app, so a restrictive build would ship a preload only the builder
  // can read; the packaged resource must stay readable like staged legal files.
  await chmod(output, 0o644)
}
