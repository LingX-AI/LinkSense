import path from "path"
import { fileViewerRenderers } from "@file-viewer/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type { Plugin } from "vite"
import { defineConfig } from "vitest/config"

const embedStylesheetFileName = "assets/embed-app.css"

function emitEmbedStylesheet(): Plugin {
  return {
    name: "linksense-embed-stylesheet",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const stylesheets = Object.values(bundle).filter(
        (output) =>
          output.type === "asset" &&
          output.fileName.endsWith(".css") &&
          output.fileName !== embedStylesheetFileName
      )
      if (stylesheets.length !== 1) {
        this.error(
          `Expected one application stylesheet, received ${stylesheets.length}`
        )
      }
      const stylesheet = stylesheets[0]
      if (!stylesheet || stylesheet.type !== "asset") {
        this.error("Expected the application stylesheet to be an asset")
      }
      this.emitFile({
        type: "asset",
        fileName: embedStylesheetFileName,
        source: stylesheet.source,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    fileViewerRenderers({
      autoPresets: ["lite", "office"],
      // Keep Flyfish code behind the lazy knowledge routes instead of
      // preloading it for the conversation / "Ask LinkSense" entrypoint.
      chunkStrategy: "none",
      copyAssets: process.env.VITEST !== "true",
      inject: false,
    }),
    react(),
    tailwindcss(),
    emitEmbedStylesheet(),
  ],
  server: {
    proxy: {
      "/help": {
        target:
          process.env.LINKSENSE_DEV_DOCS_PROXY_TARGET ??
          "http://localhost:3001",
      },
      // Azure redirects to the API callback; keep the same public origin in development.
      "/api": {
        target:
          process.env.LINKSENSE_DEV_API_PROXY_TARGET ?? "http://localhost:4000",
      },
    },
  },
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(__dirname, "./src") }],
  },
  optimizeDeps: {
    // This package is patched locally; pre-bundling can keep an older, unpatched loader alive.
    exclude: ["pptx-react-viewer"],
    // These preview dependencies are first reached through lazy modules or a
    // Web Worker. Pre-bundle them during startup so Vite does not discover a
    // new dependency on the first preview and force a full-page reload.
    include: ["pptx-react-viewer > jszip", "@zip.js/zip.js"],
  },
  build: {
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        embed: path.resolve(__dirname, "src/embed-main.tsx"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "embed"
            ? "assets/embed-app.js"
            : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith(".css"))
            ? "assets/app-[hash][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
})
